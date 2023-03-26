/** All the various kinds of typed arrays */
type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array;
/** All the various kinds of typed array constructors */
type TypedArrayConstructor = Int8ArrayConstructor | Uint8ArrayConstructor | Uint8ClampedArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor | Float64ArrayConstructor | BigInt64ArrayConstructor | BigUint64ArrayConstructor;
/**
 * The parameters of a function omitting the first two parameters
 * @author https://stackoverflow.com/a/67605309
 */
type ParametersExceptFirstTwo<F> = F extends (arg0: any, arg1: any, ...rest: infer R) => any ? R : never;
/**
 * Opaque typing allows for nominal types
 * @example
 * type Entity = number;
 * const a: Entity = 1; // a = number;
 * type Entity = Opaque<number, "Entity">;
 * const b: Entity = 1 // b = Entity;
 */
type Opaque<T, K> = T & {
    _TYPE: K;
};

/** Individual entity's component properties */
type SchemaProps<T> = Record<keyof T, number | bigint | undefined>;
/**
 * Schemas are component storage definitions:
 *
 * Schemas use TypedArray objects and so can only store a single number per property per entity.
 *
 * For example, `{ property: Int8Array }`;
 *
 * Values in TypedArrays are initialised to 0 by default.
 *
 * To set an initial value: `{ property: [Int8Array, defaultValue] }`.
 *
 * Set to `null` to define a tag component.
 */
type Schema<T> = null | Record<keyof T, TypedArrayConstructor | [TypedArrayConstructor, number]>;

interface ComponentSpec<T> {
    /**
     * The maximum number of entities able to equip this component per world.
     *
     * __Warning__: use this only where memory consumption is a concern, performance will be worse.
     */
    maxEntities?: number;
    /** The component's label */
    name: string;
    /** The component's property definitions. Omit to define a tag component. */
    schema?: Schema<T>;
}
declare class Component<T extends Schema<T>> {
    /** `true` if the component has no schema */
    readonly isTag: boolean;
    /** The maximum number of entities able to equip this component per world. */
    readonly maxEntities: number | null;
    /** The component's label */
    readonly name: string;
    /** The component's property definitions or `null` if component is a tag */
    readonly schema: Readonly<Schema<T>> | null;
    /** The storage requirements of the schema in bytes for a single entity */
    readonly size: number;
    /**
     * Define a new component.
     * @param spec the component's specification.
     * @param spec.name the component's string identifier.
     * @param spec.schema the component's optional schema object.
     * @returns A valid Component object - a reusable definitions for the creation of ComponentInstances
     * @throws If the spec is invalid
     */
    constructor(spec: ComponentSpec<T>);
}

interface QuerySpec {
    /** AND - Gather entities as long as they have all these components */
    all?: Component<any>[];
    /** OR - Gather entities as long as they have 0...* of these components */
    any?: Component<any>[];
    /** NOT - Gather entities as long as they don't have these components */
    none?: Component<any>[];
}
declare class Query {
    /** AND - Gather entities as long as they have all these components */
    readonly all: Readonly<Component<any>[]>;
    /** OR - Gather entities as long as they have 0...* of these components */
    readonly any: Readonly<Component<any>[]>;
    /** NOT - Gather entities as long as they don't have these components */
    readonly none: Readonly<Component<any>[]>;
    /**
     * Create a new Query
     *
     * Queries are groupings of archetypes
     *
     * @param spec The Query's specification object
     * @param spec.all AND - Gather entities as long as they have all these components
     * @param spec.any OR - Gather entities as long as they have 0...* of these components
     * @param spec.none NOT - Gather entities as long as they don't have these components
     * @throws If the spec is invalid
     */
    constructor(spec: QuerySpec);
}

/** Symbol for use as a key for the `changed` flag getter and setter */
declare const $_CHANGED: unique symbol;
/** Symbol for use as a key for the `owners` flag getter and setter */
declare const $_OWNERS: unique symbol;

/**
 *
 */
type Bitfield = Uint32Array;

/**
 * A storage proxy is a convenience method for setting entity's component
 * properties in a way which is type safe and flips the `changed` property
 * on the entity at the expense of performance vs. direct array access.
 */
type StorageProxy<T extends Schema<T>> = Record<keyof T, number> & {
    /** @returns the entity the proxy is currently pointed at */
    getEntity(): Entity;
    /**
     * Change the proxy's cursor to a given entity
     * @param entity The entity to change
     * @throws If the entity is not a number
     */
    setEntity(entity: Entity): Entity;
};

type ComponentInstance<T extends Schema<T>> = Component<T> & Record<keyof T, TypedArray> & {
    /** @internal */
    [$_CHANGED]: Set<Entity>;
    /** @internal */
    [$_OWNERS]: Bitfield;
    /** Entities who's properties have been changed via this.proxy since last refresh */
    changed: IterableIterator<Entity>;
    /** The number of entities which have this component instance */
    count: number;
    /** The instance's identifier */
    id: number;
    /** */
    proxy: StorageProxy<T>;
};

