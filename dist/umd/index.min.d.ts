/*! *****************************************************************************
 *
 * miski
 * v0.1.0
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

declare type Entity = Readonly<{
    /** The entity's archetype */
    archetype: bigint;
    /** The entity's id */
    id: bigint;
    /** Check if a component is present in an entity */
    hasComponent(component: Component<unknown>): boolean;
    /** @hidden */
    _destroy(): Entity;
    /** @hidden */
    _setId(id: bigint): Entity;
    /** @hidden */
    _addComponent(component: Component<unknown>): Entity;
    /** @hidden */
    _removeComponent(component: Component<unknown>): Entity;
}>;

/** Component specification object */
declare type ComponentSpec<T> = Omit<InternalComponentSpec<T>, "id">;
/** Internal component specification object */
interface InternalComponentSpec<T> {
    id: bigint;
    name: string;
    properties: T;
}
interface Component<T> {
    id: Readonly<bigint>;
    name: Readonly<string>;
    entities: Readonly<Entity[]>;
    properties: T;
    /** Check if an entity is associated with this category */
    hasEntity(entity: Entity): boolean;
    /** @hidden */
    _addEntity(entity: Entity): void;
    /** @hidden */
    _removeEntity(entity: Entity): void;
}

declare type SystemSpec = Omit<InternalSystemSpec, "id">;
interface InternalSystemSpec {
    id: bigint;
    updateFn?: (dt: number, entities: Entity[]) => void;
    renderFn?: (int: number, entities: Entity[]) => void;
    components: Component<unknown>[];
}
declare type System = Readonly<{
    archetype: bigint;
    enabled: boolean;
    id: bigint;
    enable(): void;
    disable(): void;
    update(dt: number, entities: Entity[]): void;
    render(int: number, entities: Entity[]): void;
}>;

interface WorldSpec {
    initialPoolSize?: number | bigint;
    maxComponents?: number | bigint;
}
interface World {
    components: Component<unknown>[];
    entities: Entity[];
    systems: System[];
    createEntity(): Entity;
    removeEntity(entity: Entity): boolean;
    createComponent<T>(spec: ComponentSpec<T>): Component<T>;
    removeComponent<T>(component: Component<T>): boolean;
    addComponentsToEntity(entity: Entity, ...components: Component<unknown>[]): Entity;
    removeComponentsFromEntity(entity: Entity, ...components: Component<unknown>[]): Entity;
    createSystem(spec: SystemSpec): System;
    removeSystem(system: System): boolean;
    update(dt: number): void;
    render(int: number): void;
}
declare function createWorld(spec: WorldSpec): World;

export { Component, ComponentSpec, Entity, System, SystemSpec, createWorld };
