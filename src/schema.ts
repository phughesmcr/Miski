/**
 * @summary
 *  A Schema is a collection of DataStores.
 *  A DataStore is a container for getting and setting the correct
 *  data types for component properties.
 *
 * @example - Creating a Vec2d component with int32 based X & Y properties
 *
 *  // Define out int32 storage (i.e. an Int32Array)
 *  const i32 = defineDataStore({
 *    arrayType: Int32Array, // "arrayType" can be omitted if storage doesn't used typed arrays
 *    guard: (property: unknown): property is number => (!isNaN(property)),
 *    initial: () => 0,
 *    name: "i32",
 *    // N.B. "prefill" property is ignored when arrayType is a typed array.
 *  });
 *
 *  // Define the shape of our component
 *  interface Vec2d {
 *    x: i32,
 *    y: i32
 *  }
 *
 *  // Create the component
 *  const Vec2d = createComponent<Vec2d>({
 *    name: "vec2d",
 *    schema: {
 *      x: i32,
 *      y: i32,
 *    }
 *  });
 *
 *  // ... later, get entity property through:
 *  const entityX = vec2d.x.getProp(entity);
 *  // or:
 *  const entityX = vec2d.x[entity];
 *
 *  // and set by:
 *  vec2d.x.setProp(entity, 100); // this will call i32.guard(100) for safer setting
 *  // or:
 *  vec2d.x[entity] = 100; // no type checking
 *
 */
"use strict";

import { Entity } from "./entity.js";
import { Constructable, isObject, isTypedArray, isValidName, TypedArray, TypedArrayConstructor } from "./utils.js";
import { World } from "./world.js";

/**
 * Schema type guard
 * @param schema the schema to validate
 * @returns true if schema is valid
 */
export function isValidSchema(schema: unknown): schema is Schema<unknown> {
  if (!schema) return false;
  const isObj = isObject(schema);
  // @todo validate keys
  return isObj;
}

/** Schemas define data storage for component properties */
export type Schema<T> = {
  [K in keyof T]: DataStore<T[K], unknown>;
};

/**
 * Data storage specification.
 *
 * T = array/storage type. E.g., `Array` or `Uint8Array`.
 *
 * D = acceptable input types. E.g., `string` or `number`.
 *
 * Note - D must always be `number` when T is a typed array.
 */
export interface DataSpec<T, D> {
  /**
   * Underlying array type to use for data storage.
   *
   * Defaults to regular array (i.e., `Array`).
   *
   * Mandatory if you want to use a typed array (e.g., `Int8Array`).
   */
  arrayType?: Constructable<Array<T>> | TypedArrayConstructor;
  /** A function that returns the default value for store properties. */
  initial: () => D;
  /** A mandatory type guard function for setting data in the DataStore */
  guard: (property: unknown) => property is D;
  /** The name of the DataStore */
  name: string;
  /**
   * Pre-fill data array with the value that `initial` returns?
   *
   * Defaults to `false`. Ignored if `arrayType` is a typed array.
   */
  prefill?: boolean;
}

type DataArray<D> = Array<D> | TypedArray;

interface DataArrayMethods<T, D> {
  /** Get an entity's data from a component's datastore */
  getProp: (entity: Entity) => D | undefined;
  /** Validate and set data for entity in component storage */
  setProp: (entity: Entity, value: D) => DataStoreInstance<T, D>;
  /** true if the DataStore's data array is a typed array */
  isTypedArray: boolean;
}

/** A data storage definition */
export type DataStore<T, D> = Required<DataSpec<T, D>> & DataArray<D> & DataArrayMethods<T, D>;

/** Data storage for properties in a ComponentInstance */
export type DataStoreInstance<T, D> = DataStore<T, D> & {
  /** The world associated with the component to which this storage belongs. */
  world: World;
};

/**
 * Delete all data from a DataStore
 * @param store the store to clear
 * @returns the cleared store
 */
export function clearDataStoreInstance<T, D>(store: DataStoreInstance<T, D>): DataStoreInstance<T, D> {
  const { initial, isTypedArray, prefill, world } = store;
  switch (isTypedArray) {
    case true:
      if (prefill === true) {
        store.fill(initial() as never);
      } else {
        store.fill(0 as never);
      }
      break;
    case false:
      (store as D[]).length = 0;
      (store as D[]).length = world.spec.maxEntities;
      if (prefill === true) {
        store.fill(initial() as never);
      }
      break;
  }
  return store;
}

/**
 * Clones a DataStore and its associated data
 * @param store the store to clone
 * @returns the cloned store
 */
export function cloneDataStoreInstance<T, D>(store: DataStoreInstance<T, D>): DataStoreInstance<T, D> {
  const clone = createDataStorage(store.world, Object.getPrototypeOf(store));
  store.forEach((val, i) => (clone[i] = val));
  return clone as DataStoreInstance<T, D>;
}

/**
 * Copy all data from one DataStore to another
 * @param src the source DataStore
 * @param dest the destination DataStore
 * @returns dest store as a copy of src store
 */
