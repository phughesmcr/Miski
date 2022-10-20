/** All the various kinds of typed arrays */
declare type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array;
/** All the various kinds of typed array constructors */
declare type TypedArrayConstructor = Int8ArrayConstructor | Uint8ArrayConstructor | Uint8ClampedArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor | Float64ArrayConstructor | BigInt64ArrayConstructor | BigUint64ArrayConstructor;
/**
 * The parameters of a function omitting the first two parameters
 * @author https://stackoverflow.com/a/67605309
 */
declare type ParametersExceptFirstTwo<F> = F extends (arg0: any, arg1: any, ...rest: infer R) => any ? R : never;
/**
 * Opaque typing allows for nominal types
 * @example
 * type Entity = number;
 * const a: Entity = 1; // a = number;
 * type Entity = Opaque<number, "Entity">;
 * const b: Entity = 1 // b = Entity;
 */
declare type Opaque<T, K> = T & {
    _TYPE: K;
};

/** Individual entity's component properties */
declare type SchemaProps<T> = Record<keyof T, number | bigint | undefined>;
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
declare type Schema<T> = null | Record<keyof T, TypedArrayConstructor | [TypedArrayConstructor, number]>;

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
     */
    constructor(spec: QuerySpec);
}

/** Symbol for use as a key for the `changed` flag getter and setter */
declare const $_CHANGED: unique symbol;
/** Symbol for use as a key for the `owners` flag getter and setter */
declare const $_OWNERS: unique symbol;

/**
 * @note
 * `bit >>> 5` is used in place of `Math.floor(bit / 32)`.
 * `(bit - (bit >>> 5) * 32)` is used in place of `bit % 32`.
 */
/** */
declare class Bitfield extends Uint32Array {
    static getHighestSetBit(value: number): number;
    /** @returns the number of set bits in a given value */
    static getSetBitCount(value: number): number;
    /** @returns the number of set bits in a given bitfield */
    static getSetBitCountInBitfield(bitfield: Bitfield): number;
    /**
     * Create a new Bitfield from an array of objects
     * @param size the number of bits in the bitfield
     * @param key the key of the property to use for the bitfield's indexes
     * @param objs an array of objects which have the key as an index to a number
     *
     * @example
     *  // Creating 32 bit bitfield from <T extends { id: number }>:
     *  Bitfield.fromObjects(32, "id", [{ id: 0, ... }, ...]);
     */
    static fromObjects<T>(size: number, key: keyof T, objs: T[]): Bitfield;
    /** @returns the index of a bit in a bitfield */
    static indexOf(bit: number): number;
    /**
     * Creates a new Bitfield
     * @param size the number of bits in the array
     */
    constructor(size: number);
    /** @returns The amount of bits in the array */
    get size(): number;
    /** @returns a new Bitfield with identical properties to this Bitfield */
    clone(): Bitfield;
    /** @returns a new Bitfield based on this one with toggled bits */
    cloneWithToggle<T>(key: keyof T, sources: T[]): Bitfield;
    /** @returns the index and position of a bit in the bitfield */
    getPosition(bit: number): {
        index: number;
        position: number;
    };
    /** @returns `true` if a given bit is set in the Bitfield or null on error */
    isSet(bit: number): boolean | null;
    /**
     * Toggle a bit in the Bitfield
     * @return the resulting state of the bit or null if error
     */
    toggle(bit: number): boolean | null;
}

/**
 * A storage proxy is a convenience method
 * for setting entity's component properties
 * in a way which is type safe and
 * flips the `changed` property on the entity
 * at the expense of performance.
 * */
declare type StorageProxy<T extends Schema<T>> = Record<keyof T, number> & {
    getEntity(): Entity;
    setEntity(entity: Entity): Entity;
};

