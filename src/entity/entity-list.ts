import type { Entity } from "@/entity/entity-id.ts";
import type { EntityArray } from "./entity-array.ts";

export class ReusableEntityIterator implements IterableIterator<Entity> {
  count: number;
  cursor: number;
  indices: EntityArray;
  result: IteratorResult<Entity>;

  constructor(indices: EntityArray) {
    this.indices = indices;
    this.count = 0;
    this.cursor = 0;
    this.result = { value: 0, done: false };
  }

  reset(count: number): this {
    this.count = count;
    this.cursor = 0;
    return this;
  }

  next(): IteratorResult<Entity> {
    if (this.cursor < this.count) {
      this.result.value = this.indices[this.cursor++]!;
      this.result.done = false;
      return this.result;
    }

    this.result.value = undefined as unknown as Entity;
    this.result.done = true;
    return this.result;
  }

  [Symbol.iterator](): IterableIterator<Entity> {
    return this;
  }
}
