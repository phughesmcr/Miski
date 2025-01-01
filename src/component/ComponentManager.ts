import type { BooleanArray } from "@phughesmcr/booleanarray";
import type { ComponentInstance } from "./ComponentInstance.ts";
import type { Component } from "./Component.ts";
import { PartitionedBuffer } from "@phughesmcr/partitionedbuffer";

export class ComponentManager {
  #buffer: PartitionedBuffer;
  #changed: Map<Component<any>, BooleanArray>;
  #owners: Map<Component<any>, BooleanArray>;
  #registry: Map<Component<any>, ComponentInstance<any>>;

  constructor(capacity: number) {
    this.#buffer = new PartitionedBuffer(capacity);
    this.#changed = new Map();
    this.#owners = new Map();
    this.#registry = new Map();
  }

  /**
   * @returns an iterable of all component instances
   */
  get all(): IterableIterator<ComponentInstance<any>> {
    return this.#registry.values();
  }

  get count(): number {
    return this.#registry.size;
  }

  addToEntity(entity: Entity, component: Component<any>): ComponentInstance<any> {
  }

  get(component: Component<any> | string): ComponentInstance<any> | undefined {
    if (typeof component === "string") {
      const instance = this.#registry.keys().find((key) => key.name === component);
      if (instance === undefined) {
        return undefined;
      }
      return this.#registry.get(instance);
    }
    return this.#registry.get(component);
  }

  isRegistered(component: Component<any> | string): boolean {
    return this.get(component) !== undefined;
  }

  /**
   * Run routine maintenance on the component manager
   * @returns The component manager
   */
  refresh(): ComponentManager {
    for (const changed of this.#changed.values()) {
      changed.fill(0);
    }
    return this;
  }

  stringify(): string {
    return JSON.stringify(
      {
        buffer: this.#buffer.toString(),
        // TODO: serialise changed, owners, registry
      },
    );
  }
}