/** Entities are indexes of an EntityArray. An Entity is just an integer. */
type Entity = Opaque<number, "Entity">;
/** The object returned from `world.save();` */
interface WorldData {
    /** The world's component storage buffer */
    buffer: ArrayBuffer;
    /** The maximum number of entities allowed in the world */
    capacity: number;
    /** The Miski version of the creating world */
    version: string;
}
interface WorldSpec {
    /** The maximum number of entities allowed in the world */
    capacity: number;
    /** Components to instantiate in the world */
    components: Component<any>[];
}
declare class World {
    private readonly archetypeManager;
    private readonly componentManager;
    private readonly queryManager;
    /** Pool of Entity states */
    private readonly entities;
    /** The maximum number of entities the world can hold */
    readonly capacity: number;
    /** Miski version */
    readonly version = "0.11.1";
    /**
     * Create a new World object
     * @param spec An WorldSpec object
     * @param spec.capacity The maximum number of entities allowed in the world
     * @param spec.components An array of components to instantiate in the world
     * @throws If the spec is invalid
     */
    constructor(spec: WorldSpec);
    /** @returns the number of active entities */
    get residents(): number;
    /** @returns the number of available entities */
    get vacancies(): number;
    /**
     * Creates a function to add a given set of components to an entity
     * @param components One or more components to add
     * @returns A function which takes an entity and optional properties object
     * @throws if one or more components are not registered in this world
     */
    addComponentsToEntity(...components: Component<any>[]): (entity: Entity, properties?: Record<string, SchemaProps<unknown>>) => World;
    /** @returns the next available Entity or `undefined` if no Entity is available */
    createEntity(): Entity | undefined;
    /**
     * Remove and recycle an Entity
     * @param entity the entity to destroy
     * @returns the world
     * @throws if the entity is invalid
     */
    destroyEntity(entity: Entity): World;
    /**
     * Get all the changed entities from a set of components
     * @param components The components to collect changed entities from
     * @returns An array of entities
     * @throws if one or more components are not registered in this world
     */
    getChangedFromComponents(...components: Component<any>[]): () => IterableIterator<Entity>;
    /**
     * Get all the changed entities from a query
     * @param query the query to collect changed entities from
     * @param arr an optional array to be emptied and recycled
     * @returns an array of entities
     * @throws if query is invalid
     */
    getChangedFromQuery(query: Query): () => IterableIterator<Entity>;
    /**
     * Get this world's instance of a component
     * @param component The component to retrieve the instance of
     * @returns The component instance or undefined if the component is not registered
     */
    getComponentInstance<T extends Schema<T>>(component: Component<T>): ComponentInstance<T> | undefined;
    /**
     * Get this world's instances of a set of components
     * @param component The component to retrieve the instance of
     * @returns An array of component instances or undefined if the component is not registered
     */
    getComponentInstances(...components: Component<any>[]): (ComponentInstance<any> | undefined)[];
    /**
     * Get all of the component properties of a given entity
     * @param entity The entity to retrieve the properties of
     * @returns An object where keys are component names and properties are the entity's properties
     */
    getEntityProperties(entity: Entity): Record<string, boolean | SchemaProps<unknown>>;
    /**
     * Get all the components positively associated with a query
     * @param query The query to get the components from
     * @returns An object where keys are component names and properties are component instances
     * @throws If the query is invalid
     */
    getQueryComponents(query: Query): ComponentRecord;
    /**
     * Get all the entities which have entered the query since the last refresh
     * @param query The query to get the entities from
     * @returns An iterator of entities
     * @throws If the query is invalid
     */
    getQueryEntered(query: Query): () => IterableIterator<Entity>;
    /**
     * Get all the entities which match a query
     * @param query The query to get the entities from
     * @returns An iterator of entities
     * @throws If the query is invalid
     */
    getQueryEntities(query: Query): () => IterableIterator<Entity>;
    /**
     * Get all the entities which have exited the query since the last refresh
     * @param query The query to get the entities from
     * @returns An iterator of entities
     * @throws If the query is invalid
     */
    getQueryExited(query: Query): () => IterableIterator<Entity>;
    /**
     * Create a function to test entities for a given component
     * @param component The component to test for
     * @returns A function which takes an entity and returns
     *     true if the entity has the component, false if it does not
     *     or null if the entity does not exist.
     * @throws if the component is not registered in this world
     */
    hasComponent<T extends Schema<T>>(component: Component<T>): (entity: Entity) => boolean | null;
    /**
     * Create a function to test entities for a given component
     * @param components The components to test for
     * @returns A function which takes an entity and returns an array of
     *     true if the entity has the component, false if it does not
     *     or null if the entity does not exist.
     * @throws if one or more component is not registered in this world
     */
    hasComponents(...components: Component<any>[]): (entity: Entity) => (boolean | null)[];
    /**
     * Test if an entity is active in the world
     * @return a boolean or null if the entity is invalid
     *
     */
    isEntityActive(entity: Entity): boolean | null;
    /** @return `true` if the given entity is valid for the given capacity */
    isValidEntity(entity: Entity): entity is Entity;
    /**
     * Swap the ComponentBuffer of one world with this world
     * @returns the world
     * @throws if the capacity or version of the data to load is mismatched
     */
    load(data: WorldData): World;
    /** Runs various world maintenance functions */
    refresh(): World;
    /**
     * Creates a function to remove a given set of components from an entity
     * @param components One or more components to remove
     * @returns A function which takes an entity
     * @throws if one or more components are not registered in this world
     */
    removeComponentsFromEntity(...components: Component<any>[]): (entity: Entity) => World;
    /** Export various bits of data about the world */
    save(): WorldData;
}

