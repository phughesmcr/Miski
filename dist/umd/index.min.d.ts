declare class Archetype {
    private _registry;
    readonly id: bigint;
    constructor(id: bigint, initialEntities?: Entity[]);
    get entities(): Entity[];
    addEntity(entity: Entity): void;
    isEmpty(): boolean;
    removeEntity(entity: Entity): void;
}

interface QuerySpec {
    all?: Component<unknown>[];
    any?: Component<unknown>[];
    none?: Component<unknown>[];
}
declare class Query {
    private _all;
    private _any;
    private _none;
    private _mskAll;
    private _mskAny;
    private _mskNone;
    private _cache;
    private _registry;
    private _world;
    constructor(world: World, spec: QuerySpec);
    get entities(): Entity[];
    get size(): number;
    hasEntity(entity: Entity): boolean;
    matches(archetype: bigint): boolean;
    update(): void;
}

interface Toggleable {
    readonly enabled: boolean;
    disable: () => void;
    enable: () => void;
}

interface SystemSpec {
    query?: Query | null;
    name: string;
    pre?: (entities: Entity[], global: Entity) => void;
    post?: (entities: Entity[], global: Entity, int?: number) => void;
    update?: (entities: Entity[], global: Entity, dt?: number) => void;
}
declare class System implements Toggleable {
    private _enabled;
    private _world;
    readonly name: string;
    readonly query: Query | null;
    readonly pre: (entities: Entity[], global: Entity) => void;
    readonly post: (entities: Entity[], global: Entity, int?: number) => void;
    readonly update: (entities: Entity[], global: Entity, dt?: number) => void;
    constructor(world: World, spec: SystemSpec);
    get enabled(): boolean;
    get entities(): Entity[];
    disable(): void;
    enable(): void;
}

interface WorldSpec {
    entityPoolGrowthFactor?: number;
    initialEntityPoolSize?: number;
    maxComponents?: number;
    maxEntities?: number;
    maxUpdates?: number;
    tempo?: number;
}
interface World {
    FORBIDDEN_NAMES: Readonly<string[]>;
    global: Entity;
    getArchetype: (id: bigint) => Archetype | undefined;
    getArchetypes: () => Archetype[];
    getEntitiesByComponents: (...components: Component<unknown>[]) => Entity[];
    isArchetypeRegistered: (archetype: Archetype) => boolean;
    updateArchetype: (entity: Entity, prev?: bigint) => World;
    getComponentById: (id: bigint) => Component<unknown> | undefined;
    getComponentByName: (name: string) => Component<unknown> | undefined;
    getComponents: () => Component<unknown>[];
    isComponentRegistered: <T>(component: Component<T>) => boolean;
    registerComponent: <T>(spec: ComponentSpec<T>) => Component<T>;
    unregisterComponent: <T>(component: Component<T>) => World;
    createEntity: () => Entity;
    destroyEntity: (entity: Entity) => boolean;
    getEntities: () => Entity[];
    getEntityById: (id: string) => Entity | undefined;
    isEntityRegistered: (entity: Entity) => boolean;
    isQueryRegistered: (query: Query) => boolean;
    registerQuery: (spec: QuerySpec) => Query;
    unregisterQuery: (query: Query) => World;
    updateQueries: () => World;
    pre: () => World;
    post: (int: number) => World;
    step: (time: number) => World;
    update: (dt: number) => World;
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
/**
 * Creates a new World object
 * @param spec the world's specification object
 * @param spec.entityPoolGrowthFactor amount to grow the entity pool by once the
 * initial entities have been used. Defaults to 0.25.
 * @param spec.initialEntityPoolSize the number of entities to pre-allocate. Defaults to 128.
 * @param spec.maxComponents the maximum number of components to allow. Defaults to 256.
 * @param spec.maxEntities the maximum number of entities to allow. Defaults to Number.POSITIVE_INFINITY.
 * @param spec.maxUpdates the maximum number of updates to allow before panicking. Defaults to 240.
 * @param spec.tempo the desired update rate. Defaults to 1/60 (i.e. 60fps, or 0.016).
 * @returns a new World object
 */
declare function createWorld(spec?: WorldSpec): World;

interface Poolable<T> {
    next: T | null;
}

interface Entity {
    [property: string]: unknown;
}
declare class Entity implements Toggleable, Poolable<Entity> {
    private _archetype;
    private _enabled;
    private _next;
    private _properties;
    private _world;
    readonly id: string;
    constructor(world: World);
    get archetype(): bigint;
    get enabled(): boolean;
    get next(): Entity | null;
    set next(next: Entity | null);
    addComponent<T>(component: Component<T>, properties?: T): boolean;
    clear(): void;
    disable(): void;
    enable(): void;
    hasComponent<T>(component: Component<T> | string): boolean;
    removeComponent<T>(component: Component<T>): boolean;
}

interface ComponentSpec<T> {
    name: string;
    defaults: T;
}
declare class Component<T> {
    private _world;
    readonly defaults: Readonly<T>;
    readonly id: bigint;
    readonly name: string;
    constructor(world: World, id: bigint, spec: ComponentSpec<T>);
    get entities(): Entity[];
    get isRegistered(): boolean;
}

export { Component, ComponentSpec, Entity, Poolable, Query, QuerySpec, System, SystemSpec, Toggleable, World, WorldSpec, createWorld };