export async function copyDataStoreInstance<T, D>(
  src: DataStoreInstance<T, D>,
  dest: DataStoreInstance<T, D>
): Promise<DataStoreInstance<T, D>> {
  if (src.length !== dest.length) {
    throw new Error("Source and destination stores are different sizes.");
  }
  if (src.arrayType !== dest.arrayType) {
    throw new TypeError("Source and destination have different arrayType properties.");
  }

  const _copy = (val: D, idx: number) => (dest[idx] = val);

  switch (dest.isTypedArray) {
    case true:
      (dest as TypedArray).set(src as unknown as ArrayLike<number> & ArrayLike<bigint>);
      break;
    case false:
      (dest as D[]).length = 0;
      (dest as D[]).length = src.length;
      await Promise.all(src.map(_copy as never));
      break;
  }

  return dest;
}

/**
 * Returns the data for an entity to the store's initial value
 * @param store the store the reset the data in
 * @param entity the entity to reset
 * @returns the datastore
 */
export function resetDataInStore<T, D>(store: DataStoreInstance<T, D>, entity: Entity): DataStoreInstance<T, D> {
  const { initial, isTypedArray, prefill } = store;
  if (entity < 0 || entity > store.length) throw new SyntaxError("Entity is out of range.");
  try {
    delete store[entity];
  } catch (err) {
    if (isTypedArray) {
      store[entity] = 0 as unknown as D;
    } else {
      throw new Error(err);
    }
  }
  if (prefill === true) store[entity] = initial();
  return store;
}

/**
 * Get an entity's data from a component's datastore
 * @param store the store to get the data from
 * @param entity the entity to get data for
 * @returns the entity's data or undefined
 */
export function getDataFromStore<T, D>(store: DataStoreInstance<T, D>, entity: Entity): D | undefined {
  return store[entity] as D | undefined;
}

/**
 * Validate and set data for entity in component storage
 * @param store the store to set the data in
 * @param entity the entity to set the data for
 * @param value the value to set
 * @returns the DataStore
 */
export function setDataInStore<T, D>(
  store: DataStoreInstance<T, D>,
  entity: Entity,
  value: D
): DataStoreInstance<T, D> {
  if (entity < 0 || entity > store.length) throw new SyntaxError("Entity is out of range.");
  if (!store.guard(value)) throw new TypeError("Value is not correct type.");
  store[entity] = value;
  return store;
}

/**
 * Create a new data storage prototype object for use in component schemas
 * @param spec the DataStore's specification
 * @returns the DataStore prototype
 */
export function defineDataStore<T, D>(spec: DataSpec<T, D>): DataStore<T, D> {
  const { name, initial, guard, arrayType = Array, prefill = false } = spec;

  if (!name || !guard) {
    throw new SyntaxError("Invalid datastore spec - mandatory properties missing.");
  }

  if (!isValidName(name)) {
    throw new Error("Invalid name.");
  }

  const _init = initial();

  if (!guard(_init)) {
    throw new TypeError("Initial property is of invalid type. Make sure guard(initial()) returns true.");
  }

  const tmp = new arrayType();
  const isTyped = isTypedArray(tmp);

  if (isTyped && (typeof _init !== "number" || isNaN(_init))) {
    throw new TypeError(`Initial property for typed array type must be a number. Found ${typeof _init}.`);
  }

  const store: DataStore<T, D> = Object.create(Object.getPrototypeOf(tmp), {
    getProp: {
      value: function (this: DataStoreInstance<T, D>, entity: Entity): D | undefined {
        return this[entity as never] as D;
      },
      enumerable: true,
    },
    setProp: {
      value: function (this: DataStoreInstance<T, D>, entity: Entity, value: D): DataStoreInstance<T, D> {
        if (entity < 0 || entity > this.length) throw new SyntaxError("Entity is out of range.");
        if (!this.guard(value)) throw new TypeError("Property is not correct type.");
        this[entity] = value;
        return this;
      },
      enumerable: true,
    },
    arrayType: {
      value: arrayType,
      enumerable: true,
    },
    guard: {
      value: guard,
      enumerable: true,
    },
    initial: {
      value: initial,
      enumerable: true,
    },
    isTypedArray: {
      value: isTyped,
      enumerable: true,
    },
    name: {
      value: name,
      enumerable: true,
    },
    prefill: {
      value: prefill,
      enumerable: true,
    },
  }) as DataStore<T, D>;

  return store;
}

/**
 * Create a new DataStoreInstance from a DataStore
 * @param world the world the store's component belongs to
 * @param factory the DataStore object to create the instance from
 * @returns the created DataStoreInstance
 */
export function createDataStorage<T, D>(world: World, factory: DataStore<T, D>): DataStoreInstance<T, D> {
  const { arrayType, initial, prefill } = factory;
  const array = new arrayType(world.spec.maxEntities) as unknown as DataStoreInstance<T, D>;
  Object.setPrototypeOf(array, factory);
  if (prefill === true) array.fill(initial() as never);
  array.world = world;
  return array as unknown as DataStoreInstance<T, D>;
}
