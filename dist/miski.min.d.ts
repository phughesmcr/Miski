/** All the various kinds of typed array constructors */
declare type TypedArrayConstructor = Int8ArrayConstructor | Uint8ArrayConstructor | Uint8ClampedArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor | Float64ArrayConstructor | BigInt64ArrayConstructor | BigUint64ArrayConstructor;
/** @author https://stackoverflow.com/a/67605309 */
declare type ParametersExceptFirst<F> = F extends (arg0: any, ...rest: infer R) => any ? R : never;
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

/** The interface available to end users */
declare type SchemaProps<T> = Record<keyof T, number>;
/**
 * Schemas are component storage definitions:
 * Schemas use TypedArray objects and so can only store a single number per property per entity.
 *
 * For example, `{ property: Int8Array }`;
 * Values in the array are initialised to 0 by default.
 * To set your own default value: `{ property: [Int8Array, default value] }`.
 */
declare type Schema<T> = Record<keyof T, TypedArrayConstructor | [TypedArrayConstructor, number]>;

interface ComponentInstance<T> extends Component<T> {
    /** The instance's identifier */
    id: number;
}

/** { [component name]: component instance } */
declare type ComponentRecord = Record<string, ComponentInstance<unknown>>;
interface ComponentSpec<T> {
    /** The component's label */
    name: string;
    /** The component's property definitions. Omit to define a tag component. */
    schema?: Schema<T>;
}
interface Component<T> {
    /** `true` if the component has no schema */
    isTag: boolean;
    /** The component's label */
    name: string;
    /** The component's property definitions or `null` if component is a tag */
    schema: Readonly<Schema<T>> | null;
    /** The storage requirements of the schema in bytes for a single entity */
    size: number;
}
/**
 * Define a new component.
 * @param spec the component's specification.
 * @param spec.name the component's string identifier.
 * @param spec.schema the component's optional schema object.
 * @returns A valid Component object - a reusable definitions for the creation of ComponentInstances
 */
declare function createComponent<T extends Schema<T>>(spec: ComponentSpec<T>): Component<T>;

interface QuerySpec {
    /** AND - Gather entities as long as they have all these components */
    all?: Readonly<Component<unknown>[]>;
    /** OR - Gather entities as long as they have 0...* of these components */
    any?: Readonly<Component<unknown>[]>;
    /** NOT - Gather entities as long as they don't have these components */
    none?: Readonly<Component<unknown>[]>;
}
/** Queries are groupings of archetypes */
interface Query {
    /** AND - Gather entities as long as they have all these components */
    all: Readonly<Component<unknown>[]>;
    /** OR - Gather entities as long as they have 0...* of these components */
    any: Readonly<Component<unknown>[]>;
    /** NOT - Gather entities as long as they don't have these components */
    none: Readonly<Component<unknown>[]>;
}
/**
 * Create a new Query
 * @param spec The Query's specification object
 * @param spec.all AND - Gather entities as long as they have all these components
 * @param spec.any OR - Gather entities as long as they have 0...* of these components
 * @param spec.none NOT - Gather entities as long as they don't have these components
 * @returns a valid Query object
 */
declare function createQuery(spec: QuerySpec): Readonly<Query>;

interface Bitfield {
    /** The size of the bitfield */
    capacity: number;
    /** The underlying bit array */
    array: Uint32Array;
    /**
     * Set all bits to 0
     * @returns `true` if the bitfield array was cleared successfully
     */
    clear: () => Bitfield;
    /** @returns a new Bitfield based on this Bitfield */
    copy: () => Bitfield;
    /** @returns `true` if a given bit is 'on' (e.g., truthy) in the Bitfield */
    isOn: (bit: number) => boolean;
    /**
     * Set a bit 'off' (e.g., falsy) in the Bitfield
     * @returns `true` if the bit was manipulated successfully
     */
    off: (bit: number) => Bitfield;
    /**
     * Set a bit 'on' (e.g., truthy) in the Bitfield
     * @returns `true` if the bit was manipulated successfully
     */
    on: (bit: number) => Bitfield;
    /**
     * Toggle a bit in the Bitfield
     * @returns `true` if the bit was manipulated successfully
     */
    toggle: (bit: number) => Bitfield;
    /** @returns the bitfield array as a string */
    toString: () => string;
}

/** Entities are indexes of an EntityArray. An Entity is just an integer. */
declare type Entity = Opaque<number, "Entity">;

interface QueryInstance extends Query {
    getComponents: () => ComponentRecord;
    /** Entities which have entered this query since last refresh */
    getEntered: () => Entity[];
    getEntities: () => Entity[];
    /** Entities which have exited this query since last refresh */
    getExited: () => Entity[];
    refresh: (archetypes: Archetype[]) => void;
}
interface QueryData {
    /** A bitfield for the AND match criteria */
    and?: Readonly<Bitfield>;
    /** A bitfield for the OR match criteria */
    or?: Readonly<Bitfield>;
    /** A bitfield for the NOT match criteria */
    not?: Readonly<Bitfield>;
}

/**
 * Archetypes are unique groupings of Entities by Components
 * An archetype must have:
 *  - A unique ID
 *  - A Set of Entity inhabitants
 *  - A way of knowing which Components are represented (Bitfield)
 *  - A way of checking if a QueryInstance matches the Archetype's Components
 */

