/*! *****************************************************************************
 *
 * miski
 * v0.2.2
 *
 * MIT License
 * 
 * Copyright (C) 2021 Peter Hughes<https://www.phugh.es>, all rights reserved.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * 
***************************************************************************** */

interface ComponentSpec<T> {
    entityLimit?: number | null;
    name: string;
    properties: T;
    removable?: boolean;
}
declare type Component<T> = Readonly<{
    entityLimit: number | null;
    id: number;
    name: string;
    properties: T;
    removable: boolean;
}>;

declare type Entity = Readonly<{
    _: Record<string, unknown>;
    addComponent: <T>(component: Component<T>) => boolean;
    getArchetype: () => bigint;
    hasComponent: <T>(component: Component<T>) => boolean;
    id: string;
    isAwake: () => boolean;
    next: (next?: Entity | null) => Entity | null;
    purge: () => void;
    removeComponent: <T>(component: Component<T>) => boolean;
    sleep: () => boolean;
    wake: () => boolean;
}>;

declare type System = Readonly<{
    archetype: bigint;
    disable: () => boolean;
    enable: () => boolean;
    enabled: boolean;
    exclusive: boolean;
    name: string;
    postUpdate: (int: number, entities: Entity[], system: System) => void;
    preUpdate: (entities: Entity[], system: System) => void;
    update: (dt: number, entities: Entity[], system: System) => void;
}>;
interface SystemSpec {
    components: Component<unknown>[];
    exclusive?: boolean;
    name: string;
    postUpdate?: (int: number, entity: Entity[], system: System) => void;
    preUpdate?: (entities: Entity[], system: System) => void;
    update?: (dt: number, entities: Entity[], system: System) => void;
}

interface WorldSpec {
    initialPoolSize?: number;
    maxComponents?: number;
    maxEntities?: number;
}
declare type World = Readonly<{
    addComponentsToEntity: (entity: Entity, ...components: Component<unknown>[]) => Entity;
    createEntity: () => Entity;
    destroyEntity: (entity: Entity) => boolean;
    entity: Entity;
    getComponentById: (id: number) => Component<unknown> | undefined;
    getComponentByName: (name: string) => Component<unknown> | undefined;
    getComponents: () => Component<unknown>[];
    getEntities: () => Entity[];
    getEntitiesByComponents: (...components: Component<unknown>[]) => Entity[];
    getEntityById: (id: string) => Entity | undefined;
    getSystemByIndex: (index: number) => System | undefined;
    getSystemByName: (name: string) => System | undefined;
    getSystems: () => System[];
    isComponentRegistered: <T>(component: Component<T>) => boolean;
    isSystemRegistered: (system: System) => boolean;
    moveSystem: (system: System, idx: number) => boolean;
    postUpdate: (int: number) => void;
    preUpdate: () => void;
    registerComponent: <T>(spec: ComponentSpec<T>) => Component<T>;
    registerSystem: (spec: SystemSpec) => System;
    removeComponentsFromEntity: (entity: Entity, ...components: Component<unknown>[]) => Entity;
    unregisterComponent: <T>(component: Component<T>) => ComponentSpec<T>;
    unregisterSystem: (system: System) => void;
    update: (dt: number) => void;
}>;
declare function createWorld(spec: WorldSpec): World;

export { Component, Entity, System, World, createWorld };
