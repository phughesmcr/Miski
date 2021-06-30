/**
 * @name        Bitmask
 * @description Utilities for handling and manipulating bitmask arrays
 * @author      P. Hughes <peter@phugh.es> (https://www.phugh.es)
 * @copyright   2021 P. Hughes. All rights reserved.
 * @license     MIT
 */
/** A bitmask is simply one of these typed arrays. */
declare type Bitmask = Uint32Array;

declare type SOA<T> = {
    [K in keyof T]: T[K][];
};

declare type TypeCopyFunction<T> = (src: T, dest: T) => T;
declare type TypeCloneFunction<T> = (value: T) => T;
declare type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array;

/** Entities are indexes. */
declare type Entity = number;
/**
 * Entity availability state.
 * 1 = unavailable
 * 0 = available
 */
declare type EntityState = 0 | 1;
interface EntityManager {
    createEntity: () => Entity;
    destroyEntity: (entity: Entity) => World;
    getEntityState: (entity: Entity) => EntityState | undefined;
    isEntityRegistered: (entity: Entity) => boolean;
}

declare const $dirty: unique symbol;
interface Archetype {
    [$dirty]: boolean;
    add: (entity: Entity) => Archetype;
    entities: Set<Entity>;
    has: (entity: Entity) => boolean;
    mask: Bitmask;
    name: string;
    remove: (entity: Entity) => Archetype;
    reset: () => Archetype;
}

interface ArchetypeManager {
    getArchetypes: () => Archetype[];
    getEntityArchetype: (entity: number) => Archetype | undefined;
    archetypeHasComponent: <T>(archetype: Archetype, component: ComponentInstance<T>) => boolean;
    resetEntityArchetype: (entity: number) => Archetype;
    updateEntityArchetype: (entity: number, ...components: ComponentInstance<unknown>[]) => Archetype;
}

interface ComponentManager {
    addComponentToEntity: <T>(entity: Entity, component: Component<T>, properties?: Partial<T>) => World;
    collateEntityProperties: (entity: Entity) => Record<string, unknown>;
    entityHasComponent: <T>(entity: Entity, component: Component<T>) => boolean;
    getComponentId: <T>(component: Component<T>) => number | undefined;
    getComponentById: (id: number) => Component<unknown> | undefined;
    getComponentByName: (name: string) => Component<unknown> | undefined;
    getComponents: () => ComponentInstance<unknown>[];
    getEntitiesWithComponent: <T>(component: Component<T>) => Entity[];
    getProperties: <T>(entity: Entity, component: Component<T>) => T | undefined;
    isComponentRegistered: <T>(component: Component<T>) => boolean;
    registerComponent: <T>(component: Component<T>) => ComponentInstance<T>;
    removeComponentFromEntity: <T>(entity: Entity, component: Component<T>) => World;
    stripEntity: (entity: Entity) => void;
    unregisterComponent: <T>(component: Component<T>) => World;
}

declare type QueryArray = [all: Uint32Array, any: Uint32Array, none: Uint32Array];
interface QuerySpec {
    /** Makes finding the query later much easier */
    name: string;
    /** The world associated with the query */
    world: World;
    /** AND - Gather entities as long as they have all these components */
    all?: ComponentInstance<unknown>[];
    /** OR - Gather entities as long as they have 0...* of these components */
    any?: ComponentInstance<unknown>[];
    /** NOT -Gather entities as long as they don't have these components */
    none?: ComponentInstance<unknown>[];
}
interface Query {
    add: (archetype: Archetype) => Query;
    archetypes: Archetype[];
    getEntities: () => Entity[];
    isMatch: (archetype: Archetype) => boolean;
    isQuery: true;
    name: string;
    query: QueryArray;
    remove: (archetype: Archetype) => Query;
}

interface QueryManager {
    getQueries: () => Query[];
    isQueryRegistered: (query: Query) => boolean;
    registerQuery: (spec: QuerySpec) => Query;
    refreshQuery: (query: Query) => Query;
    refreshQueries: () => World;
    unregisterQuery: (query: Query) => World;
}

interface StepManager {
    post: (alpha: number) => void;
    pre: () => void;
    /**
     * Perform one complete step.
     * i.e. Pre > Update > Post
     * @param time the current DOMHighResTimeStamp (e.g., from requestAnimationFrame)
     */
    step: (time: DOMHighResTimeStamp | number) => void;
    update: (delta: number) => void;
}

interface System extends SystemPrototype {
    entities: Entity[];
    name: string;
    query: Query;
}
interface SystemSpec {
    /** The associated query to gather entities for this system. */
    query: Query;
    /** The name of the system. Must be a valid property name. */
    name: string;
    /**
     * The system's pre-update function.
     * This runs once per step before the update function.
     * @param entities an array of entities associated with the system's query
     */
    pre?: (entities: Entity[]) => void;
    /**
     * The system's post-update function.
     * This runs once per step after the update function.
     * @param entities an array of entities associated with the system's query
     * @param alpha the step's interpolation alpha
     */
    post?: (entities: Entity[], alpha?: number) => void;
    /**
     * The system's update function.
     * @param entities an array of entities associated with the system's query
     * @param delta the step's delta time
     */
    update?: (entities: Entity[], delta?: number) => void;
}
interface SystemPrototype {
    disable: () => void;
    enable: () => void;
    enabled: boolean;
    isSystem: true;
    post: (entities: Entity[], alpha?: number) => void;
    pre: (entities: Entity[]) => void;
    update: (entities: Entity[], delta?: number) => void;
}

