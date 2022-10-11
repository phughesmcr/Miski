/* Copyright 2022 the Miski authors. All rights reserved. MIT license. */

import { $_COUNT } from "../constants";
import { Entity } from "../entity";
import { ComponentBuffer } from "./buffer";
import { Component } from "./component.js";
import { ComponentInstance, createComponentInstance, refreshComponentInstance } from "./instance";
import { Schema, SchemaProps } from "./schema";

/** [component name]: component instance */
export type ComponentRecord = Record<string, ComponentInstance<any>>;

export type ComponentMap = Map<Component<any>, ComponentInstance<any>>;

export interface ComponentManagerSpec {
  capacity: number;
  components: Component<any>[];
}

function instantiate(buffer: ComponentBuffer, components: Component<any>[]) {
  return [...new Set(components)].reduce(
    <T extends Schema<T>>(res: ComponentMap, component: Component<T>, id: number) => {
      const storage = buffer.partition(component);
      const instance = createComponentInstance({ component, id, storage });
      res.set(component, instance);
      return res;
    },
    new Map() as ComponentMap,
  );
}

export class ComponentManager {
  buffer: ComponentBuffer;
  componentMap: Map<Component<any>, ComponentInstance<any>>;

  constructor(spec: ComponentManagerSpec) {
    const { capacity, components } = spec;
    this.buffer = new ComponentBuffer({ capacity, components });
    this.componentMap = instantiate(this.buffer, components);
  }

  addComponentsToEntity(
    components: Component<any>[],
  ): (entity: Entity, properties?: Record<string, SchemaProps<unknown>>) => ComponentInstance<any>[] {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const instances = components.map(this.componentMap.get, this.componentMap) as ComponentInstance<any>[];
    if (instances.length !== components.length) throw new Error("Some components are not registered in this world!");
    return (entity: Entity, properties?: Record<string, SchemaProps<unknown>>) => {
      // if (!isValidEntity(entity)) throw new SyntaxError(`Entity ${entity as number} is not valid!`);
      return instances
        .map((component) => {
          const { count, maxEntities, schema } = component;
          if (maxEntities && count >= maxEntities) return null;
          component[$_COUNT] += 1;
          // set properties
          if (schema) {
            Object.entries(schema).forEach(([key, value]) => {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              component[key][entity] = properties[component.name][key] ?? value[1] ?? 0;
            });
          }
          return component;
        })
        .filter((x) => x) as ComponentInstance<any>[];
    };
  }

  removeComponentsFromEntity(components: Component<any>[]) {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const instances = components.map(this.componentMap.get, this.componentMap) as ComponentInstance<any>[];

    /** @todo this is convoluted and inefficient */
    const remove = (instance: ComponentInstance<any>, entity: Entity) => {
      const { maxEntities, schema } = instance;
      if (schema) {
        Object.entries(schema).forEach(([key, prop]) => {
          const storage = instance[key];
          if (!storage) return false;
          if (maxEntities) {
            delete storage[entity];
          } else {
            const initialValue = Array.isArray(prop) ? prop[1] : 0;
            storage[entity] = initialValue;
          }
          return true;
        });
      }
      return false;
    };

    return (entity: Entity) => {
      return instances
        .map((instance) => {
          instance[$_COUNT] = instance[$_COUNT] - 1;
          const removed = remove(instance, entity);
          if (removed) return instance;
          return null;
        })
        .filter((x) => x) as ComponentInstance<any>[];
    };
  }

  getBuffer(): ArrayBuffer {
    return this.buffer.slice(0);
  }

  getInstance<T extends Schema<T>>(component: Component<T>): ComponentInstance<T> | undefined {
    return this.componentMap.get(component);
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
      componentMap: [...this.componentMap.entries()],
    };
  }
}
