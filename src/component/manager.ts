/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "../archetype/archetype.js";
import { Bitfield } from "../bitfield.js";
import { Entity } from "../entity.js";
import { ComponentBufferPartitioner, createComponentBuffer, createComponentBufferPartitioner } from "./buffer.js";
import { Component, ComponentRecord } from "./component.js";
import { ComponentInstance, createComponentInstance } from "./instance.js";
import { SchemaProps } from "./schema.js";

export interface ComponentManager {
  componentMap: Map<Component<unknown>, ComponentInstance<unknown>>;
  addComponentToEntity: <T>(component: Component<T>, entity: Entity, props?: SchemaProps<T>) => boolean;
  entityHasComponent: <T>(entity: Entity, component: Component<T>) => boolean;
  getBuffer: () => ArrayBuffer;
  removeComponentFromEntity: <T>(component: Component<T>, entity: Entity) => boolean;
  setBuffer: (source: ArrayBuffer) => ArrayBuffer;
}

interface ComponentManagerSpec {
  capacity: number;
  components: Component<unknown>[];
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  isBitOn: (bit: number, bitfield: Bitfield) => boolean;
  isValidEntity: (entity: Entity) => entity is Entity;
  updateArchetype: <T>(entity: Entity, component: ComponentInstance<T>) => Archetype;
}

/**
 * Create component instances for the world
 * @param spec The function's specification object
 * @param spec.components An array of components to instantiate
 * @param spec.capacity The associated world's component buffer partitioner function
 * @returns an object whose keys are component names, and whose values are component instances
 */
function instantiateComponents(spec: {
  components: Component<unknown>[];
  partitioner: ComponentBufferPartitioner;
}): ComponentRecord {
  const { components, partitioner } = spec;
  const reducer = <T>(obj: ComponentRecord, component: Component<T>, id: number) => {
    const { name } = component;
    if (Object.prototype.hasOwnProperty.call(obj, name))
      throw new Error(`ComponentInstance with name "${name}" already exists.`);
    const storage = partitioner(component);
    obj[name] = createComponentInstance({ component, id, storage });
    return obj;
  };
  return [...new Set(components)].reduce(reducer, {});
}

export function createComponentManager(spec: ComponentManagerSpec): ComponentManager {
  const { capacity, components, getEntityArchetype, isBitOn, isValidEntity, updateArchetype } = spec;

  const buffer = createComponentBuffer({ capacity, components });
  const partitioner = createComponentBufferPartitioner({ buffer, capacity });

  /** { component_name: ComponentInstance } */
  const instances = instantiateComponents({ components, partitioner });

  /** <Component, ComponentInstance> */
  const componentMap: Map<Component<unknown>, ComponentInstance<unknown>> = new Map();
  Object.values(instances).forEach(<T>(instance: ComponentInstance<T>) => {
    componentMap.set(Object.getPrototypeOf(instance) as Component<T>, instance);
  });

  const getBuffer = (): ArrayBuffer => buffer.slice(0);

  const setBuffer = (source: ArrayBuffer): ArrayBuffer => {
    if (source.byteLength !== buffer.byteLength) {
      throw new Error("setBuffer - byteLength mismatch!");
    }
    const view = new Uint8Array(source);
    const target = new Uint8Array(buffer);
    target.set(view);
    return buffer.slice(0);
  };

  const addComponentToEntity = <T>(component: Component<T>, entity: Entity, props?: SchemaProps<T>): boolean => {
    if (!isValidEntity(entity)) return false;
    const inst = componentMap.get(component);
    if (!inst) return false;
    updateArchetype(entity, inst);
    // set any default initial properties
    if (component.schema) {
      Object.entries(component.schema).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
          inst[key][entity] = value[1] ?? 0;
        }
      });
    }
    // set any custom initial properties
    if (props) {
      Object.entries(props).forEach(([key, value]) => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        inst[key][entity] = value;
      });
    }
    return true;
  };

  const entityHasComponent = <T>(entity: Entity, component: Component<T>): boolean => {
    const inst = componentMap.get(component);
    if (!inst) return false;
    const arch = getEntityArchetype(entity);
    if (!arch) return false;
    const { bitfield } = arch;
    const { id } = inst;
    return isBitOn(id, bitfield);
  };

  const removeComponentFromEntity = <T>(component: Component<T>, entity: Entity): boolean => {
    if (!isValidEntity(entity)) return false;
    const inst = componentMap.get(component);
    if (!inst) return false;
    updateArchetype(entity, inst);
    return true;
  };

  return {
    componentMap,

    addComponentToEntity,
    entityHasComponent,
    getBuffer,
    removeComponentFromEntity,
    setBuffer,
  };
}
