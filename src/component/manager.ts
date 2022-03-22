/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import type { Archetype } from "../archetype/archetype.js";
import type { Bitfield } from "../bitfield.js";
import { $_COUNT } from "../constants.js";
import type { Entity } from "../entity.js";
import { ComponentBufferPartitioner, createComponentBuffer, createComponentBufferPartitioner } from "./buffer.js";
import type { Component } from "./component.js";
import { ComponentInstance, createComponentInstance } from "./instance.js";
import type { SchemaProps } from "./schema.js";

/** { [component name]: component instance } */
export type ComponentRecord = Record<string, ComponentInstance<unknown>>;

export type ComponentMap = Map<Component<unknown>, ComponentInstance<unknown>>;

export interface ComponentManager {
  componentMap: Map<Component<unknown>, ComponentInstance<unknown>>;
  addComponentsToEntity: (
    ...components: Component<unknown>[]
  ) => (entity: Entity, properties?: Record<string, SchemaProps<unknown>>) => boolean;
  addComponentToEntity: <T>(component: Component<T>) => (entity: Entity, properties?: SchemaProps<T>) => boolean;
  getBuffer: () => ArrayBuffer;
  getEntityProperties: (entity: Entity) => Record<string, SchemaProps<unknown>>;
  hasComponent: <T>(component: Component<T>) => (entity: Entity) => boolean;
  removeComponentFromEntity: <T>(component: Component<T>) => (entity: Entity) => boolean;
  removeComponentsFromEntity: (...components: Component<unknown>[]) => (entity: Entity) => ComponentInstance<unknown>[];
  setBuffer: (source: ArrayBuffer) => ArrayBuffer;
  withComponents: (...components: Component<unknown>[]) => (...entities: Entity[]) => Entity[];
}

interface ComponentManagerSpec {
  capacity: number;
  components: Component<unknown>[];
  getEntityArchetype: (entity: Entity) => Archetype | undefined;
  isBitOn: (bit: number, bitfield: Bitfield) => boolean;
  isValidEntity: (entity: Entity) => entity is Entity;
  updateArchetype: (entity: Entity, component: ComponentInstance<unknown> | ComponentInstance<unknown>[]) => Archetype;
}

type R<C> = C extends Component<unknown> ? ComponentInstance<unknown> : ComponentInstance<unknown>[];

interface ComponentManagerFns {
  adder: (entity: Entity) => <T>(instance: ComponentInstance<T>) => ComponentInstance<T> | null;
  getInstances: <C extends Component<unknown> | Component<unknown>[]>(components: C) => R<C>;
  isMatch: ({ bitfield }: Archetype) => ({ id }: ComponentInstance<unknown>) => boolean;
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
}): ComponentMap {
  const { components, partitioner } = spec;
  const reducer = <T>(res: ComponentMap, component: Component<T>, id: number) => {
    const storage = partitioner(component);
    const instance = createComponentInstance({ component, id, storage });
    res.set(component, instance);
    return res;
  };
  return [...new Set(components)].reduce(reducer, new Map() as ComponentMap);
}

/** @private */
function createStorage(capacity: number, components: Component<unknown>[]): [ArrayBuffer, ComponentBufferPartitioner] {
  const buffer = createComponentBuffer({ capacity, components });
  const partitioner = createComponentBufferPartitioner({ buffer, capacity });
  return [buffer, partitioner];
}

/** @private */
function bufferFns(buffer: ArrayBuffer): [() => ArrayBuffer, (source: ArrayBuffer) => ArrayBuffer] {
  /** @returns a copy of the component storage buffer */
  const getBuffer = (): ArrayBuffer => buffer.slice(0);

  /** */
  const setBuffer = (source: ArrayBuffer): ArrayBuffer => {
    if (source.byteLength !== buffer.byteLength) {
      throw new Error("setBuffer - byteLength mismatch!");
    }
    const view = new Uint8Array(source);
    const target = new Uint8Array(buffer);
    target.set(view);
    return buffer.slice(0);
  };

  return [getBuffer, setBuffer];
}

/** @private */
const _setDefaults = <T>(entity: Entity, instance: ComponentInstance<T>) => {
  const { schema } = instance;
  if (schema) {
    Object.entries(schema).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
        instance[key][entity] = value[1] ?? 0;
      }
    });
  }
};

/** @private */
const _setCustom = <T>(entity: Entity, instance: ComponentInstance<T>, properties: SchemaProps<T>) => {
  Object.entries(properties).forEach(([key, value]) => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    instance[key][entity] = value ?? 0;
  });
};

