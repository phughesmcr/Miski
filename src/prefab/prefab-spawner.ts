import type { Archetype } from "@/archetype/archetype.ts";
import {
  assertBundleArray,
  assertBundleEntry,
  duplicateComponentError,
  relationComponentError,
} from "@/component/bundle-entry.ts";
import type { ComponentManager, ComponentTemplateRow } from "@/component/component-manager.ts";
import { asSlotIndex, type BorrowedEntityList, type Entity, entityIndex } from "@/entity/entity.ts";
import type { EntityManager } from "@/entity/entity-manager.ts";
import {
  ArgumentError,
  CapacityError,
  componentDisplayName,
  formatComponentNotRegistered,
  maxOwnersError,
  NotRegisteredError,
} from "@/errors.ts";
import { QueryEntityResult } from "@/query/query-pool.ts";
import type { ComponentBundleEntryInput } from "@/types/component-bundle.ts";
import { isRelation } from "@/relation/relation.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { WorldMutations } from "@/world/world-mutations.ts";
import { Prefab, PREFAB_RELATION_ADVICE, prefabDefaults } from "./prefab.ts";

/** Dependencies required by {@link PrefabSpawner}. */
export type PrefabSpawnerDeps = {
  readonly entityManager: EntityManager;
  readonly componentManager: ComponentManager;
  readonly componentCount: number;
  /** The world's `create(bundle)` path, which places, publishes and discards created entities. */
  readonly mutations: Pick<WorldMutations, "publishCreatedEntity" | "discardCreatedEntity">;
};

/** A prefab compiled against one world's registration: resolved instances and defaults in column order. */
type PrefabPlan = {
  readonly instances: readonly DynamicComponentInstance[];
  /** Default row per instance in this world's column order; `null` for tags. */
  readonly rows: readonly (ComponentTemplateRow | null)[];
  /** Plan index by instance id, or -1 when the prefab lacks the component. */
  readonly indexById: Int32Array;
  /** Instances with an owner cap, preflighted before allocation. */
  readonly capped: readonly DynamicComponentInstance[];
};

/**
 * Per-call staging; one per nesting depth so a getter or field hook that instantiates cannot clobber its caller.
 */
type OverrideStaging = {
  /** Override payload by instance id (`undefined` when absent or payload-less). */
  readonly data: (Record<string, unknown> | undefined)[];
  /** Duplicate-detection flags by instance id. */
  readonly seen: Uint8Array;
  /** Override instance ids, for O(overrides) clearing. */
  readonly ids: number[];
  idCount: number;
  /** Overridden components the prefab lacks, appended after the prefab's own. */
  readonly extras: DynamicComponentInstance[];
  extraCount: number;
  /** Every component of one instance, in archetype-transition order. */
  readonly added: DynamicComponentInstance[];
  /** Borrowed result of the last bulk instantiate at this depth (allocated on first use). */
  list: QueryEntityResult | undefined;
};

/**
 * Instantiates {@link Prefab} templates in one world.
 *
 * Instantiation is observationally identical to `create(bundle)` with the prefab's flattened bundle followed by the
 * overrides the prefab lacks: same handles, ownership and changed order, values, archetype path, entered order and
 * revision sequence. Every check (payloads, owner caps, capacity) finishes before the first allocation, so a rejected
 * call allocates nothing, consumes no generation and publishes no transition. Each entity is placed, published and (on
 * an unexpected failure) discarded by the same {@link WorldMutations} helpers `create(bundle)` uses.
 */
export class PrefabSpawner {
  readonly #entityManager: EntityManager;
  readonly #componentManager: ComponentManager;
  readonly #componentCount: number;
  readonly #mutations: PrefabSpawnerDeps["mutations"];

  /** Compiled plans; weak so discarded prefabs do not outlive their last use. */
  readonly #plans: WeakMap<Prefab, PrefabPlan> = new WeakMap();

  /** Override staging by nesting depth (allocated on first use). */
  readonly #staging: OverrideStaging[] = [];

  #depth = 0;

  constructor(deps: PrefabSpawnerDeps) {
    this.#entityManager = deps.entityManager;
    this.#componentManager = deps.componentManager;
    this.#componentCount = deps.componentCount;
    this.#mutations = deps.mutations;
  }

