declare type Bitmask = Uint32Array;

/** Archetypes are unique groupings of entities by components */
interface Archetype {
    components: Set<ComponentInstance<unknown>>;
    entities: Set<Entity>;
    mask: Bitmask;
    name: string;
}

interface QuerySpec {
    /** AND - Gather entities as long as they have all these components */
    all?: Component<unknown>[];
    /** OR - Gather entities as long as they have 0...* of these components */
    any?: Component<unknown>[];
    /** NOT - Gather entities as long as they don't have these components */
    none?: Component<unknown>[];
}
interface Query extends Required<QuerySpec> {
    /** Instances of this query registered in a world/system */
    instances: QueryInstance[];
}
/** Queries are groupings of archetypes */
interface QueryInstance {
    /** The archetypes which match this query */
    archetypes: Archetype[];
    /** A bitmask for the AND match criteria */
    and: Bitmask;
    /** A bitmask for the OR match criteria */
    or: Bitmask;
    /** A bitmask for the NOT match criteria */
    not: Bitmask;
    /** The world associated with this instance */
    world: World;
}
/**
 * Create a new query
 * @param spec the query specification
 * @returns the created query object
 */
declare function createQuery(spec: QuerySpec): Query;

/** A function which runs once at the start of each frame */
declare type PreFunction = (entities: number[]) => void;
/** A function which runs once at the end of each frame */
declare type PostFunction = (entities: number[], components: Record<string, ComponentInstance<unknown>>, alpha?: number) => void;
/** A system which may be called multiple times per frame */
declare type UpdateFunction = (entities: number[], components: Record<string, ComponentInstance<unknown>>, delta?: number) => void;
/** System specification */
interface SystemSpec {
    /** The system's label */
    name: string;
    /** A function which runs once at the start of each frame. Defaults to noop. */
    pre?: PreFunction;
    /** A function which runs once at the end of each frame. Defaults to noop. */
    post?: PostFunction;
    /** A system which may be called multiple times per frame. Defaults to noop. */
    update?: UpdateFunction;
}
/** Systems are the base system context */
interface System {
    /** List of the system's registered instances */
    instances: SystemInstance[];
    /** The system's label */
    name: string;
    /** A function which runs once at the start of each frame */
    pre: PreFunction;
    /** A function which runs once at the end of each frame */
    post: PostFunction;
    /** A system which may be called multiple times per frame */
    update: UpdateFunction;
}
/** System instances are systems that are registered in a world */
interface SystemInstance extends System {
    /** The state of the system */
    enabled: boolean;
    /** Query or queries associated with this system instance */
    query: QueryInstance;
    /** The world associated with this system instance */
    world: World;
}
/**
 * Create a new component.
 * Takes a `ComponentSpec` and produces a `Component`.
 * Components can then be registered in a world using `registerComponent(world)`.
 * Components can also be recycled using `destroyComponent(component)`.
 * @param spec the component's specification.
 * @returns the component object.
 */
declare function createSystem(spec: SystemSpec): System;
/**
 * Register a system in a world.
 * Takes a `System` and produces a `SystemInstance` tied to the given `World`.
 * The instance can be removed from the world later, using `unregisterSystem(world, system)`.
 * @param world the world to register the system in.
 * @param system the system to register in the world.
 * @param query the query to associate with the system instance.
 * @returns the registered system instance.
 */
declare function registerSystem(world: World, system: System, query: Query): Promise<SystemInstance>;
/**
 * Remove a system from the world.
 * Takes a `SystemInstance` an unregisters it from its `World`.
 * @param system the system instance to unregister.
 * @returns the world object.
 */
declare function unregisterSystem(system: SystemInstance): Promise<World>;
declare function enableSystem(system: SystemInstance): SystemInstance;
declare function disableSystem(system: SystemInstance): SystemInstance;
declare function isSystemEnabled(system: SystemInstance): boolean;

/** World configuration */
interface WorldSpec {
    /**
     * The maximum number of components allowed in the world.
     * Defaults to 128.
     */
    maxComponents: number;
    /**
     * The maximum number of entities allowed in the world.
     * Defaults to 10,000.
     */
    maxEntities: number;
}
/** World is the primary ECS context */
interface World {
    spec: Readonly<WorldSpec>;
    id: string;
    archetypes: Record<string, Archetype>;
    components: ComponentInstance<unknown>[];
    entities: Archetype[];
    queries: Map<Query, QueryInstance>;
    systems: SystemInstance[];
}
/**
 * Create new world context
 * @param spec optional specification object.
 * @param spec.maxComponents the maximum number of components allowed in the world. Defaults to 128.
 * @param spec.maxEntities the maximum number of entities allowed in the world. Defaults to 10,000.
 */
declare function createWorld(spec?: Partial<WorldSpec>): World;