/** @private */
const _setter = <T>(entity: Entity, instance: ComponentInstance<T>, properties?: SchemaProps<T>) => {
  // @note modifies the instance
  // @todo merge default and custom property objects and set once
  _setDefaults(entity, instance);
  if (properties) _setCustom(entity, instance, properties);
};

/** @private */
function _adder(spec: ComponentManagerSpec) {
  const { isValidEntity, getEntityArchetype, isBitOn } = spec;
  return (entity: Entity) => {
    if (!isValidEntity(entity)) throw new SyntaxError(`Entity ${entity as number} is not valid!`);
    return <T>(instance: ComponentInstance<T>) => {
      const archetype = getEntityArchetype(entity);
      if (!archetype) throw new SyntaxError(`Archetype for Entity ${entity} not found.`);
      const { count, id, maxEntities } = instance;
      if (isBitOn(id, archetype.bitfield)) return instance;
      if (maxEntities && count >= maxEntities) return null;
      instance[$_COUNT] = count + 1;
      return instance;
    };
  };
}

/** @private */
function _addMultiple(
  adder: (entity: Entity) => <T>(instance: ComponentInstance<T>) => ComponentInstance<T> | null,
  updateArchetype: (entity: Entity, component: ComponentInstance<unknown> | ComponentInstance<unknown>[]) => Archetype,
  instances: ComponentInstance<unknown>[],
) {
  return (entity: Entity, properties: Record<string, SchemaProps<unknown>> = {}): boolean => {
    const add = adder(entity);
    const added = instances.map(add).filter((x) => x) as ComponentInstance<unknown>[];
    added.forEach((instance) => _setter(entity, instance, properties[instance.name]));
    updateArchetype(entity, added);
    return added.length === instances.length;
  };
}

/** @private */
function _addComponentsToEntity(spec: ComponentManagerSpec, fns: ComponentManagerFns) {
  const { updateArchetype } = spec;
  const { adder, getInstances } = fns;
  return (...components: Component<unknown>[]) => {
    const instances = getInstances(components) as ComponentInstance<unknown>[];
    if (instances.length !== components.length) {
      throw new SyntaxError("Not all components are registered in the world!");
    }
    return _addMultiple(adder, updateArchetype, instances);
  };
}

/** @private */
function _addSingle<T>(
  adder: (entity: Entity) => <T>(instance: ComponentInstance<T>) => ComponentInstance<T> | null,
  updateArchetype: (entity: Entity, component: ComponentInstance<unknown> | ComponentInstance<unknown>[]) => Archetype,
  instance: ComponentInstance<T>,
) {
  return (entity: Entity, properties?: SchemaProps<T>): boolean => {
    if (adder(entity)(instance)) return false;
    _setter(entity, instance, properties);
    updateArchetype(entity, instance);
    return true;
  };
}

/** @private */
function _addComponentToEntity(spec: ComponentManagerSpec, fns: ComponentManagerFns) {
  const { updateArchetype } = spec;
  const { adder, getInstances } = fns;
  return <T>(component: Component<T>) => {
    const instance = getInstances(component);
    if (!instance) throw new SyntaxError(`Component ${component.name} is not registered in the world.`);
    return _addSingle(adder, updateArchetype, instance);
  };
}

/** @private */
function _getEntityProperties({ getEntityArchetype }: ComponentManagerSpec) {
  return (entity: Entity): Record<string, SchemaProps<unknown>> => {
    const archetype = getEntityArchetype(entity);
    if (!archetype) return {};
    const { components } = archetype;
    return [...components].reduce(<T>(res: Record<string, SchemaProps<unknown>>, component: ComponentInstance<T>) => {
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
    }, {});
  };
}

/** @private */
function _hasComponent(spec: ComponentManagerSpec, fns: ComponentManagerFns) {
  const { getEntityArchetype, isBitOn } = spec;
  const { getInstances } = fns;
  return <T>(component: Component<T>): ((entity: Entity) => boolean) => {
    const instance = getInstances(component);
    if (!instance) throw new SyntaxError(`Component ${component.name} is not registered!`);
    return (entity: Entity): boolean => {
      const archetype = getEntityArchetype(entity);
      if (!archetype) return false;
      return isBitOn(instance.id, archetype.bitfield);
    };
  };
}

/** @private */
function _deleteStorageValues<T>(instance: ComponentInstance<T>, entity: Entity) {
  const { maxEntities, schema } = instance;
  // make sure facade storage is freed for those that need it
  if (maxEntities && schema) {
    Object.keys(schema).forEach((key) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      delete instance[key][entity];
    });
  }
}

