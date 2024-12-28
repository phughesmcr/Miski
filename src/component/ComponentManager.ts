import { BooleanArray } from "@phughesmcr/booleanarray";
import { type Partition, PartitionedBuffer, type Schema } from "@phughesmcr/partitionedbuffer";
import { Component } from "./Component.ts";

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
