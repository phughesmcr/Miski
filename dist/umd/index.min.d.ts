/*! *****************************************************************************
 *
 * miski
 * v0.1.4
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

declare type SystemSpec = Omit<InternalSystemSpec, "id">;
interface InternalSystemSpec {
    /** The system's required components */
    components?: Component<unknown>[];
    /** The system's id */
    id: bigint;
    /** A name / label for the system */
    name: string;
    /** The system's render function */
    renderFn?: (int: number, entities: Entity[]) => void;
    /** The system's update function */
    updateFn?: (dt: number, entities: Entity[]) => void;
}
declare type System = Readonly<{
    /** The system's associated entity archetype */
    archetype: bigint;
    /** Is the system enabled? */
    enabled: boolean;
    /** The system's id */
    id: bigint;
    /** The name / label of the system */
    name: string;
    /** Disable the system */
    disable(): void;
    /** Enable the system */
    enable(): void;
    /** The system's render function */
    render(int: number, entities: Entity[]): void;
    /** The system's update function */
    update(dt: number, entities: Entity[]): void;
}>;

interface WorldSpec {
    initialPoolSize?: number | bigint;
    maxComponents?: number | bigint;
}
interface World {
    archetypes: [bigint, Set<Entity>][];
    components: Component<unknown>[];
    component: Component<WorldComponent>;
    entities: Entity[];
    entity: Entity;
    systems: System[];
    createEntity(): Entity;
    removeEntity(entity: Entity): boolean;
    getEntityById(id: bigint): Entity | undefined;
    createComponent<T>(spec: ComponentSpec<T>): Component<T>;
    removeComponent<T>(component: Component<T>): boolean;
    getComponentByName(name: string): Component<unknown> | undefined;
    addComponentsToEntity(entity: Entity, ...components: Component<unknown>[]): Entity;
    removeComponentsFromEntity(entity: Entity, ...components: Component<unknown>[]): Entity;
    createSystem(spec: SystemSpec, idx?: number): System;
    removeSystem(system: System): boolean;
    moveSystem(system: System | string, idx: number): System;
    getSystemByName(name: string): System | undefined;
    update(dt: number): void;
    render(int: number): void;
}
declare function createWorld(spec: WorldSpec): World;

declare type Entity = Readonly<{
    /** The entity's archetype */
    archetype: bigint;
    /** Array of components associated with the entity */
    allComponents: Component<unknown>[];
    /** The entity's id */
    id: bigint;
    /** The entity's world */
    world: World | null;
    /** Check if a component is present in an entity */
    hasComponent(component: Component<unknown>): boolean;
    /** @hidden */
    _setId(id: bigint): Entity;
    /** @hidden */
    _setWorld(world: World | null): void;
    /** @hidden */
    _addComponent(component: Component<unknown>): Entity;
    /** @hidden */
    _removeComponent(component: Component<unknown>): Entity;
}>;

/** A property specifically for the worldEntity */
interface WorldComponent {
    /** The associated world object */
    world: World;
}
/** Component specification object */
declare type ComponentSpec<T = Record<string, unknown>> = Omit<InternalComponentSpec<T>, "id">;
/** Internal component specification object */
interface InternalComponentSpec<T = Record<string, unknown>> {
    /** The maximum entities component can attach to */
    entityLimit?: number | bigint | null;
    /** The component's id */
    id: bigint;
    /** The component's name */
    name: string;
    /** The component's property object */
    properties: T;
    /** Is the component removable once attached? */
    removable?: boolean;
}
interface Component<T = Record<string, unknown>> {
    /** An array of entities associated with this component */
    entities: Entity[];
    /** The maximum entities component can attach to */
    entityLimit: number | bigint | null;
    /** The component's id */
    id: Readonly<bigint>;
    /** The component's name */
    name: Readonly<string>;
    /** The component's property object */
    properties: T;
    /** Is the component removable once attached? */
    removable: boolean;
    /** @hidden */
    _addEntity(entity: Entity): void;
    /** @hidden */
    _removeEntity(entity: Entity): void;
    /** Check if an entity is associated with this category */
    hasEntity(entity: Entity): boolean;
    /** Set the maximum entities component can attach to */
    setEntityLimit(limit: number | bigint | null): void;
    /** Set whether the component be removed from entities once attached */
    setRemovable(isRemovable: boolean): void;
}

export { Component, ComponentSpec, Entity, System, SystemSpec, World, createWorld };
