import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Entity } from "@/entity/entity.ts";
import { Query } from "@/query/query.ts";
import {
  compileComponentSchema,
  type CompiledComponentSchema,
  createComponentRegistry,
  type RegistryFromMaps,
  type SchemaComponentMap,
  type TagMap,
} from "@/schema/schema.ts";
import { Relation, type RelationDeletePolicy } from "@/relation/relation.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { ComponentValue, SchemaProperty } from "@/types/partitions.ts";
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
  readonly schema?: Readonly<Record<string, SchemaProperty>> | null;
};

/** Relations declared by name. */
export type RelationMap = Readonly<Record<string, RelationOptions>>;

/** Typed relation definitions for a {@link RelationMap}. */
export type RelationsFromMap<R extends RelationMap> = {
  readonly [K in keyof R]: R[K] extends { readonly schema: infer S extends Record<string, SchemaProperty> } ?
    Relation<S> :
    Relation<null>;
};

/** Configuration for a typed named-map ECS world. */
export type EcsWorldConfig<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
  R extends RelationMap = Record<never, never>,
> = {
  readonly capacity: number;
  readonly components: M;
  readonly tags?: T;
  /** Relations by name; each becomes a {@link Relation} on {@link EcsWorld.relations}. */
  readonly relations?: R;
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
  /** Reusable bundle passed to the world by {@link EcsWorld.spawn}. */
  readonly #spawnBundle: SpawnTuple[] = [];
  /** Reusable bundle tuples keyed by component/tag name. */
  readonly #spawnTuples: Record<string, SpawnTuple> = Object.create(null);
  /** Whether a {@link EcsWorld.spawn} call is in progress (the shared scratch is in use). */
  #spawning = false;

  /** Create a typed world, optionally reusing precompiled component definitions. */
  constructor(
    config: EcsWorldConfig<M, T, R>,
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

  /** Run one tick, then clear enter/exit transition sets. */
  frame<TReturn>(fn: () => TReturn): TReturn {
    return this.world.frame(fn);
  }
}

/** Bootstrap a typed ECS world from a component map (and optional tags and relations). */
export function createEcsWorld<
  M extends SchemaComponentMap,
  T extends TagMap = Record<never, never>,
  R extends RelationMap = Record<never, never>,
>(config: EcsWorldConfig<M, T, R>): EcsWorld<M, T, R> {
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