  /**
   * Create one entity from a prefab.
   * @returns the new entity, or `undefined` at capacity when `throwOnCapacity` is false
   */
  instantiate(
    prefab: Prefab,
    overrides: readonly ComponentBundleEntryInput[] | undefined,
    throwOnCapacity: boolean,
  ): Entity | undefined {
    const staging = this.#enter();
    try {
      const plan = this.#preflight(prefab, overrides, 1, throwOnCapacity, staging);
      return plan === undefined ? undefined : this.#commit(plan, staging, 1, undefined);
    } finally {
      this.#leave(staging);
    }
  }

  /**
   * Create `count` entities from a prefab, all or nothing.
   * @returns a borrowed list of the new entities in allocation order, valid until the next instantiate or world
   * mutation, or `undefined` when they do not all fit and `throwOnCapacity` is false
   */
  instantiateMany(
    prefab: Prefab,
    count: number,
    overrides: readonly ComponentBundleEntryInput[] | undefined,
    throwOnCapacity: boolean,
  ): BorrowedEntityList | undefined {
    if (!Number.isInteger(count) || count < 0) {
      throw new ArgumentError(`Prefab instance count ${count} must be a non-negative integer.`);
    }
    const staging = this.#enter();
    try {
      const plan = this.#preflight(prefab, overrides, count, throwOnCapacity, staging);
      if (plan === undefined) return undefined;
      const list = staging.list ??= new QueryEntityResult(this.#entityManager.capacity);
      list.clear();
      list.reserve(count);
      this.#commit(plan, staging, count, list);
      return list;
    } finally {
      this.#leave(staging);
    }
  }

  #enter(): OverrideStaging {
    const depth = this.#depth++;
    let staging = this.#staging[depth];
    if (staging === undefined) {
      staging = {
        data: new Array(this.#componentCount).fill(undefined),
        seen: new Uint8Array(this.#componentCount),
        ids: [],
        idCount: 0,
        extras: [],
        extraCount: 0,
        added: [],
        list: undefined,
      };
      this.#staging[depth] = staging;
    }
    return staging;
  }

  /** Drop staged references so caller-owned payloads are never retained. */
  #leave(staging: OverrideStaging): void {
    for (let i = 0; i < staging.idCount; i++) {
      const id = staging.ids[i]!;
      staging.seen[id] = 0;
      staging.data[id] = undefined;
    }
    staging.idCount = 0;
    staging.extraCount = 0;
    this.#depth--;
  }

  /** Resolve (and cache) a prefab's plan for this world. */
  #getPlan(prefab: Prefab): PrefabPlan {
    if (!(prefab instanceof Prefab)) throw new ArgumentError("Expected a Prefab.");
    const cached = this.#plans.get(prefab);
    if (cached !== undefined) return cached;
    const components = prefab.components;
    const defaults = prefabDefaults(prefab);
    const instances: DynamicComponentInstance[] = [];
    const rows: (ComponentTemplateRow | null)[] = [];
    const capped: DynamicComponentInstance[] = [];
    const indexById = new Int32Array(this.#componentCount).fill(-1);
    for (let i = 0; i < components.length; i++) {
      const component = components[i]!;
      const instance = this.#componentManager.getInstance(component);
      if (instance === undefined) {
        throw new NotRegisteredError(formatComponentNotRegistered(component.name));
      }
      const values = defaults[i]!;
      // Reorder the frozen name-keyed defaults into this world's column order.
      rows.push(values === null ? null : this.#componentManager.compileTemplateRow(instance, values));
      indexById[instance.id] = i;
      instances.push(instance);
      if ((component.maxEntities ?? 0) !== 0) capped.push(instance);
    }
    const plan: PrefabPlan = { instances, rows, indexById, capped };
    this.#plans.set(prefab, plan);
    return plan;
  }

  /**
   * Validate and stage everything before allocation.
   * @returns the plan, or `undefined` when the instances do not fit and `throwOnCapacity` is false
   */
  #preflight(
    prefab: Prefab,
    overrides: readonly ComponentBundleEntryInput[] | undefined,
    count: number,
    throwOnCapacity: boolean,
    staging: OverrideStaging,
  ): PrefabPlan | undefined {
    const plan = this.#getPlan(prefab);
    if (overrides !== undefined) this.#stageOverrides(plan, overrides, staging);

    const capped = plan.capped;
    for (let i = 0; i < capped.length; i++) this.#preflightCap(capped[i]!, count);
    for (let i = 0; i < staging.extraCount; i++) {
      const extra = staging.extras[i]!;
      if ((extra.type.maxEntities ?? 0) !== 0) this.#preflightCap(extra, count);
    }

    const available = this.#entityManager.getAvailableCount();
    if (available < count) {
      if (!throwOnCapacity) return undefined;
      const capacity = this.#entityManager.capacity;
      throw new CapacityError(
        count === 1 ?
          `World is at capacity (${capacity} entities).` :
          `World capacity cannot fit ${count} prefab instances (${available} of ${capacity} slots free).`,
      );
    }
    return plan;
  }

  #preflightCap(instance: DynamicComponentInstance, count: number): void {
    const maxEntities = instance.type.maxEntities ?? 0;
    if (this.#componentManager.getOwnerCount(instance.type) + count > maxEntities) {
      throw maxOwnersError(instance.type.name, maxEntities);
    }
  }

