/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { Archetype } from "../archetype/archetype.js";
import { Bitfield } from "../bitfield.js";
import { $_COUNT } from "../constants.js";
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
  hasAllComponents: (...components: Component<unknown>[]) => (...entities: Entity[]) => boolean[];
  hasComponent: <T>(component: Component<T>) => (entity: Entity) => boolean;
  hasComponents: (...components: Component<unknown>[]) => (...entities: Entity[]) => boolean[][];
  getBuffer: () => ArrayBuffer;
  getEntityProperties: (entity: Entity) => { [key: string]: SchemaProps<unknown> };
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
  updateArchetype: (entity: Entity, component: ComponentInstance<unknown> | ComponentInstance<unknown>[]) => Archetype;
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
        instance[$_COUNT] = count + 1;

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

      const added = status
        .map((value, idx) => (value ? instances[idx] : undefined))
        .filter((x) => x) as ComponentInstance<unknown>[];

      updateArchetype(entity, added);

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

    const { count, maxEntities } = inst;
    if (maxEntities && count >= maxEntities) return false;
    inst[$_COUNT] = count + 1;

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

  const getEntityProperties = (entity: Entity): { [key: string]: SchemaProps<unknown> } => {
    const archetype = getEntityArchetype(entity);
    if (!archetype) return {};
    const { components } = archetype;
    return [...components].reduce(
      <T>(res: { [key: string]: SchemaProps<unknown> }, component: ComponentInstance<T>) => {
        const { name, schema } = component;
        res[name] = {};
        if (schema === null) {
          res[name] = true;
        } else {
          res[name] = Object.keys(schema).reduce((prev, key) => {
            prev[key as keyof T] = component[key as keyof T][entity];
            return prev;
          }, {} as SchemaProps<T>);
        }
        return res;
      },
      {},
    );
  };

  /**
   * returns a 2d array, first indexed by entity, then by component id.
   * @returns [entity: [component.id: boolean]]
   * @example
   *  const hasRenderables = hasComponents({ id: 21 }, { id: 99 });
   *  const state = hasRenderables(10, 33, 75);
   *  // state[10][21] = whether entity 10 has component 21;
   *  // state[33][99] = whether entity 33 has component 99;
   *  // state[0][99] = will throw because state[0] is undefined;
   */
  const hasComponents = (...components: Component<unknown>[]): ((...entities: Entity[]) => boolean[][]) => {
    const instances = components.map((component) => componentMap.get(component)) as ComponentInstance<unknown>[];
    const resFalse = instances.reduce((res, { id }) => {
      res[id] = false;
      return res;
    }, [] as boolean[]);
    return (...entities: Entity[]): boolean[][] => {
      return entities.reduce((res, entity) => {
        const archetype = getEntityArchetype(entity);
        if (!archetype) {
          res[entity] = resFalse;
        } else {
          res[entity] = instances.reduce((delta, { id }) => {
            delta[id] = isBitOn(id, archetype.bitfield);
            return delta;
          }, [] as boolean[]);
        }
        return res;
      }, [] as boolean[][]);
    };
  };

  /**
   * returns an array, indexed by entity,
   * containing `true` if the entity has all the desired components.
   * @returns [entity: boolean]
   * @example
   *  const hasRenderables = hasComponents({ id: 21 }, { id: 99 });
   *  const state = hasRenderables(10, 33, 75);
   *  // state[10] = whether entity 10 has both components 21 & 99;
   *  // state[33] = whether entity 33 has both components 21 & 99;
   *  // state[0] = will be undefined;
   */
  const hasAllComponents = (...components: Component<unknown>[]): ((...entities: Entity[]) => boolean[]) => {
    const instances = components.map((component) => componentMap.get(component)) as ComponentInstance<unknown>[];
    return (...entities: Entity[]): boolean[] => {
      return entities.reduce((res, entity) => {
        const archetype = getEntityArchetype(entity);
        if (!archetype) {
          res[entity] = false;
        } else {
          res[entity] = instances.every(({ id }) => isBitOn(id, archetype.bitfield));
        }
        return res;
      }, [] as boolean[]);
    };
  };

  /** Test a single component against a single entity */
  const hasComponent = <T>(component: Component<T>): ((entity: Entity) => boolean) => {
    const instance = componentMap.get(component);
    return (entity: Entity): boolean => {
      if (!instance) return false;
      const archetype = getEntityArchetype(entity);
      if (!archetype) return false;
      return isBitOn(instance.id, archetype.bitfield);
    };
  };

  const removeComponentFromEntity = <T>(component: Component<T>, entity: Entity): boolean => {
    if (!isValidEntity(entity)) return false;
    const instance = componentMap.get(component);
    if (!instance) return false;

    const archetype = getEntityArchetype(entity);
    if (archetype && !isBitOn(instance.id, archetype.bitfield)) return true;
    instance[$_COUNT] = instance[$_COUNT] - 1;

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

    updateArchetype(entity, instance);
    return true;
  };

  const _removeMultiple = (instances: ComponentInstance<unknown>[]) => {
    return (entity: Entity): boolean[] => {
      const archetype = getEntityArchetype(entity);

      const status = instances.map((instance) => {
        if (archetype && !isBitOn(instance.id, archetype.bitfield)) return false;
        instance[$_COUNT] = instance[$_COUNT] - 1;

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

      const removed = status
        .map((value, idx) => (value ? instances[idx] : undefined))
        .filter((x) => x) as ComponentInstance<unknown>[];

      updateArchetype(entity, removed);

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
    getEntityProperties,
    hasAllComponents,
    hasComponent,
    hasComponents,
    getBuffer,
    removeComponentFromEntity,
    removeComponentsFromEntity,
    setBuffer,
  };
}