declare type ComponentInstance<T extends Schema<T>> = Component<T> & Record<keyof T, TypedArray> & {
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
declare type Entity = Opaque<number, "Entity">;
interface WorldData {
    buffer: ArrayBuffer;
    capacity: number;
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
     */
    constructor(spec: WorldSpec);
    /** @returns the number of active entities */
    get residents(): number;
    /** @returns the number of available entities */
    get vacancies(): number;
    addComponentsToEntity(...components: Component<any>[]): (entity: Entity, properties?: Record<string, SchemaProps<unknown>>) => World;
    /** @returns the next available Entity or `undefined` if no Entity is available */
    createEntity(): Entity | undefined;
    /** Remove and recycle an Entity */
    destroyEntity(entity: Entity): World;
    getChangedFromComponents(...components: Component<any>[]): Entity[];
    getChangedFromQuery(query: Query, arr?: Entity[]): Entity[];
    getComponentInstance<T extends Schema<T>>(component: Component<T>): ComponentInstance<T> | undefined;
    getComponentInstances(...components: Component<any>[]): (ComponentInstance<any> | undefined)[];
    getEntityProperties(entity: Entity): Record<string, SchemaProps<unknown>>;
    getQueryComponents(query: Query): ComponentRecord;
    getQueryEntered(query: Query, arr?: Entity[]): Entity[];
    getQueryEntities(query: Query, arr?: Entity[]): Entity[];
    getQueryExited(query: Query, arr?: Entity[]): Entity[];
    hasComponent<T extends Schema<T>>(component: Component<T>): (entity: Entity) => boolean | null;
    hasComponents(...components: Component<any>[]): (entity: Entity) => (boolean | null)[];
    /**
     * @return `true` if the Entity is valid and exists in the world
     * @throws if the entity is invalid
     */
    isEntityActive(entity: Entity): boolean | null;
    /** @return `true` if the given entity is valid for the given capacity */
    isValidEntity(entity: Entity): entity is Entity;
    /** Swap the ComponentBuffer of one world with this world */
    load(data: WorldData): World;
    /** Runs various world maintenance functions */
    refresh(): World;
    removeComponentsFromEntity(...components: Component<any>[]): (entity: Entity) => World;
    /** Export various bits of data about the world */
    save(): WorldData;
}

/** [component name]: component instance */
declare type ComponentRecord = Record<string, ComponentInstance<any>>;

/**
 * A multi-arity function where the first two parameters
 * are the components and entities available to
 * the system respectively.
 */
declare type SystemCallback<T extends (components: ComponentRecord, entities: Entity[], ...args: unknown[]) => ReturnType<T>, U extends ParametersExceptFirstTwo<T>> = (components: ComponentRecord, entities: Entity[], ...args: U) => ReturnType<T>;
interface SystemSpec<T extends (components: ComponentRecord, entities: Entity[], ...args: unknown[]) => ReturnType<T>, U extends ParametersExceptFirstTwo<T>> {
    /** The core function of the system. Called when this.exec is called. */
    system: SystemCallback<T, U>;
    /** The query which will provide the components and entities to the system. */
    query: Query;
}
declare class System<T extends (components: ComponentRecord, entities: Entity[], ...args: unknown[]) => ReturnType<T>, U extends ParametersExceptFirstTwo<T>> {
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
     * @param world the world to execute the system in
     * @param args arguments to pass to the system's callback function
     * @returns the result of the system's callback function
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
    constructor(size: number, components: ComponentInstance<any>[], bitfield?: Bitfield);
    /** The Archetype's unique identifier */
    get id(): string;
    /** `true` if this Archetype has no entities associated with it */
    get isEmpty(): boolean;
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
    toString(): string;
}

export { Archetype, Bitfield, Component, ComponentInstance, ComponentRecord, ComponentSpec, Entity, Opaque, ParametersExceptFirstTwo, Query, QueryInstance, QuerySpec, Schema, SchemaProps, StorageProxy, System, SystemCallback, SystemSpec, TypedArray, TypedArrayConstructor, World, WorldData, WorldSpec };