interface Archetype {
    /** The Archetype's Component Bitfield */
    bitfield: Bitfield;
    /** Entities which have entered this archetype since last refresh */
    entered: Set<Entity>;
    /** Set of Entities which inhabit this Archetype */
    entities: Set<Entity>;
    /** Entities which have exited this archetype since last refresh */
    exited: Set<Entity>;
    /** The Archetype's unique ID */
    id: string;
    /** Add an entity to the inhabitants list */
    addEntity: (entity: Entity) => Archetype;
    /** Get the ID of an archetype based on this with a toggled component */
    cloneInStep: <T>(component: ComponentInstance<T>) => [string, () => Archetype];
    /** @returns a clone on this archetype */
    cloneWithToggle: <T>(component: ComponentInstance<T>) => Archetype;
    /** @returns an iterator of Entities which inhabit this Archetype */
    getEntities: () => IterableIterator<Entity>;
    /** @returns `true` if the Entity inhabits this Archetype */
    hasEntity: (entity: Entity) => boolean;
    /** @returns `true` if the query criteria match this archetype */
    isCandidate: (query: QueryData) => boolean;
    /** Purge various archetype related caches */
    purge: () => void;
    /** Remove an entity from the inhabitants list */
    removeEntity: (entity: Entity) => Archetype;
    /** Run archetype maintenance functions */
    refresh: () => void;
}

interface MiskiData {
    componentBuffer: ArrayBuffer;
}

interface WorldSpec {
    /** The maximum number of entities allowed in the world */
    capacity: number;
    /** Components to instantiate in the world  */
    components: Component<unknown>[];
}
interface WorldProto {
    /** The Miski version used to create this World */
    readonly version: string;
}
interface World extends WorldProto {
    /** The maximum number of entities allowed in the world */
    readonly capacity: number;
    /**
     * Add a component to an entity.
     * @param component the component to add.
     * @param entity the entity to add the component to.
     * @param props optional initial component values to set for the entity.
     * @returns `true` if the component was added successfully.
     */
    addComponentToEntity: <T>(component: Component<T>, entity: Entity, props?: SchemaProps<T> | undefined) => boolean;
    /**
     * Create a new entity for use in the world.
     * @returns the entity or `undefined` if no entities were available.
     */
    createEntity: () => Entity | undefined;
    /**
     * Destroy a given entity.
     * @returns `true` if the entity was successfully destroyed.
     */
    destroyEntity: (entity: Entity) => boolean;
    /**
     * Check if an entity has a given component.
     * @param entity the entity to check.
     * @param component the component to check for.
     * @returns `true` if the entity has the component.
     */
    entityHasComponent: <T>(entity: Entity, component: Component<T>) => boolean;
    /**
     * Get a given entity's archetype.
     * @param entity the entity to expose.
     * @returns the Archetype object or `undefined` if no archetype found.
     */
    getEntityArchetype: (entity: Entity) => Archetype | undefined;
    /** @returns an array of entities which have entered a query's archetypes since last world.refresh() */
    getQueryEntered: (query: Query) => Entity[];
    /** @returns an array of entities which have left a query's archetypes since last world.refresh() */
    getQueryExited: (query: Query) => Entity[];
    /** @returns a tuple of entities and components which match the query's criteria */
    getQueryResult: (query: Query) => [Entity[], ComponentRecord];
    /** @returns the number of available entities in the world. */
    getVacancyCount: () => number;
    /** @returns `true` if the entity is valid and !== undefined */
    hasEntity: (entity: Entity) => boolean;
    /**
     * Load data into the world.
     * @param data the MiskiData object to load
     * @returns `true` if all the data was successfully loaded into the world.
     */
    load: (data: MiskiData) => boolean;
    /**
     * Purge various caches throughout the world.
     * Should not be necessary but useful if memory footprint is creeping.
     */
    purgeCaches: () => void;
    /**
     * Run various maintenance functions in the world.
     * Recommended once per frame.
     */
    refresh: () => void;
    /**
     * Remove a component from an entity.
     * @param component the component to remove.
     * @param entity the entity to remove the component from.
     * @returns `true` if the component was removed successfully.
     */
    removeComponentFromEntity: <T>(component: Component<T>, entity: Entity) => boolean;
    /** Serialize various aspects of the world's data */
    save: () => Readonly<MiskiData>;
}
declare function createWorld(spec: WorldSpec): Readonly<World>;

/** A multi-arity function where the first parameter is always the World object */
declare type System<T extends (world: World, ...args: any[]) => ReturnType<T>, U extends ParametersExceptFirst<T>> = (world: World, ...args: U) => ReturnType<T>;
/**
 * Creates a new curried System function
 * @param callback the System function to be called
 * @returns a curried function (world) => (...args) => result;
 *
 * @example
 * const world = {} as World;
 * const log = (world: World, value: string) => console.log(value);
 * const logSystem = createSystem(log);
 * const logSystemInstance = logSystem(world);
 * logSystemInstance("hello, world!"); // hello, world!
 */
declare function createSystem<T extends (world: World, ...args: any[]) => ReturnType<T>, U extends ParametersExceptFirst<T>>(callback: System<T, U>): (world: World) => (...args: U) => ReturnType<T>;

export { Archetype, Bitfield, Component, ComponentInstance, ComponentRecord, ComponentSpec, Entity, MiskiData, Opaque, ParametersExceptFirst, Query, QueryData, QueryInstance, QuerySpec, Schema, SchemaProps, System, TypedArrayConstructor, World, WorldSpec, createComponent, createQuery, createSystem, createWorld };
