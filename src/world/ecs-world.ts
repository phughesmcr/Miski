import type { ComponentInstance } from "@/component/component-instance.ts";
import type { BorrowedEntityList, Entity } from "@/entity/entity.ts";
import { Prefab } from "@/prefab/prefab.ts";
import { Query } from "@/query/query.ts";
import {
  compileComponentSchema,
  type CompiledComponentSchema,
  createComponentRegistry,
  type RegistryFromMaps,
  type SchemaComponentMap,
  type TagMap,
} from "@/schema/schema.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { ComponentValue } from "@/types/partitions.ts";
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

/** Configuration for a typed named-map ECS world. */
export type EcsWorldConfig<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
> = {
  readonly capacity: number;
  readonly components: M;
  readonly tags?: T;
};

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
> {
  /** Entity lifecycle, attach/detach, and other low-level ECS operations. */
  readonly world: World;
  /** Component definitions for query and attach APIs (data + tags). */
  readonly components: RegistryFromMaps<M, T>;
  /** Flat storage handles keyed by component/tag name. */
  readonly storage: StorageFromMap<M, T>;
  /** Maximum number of simultaneously active entities. */
  readonly capacity: number;
  /** Tag names registered on this world (for spawn dispatch). */
  readonly #tagNames: ReadonlySet<string>;
  /** Reusable bundle passed to the world by {@link EcsWorld.spawn}. */
  readonly #spawnBundle: SpawnTuple[] = [];
  /** Reusable bundle tuples keyed by component/tag name. */
  readonly #spawnTuples: Record<string, SpawnTuple> = Object.create(null);
  /** Whether a {@link EcsWorld.spawn} call is in progress (the shared scratch is in use). */
  #spawning = false;
  /** Reusable override bundle passed to the world by {@link EcsWorld.instantiate}. */
  readonly #overrideBundle: SpawnTuple[] = [];
  /** Reusable override tuples keyed by component/tag name. */
  readonly #overrideTuples: Record<string, SpawnTuple> = Object.create(null);
  /** Whether an instantiate call is in progress (the override scratch is in use). */
  #instantiating = false;

  /** Create a typed world, optionally reusing precompiled component definitions. */
  constructor(
    config: EcsWorldConfig<M, T>,
    definitions: RegistryFromMaps<M, T> = createComponentRegistry(config.components, config.tags),
  ) {
    this.components = Object.create(null) as RegistryFromMaps<M, T>;
    this.storage = Object.create(null) as StorageFromMap<M, T>;
    this.capacity = config.capacity;
    this.#tagNames = new Set(config.tags === undefined ? [] : Object.keys(config.tags));

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
    this.world = new World({ capacity: config.capacity, components: componentList });
    for (const name of keysOf(this.components)) {
      const key = String(name);
      (this.storage as Record<string, unknown>)[key] = this.world.components.require(
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

  /** Create an entity with the named components/tags and initial values in `spec`. */
  spawn(spec: SpawnSpec<M, T>): Entity {
    // Reused bundle and per-component tuples: the world only reads them during the call. A nested spawn
    // (from a getter on the spec or its data) gets fresh ones so it cannot clobber the outer call's.
    const nested = this.#spawning;
    const bundle: SpawnTuple[] = nested ? [] : this.#spawnBundle;
    const tuples: Record<string, SpawnTuple> = nested ? Object.create(null) : this.#spawnTuples;
    this.#spawning = true;
    let count = 0;
    try {
      for (const key in spec) {
        if (!Object.hasOwn(spec, key)) continue;
        const component = (this.components as Record<string, DynamicComponent | undefined>)[key];
        if (component === undefined) {
          throw new Error(`Unknown component "${key}" in spawn spec.`);
        }
        const value = (spec as Record<string, unknown>)[key];
        // `undefined` means absent, matching data keys and the optional `?: true` SpawnSpec shape.
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
      // The mapped SpawnSpec already proved each runtime tuple against its named component.
      return this.world.entities.createWithOrThrow(bundle as never);
    } finally {
      if (!nested) {
        this.#spawning = false;
        // Drop references to caller-owned data so the scratch never retains it.
        for (let i = 0; i < count; i++) {
          const tuple = bundle[i]!;
          if (tuple.length === 2) tuple[1] = undefined;
        }
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
   * @throws {CapacityError} - If the world's entity capacity is exhausted
   */
  instantiate(prefab: Prefab, overrides?: SpawnSpec<M, T>): Entity {
    return this.#instantiate(prefab, undefined, overrides) as Entity;
  }

  /**
   * Create `count` entities from a prefab, all or nothing, with the same overrides.
   * @returns a borrowed list of the new entities, valid until the next instantiate or world mutation
   * @throws {CapacityError} - If fewer than `count` entity slots are free
   */
  instantiateMany(prefab: Prefab, count: number, overrides?: SpawnSpec<M, T>): BorrowedEntityList {
    return this.#instantiate(prefab, count, overrides) as BorrowedEntityList;
  }

  #instantiate(
    prefab: Prefab,
    count: number | undefined,
    overrides: SpawnSpec<M, T> | undefined,
  ): Entity | BorrowedEntityList {
    const entities = this.world.entities;
    if (overrides === undefined) {
      return count === undefined ? entities.instantiateOrThrow(prefab) : entities.instantiateManyOrThrow(prefab, count);
    }
    // Same reuse rules as spawn: a nested call (from a getter on the overrides) gets fresh scratch.
    const nested = this.#instantiating;
    const bundle: SpawnTuple[] = nested ? [] : this.#overrideBundle;
    this.#instantiating = true;
    try {
      this.#fillBundle(overrides, bundle, nested ? Object.create(null) : this.#overrideTuples);
      // The mapped SpawnSpec already proved each runtime tuple against its named component.
      return count === undefined ?
        entities.instantiateOrThrow(prefab, bundle as never) :
        entities.instantiateManyOrThrow(prefab, count, bundle as never);
    } finally {
      if (!nested) {
        this.#instantiating = false;
        // Drop references to caller-owned data so the scratch never retains it.
        for (let i = 0; i < bundle.length; i++) {
          const tuple = bundle[i]!;
          if (tuple.length === 2) tuple[1] = undefined;
        }
      }
    }
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

/** Bootstrap a typed ECS world from a component map (and optional tags). */
export function createEcsWorld<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
>(config: EcsWorldConfig<M, T>): EcsWorld<M, T> {
  return new EcsWorld(config);
}

/** Create storage from one already-compiled schema truth object. */
export function createEcsWorldFromSchema<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
>(
  capacity: number,
  schema: CompiledComponentSchema<M, T>,
): EcsWorld<M, T> {
  return new EcsWorld(
    { capacity, components: schema.componentMap, tags: schema.tagMap },
    schema.components,
  );
}

/** Compile then create; useful when the caller also needs the schema hash. */
export function createEcsWorldWithSchema<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
>(
  config: EcsWorldConfig<M, T>,
): { ecs: EcsWorld<M, T>; schema: CompiledComponentSchema<M, T> } {
  const schema = compileComponentSchema(config.components, config.tags);
  return { ecs: createEcsWorldFromSchema(config.capacity, schema), schema };
}
