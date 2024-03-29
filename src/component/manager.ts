/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { $_OWNERS } from "../constants.js";
import { createComponentInstance, refreshComponentInstance } from "./instance.js";
import { ComponentBuffer } from "./buffer.js";
import type { Entity } from "../world.js";
import type { TypedArrayConstructor } from "../utils/utils.js";
import type { Component } from "./component.js";
import type { ComponentInstance } from "./instance.js";
import type { Schema, SchemaProps } from "./schema.js";

/** [component name]: component instance */
export type ComponentRecord = Record<string, ComponentInstance<any>>;

export type ComponentMap = Map<Component<any>, ComponentInstance<any>>;

export interface ComponentManagerSpec {
  capacity: number;
  components: Component<any>[];
}

function instantiate(buffer: ComponentBuffer, capacity: number, components: Component<any>[]) {
  return components.reduce(<T extends Schema<T>>(res: ComponentMap, component: Component<T>, id: number) => {
    const instance = createComponentInstance({ capacity, component, id, storage: buffer.map.get(component) });
    res.set(component, instance);
    return res;
  }, new Map() as ComponentMap);
}

/** @todo better async? */
function add<T extends Schema<T>>(
  instance: ComponentInstance<T>,
  entity: number,
  properties?: Record<string, SchemaProps<unknown>>,
) {
  const { maxEntities, name, schema } = instance;
  if (maxEntities && instance.count >= maxEntities) {
    throw new Error(`Component "${name}".maxEntities reached.`);
  }
  if (instance[$_OWNERS].isSet(entity)) return null;
  instance[$_OWNERS].toggle(entity);
  // set properties
  if (schema) {
    /** @todo Object.entries creates an array. */
    Object.entries(schema).forEach(([key, value]) => {
      instance[key as keyof T][entity] = properties
        ? (properties[name] as SchemaProps<T>)[key as keyof T] ?? (value as [TypedArrayConstructor, number])[1] ?? 0
        : (value as [TypedArrayConstructor, number])[1] ?? 0;
    });
  }
  return instance;
}

export const addEntity = <T extends Schema<T>>(
  instance: ComponentInstance<T>,
  entity: Entity,
  properties?: Record<string, SchemaProps<T>>,
) => add(instance, entity, properties);

/** @todo better async? */
function remove(instance: ComponentInstance<any>, entity: Entity) {
  const { maxEntities, schema } = instance;
  if (!instance[$_OWNERS].isSet(entity)) return null;
  instance[$_OWNERS].toggle(entity);
  if (schema) {
    /** @todo Object.entries creates an array. */
    Object.entries(schema).forEach(([key, prop]) => {
      const storage = instance[key];
      if (storage) {
        if (maxEntities) {
          delete storage[entity];
        } else {
          storage[entity] = Array.isArray(prop) ? prop[1] : 0;
        }
      }
    });
  }
  return instance;
}

export const removeEntity = <T extends Schema<T>>(instance: ComponentInstance<T>, entity: Entity) => {
  return remove(instance, entity);
};

export class ComponentManager {
  readonly buffer: ComponentBuffer;
  readonly componentMap: Map<Component<any>, ComponentInstance<any>>;

  constructor(spec: ComponentManagerSpec) {
    const { capacity, components } = spec;
    this.buffer = new ComponentBuffer({ capacity, components });
    this.componentMap = instantiate(this.buffer, capacity, components);
  }

  addComponentsToEntity(
    components: Component<any>[],
  ): (entity: Entity, properties?: Record<string, SchemaProps<unknown>>) => ComponentInstance<any>[] {
    const instances = this.getInstances(components).filter(Boolean) as ComponentInstance<any>[];
    if (instances.length !== components.length) throw new Error("Some components are not registered in this world!");
    return (entity: Entity, properties?: Record<string, SchemaProps<unknown>>) => {
      return instances
        .map((instance) => addEntity(instance, entity, properties))
        .filter(Boolean) as ComponentInstance<any>[];
    };
  }

  removeComponentsFromEntity(components: Component<any>[]) {
    const instances = this.getInstances(components).filter(Boolean) as ComponentInstance<any>[];
    if (instances.length !== components.length) throw new Error("Some components are not registered in this world!");
    return (entity: Entity) => {
      return instances.map((instance) => removeEntity(instance, entity)).filter(Boolean) as ComponentInstance<any>[];
    };
  }

  getBuffer(): ArrayBuffer {
    return this.buffer.slice(0);
  }

  getInstance<T extends Schema<T>>(component: Component<T>): ComponentInstance<T> | undefined {
    return this.componentMap.get(component);
  }

  getInstances(components: Component<any>[]): (ComponentInstance<any> | undefined)[] {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    return components.map(this.getInstance, this);
  }

  setBuffer(source: ArrayBuffer): ComponentManager {
    if (source.byteLength !== this.buffer.byteLength) {
      throw new Error("setBuffer: byteLength mismatch!");
    }
    const view = new Uint8Array(source);
    const target = new Uint8Array(this.buffer);
    target.set(view);
    return this;
  }

  refreshComponents(): ComponentManager {
    this.componentMap.forEach(refreshComponentInstance);
    return this;
  }

  export() {
    return {
      buffer: this.buffer.slice(0),
      components: [...this.componentMap.values()],
    };
  }
}