/** @private */
function _removeComponentFromEntity(spec: ComponentManagerSpec, fns: ComponentManagerFns) {
  const { getEntityArchetype, isBitOn, updateArchetype } = spec;
  const { getInstances } = fns;
  return (component: Component<unknown>) => {
    const instance = getInstances(component);
    if (!instance) throw new SyntaxError(`Component ${component.name} is not registered!`);
    return (entity: Entity): boolean => {
      const archetype = getEntityArchetype(entity);
      if (archetype && !isBitOn(instance.id, archetype.bitfield)) return true;
      instance[$_COUNT] = instance[$_COUNT] - 1;
      _deleteStorageValues(instance, entity);
      updateArchetype(entity, instance);
      return true;
    };
  };
}

/** @private */
function _removeMultiple(spec: ComponentManagerSpec) {
  const { getEntityArchetype, isBitOn, updateArchetype } = spec;
  return (instances: ComponentInstance<unknown>[]) => {
    return (entity: Entity): ComponentInstance<unknown>[] => {
      const archetype = getEntityArchetype(entity);
      const _getStatus = <T>(instance: ComponentInstance<T>): ComponentInstance<T> | undefined => {
        if (archetype && !isBitOn(instance.id, archetype.bitfield)) return;
        instance[$_COUNT] = instance[$_COUNT] - 1;
        _deleteStorageValues(instance, entity);
        return instance;
      };
      const removed = instances.map(_getStatus).filter((x) => x) as ComponentInstance<unknown>[];
      updateArchetype(entity, removed);
      return removed;
    };
  };
}

/** @private */
function _removeComponentsFromEntity(spec: ComponentManagerSpec, fns: ComponentManagerFns) {
  const { getInstances } = fns;
  const removeMultiple = _removeMultiple(spec);
  return (...components: Component<unknown>[]) => {
    const instances = getInstances(components);
    if (instances.length !== components.length) throw new SyntaxError("Not all components were found!");
    return removeMultiple(instances);
  };
}

/** @private */
function _withComponents(spec: ComponentManagerSpec, fns: ComponentManagerFns) {
  const { getEntityArchetype } = spec;
  const { getInstances, isMatch } = fns;
  return (...components: Component<unknown>[]) => {
    const instances = getInstances(components);
    const _reducer = (res: Entity[], entity: Entity) => {
      const archetype = getEntityArchetype(entity);
      if (!archetype) return res;
      const _match = isMatch(archetype);
      if (instances.every(_match)) res.push(entity);
      return res;
    };
    return (...entities: Entity[]) => entities.reduce(_reducer, []);
  };
}

/** @private */
function _getInstances(componentMap: ComponentMap) {
  const _getter = (component: Component<unknown>) => componentMap.get(component);
  return <C extends Component<unknown> | Component<unknown>[]>(components: C): R<C> => {
    if (Array.isArray(components)) {
      return components.map(_getter).filter((x) => x) as R<C>;
    }
    return _getter(components) as R<C>;
  };
}

function _isMatch(isBitOn: (bit: number, bitfield: Bitfield) => boolean) {
  return ({ bitfield }: Archetype) => {
    return ({ id }: ComponentInstance<unknown>) => {
      return isBitOn(id, bitfield);
    };
  };
}

/**
 *
 * @param spec
 * @returns
 */
export function createComponentManager(spec: ComponentManagerSpec): ComponentManager {
  const { capacity, components, isBitOn } = spec;

  const [buffer, partitioner] = createStorage(capacity, components);

  const [getBuffer, setBuffer] = bufferFns(buffer);

  const componentMap = instantiateComponents({ components, partitioner });

  const fns = {
    adder: _adder(spec),
    getInstances: _getInstances(componentMap),
    isMatch: _isMatch(isBitOn),
  };

  return {
    // properties
    componentMap,
    // methods
    addComponentToEntity: _addComponentToEntity(spec, fns),
    addComponentsToEntity: _addComponentsToEntity(spec, fns),
    getEntityProperties: _getEntityProperties(spec),
    hasComponent: _hasComponent(spec, fns),
    getBuffer,
    removeComponentFromEntity: _removeComponentFromEntity(spec, fns),
    removeComponentsFromEntity: _removeComponentsFromEntity(spec, fns),
    setBuffer,
    withComponents: _withComponents(spec, fns),
  };
}
