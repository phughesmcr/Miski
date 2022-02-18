/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "../archetype/archetype.js";
import { Entity } from "../entity.js";
import { ComponentBufferPartitioner, createComponentBuffer, createComponentBufferPartitioner } from "./buffer.js";
import { Component, ComponentRecord } from "./component.js";
import { ComponentInstance, createComponentInstance } from "./instance.js";
import { SchemaProps } from "./schema.js";

export interface ComponentManager {
  componentMap: Map<Component<unknown>, ComponentInstance<unknown>>;
  addComponentToEntity: <T>(component: Component<T>, entity: Entity, props?: SchemaProps<T>) => boolean;
  entityHasComponent: <T>(entity: Entity, component: Component<T>) => boolean;
  removeComponentFromEntity: <T>(component: Component<T>, entity: Entity) => boolean;
}

export interface ComponentManagerSpec {
  components: Component<unknown>[];
  entityCapacity: number;
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
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
    if (name in obj) throw new Error(`ComponentInstance with name "${name}" already exists.`);
    const storage = partitioner(component);
    obj[name] = createComponentInstance({ component, id, storage });
    return obj;
  };
  return [...new Set(components)].reduce(reducer, {});
}

/**
 * Create a new ComponentManager object
 * @param spec
 * @param spec.capacity
 * @param spec.components
 */
export function createComponentManager(spec: ComponentManagerSpec): Readonly<ComponentManager> {
  const { components, entityCapacity, getEntityArchetype, updateArchetype } = spec;

  /** { component_name: ComponentInstance } */
  const instances = (() => {
    const buffer = createComponentBuffer({ entityCapacity, components });
    const partitioner = createComponentBufferPartitioner({ buffer, entityCapacity });
    return instantiateComponents({ components, partitioner });
  })();

  /** <Component, ComponentInstance> */
  const componentMap: Map<Component<unknown>, ComponentInstance<unknown>> = new Map();
  Object.values(instances).forEach(<T>(instance: ComponentInstance<T>) => {
    componentMap.set(instance.component, instance);
  });

  function getComponentInstance<T>(component: Component<T> | string): ComponentInstance<T> | undefined {
    if (typeof component === "string") {
      return instances[component] as ComponentInstance<T> | undefined;
    } else {
      return componentMap.get(component) as ComponentInstance<T> | undefined;
    }
  }

  return Object.freeze({
    componentMap,

    addComponentToEntity<T>(component: Component<T>, entity: Entity, props?: SchemaProps<T>): boolean {
      const inst = getComponentInstance(component);
      if (!inst) return false;
      updateArchetype(entity, inst);
      if (props) {
        Object.entries(props).forEach(([key, value]) => {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          inst[key][entity] = value;
        });
      }
      return true;
    },

    entityHasComponent<T>(entity: Entity, component: Component<T>): boolean {
      const inst = getComponentInstance(component);
      if (!inst) return false;
      const arch = getEntityArchetype(entity);
      if (!arch) return false;
      const { bitfield } = arch;
      return bitfield.isOn(inst.id);
    },

    removeComponentFromEntity<T>(component: Component<T>, entity: Entity): boolean {
      const inst = getComponentInstance(component);
      if (!inst) return false;
      updateArchetype(entity, inst);
      return true;
    },
  });
}
