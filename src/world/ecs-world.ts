import type { ComponentInstance } from "@/component/component-instance.ts";
import type { BorrowedEntityList, Entity } from "@/entity/entity.ts";
import { Prefab } from "@/prefab/prefab.ts";
import { Query } from "@/query/query.ts";
import {
  type CompiledComponentSchema,
  createComponentRegistry,
  type RegistryFromMaps,
  type SchemaComponentMap,
  type TagMap,
} from "@/schema/schema.ts";
import { Relation, type RelationDeletePolicy } from "@/relation/relation.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { ComponentValue, TypedArrayConstructor } from "@/types/partitions.ts";
import { World } from "@/world/world.ts";

/** Storage handles for data components keyed by name. */
export type DataStorageFromMap<M extends SchemaComponentMap> = {
  [K in keyof M]: ComponentInstance<ComponentValue<M[K]>, M[K]>;
};

/** Storage handles for tag components keyed by name. */
export type TagStorageFromMap<T extends TagMap> = {
  [K in keyof T]: ComponentInstance<null, null>;
};

/** Flat storage handles for data + tag components. */
export type StorageFromMap<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
> = DataStorageFromMap<M> & TagStorageFromMap<T>;

/** Typed spawn spec: data keys take partial values; tag keys take `true`. */
export type SpawnSpec<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
> =
  & { [K in keyof M]?: Partial<ComponentValue<M[K]>> }
  & { [K in keyof T]?: true };

/** Options for one relation declared by name in {@link EcsWorldConfig.relations}. */
export type RelationOptions = {
  readonly exclusive?: boolean;
  readonly acyclic?: boolean;
  readonly onDeleteTarget?: RelationDeletePolicy;
  readonly schema?: Readonly<Record<string, TypedArrayConstructor>> | null;
};

/** Relations declared by name. */
export type RelationMap = Readonly<Record<string, RelationOptions>>;

/** Typed relation definitions for a {@link RelationMap}. */
export type RelationsFromMap<R extends RelationMap> = {
  readonly [K in keyof R]: R[K] extends { readonly schema: infer S extends Record<string, TypedArrayConstructor> } ?
    Relation<S> :
    Relation<null>;
};

/**
 * Configuration for a typed named-map ECS world.
 *
 * Declare components either inline (`components` and optional `tags`) or as one precompiled `schema` from
 * `compileComponentSchema` / `mergeComponentSchemas`, which keeps that schema's component identities and
 * hash. The two forms are exclusive.
 */
export type EcsWorldConfig<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
  R extends RelationMap = Record<never, never>,
> =
  & {
    /** Maximum number of simultaneously active entities. */
    readonly capacity: number;
    /** Relations by name; each becomes a {@link Relation} on {@link EcsWorld.relations}. */
    readonly relations?: R;
  }
  & (
    | {
      /** Data components by name. */
      readonly components: M;
      /** Tag components by name. */
      readonly tags?: T;
      readonly schema?: never;
    }
    | {
      /** A precompiled component schema; the world reuses its component definitions. */
      readonly schema: CompiledComponentSchema<M, T>;
      readonly components?: never;
      readonly tags?: never;
    }
  );

/** Options for {@link EcsWorld.prefab}. */
export type EcsPrefabOptions = {
  /** Label used in tooling and error messages. */
  readonly name?: string;
  /** Parent template; its components come first and this spec's fields override it. */
  readonly extends?: Prefab;
};

/** Mutable spawn bundle entry: `[component]` for tags, `[component, data]` for data components. */
type SpawnTuple = [DynamicComponent] | [DynamicComponent, unknown];

function keysOf<T extends object>(value: T): (keyof T)[] {
  return Object.keys(value) as (keyof T)[];
}

/** Drop references to caller-owned data so reused scratch never retains it. */
function releaseBundle(bundle: SpawnTuple[]): void {
  for (let i = 0; i < bundle.length; i++) {
    const tuple = bundle[i]!;
    if (tuple.length === 2) tuple[1] = undefined;
  }
}

/**
 * Primary developer surface for a typed ECS world.
 *
 * - Component map keys, `storage` accessors, and spawn keys share one name.
 * - Tags are declared beside data components via {@link EcsWorldConfig.tags}.
 * - Entity lifecycle lives on {@link EcsWorld.world}.
 */
export class EcsWorld<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
  R extends RelationMap = Record<never, never>,