/** Entities are indexes */
declare type Entity = number;
/**
 * Create an entity in the world
 * @param world the world to create the entity in
 * @returns the entity
 */
declare function createEntity(world: World): Promise<Entity>;
/**
 * Remove an entity from the world and destroy any component data associated
 * @param world the world the entity is associated with
 * @param entity the entity to destroy
 * @returns the world
 */
declare function destroyEntity(world: World, entity: Entity): Promise<World>;

/** Check if a string is a valid property name */
declare function isValidName(str: string): boolean;
interface Constructable<T> {
    new (...args: unknown[]): T;
    constructor: (...args: unknown[]) => T;
}
declare type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array;
declare type TypedArrayConstructor = Int8ArrayConstructor | Uint8ArrayConstructor | Uint8ClampedArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor | Float64ArrayConstructor | BigInt64ArrayConstructor | BigUint64ArrayConstructor;

/**
 * Schema type guard
 * @param schema the schema to validate
 * @returns true if schema is valid
 */
declare function isValidSchema(schema: unknown): schema is Schema<unknown>;
/** Schemas define data storage for component properties */
declare type Schema<T> = {
    [K in keyof T]: DataStore<T[K], unknown>;
};
/**
 * Data storage specification.
 *
 * T = array/storage type. E.g., `Array` or `Uint8Array`.
 *
 * D = acceptable input types. E.g., `string` or `number`.
 *
 * Note - D must always be `number` when T is a typed array.
 */
interface DataSpec<T, D> {
    /**
     * Underlying array type to use for data storage.
     *
     * Defaults to regular array (i.e., `Array`).
     *
     * Mandatory if you want to use a typed array (e.g., `Int8Array`).
     */
    arrayType?: Constructable<Array<T>> | TypedArrayConstructor;
    /** A function that returns the default value for store properties. */
    initial: () => D;
    /** A mandatory type guard function for setting data in the DataStore */
    guard: (property: unknown) => property is D;
    /** The name of the DataStore */
    name: string;
    /**
     * Pre-fill data array with the value that `initial` returns?
     *
     * Defaults to `false`. Ignored if `arrayType` is a typed array.
     */
    prefill?: boolean;
}
declare type DataArray<D> = Array<D> | TypedArray;
interface DataArrayMethods<T, D> {
    /** Get an entity's data from a component's datastore */
    getProp: (entity: Entity) => D | undefined;
    /** Validate and set data for entity in component storage */
    setProp: (entity: Entity, value: D) => DataStoreInstance<T, D>;
    /** true if the DataStore's data array is a typed array */
    isTypedArray: boolean;
}
/** A data storage definition */
declare type DataStore<T, D> = Required<DataSpec<T, D>> & DataArray<D> & DataArrayMethods<T, D>;
/** Data storage for properties in a ComponentInstance */
declare type DataStoreInstance<T, D> = DataStore<T, D> & {
    /** The world associated with the component to which this storage belongs. */
    world: World;
};
/**
 * Get an entity's data from a component's datastore
 * @param store the store to get the data from
 * @param entity the entity to get data for
 * @returns the entity's data or undefined
 */
declare function getDataFromStore<T, D>(store: DataStoreInstance<T, D>, entity: Entity): D | undefined;
/**
 * Validate and set data for entity in component storage
 * @param store the store to set the data in
 * @param entity the entity to set the data for
 * @param value the value to set
 * @returns the DataStore
 */
declare function setDataInStore<T, D>(store: DataStoreInstance<T, D>, entity: Entity, value: D): DataStoreInstance<T, D>;
/**
 * Create a new data storage prototype object for use in component schemas
 * @param spec the DataStore's specification
 * @returns the DataStore prototype
 */
declare function defineDataStore<T, D>(spec: DataSpec<T, D>): DataStore<T, D>;

interface ComponentSpec<T> {
    /** The component's label */
    name: string;
    /** The component's property definitions */
    schema: Schema<T>;
}
/** Components are the base component context */
interface Component<T> extends ComponentSpec<T> {
    /** Register of instances of this component */
    instances: ComponentInstance<T>[];
}
/** ComponentInstances are Components which have been registered in a world */
declare type ComponentInstance<T> = Component<T> & {
    entities: Set<Entity>;
    id: number;
    world: World;
} & {
    [K in keyof T]: DataStore<T[K], unknown>;
};
/**
 * Create a new component.
 * Takes a `ComponentSpec` and produces a `Component`.
 * Components can then be registered in a world using `registerComponent(world, component)`.
 * @param spec the component's specification.
 * @returns the component object.
 */
declare function createComponent<T>(spec: ComponentSpec<T>): Component<T>;
/**
 * Register a component in a world.
 * Takes a `Component` and produces a `ComponentInstance` tied to the given `World`.
 * The instance can be removed from the world later, using `unregisterComponent(world, component)`.
 * @param world the world to register the component in.
 * @param component the component to register in the world.
 * @returns the registered component instance.
 */
