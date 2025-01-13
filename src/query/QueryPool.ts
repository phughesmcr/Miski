import { BooleanArray } from "@phughesmcr/booleanarray";
import type { ComponentInstance } from "../component/ComponentInstance.ts";
import type { SchemaOrNull } from "../types.ts";

/** Pool for reusing query result objects */
export class QueryResultPool {
  #entityArrays: BooleanArray[] = [];
  #componentMaps: Record<string, ComponentInstance<SchemaOrNull<any>>>[] = [];
  #size: number;

  constructor(size: number) {
    this.#size = size;
    this.#entityArrays = [];
    this.#componentMaps = [];
  }

  acquireEntityArray(): BooleanArray {
    return this.#entityArrays.pop() ?? new BooleanArray(this.#size);
  }

  releaseEntityArray(array: BooleanArray): void {
    array.clear();
    this.#entityArrays.push(array);
  }

  acquireComponentMap(): Record<string, ComponentInstance<SchemaOrNull<any>>> {
    return this.#componentMaps.pop() ?? {};
  }

  releaseComponentMap(map: Record<string, ComponentInstance<SchemaOrNull<any>>>): void {
    Object.keys(map).forEach((key) => delete map[key]);
    this.#componentMaps.push(map);
  }
}