> {
  /** Entity lifecycle, attach/detach, and other low-level ECS operations. */
  readonly world: World;
  /** Component definitions for query and attach APIs (data + tags). */
  readonly components: RegistryFromMaps<M, T>;
  /** Flat storage handles keyed by component/tag name. */
  readonly storage: StorageFromMap<M, T>;
  /** Relation definitions keyed by name, for `world.relations` and queries. */
  readonly relations: RelationsFromMap<R>;
  /** Maximum number of simultaneously active entities. */
  readonly capacity: number;
  /** Tag names registered on this world (for spawn dispatch). */
  readonly #tagNames: ReadonlySet<string>;
  /** Reusable bundle passed to the world by {@link EcsWorld.spawn} / {@link EcsWorld.spawnOrThrow}. */
  readonly #spawnBundle: SpawnTuple[] = [];
  /** Reusable bundle tuples keyed by component/tag name. */
  readonly #spawnTuples: Record<string, SpawnTuple> = Object.create(null);
  /** Whether a spawn call is in progress (the shared scratch is in use). */
  #spawning = false;
  /** Reusable override bundle passed to the world by the instantiate methods. */
  readonly #overrideBundle: SpawnTuple[] = [];
  /** Reusable override tuples keyed by component/tag name. */
  readonly #overrideTuples: Record<string, SpawnTuple> = Object.create(null);
  /** Whether an instantiate call is in progress (the override scratch is in use). */
  #instantiating = false;

  /**
   * Create a typed world from inline component maps or a precompiled schema.
   * @throws {TypeError} - If the config passes both `schema` and `components`/`tags`
   */
  constructor(config: EcsWorldConfig<M, T, R>) {
    let definitions: RegistryFromMaps<M, T>;
    let tags: T | undefined;
    if (config.schema !== undefined) {
      if (config.components !== undefined || config.tags !== undefined) {
        throw new TypeError("EcsWorldConfig takes either `schema` or `components`/`tags`, not both.");
      }
      definitions = config.schema.components;
      tags = config.schema.tagMap;
    } else {
      definitions = createComponentRegistry(config.components, config.tags);
      tags = config.tags;
    }
    this.components = Object.create(null) as RegistryFromMaps<M, T>;
    this.storage = Object.create(null) as StorageFromMap<M, T>;
    this.capacity = config.capacity;
    this.#tagNames = new Set(tags === undefined ? [] : Object.keys(tags));

    const componentList: DynamicComponent[] = [];
    for (const name of keysOf(definitions)) {
      const component = definitions[name];
      if (component === undefined) {
        throw new Error(`Compiled schema is missing component "${String(name)}".`);
      }
      (this.components as Record<string, DynamicComponent>)[String(name)] = component;
      componentList.push(component);
    }

    Object.freeze(this.components);
    this.relations = Object.create(null) as RelationsFromMap<R>;
    if (config.relations !== undefined) {
      for (const name of Object.keys(config.relations)) {
        const relation = new Relation({ name, ...config.relations[name] } as ConstructorParameters<typeof Relation>[0]);
        (this.relations as Record<string, Relation<never>>)[name] = relation as Relation<never>;
        componentList.push(relation);
      }
    }
    Object.freeze(this.relations);
    this.world = new World({ capacity: config.capacity, components: componentList });
    for (const name of keysOf(this.components)) {
      const key = String(name);
      (this.storage as Record<string, unknown>)[key] = this.world.components.getInstanceOrThrow(
        (this.components as Record<string, DynamicComponent>)[key]!,
      );
    }
    Object.freeze(this.storage);
  }

  /** Ensure the underlying world is initialized. */
  async init(): Promise<void> {
    await this.world.init();
  }

  /** Create an all-components query. */
  query(...components: DynamicComponent[]): Query {
    return new Query({ all: components });
  }

  /**
   * Create an entity with the named components/tags and initial values in `spec`, all or nothing.
   * @returns the new entity (handle `0` is valid; compare with `=== undefined`), or `undefined` if the world is at
   * capacity
   * @throws {Error} - If `spec` names an unknown component, a tag value is not `true`, or a value fails validation
   */
  spawn(spec: SpawnSpec<M, T>): Entity | undefined {
    return this.#spawn(spec, false);
  }

  /**
   * Create an entity with the named components/tags and initial values in `spec`, all or nothing.
   * @throws {CapacityError} - If the world's entity capacity is exhausted
   * @throws {Error} - If `spec` names an unknown component, a tag value is not `true`, or a value fails validation
   */
  spawnOrThrow(spec: SpawnSpec<M, T>): Entity {
    return this.#spawn(spec, true)!;
  }

  #spawn(spec: SpawnSpec<M, T>, orThrow: boolean): Entity | undefined {
    // Reused bundle and per-component tuples: the world only reads them during the call. A nested spawn
    // (from a getter on the spec or its data) gets fresh ones so it cannot clobber the outer call's.
    const nested = this.#spawning;
    const bundle: SpawnTuple[] = nested ? [] : this.#spawnBundle;
    this.#spawning = true;
    try {
      this.#fillBundle(spec, bundle, nested ? Object.create(null) : this.#spawnTuples);
      // The mapped SpawnSpec already proved each runtime tuple against its named component.
      return orThrow ? this.world.entities.createOrThrow(bundle as never) : this.world.entities.create(bundle as never);
    } finally {
      if (!nested) {
        this.#spawning = false;
        releaseBundle(bundle);
      }
    }
  }

  /**
   * Define a {@link Prefab} from a named spec: data keys take partial defaults (omitted fields are zero), tag keys
   * take `true`. The prefab works in any world that registers the same component definitions.
   */
  prefab(spec: SpawnSpec<M, T>, options: EcsPrefabOptions = {}): Prefab {
    const bundle: SpawnTuple[] = [];
    this.#fillBundle(spec, bundle, Object.create(null));
    return new Prefab({ name: options.name, extends: options.extends, components: bundle as never });
  }

  /**
   * Create an entity from a prefab; `overrides` merge field by field over its defaults and may add components.
   * @returns the new entity, or `undefined` if the world is at capacity
   */
  instantiate(prefab: Prefab, overrides?: SpawnSpec<M, T>): Entity | undefined {
    return this.#instantiate(prefab, undefined, overrides, false) as Entity | undefined;
  }

  /**
   * Create an entity from a prefab; `overrides` merge field by field over its defaults and may add components.
   * @throws {CapacityError} - If the world's entity capacity is exhausted
   */
  instantiateOrThrow(prefab: Prefab, overrides?: SpawnSpec<M, T>): Entity {
    return this.#instantiate(prefab, undefined, overrides, true) as Entity;
  }

  /**
   * Create `count` entities from a prefab, all or nothing, with the same overrides. Object override values are
   * shared by every new entity; prefab object defaults are cloned per entity.
   * @returns a borrowed list of the new entities, valid until the next instantiate or world mutation, or `undefined`
   * if fewer than `count` entity slots are free
   */
  instantiateMany(prefab: Prefab, count: number, overrides?: SpawnSpec<M, T>): BorrowedEntityList | undefined {
    return this.#instantiate(prefab, count, overrides, false) as BorrowedEntityList | undefined;
  }

  /**
   * Create `count` entities from a prefab, all or nothing, with the same overrides. Object override values are
   * shared by every new entity; prefab object defaults are cloned per entity.
   * @returns a borrowed list of the new entities, valid until the next instantiate or world mutation
   * @throws {CapacityError} - If fewer than `count` entity slots are free
   */
  instantiateManyOrThrow(prefab: Prefab, count: number, overrides?: SpawnSpec<M, T>): BorrowedEntityList {
    return this.#instantiate(prefab, count, overrides, true) as BorrowedEntityList;
  }

  #instantiate(
    prefab: Prefab,
    count: number | undefined,
    overrides: SpawnSpec<M, T> | undefined,
    orThrow: boolean,
  ): Entity | BorrowedEntityList | undefined {
    if (overrides === undefined) return this.#instantiateBundle(prefab, count, undefined, orThrow);
    // Same reuse rules as spawn: a nested call (from a getter on the overrides) gets fresh scratch.
    const nested = this.#instantiating;
    const bundle: SpawnTuple[] = nested ? [] : this.#overrideBundle;
    this.#instantiating = true;
    try {
      this.#fillBundle(overrides, bundle, nested ? Object.create(null) : this.#overrideTuples);
      return this.#instantiateBundle(prefab, count, bundle, orThrow);
    } finally {
      if (!nested) {
        this.#instantiating = false;
        releaseBundle(bundle);
      }
    }
  }

  #instantiateBundle(
    prefab: Prefab,
    count: number | undefined,
    bundle: SpawnTuple[] | undefined,
    orThrow: boolean,
  ): Entity | BorrowedEntityList | undefined {
    const entities = this.world.entities;
    // The mapped SpawnSpec already proved each runtime tuple against its named component.
    const overrides = bundle as never;
    if (count === undefined) {
      return orThrow ? entities.instantiateOrThrow(prefab, overrides) : entities.instantiate(prefab, overrides);
    }
    return orThrow ?
      entities.instantiateManyOrThrow(prefab, count, overrides) :
      entities.instantiateMany(prefab, count, overrides);
  }

  /** Resolve a named spec into `bundle` (trimmed to the entries written), reusing `tuples` by name. */
  #fillBundle(spec: SpawnSpec<M, T>, bundle: SpawnTuple[], tuples: Record<string, SpawnTuple>): void {
    let count = 0;
    for (const key in spec) {
      if (!Object.hasOwn(spec, key)) continue;
      const component = (this.components as Record<string, DynamicComponent | undefined>)[key];
      if (component === undefined) {
        throw new Error(`Unknown component "${key}" in spawn spec.`);
      }
      const value = (spec as Record<string, unknown>)[key];
      if (value === undefined) continue;
      let tuple = tuples[key];
      if (this.#tagNames.has(key)) {
        if (value !== true) {
          throw new TypeError(`Tag "${key}" must be spawned with true.`);
        }
        tuple ??= tuples[key] = [component];
      } else {
        tuple ??= tuples[key] = [component, undefined];
        tuple[1] = value;
      }
      bundle[count++] = tuple;
    }
    if (bundle.length !== count) bundle.length = count;
  }

  /** Run one tick, then clear enter/exit transition sets. */
  frame<TReturn>(fn: () => TReturn): TReturn {
    return this.world.frame(fn);
  }
}

/**
 * Bootstrap a typed ECS world from a component map (and optional tags and relations), or from a precompiled schema
 * passed as `schema`.
 */
export function createEcsWorld<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
  R extends RelationMap = Record<never, never>,
>(config: EcsWorldConfig<M, T, R>): EcsWorld<M, T, R> {
  return new EcsWorld(config);
}
