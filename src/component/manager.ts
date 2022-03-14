/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "../archetype/archetype.js";
import { Bitfield } from "../bitfield.js";
import { Entity } from "../entity.js";
import { ComponentBufferPartitioner, createComponentBuffer, createComponentBufferPartitioner } from "./buffer.js";
import { Component } from "./component.js";
import { ComponentInstance, createComponentInstance } from "./instance.js";
import { SchemaProps } from "./schema.js";

/** { [component name]: component instance } */
export type ComponentRecord = Record<string, ComponentInstance<unknown>>;

export interface ComponentManager {
  componentMap: Map<Component<unknown>, ComponentInstance<unknown>>;
  addComponentToEntity: <T>(component: Component<T>, entity: Entity, props?: SchemaProps<T>) => boolean;
  addComponentsToEntity: (components: Component<unknown>[]) => (entity: Entity) => boolean[];
  entityHasComponent: <T>(entity: Entity, component: Component<T>) => boolean;
  getBuffer: () => ArrayBuffer;
  removeComponentFromEntity: <T>(component: Component<T>, entity: Entity) => boolean;
  removeComponentsFromEntity: (components: Component<unknown>[]) => (entity: Entity) => boolean[];
  setBuffer: (source: ArrayBuffer) => ArrayBuffer;
}

interface ComponentManagerSpec {
  capacity: number;
  components: Component<unknown>[];
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  isBitOn: (bit: number, bitfield: Bitfield) => boolean;
  isValidEntity: (entity: Entity) => entity is Entity;
  updateArchetype: (entity: Entity, component: number | number[]) => Archetype;
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

  // create component storage
  const buffer = createComponentBuffer({ capacity, components });
  const partitioner = createComponentBufferPartitioner({ buffer, capacity });

  /** { component_name: ComponentInstance } */
  const instances = instantiateComponents({ components, partitioner });

  /** Map<Component, ComponentInstance> */
  const componentMap: Map<Component<unknown>, ComponentInstance<unknown>> = new Map(
    Object.values(instances).map(<T>(instance: ComponentInstance<T>) => [
      Object.getPrototypeOf(instance) as Component<T>,
      instance,
    ]),
  );

  /** @returns a copy of the component storage buffer */
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

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const _addMultiple = (instances: ComponentInstance<unknown>[]) => {
    return (entity: Entity, properties?: { [key: string]: SchemaProps<unknown> }): boolean[] => {
      const archetype = getEntityArchetype(entity);
      if (!archetype) throw new SyntaxError(`Archetype for Entity ${entity} not found.`);

      const status = instances.map((instance) => {
        if (isBitOn(instance.id, archetype.bitfield)) return true;

        const { count, maxEntities } = instance;
        if (maxEntities && count >= maxEntities) return false;
        instance.count = count + 1;

        // set any default initial properties
        if (instance.schema) {
          Object.entries(instance.schema).forEach(([key, value]) => {
            if (Array.isArray(value)) {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
              instance[key][entity] = value[1] ?? 0;
            }
          });
        }

        // set any custom initial properties
        if (properties && instance.name in properties) {
          Object.entries(properties[instance.name]!).forEach(([key, value]) => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            inst[key][entity] = value;
          });
        }

        return true;
      });

      const ids = status.reduce((res, value, idx) => {
        if (value) res.push(instances[idx]!.id);
        return res;
      }, [] as number[]);

      updateArchetype(entity, ids);

      return status;
    };
  };

  const addComponentsToEntity = (components: Component<unknown>[]) => {
    const instances = components.map((component) => componentMap.get(component)) as ComponentInstance<unknown>[];
    if (instances.length !== components.length) throw new SyntaxError("Not all components were found!");
    return _addMultiple(instances);
  };

  const addComponentToEntity = <T>(component: Component<T>, entity: Entity, props?: SchemaProps<T>): boolean => {
    if (!isValidEntity(entity)) return false;
    const inst = componentMap.get(component);
    if (!inst) return false;

    const archetype = getEntityArchetype(entity);
    if (archetype && isBitOn(inst.id, archetype.bitfield)) return true;

    const { maxEntities } = component;
    if (maxEntities && inst.count >= maxEntities) return false;
    inst.count = inst.count + 1;

    updateArchetype(entity, inst.id);

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
    const instance = componentMap.get(component);
    if (!instance) return false;

    const archetype = getEntityArchetype(entity);
    if (archetype && !isBitOn(instance.id, archetype.bitfield)) return true;
    instance.count = instance.count - 1;

    // make sure facade storage is freed for those that need it
    const { maxEntities, schema } = component;
    if (maxEntities && schema) {
      Object.keys(schema).forEach((key) => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        delete inst[key][entity];
      });
    }

    updateArchetype(entity, instance.id);
    return true;
  };

  const _removeMultiple = (instances: ComponentInstance<unknown>[]) => {
    return (entity: Entity): boolean[] => {
      const archetype = getEntityArchetype(entity);

      const status = instances.map((instance) => {
        if (archetype && !isBitOn(instance.id, archetype.bitfield)) return true;
        instance.count = instance.count - 1;

        // make sure facade storage is freed for those that need it
        const { maxEntities, schema } = instance;
        if (maxEntities && schema) {
          Object.keys(schema).forEach((key) => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            delete inst[key][entity];
          });
        }

        return true;
      });

      const ids = status.reduce((res, value, idx) => {
        if (value) res.push(instances[idx]!.id);
        return res;
      }, [] as number[]);

      updateArchetype(entity, ids);

      return status;
    };
  };

  const removeComponentsFromEntity = (components: Component<unknown>[]) => {
    const instances = components.map((component) => componentMap.get(component)) as ComponentInstance<unknown>[];
    if (instances.length !== components.length) throw new SyntaxError("Not all components were found!");
    return _removeMultiple(instances);
  };

  return {
    componentMap,

    addComponentToEntity,
    addComponentsToEntity,
    entityHasComponent,
    getBuffer,
    removeComponentFromEntity,
    removeComponentsFromEntity,
    setBuffer,
  };
}
