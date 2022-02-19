/** All the various kinds of typed array constructors */
declare type TypedArrayConstructor = Int8ArrayConstructor | Uint8ArrayConstructor | Uint8ClampedArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor | Float64ArrayConstructor | BigInt64ArrayConstructor | BigUint64ArrayConstructor;
/** @author https://stackoverflow.com/a/67605309 */
declare type ParametersExceptFirst<F> = F extends (arg0: any, ...rest: infer R) => any ? R : never;

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
 * @param spec.all
 * @param spec.any
 * @param spec.none
 */
declare function createQuery(spec: QuerySpec): Readonly<Query>;

/** Entities are indexes of an EntityArray */
declare type Entity = number;

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

interface QueryInstance extends Query {
    getComponents: () => ComponentRecord;
    getEntities: () => Entity[];
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
    /** Set of Entities which inhabit this Archetype */
    entities: Set<Entity>;
    /** The Archetype's unique ID */
    id: string;
    /** The Archetype's Component Bitfield */
    bitfield: Bitfield;
    /** Add an entity to the inhabitants list */
    addEntity: (entity: Entity) => Archetype;
    /** @returns an iterator of Entities which inhabit this Archetype */
    getEntities: () => IterableIterator<Entity>;
    /** @returns `true` if the Entity inhabits this Archetype */
    hasEntity: (entity: Entity) => boolean;
    /** Remove an entity from the inhabitants list */
    removeEntity: (entity: Entity) => Archetype;
    /** @returns a clone on this archetype */
    cloneWithToggle: <T>(component: ComponentInstance<T>) => Archetype;
    /** Get the ID of an archetype based on this with a toggled component */
    cloneInStep: <T>(component: ComponentInstance<T>) => [string, () => Archetype];
    /** @returns `true` if the query criteria match this archetype */
    isCandidate: (query: QueryData) => boolean;
}

interface WorldSpec {
    /** Components to instantiate in the world  */
    components: Component<unknown>[];
    /** The maximum number of entities allowed in the world */
    capacity: number;
}
interface WorldProto {
    readonly version: string;
}
interface World extends WorldProto {
    readonly capacity: number;
    createEntity: () => number | undefined;
    destroyEntity: (entity: Entity) => boolean;
    getEntityArchetype: (entity: number) => Archetype | undefined;
    getQueryResult: (query: Query) => [Entity[], ComponentRecord];
    getVacancyCount: () => number;
    hasEntity: (entity: number) => boolean;
    addComponentToEntity: <T>(component: Component<T>, entity: number, props?: SchemaProps<T> | undefined) => boolean;
    entityHasComponent: <T>(component: Component<T>, entity: number) => boolean;
    removeComponentFromEntity: <T>(component: Component<T>, entity: number) => boolean;
    refresh: () => void;
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

export { Archetype, Bitfield, Component, ComponentInstance, ComponentRecord, ComponentSpec, ParametersExceptFirst, Query, QueryData, QueryInstance, QuerySpec, Schema, SchemaProps, System, TypedArrayConstructor, World, WorldSpec, createComponent, createQuery, createSystem, createWorld };