interface SystemManager {
    getSystems: () => System[];
    getPostSystems: () => System[];
    getPreSystems: () => System[];
    getUpdateSystems: () => System[];
    getSystemByIdx: (idx: number) => System | undefined;
    getSystemByName: (name: string) => System | undefined;
    isSystemRegistered: (system: System) => boolean;
    moveSystem: (system: System, idx: number) => number;
    registerSystem: (spec: SystemSpec) => System;
    unregisterSystem: (system: System) => World;
}

interface WorldSpec {
    maxComponents?: number;
    maxEntities?: number;
    maxUpdates?: number;
    tempo?: number;
}
declare type World = ArchetypeManager & ComponentManager & EntityManager & QueryManager & StepManager & SystemManager & {
    config: Readonly<Required<WorldSpec>>;
    id: string;
};
/**
 * Creates a new World object
 * @param spec the world's specification object
 * @param spec.maxComponents the maximum number of components to allow. Defaults to 256.
 * @param spec.maxEntities the maximum number of entities to allow. Defaults to 100,000.
 * @param spec.maxUpdates the maximum number of updates to allow before panicking. Defaults to 240.
 * @param spec.tempo the target update rate. Defaults to 1/60 (i.e. 60fps, or 0.016).
 * @returns a new World object
 */
declare function createWorld(spec?: WorldSpec): World;

interface SchemaProperty<T, D> {
    create: (...args: any[]) => T;
    init: D;
    clone: TypeCloneFunction<T>;
    copy: TypeCopyFunction<T>;
}
declare type Schema<T> = {
    [K in keyof T]: SchemaProperty<T[K], T[K]> | {
        type: SchemaProperty<T[K], T[K]>;
        default?: T[K];
    };
};
declare type ArrayPropType<T> = SchemaProperty<Array<T>, []>;
declare type BooleanPropType = SchemaProperty<boolean, boolean>;
declare type JSONPropType = SchemaProperty<unknown, unknown | null>;
declare type MapPropType<T, D> = SchemaProperty<Map<T, D>, Map<T, D>>;
declare type NumberPropType = SchemaProperty<number, number>;
declare type ObjectPropType<T extends Record<string, unknown>> = SchemaProperty<T, T>;
declare type RefPropType<T> = SchemaProperty<T, undefined>;
declare type SetPropType<T> = SchemaProperty<Set<T>, Set<T>>;
declare type StringPropType = SchemaProperty<string, string>;
declare type TypedArrayType<T extends TypedArray> = SchemaProperty<T, T>;
/**  */
declare const Types: {
    Array: ArrayPropType<unknown>;
    Boolean: BooleanPropType;
    JSON: JSONPropType;
    Map: MapPropType<unknown, unknown>;
    Number: NumberPropType;
    Object: ObjectPropType<Record<string, unknown>>;
    Ref: RefPropType<unknown>;
    Set: SetPropType<unknown>;
    String: StringPropType;
    i8: TypedArrayType<Int8Array>;
    u8: TypedArrayType<Uint8Array>;
    u8c: TypedArrayType<Uint8ClampedArray>;
    i16: TypedArrayType<Int16Array>;
    u16: TypedArrayType<Uint16Array>;
    i32: TypedArrayType<Int32Array>;
    u32: TypedArrayType<Uint32Array>;
    f32: TypedArrayType<Float32Array>;
    f64: TypedArrayType<Float64Array>;
    i64: TypedArrayType<BigInt64Array>;
    u64: TypedArrayType<BigUint64Array>;
};

declare const $isComponent: unique symbol;
declare const $isComponentInstance: unique symbol;
/** Component specification object */
interface ComponentSpec<T> {
    name: string;
    schema: Schema<T>;
}
/** Component object */
declare type Component<T> = ComponentPrototype & {
    name: string;
    schema: Schema<T>;
};
/** Component prototype object */
interface ComponentPrototype {
    readonly [$isComponent]: true;
}
declare type ComponentInstance<T> = ComponentInstancePrototype & Component<T> & SOA<T> & {
    entities: Bitmask;
    id: number;
    world: World;
    getPropertyArrays: () => [string, unknown[] | TypedArray][];
};
interface ComponentInstancePrototype {
    [$isComponentInstance]: true;
}
/**
 * Creates and returns a new component object
 * @param spec the component's specification
 * @param spec.name the component's name
 * @param spec.schema the component's schema specification
 * @returns the created component
 */
declare function createComponent<T>(spec: ComponentSpec<T>): Component<T>;

interface Poolable<T> {
    next: T | null;
}

export { ComponentSpec, Entity, Poolable, Query, QuerySpec, System, SystemSpec, Types, World, WorldSpec, createComponent, createWorld };
