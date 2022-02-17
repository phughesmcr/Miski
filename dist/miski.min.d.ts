/** All the various kinds of typed array constructors */
declare type TypedArrayConstructor = Int8ArrayConstructor | Uint8ArrayConstructor | Uint8ClampedArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor | Float64ArrayConstructor | BigInt64ArrayConstructor | BigUint64ArrayConstructor;

/** The interface available to end users */
declare type SchemaProps<T> = Record<keyof T, number>;
/** Schemas are component storage definitions: e.g., { property: Int8Array } */
declare type Schema<T> = Record<keyof T, TypedArrayConstructor>;

interface ComponentInstance<T> extends Component<T> {
    /** The instance's parent component */
    component: Component<T>;
    /** The instance's identifier */
    id: number;
}

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
    /**
     * Get the result of the query for a given world
     * @returns a tuple of Entities and Components which match the Query criteria
     */
    getResult: (world: World) => [Entity[], ComponentRecord];
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

interface QueryInstance {
    /** */
    archetypes: Set<Archetype>;
    /** */
    archetypeCache: Map<Archetype, boolean>;
    /** The components matched by the and/or bitfields */
    components: Readonly<ComponentRecord>;
    /** A bitfield for the AND match criteria */
    and: Readonly<Bitfield> | undefined;
    /** A bitfield for the OR match criteria */
    or: Readonly<Bitfield> | undefined;
    /** A bitfield for the NOT match criteria */
    not: Readonly<Bitfield> | undefined;
    getComponents: () => ComponentRecord;
    getEntities: () => Entity[];
    refresh: (archetypes: Archetype[]) => void;
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
    /** @returns an array of Entities which inhabit this Archetype */
    getEntities: () => Entity[];
    /** @returns `true` if the Entity inhabits this Archetype */
    hasEntity: (entity: Entity) => boolean;
    /** Remove an entity from the inhabitants list */
    removeEntity: (entity: Entity) => Archetype;
    /** @returns a clone on this archetype */
    cloneWithToggle: <T>(component: ComponentInstance<T>) => Archetype;
    /** Get the ID of an archetype based on this with a toggled component */
    cloneInStep: <T>(component: ComponentInstance<T>) => [string, () => Archetype];
    /** @returns `true` if the query criteria match this archetype */
    isCandidate: (spec: QueryInstance) => boolean;
}

interface WorldSpec {
    /** Components to instantiate in the world  */
    components: Component<unknown>[];
    /** The maximum number of entities allowed in the world */
    entityCapacity: number;
}
interface WorldProto {
    version: string;
}
interface WorldData extends WorldProto {
    archetypes: Map<string, Archetype>;
    availableEntities: Entity[];
    components: Map<Component<unknown>, ComponentInstance<unknown>>;
    emptyBitfield: Bitfield;
    entityArchetypes: Archetype[];
    entityCapacity: number;
    bitfieldFactory: (components?: ComponentInstance<unknown>[]) => Bitfield;
    queries: Map<Query, QueryInstance>;
}
interface World extends WorldData {
    createEntity: () => number | undefined;
    destroyEntity: (entity: Entity) => boolean;
    getEntityArchetype: (entity: number) => Archetype | undefined;
    hasEntity: (entity: number) => boolean;
    addComponentToEntity: <T>(component: Component<T>, entity: number, props?: SchemaProps<T> | undefined) => boolean;
    entityHasComponent: <T>(component: Component<T>, entity: number) => boolean;
    removeComponentFromEntity: <T>(component: Component<T>, entity: number) => boolean;
    refreshWorld: () => void;
}
declare function createWorld(spec: WorldSpec): Readonly<World>;

/** { [component name]: component instance } */
declare type ComponentRecord = Record<string, ComponentInstance<unknown>>;
interface ComponentSpec<T> {
    /** The component's label */
    name: string;
    /** The component's property definitions. Omit to define a tag component. */
    schema?: Schema<T>;
}
interface Component<T> {
    instance: (world: World) => ComponentInstance<T> | undefined;
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
declare function createComponent<T>(spec: ComponentSpec<T>): Component<T>;

export { Archetype, Bitfield, Component, ComponentInstance, ComponentRecord, ComponentSpec, Query, QueryInstance, QuerySpec, Schema, SchemaProps, TypedArrayConstructor, World, WorldSpec, createComponent, createQuery, createWorld };