declare function registerComponent<T>(world: World, component: Component<T>): Promise<ComponentInstance<T>>;
/**
 * Remove a component from the world.
 * Takes a `ComponentInstance` an unregisters it from its `World`.
 * @param component the component instance to unregister.
 * @returns the world object.
 */
declare function unregisterComponent<T>(component: ComponentInstance<T>): Promise<World>;
/**
 * Gives a component to an entity.
 * @param component the component instance to add to the entity
 * @param entity the entity to add the component to
 * @param properties optional initial properties to set
 * @returns the component instance
 */
declare function addComponentToEntity<T>(component: ComponentInstance<T>, entity: Entity, properties?: T): Promise<ComponentInstance<T>>;
/**
 * Removes a component from an entity, deleting its properties
 * @param component the component instance to remove
 * @param entity the entity to remove the component from
 * @returns the component instance
 */
declare function removeComponentFromEntity<T>(component: ComponentInstance<T>, entity: Entity): Promise<ComponentInstance<T>>;

/** Call all enabled system's pre functions */
declare function runPreSystems(world: World): void;
/**
 * Call all enabled system's post functions.
 * @param world the world to call systems from
 * @param alpha frame interpolation alpha
 */
declare function runPostSystems(world: World, alpha?: number): void;
/**
 * Call all enabled system's update functions
 * @param world the world to call systems from
 * @param delta frame delta time
 */
declare function runUpdateSystems(world: World, delta?: number): void;

declare type AnyStore = DataStore<any[], any>;
declare type Int8Store = DataStore<Int8Array, number>;
declare type Uint8Store = DataStore<Uint8Array, number>;
declare type ClampedUint8Store = DataStore<Uint8ClampedArray, number>;
declare type Int16Store = DataStore<Int16Array, number>;
declare type Uint16Store = DataStore<Uint16Array, number>;
declare type Int32Store = DataStore<Int32Array, number>;
declare type Uint32Store = DataStore<Uint32Array, number>;
declare type Float32Store = DataStore<Float32Array, number>;
declare type Float64Store = DataStore<Float64Array, number>;
declare type BigintStore = DataStore<BigInt64Array, number>;
declare type BigUintStore = DataStore<BigUint64Array, number>;
declare type ArrayStore<T> = DataStore<T[][], T[]>;
declare type BooleanStore = DataStore<boolean[], boolean>;
declare type FunctionStore = DataStore<((...args: unknown[]) => unknown)[], (...args: unknown[]) => unknown>;
declare type NumberStore = DataStore<number[], number>;
declare type ObjectStore<T> = DataStore<T[], T>;
declare type StringStore = DataStore<string[], string>;
/** number type guard */
declare function numberGuard(property: unknown): property is number;
/** @returns 0 */
declare function initToZero(): number;
/** Type unsafe data storage */
declare const any: AnyStore;
/** Int8 data storage */
declare const i8: Int8Store;
/** Uint8 data storage */
declare const ui8: Uint8Store;
/** Clamped uint8 data storage */
declare const ui8c: ClampedUint8Store;
/** Int16 data storage */
declare const i16: Int16Store;
/** Uint16 data storage */
declare const ui16: Uint16Store;
/** Int32 data storage */
declare const i32: Int32Store;
/** Uint32 data storage */
declare const ui32: Uint32Store;
/** Int64 data storage */
declare const i64: BigintStore;
/** Uint64 data storage */
declare const ui64: BigUintStore;
/** Float32 data storage */
declare const f32: Float32Store;
/** Float64 data storage */
declare const f64: Float64Store;
/** Array data storage */
declare const array: ArrayStore<unknown>;
/** Boolean data storage */
declare const boolean: BooleanStore;
/** Function data storage */
declare const fnc: FunctionStore;
/** Number data storage */
declare const number: NumberStore;
/** Object data storage */
declare const object: ObjectStore<object>;
/** String data storage */
declare const string: StringStore;

export { AnyStore, ArrayStore, BigUintStore, BigintStore, BooleanStore, ClampedUint8Store, Float32Store, Float64Store, FunctionStore, Int16Store, Int32Store, Int8Store, NumberStore, ObjectStore, StringStore, Uint16Store, Uint32Store, Uint8Store, addComponentToEntity, any, array, boolean, createComponent, createEntity, createQuery, createSystem, createWorld, defineDataStore, destroyEntity, disableSystem, enableSystem, f32, f64, fnc, getDataFromStore, i16, i32, i64, i8, initToZero, isSystemEnabled, isValidName, isValidSchema, number, numberGuard, object, registerComponent, registerSystem, removeComponentFromEntity, runPostSystems, runPreSystems, runUpdateSystems, setDataInStore, string, ui16, ui32, ui64, ui8, ui8c, unregisterComponent, unregisterSystem };
