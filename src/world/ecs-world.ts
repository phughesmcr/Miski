import type { ComponentInstance } from "@/component/component-instance.ts";
import type { Entity } from "@/entity/entity.ts";
import { Query } from "@/query/query.ts";
import {
  compileComponentSchema,
  type CompiledComponentSchema,
  type ComponentsFromSchemaMap,
  createComponentFromSchema,
  type SchemaComponentMap,
} from "@/schema/schema.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { ComponentValue } from "@/types/partitions.ts";
import type { ComponentBundleEntryInput } from "@/types/world-api.ts";
import { World } from "@/world/world.ts";

/** Storage handles keyed by component name. */
export type StorageFromMap<M extends SchemaComponentMap> = {
  [K in keyof M]: ComponentInstance<ComponentValue<M[K]>, M[K]>;
};

/** Typed spawn spec: partial attach is allowed and `{}` creates a bare entity. */
export type SpawnSpec<M extends SchemaComponentMap> = {
  [K in keyof M]?: Partial<ComponentValue<M[K]>>;
};

/** Configuration for a typed named-map ECS world. */
export type EcsWorldConfig<M extends SchemaComponentMap> = {
  readonly capacity: number;
  readonly components: M;
};

function keysOf<T extends object>(value: T): (keyof T)[] {
  return Object.keys(value) as (keyof T)[];
}

function createComponents<M extends SchemaComponentMap>(schemas: M): ComponentsFromSchemaMap<M> {
  const components = {} as ComponentsFromSchemaMap<M>;
  for (const name of keysOf(schemas)) {
    components[name] = createComponentFromSchema(String(name), schemas[name]!);
  }
  return components;
}

/**
 * Primary developer surface for a typed ECS world.
 *
 * - Component map keys, `storage` accessors, and spawn keys share one name.
 * - Entity lifecycle lives on {@link EcsWorld.world}.
 */
export class EcsWorld<M extends SchemaComponentMap> {
  /** Entity lifecycle, attach/detach, and other low-level ECS operations. */
  readonly world: World;
  /** Component definitions for query and attach APIs. */
  readonly components: ComponentsFromSchemaMap<M>;
  /** Flat storage handles keyed by component name. */
  readonly storage: StorageFromMap<M>;
  /** Maximum number of simultaneously active entities. */
  readonly capacity: number;

  /** Create a typed world, optionally reusing precompiled component definitions. */
  constructor(
    config: EcsWorldConfig<M>,
    definitions: ComponentsFromSchemaMap<M> = createComponents(config.components),
  ) {
    this.components = {} as ComponentsFromSchemaMap<M>;
    this.storage = {} as StorageFromMap<M>;
    this.capacity = config.capacity;

    const componentList: DynamicComponent[] = [];
    for (const name of keysOf(config.components)) {
      const component = definitions[name];
      if (component === undefined) {
        throw new Error(`Compiled schema is missing component "${String(name)}".`);
      }
      this.components[name] = component;
      componentList.push(component);
    }

    this.world = new World({ capacity: config.capacity, components: componentList });
    for (const name of keysOf(this.components)) {
      this.storage[name] = this.world.components.require(this.components[name]);
    }
  }

  /** Ensure the underlying world is initialized. */
  async init(): Promise<void> {
    await this.world.init();
  }

  /** Create an all-components query. */
  query(...components: DynamicComponent[]): Query {
    return new Query({ all: components });
  }

  /** Create an entity with the named components and initial values in `spec`. */
  spawn(spec: SpawnSpec<M>): Entity {
    const bundle: ComponentBundleEntryInput[] = [];
    for (const name of keysOf(spec)) {
      const data = spec[name];
      if (data !== undefined) bundle.push([this.components[name], data]);
    }
    // The mapped SpawnSpec already proved each runtime tuple against its named component.
    return this.world.entities.createWithOrThrow(bundle as never);
  }

  /** Run one tick, then clear enter/exit transition sets. */
  frame<T>(fn: () => T): T {
    return this.world.frame(fn);
  }
}

/** Bootstrap a typed ECS world from a component map. */
export function createEcsWorld<M extends SchemaComponentMap>(
  config: EcsWorldConfig<M>,
): EcsWorld<M> {
  return new EcsWorld(config);
}

/** Create storage from one already-compiled schema truth object. */
export function createEcsWorldFromSchema<M extends SchemaComponentMap>(
  capacity: number,
  schema: CompiledComponentSchema<M>,
): EcsWorld<M> {
  return new EcsWorld({ capacity, components: schema.componentMap }, schema.components);
}

/** Compile then create; useful when the caller also needs the schema hash. */
export function createEcsWorldWithSchema<M extends SchemaComponentMap>(
  config: EcsWorldConfig<M>,
): { ecs: EcsWorld<M>; schema: CompiledComponentSchema<M> } {
  const schema = compileComponentSchema(config.components);
  return { ecs: createEcsWorldFromSchema(config.capacity, schema), schema };
}