  /** Resolve, validate and stage override tuples (canonical values land in each component's scratch). */
  #stageOverrides(plan: PrefabPlan, overrides: readonly ComponentBundleEntryInput[], staging: OverrideStaging): void {
    assertBundleArray(overrides, "Prefab overrides");
    const componentManager = this.#componentManager;
    for (let i = 0; i < overrides.length; i++) {
      const entry: unknown = overrides[i];
      assertBundleEntry(entry, "Prefab override entries");
      const instance = componentManager.getInstance(entry[0]);
      if (instance === undefined) {
        throw new NotRegisteredError(formatComponentNotRegistered(componentDisplayName(entry[0])));
      }
      if (isRelation(instance.type)) {
        throw relationComponentError(instance.type.name, PREFAB_RELATION_ADVICE);
      }
      const id = instance.id;
      if (staging.seen[id] === 1) {
        throw duplicateComponentError(instance.type.name, "prefab overrides");
      }
      staging.seen[id] = 1;
      staging.ids[staging.idCount++] = id;
      if (entry.length === 2) {
        componentManager.validateInstanceData(instance, entry[1]);
        staging.data[id] = entry[1] as Record<string, unknown> | undefined;
      }
      if (plan.indexById[id] === -1) staging.extras[staging.extraCount++] = instance;
    }
  }

  /**
   * Create `count` preflighted instances. Only an unexpected internal failure can throw here; it removes every
   * instance this call created before rethrowing.
   * @returns the last entity created
   */
  #commit(
    plan: PrefabPlan,
    staging: OverrideStaging,
    count: number,
    list: QueryEntityResult | undefined,
  ): Entity | undefined {
    const entityManager = this.#entityManager;
    const componentManager = this.#componentManager;
    const mutations = this.#mutations;
    const { instances, rows } = plan;
    const added = staging.added;
    const data = staging.data;
    const instanceCount = instances.length;
    const total = instanceCount + staging.extraCount;
    for (let i = 0; i < instanceCount; i++) added[i] = instances[i]!;
    for (let i = 0; i < staging.extraCount; i++) added[instanceCount + i] = staging.extras[i]!;

    let target: Archetype | undefined;
    let last: Entity | undefined;
    let pending: Entity | undefined;
    try {
      for (let n = 0; n < count; n++) {
        const entity = entityManager.create()!;
        pending = entity;
        const slot = entityIndex(entity);
        for (let i = 0; i < instanceCount; i++) {
          const instance = instances[i]!;
          componentManager.addInstanceWithRow(instance, slot, rows[i]!, data[instance.id]);
        }
        for (let i = instanceCount; i < total; i++) {
          const instance = added[i]!;
          componentManager.addInstanceToEntity(
            instance,
            entity,
            data[instance.id] as Partial<Record<string, number>> | undefined,
            slot,
            true,
          );
        }
        // Every instance lands in the same archetype: resolve it once, then place the rest directly.
        target = mutations.publishCreatedEntity(entity, added, total, target);
        list?.add(entity, asSlotIndex(slot));
        pending = undefined;
        last = entity;
      }
    } catch (error) {
      if (pending !== undefined) mutations.discardCreatedEntity(pending, added, total);
      if (list !== undefined) {
        for (let i = 0; i < list.count; i++) mutations.discardCreatedEntity(list.entities[i]! as Entity, added, total);
        list.clear();
      } else if (last !== undefined) {
        mutations.discardCreatedEntity(last, added, total);
      }
      throw error;
    } finally {
      for (let i = 0; i < total; i++) added[i] = undefined as unknown as DynamicComponentInstance;
    }
    return last;
  }
}
