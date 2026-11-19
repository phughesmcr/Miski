import { type Entity, entityIndex } from "@/entity/entity.ts";
import {
  EntityNotFoundError,
  formatComponentNotRegistered,
  formatEntityNotActive,
  NotRegisteredError,
} from "@/errors.ts";
import type { Query } from "@/query/query.ts";
import type { DynamicComponent, DynamicComponentInstance } from "@/types/component.ts";
import type { QueryInstance } from "@/types/query.ts";
import type { SchemaOrNull } from "@/types/partitions.ts";
import type {
  AnyRelation,
  BorrowedHierarchyList,
  BorrowedRelationList,
  RelationInstance,
  WorldRelationAPI,
} from "@/types/world-relation-api.ts";
import type { Relation } from "./relation.ts";
import { isRelation } from "./relation.ts";
import {
  chainReaches,
  NONE,
  RelationStore,
  type RelationStoreHost,
  type RelationStoreSnapshot,
} from "./relation-store.ts";

/** Rollback capture of every relation store, in registration order. */
export type RelationManagerSnapshot = readonly RelationStoreSnapshot[];

/** Captured pairs of one source for a component checkpoint. */
export type RelationPairs = {
  readonly targets: readonly Entity[];
  readonly data: readonly Readonly<Record<string, number>>[];
};

/** World services the relation manager needs on top of the store host. */
export type RelationManagerHost = RelationStoreHost & {
  getInstance(component: DynamicComponent): DynamicComponentInstance | undefined;
  registerQuery(query: Query): QueryInstance;
};

/** Owns every relation store of a world and the cross-relation work (destroy cascades, rollback). */
export class RelationManager {
  /** Stores by component instance id. */
  readonly #byInstance: (RelationStore | undefined)[] = [];
  readonly #stores: RelationStore[] = [];
  readonly #cascadeStores: RelationStore[] = [];
  readonly #host: RelationManagerHost;
  /** Destroy work stack and doomed marks, by slot. */
  readonly #stack: Uint32Array;
  readonly #doomed: Uint8Array;
  /** Traversal visited marks, by slot. */
  readonly #visited: Uint8Array;

  constructor(host: RelationManagerHost, components: readonly DynamicComponent[]) {
    this.#host = host;
    for (const component of components) {
      if (!isRelation(component)) continue;
      const instance = host.getInstance(component)!;
      const store = new RelationStore(component, instance, host);
      this.#byInstance[instance.id] = store;
      this.#stores.push(store);
      if (store.cascade) this.#cascadeStores.push(store);
    }
    // A world without relations only needs the API's NotRegisteredError paths.
    const scratch = this.#stores.length === 0 ? 0 : host.capacity;
    this.#stack = new Uint32Array(scratch);
    this.#doomed = new Uint8Array(scratch);
    this.#visited = new Uint8Array(scratch);
  }

  /** @returns `true` if the world registers at least one relation */
  static hasRelations(components: readonly DynamicComponent[]): boolean {
    for (const component of components) if (isRelation(component)) return true;
    return false;
  }

  /** Component instances that are relation presence tags. */
  get instances(): DynamicComponentInstance[] {
    return this.#stores.map((store) => store.instance);
  }

  /** @returns `true` if `component` is a relation registered in this world */
  isRegisteredRelation(component: DynamicComponent): boolean {
    return this.#find(component) !== undefined;
  }