/** [component name]: component instance */
type ComponentRecord = Record<string, ComponentInstance<any>>;

/**
 * A multi-arity function where the first two parameters
 * are the components and entities available to
 * the system respectively.
 */
type SystemCallback<T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>, U extends ParametersExceptFirstTwo<T>> = (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: U) => ReturnType<T>;
interface SystemSpec<T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>, U extends ParametersExceptFirstTwo<T>> {
    /** The core function of the system. Called when this.exec is called. */
    system: SystemCallback<T, U>;
    /** The query which will provide the components and entities to the system. */
    query: Query;
}
declare class System<T extends (components: ComponentRecord, entities: IterableIterator<Entity>, ...args: unknown[]) => ReturnType<T>, U extends ParametersExceptFirstTwo<T>> {
    /** The core function of the system. Called when this.exec is called. */
    system: SystemCallback<T, U>;
    /** The query which will provide the components and entities to the system. */
    query: Query;
    /**
     * Creates a new system.
     *
     * Systems are the behaviours which affect components.
     *
     * @param spec the system's specification object
     */
    constructor(spec: SystemSpec<T, U>);
    /**
     * Initialize the system for a given world
     * @param world the world to execute the system in
     * @returns an initialized system function
     */
    init(world: World): (...args: U) => ReturnType<T>;
}

interface QueryInstance extends Query {
    /** A bitfield for the AND match criteria */
    and: Readonly<Bitfield>;
    /** */
    archetypes: Set<Archetype>;
    /** */
    checkCandidacy: (target: number, idx: number) => boolean;
    /** */
    components: Record<string, ComponentInstance<any>>;
    /**
     * `true` if the object is in a dirty state
     *
     * A query becomes dirty when an archetype is added or removed
     */
    isDirty: boolean;
    /** A bitfield for the OR match criteria */
    or: Readonly<Bitfield>;
    /** A bitfield for the NOT match criteria */
    not: Readonly<Bitfield>;
}

declare class Archetype {
    /** The Archetype's Component Bitfield */
    readonly bitfield: Bitfield;
    /** QueryInstances and their candidacy status*/
    readonly candidateCache: Map<QueryInstance, boolean>;
    /** The components associated with this archetype */
    readonly components: ComponentInstance<any>[];
    /** Entities which have entered this archetype since last refresh */
    readonly entered: Set<Entity>;
    /** Set of Entities which inhabit this Archetype */
    readonly entities: Set<Entity>;
    /** Entities which have exited this archetype since last refresh */
    readonly exited: Set<Entity>;
    /** `true` if the object is in a dirty state */
    isDirty: boolean;
    constructor(size: number, components: ComponentInstance<any>[], field?: Bitfield);
    /** The Archetype's unique identifier */
    get id(): string;
    /** `true` if this Archetype has no entities associated with it */
    get isEmpty(): boolean;
    /** The number of entities in the archetype */
    get size(): number;
    /** Add an Entity to the Archetype */
    addEntity(entity: Entity): Archetype;
    /** Create a new Archetype from this Archetype */
    clone(): Archetype;
    /**
     * Test this Archetype matches a given QueryInstance
     * @param query The QueryInstance to test
     * @returns `true` if the QueryInstance is a match
     */
    isCandidate(query: QueryInstance): boolean;
    /** Clear entered/exited entities and set `isDirty` to `false` */
    refresh(): Archetype;
    /** Remove an Entity from the Archetype */
    removeEntity(entity: Entity): Archetype;
    /** Serialize the Archetype to a string */
    toString(replacer?: (this: any, key: string, value: any) => any, space?: string | number): string;
}

export { Archetype, Bitfield, Component, ComponentInstance, ComponentRecord, ComponentSpec, Entity, Opaque, ParametersExceptFirstTwo, Query, QueryInstance, QuerySpec, Schema, SchemaProps, StorageProxy, System, SystemCallback, SystemSpec, TypedArray, TypedArrayConstructor, World, WorldData, WorldSpec };