  /** @returns the store of a relation registered in this world, or `undefined` */
  #find(relation: AnyRelation | DynamicComponent): RelationStore | undefined {
    const instance = this.#host.getInstance(relation);
    return instance === undefined ? undefined : this.#byInstance[instance.id];
  }

  /** @throws {NotRegisteredError} - If `relation` is not a relation registered in this world */
  store(relation: AnyRelation | DynamicComponent): RelationStore {
    const store = this.#find(relation);
    if (store === undefined) throw new NotRegisteredError(formatComponentNotRegistered(relation.name));
    return store;
  }

  /**
   * Destroy an active entity and, through cascade relations, every source that depends on it.
   * Gathers the doomed set iteratively (no recursion, terminates on cycles), detaches all pairs, then destroys.
   */
  destroyEntity(entity: Entity, destroyCore: (entity: Entity) => void): void {
    const stack = this.#stack;
    const doomed = this.#doomed;
    const rootSlot = entityIndex(entity);
    stack[0] = rootSlot;
    doomed[rootSlot] = 1;
    let length = 1;
    for (let i = 0; i < length; i++) {
      const slot = stack[i]!;
      for (let s = 0; s < this.#cascadeStores.length; s++) {
        const store = this.#cascadeStores[s]!;
        for (let row = store.targetHead[slot]!; row !== NONE; row = store.nextByTarget[row]!) {
          const source = store.rowSource[row]!;
          if (doomed[source] === 0) {
            doomed[source] = 1;
            stack[length++] = source;
          }
        }
      }
    }
    try {
      for (let i = 0; i < length; i++) {
        for (let s = 0; s < this.#stores.length; s++) this.#stores[s]!.detach(stack[i]!, doomed);
      }
      for (let i = 0; i < length; i++) {
        const slot = stack[i]!;
        destroyCore(i === 0 ? entity : this.#host.packSlot(slot));
      }
    } finally {
      for (let i = 0; i < length; i++) doomed[stack[i]!] = 0;
    }
  }

  refresh(): void {
    for (let i = 0; i < this.#stores.length; i++) this.#stores[i]!.clearChanged();
  }

  captureState(): RelationManagerSnapshot {
    return this.#stores.map((store) => store.captureState());
  }

  restoreState(snapshot: RelationManagerSnapshot): void {
    for (let i = 0; i < this.#stores.length; i++) this.#stores[i]!.restoreState(snapshot[i]!);
  }

  // ---------------------------------------------------------------- checkpoints

  capturePairs(source: Entity, component: DynamicComponent): RelationPairs {
    return this.store(component).capturePairs(source);
  }

  /** Check that restoring `entries` cannot fail: live targets, and no cycle for acyclic relations. */
  preflightPairs(
    component: DynamicComponent,
    entries: readonly { readonly entity: Entity; readonly pairs: RelationPairs }[],
  ): void {
    const store = this.store(component);
    for (const { pairs } of entries) {
      for (const target of pairs.targets) {
        if (!this.#host.isActive(target)) throw new EntityNotFoundError(formatEntityNotActive(target));
      }
    }
    if (!store.acyclic) return;
    // Parents after the restore: captured entries override the current hierarchy. Acyclic implies exclusive, so
    // each entry has at most one target.
    const overrides = new Map<number, Entity | undefined>();
    for (const { entity, pairs } of entries) overrides.set(entityIndex(entity), pairs.targets[0]);
    const parentOf = (entity: Entity): Entity | undefined => {
      const slot = entityIndex(entity);
      return overrides.has(slot) ? overrides.get(slot) : store.parentOf(slot);
    };
    for (const { entity, pairs } of entries) {
      if (chainReaches(pairs.targets[0], entity, parentOf, this.#host.capacity)) {
        throw new RangeError(`Relation "${store.name}" checkpoint would form a cycle through ${entity}.`);
      }
    }
  }

  restorePairs(source: Entity, component: DynamicComponent, pairs: RelationPairs): void {
    this.store(component).replacePairs(source, pairs.targets, pairs.data);
  }

  // ---------------------------------------------------------------- public API

  /** Build the public `world.relations` API. */
  createAPI(assertInitialized: () => void): WorldRelationAPI {
    const visited = this.#visited;
    const host = this.#host;
    const api: WorldRelationAPI = {
      add: (relation, source, target, data) => {
        assertInitialized();
        this.store(relation).add(source, target, data as Readonly<Record<string, number>> | undefined);
      },
      remove: (relation, source, target) => {
        assertInitialized();
        return this.store(relation).remove(source, target);
      },
      removeAll: (relation, source) => {
        assertInitialized();
        return this.store(relation).removeAll(source);
      },
      has: (relation, source, target) => {
        assertInitialized();
        return this.store(relation).rowOf(source, target) !== NONE;
      },
      hasAny: (relation, source) => {
        assertInitialized();
        const store = this.store(relation);
        return host.isActive(source) && store.sourceCount[entityIndex(source)] !== 0;
      },
      getTarget: (relation, source) => {
        assertInitialized();
        const store = this.store(relation);
        if (!host.isActive(source)) return undefined;
        const row = store.sourceHead[entityIndex(source)]!;
        return row === NONE ? undefined : store.rowTarget[row] as Entity;
      },
      getTargets: (relation, source) => {
        assertInitialized();
        return this.store(relation).fillTargets(source) as unknown as BorrowedRelationList;
      },
      getSources: (relation, target) => {
        assertInitialized();
        return this.store(relation).fillSources(target) as unknown as BorrowedRelationList;
      },
      getAllTargets: (relation) => {
        assertInitialized();
        return this.store(relation).fillAllTargets() as unknown as BorrowedRelationList;
      },
      queryList: (relation, target, query) => {
        assertInitialized();
        const store = this.store(relation);
        return store.fillQuery(host.registerQuery(query), target) as unknown as BorrowedRelationList;
      },
      getData: <TSchema extends SchemaOrNull>(relation: Relation<TSchema>, source: Entity, target: Entity) => {
        assertInitialized();
        const store = this.store(relation);
        const row = store.rowOf(source, target);
        if (row === NONE) return undefined;
        const out: Record<string, number> = {};
        store.readRow(row, out);
        return out as never;
      },
      readDataInto: (relation, source, target, out) => {
        assertInitialized();
        const store = this.store(relation);
        const row = store.rowOf(source, target);
        if (row === NONE) return false;
        store.readRow(row, out as Record<string, number>);
        return true;
      },
      setData: (relation, source, target, data) => {
        assertInitialized();
        this.store(relation).setData(source, target, data as Readonly<Record<string, number>>);
      },
      getChanged: (relation) => {
        assertInitialized();
        return this.store(relation).changed();
      },
      traverse: (relation, root) => {
        assertInitialized();
        return this.store(relation).traverse(root, visited) as unknown as BorrowedHierarchyList;
      },
      getInstance: <TSchema extends SchemaOrNull>(relation: Relation<TSchema>) => {
        assertInitialized();
        return this.#find(relation)?.view as RelationInstance<TSchema> | undefined;
      },
      getInstanceOrThrow: <TSchema extends SchemaOrNull>(relation: Relation<TSchema>) => {
        assertInitialized();
        return this.store(relation).view as RelationInstance<TSchema>;
      },
    };
    return Object.freeze(api);
  }
}
