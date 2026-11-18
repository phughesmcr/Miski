import type { Component } from "@/component/component.ts";
import type { Entity } from "@/entity/entity.ts";
import {
  CapacityError,
  ComponentDataError,
  componentDisplayName,
  formatComponentNotRegistered,
  NotRegisteredError,
  SpecError,
  WorldStateError,
} from "@/errors.ts";
import type { ComponentBundle, ComponentBundleEntryInput } from "@/types/component-bundle.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { SchemaOrNull, SchemaValues } from "@/types/partitions.ts";
import type { PendingEntity } from "@/types/scheduler.ts";
import { hasOwnProperty } from "@/utils.ts";
import { World } from "@/world/world.ts";

const OP_SPAWN = 1;
const OP_ENTRY = 2;
const OP_DESTROY = 3;
const OP_ADD = 4;
const OP_SET = 5;
const OP_REMOVE = 6;
const OP_NAMES: readonly string[] = ["", "spawn", "spawn", "destroy", "add", "set", "remove"];

/** Components with more fields than this cannot key their payload shape by a 32-bit field mask. */
const MAX_MASK_FIELDS = 31;
/** Mask value for payloads of components too wide for a field mask. */
const WIDE_MASK = -1;

/** Pending handles pack a spawn index (low 16 bits, below the 65,536 world capacity limit) and a flush epoch. */
const PENDING_INDEX_BITS = 16;
const PENDING_INDEX_MASK = (1 << PENDING_INDEX_BITS) - 1;
const PENDING_EPOCH_MASK = 0x7fff;
/** Spreads the starting epochs of buffers so a handle from another buffer is unlikely to validate. */
const EPOCH_SEED_STRIDE = 1021;

const INITIAL_COMMANDS = 64;
const INITIAL_PAYLOAD = 128;

let nextEpochSeed = 0;

/** Per-component data cached by a buffer on first use. */
type ComponentInfo = {
  readonly component: DynamicComponent;
  readonly name: string;
  /** Storage field names in schema order. */
  readonly keys: readonly string[];
  /** Field name to index in `keys`. */
  readonly keyIndex: Readonly<Record<string, number>>;
  readonly isTag: boolean;
  /** Reusable data objects holding exactly the provided fields, keyed by field mask. */
  readonly byMask: Map<number, Record<string, number>>;
  /** Reusable all-fields data object for components too wide for a field mask. */
  readonly row: Record<string, number>;
};

function growUint8(array: Uint8Array, size: number): Uint8Array {
  const next = new Uint8Array(size);
  next.set(array);
  return next;
}

function growUint16(array: Uint16Array, size: number): Uint16Array {
  const next = new Uint16Array(size);
  next.set(array);
  return next;
}

function growInt32(array: Int32Array, size: number): Int32Array {
  const next = new Int32Array(size);
  next.set(array);
  return next;
}

function growUint32(array: Uint32Array, size: number): Uint32Array {
  const next = new Uint32Array(size);
  next.set(array);
  return next;
}

function growFloat64(array: Float64Array, size: number): Float64Array {
  const next = new Float64Array(size);
  next.set(array);
  return next;
}

/**
 * A queue of structural changes (spawn, destroy, add, set, remove) applied to a world later, at `flush()`.
 *
 * Use it to change entities while iterating a borrowed query view, which direct mutation would invalidate. A
 * {@link Schedule} owns one and flushes it at the end of each phase.
 *
 * Queuing validates components and copies data immediately, so a mistake throws at the call site and data objects
 * may be reused straight away. Steady-state queuing and flushing does not allocate.
 *
 * At flush, commands apply in queue order exactly as the direct world calls would, except that a command whose
 * target entity is no longer active is skipped. If a command throws, the commands already applied stay applied, the
 * rest are dropped, and the error (prefixed with the failing command) is rethrown.
 */
export class CommandBuffer {
  readonly #world: World;

  #ops: Uint8Array = new Uint8Array(INITIAL_COMMANDS);
  /** Buffer-local component index of each command. */
  #components: Uint16Array = new Uint16Array(INITIAL_COMMANDS);
  /** Target entity, or a negative pending handle. */
  #targets: Int32Array = new Int32Array(INITIAL_COMMANDS);
  #payloadStarts: Uint32Array = new Uint32Array(INITIAL_COMMANDS);
  /** Payload field count; for a spawn record, its bundle entry count. */
  #payloadCounts: Uint32Array = new Uint32Array(INITIAL_COMMANDS);
  #masks: Int32Array = new Int32Array(INITIAL_COMMANDS);
  /** Records in use, including bundle entry records. */
  #recordCount = 0;
  /** Commands queued, excluding bundle entry records. */
  #commandCount = 0;

  #payloadFields: Uint16Array = new Uint16Array(INITIAL_PAYLOAD);
  #payloadValues: Float64Array = new Float64Array(INITIAL_PAYLOAD);
  #payloadCount = 0;

  /** Entities created by this flush's spawns, by spawn index. */
  #spawned: Int32Array = new Int32Array(0);
  #spawnCount = 0;
  #epoch: number;

  #infos: ComponentInfo[] = [];
  #infoIndex: Map<DynamicComponent, number> = new Map();
  /** Per-component stamp used to reject duplicate bundle entries without allocating. */
  #bundleSeen: Uint32Array = new Uint32Array(0);
  #bundleStamp = 0;

  /** Reusable bundle arrays by length, and reusable entry tuples by position. */
  #bundles: unknown[][] = [];
  #tagTuples: [DynamicComponent][] = [];
  #dataTuples: [DynamicComponent, Record<string, number>][] = [];

  #flushing = false;

  /**
   * Create a command buffer for a world.
   * @param world The world the commands apply to
   * @throws {SpecError} If `world` is not a World
   */
  constructor(world: World) {
    if (!(world instanceof World)) throw new SpecError("CommandBuffer requires a World");
    this.#world = world;
    this.#epoch = (nextEpochSeed++ * EPOCH_SEED_STRIDE) & PENDING_EPOCH_MASK;
  }

  /** The number of queued commands. */
  get size(): number {
    return this.#commandCount;
  }

  /**
   * Queue the creation of an entity, optionally with a component bundle applied atomically (as `createWith`).
   * @param bundle Unique `[component]` or `[component, data]` tuples
   * @returns A placeholder handle usable as the target of later commands on this buffer until it flushes
   * @throws {CapacityError} If more entities are queued than the world can ever hold
   * @throws {NotRegisteredError} If a component is not registered in the world
   * @throws {RangeError} If a component appears twice in the bundle
   * @throws {ComponentDataError} If data names an unknown field or a value is not a finite number
   */
  spawn<const TBundle extends readonly ComponentBundleEntryInput[]>(
    bundle?: TBundle & ComponentBundle<TBundle>,
  ): PendingEntity {
    this.#assertNotFlushing();
    if (this.#spawnCount >= this.#world.entities.capacity) {
      throw new CapacityError(`World is at capacity (${this.#world.entities.capacity} entities).`);
    }
    const entries = bundle as readonly ComponentBundleEntryInput[] | undefined;
    if (entries !== undefined && !Array.isArray(entries)) {
      throw new TypeError("Bundle must be an array of [component] or [component, data] tuples.");
    }
    const entryCount = entries === undefined ? 0 : entries.length;
    this.#reserveRecords(1 + entryCount);

    // Stage every entry before committing anything, so a rejected bundle queues nothing.
    const stamp = this.#nextBundleStamp();
    let payload = this.#payloadCount;
    for (let i = 0; i < entryCount; i++) {
      const entry = entries![i];
      if (!Array.isArray(entry) || (entry.length !== 1 && entry.length !== 2)) {
        throw new TypeError("Bundle entries must be [component] or [component, data] tuples.");
      }
      const index = this.#infoFor(entry[0] as DynamicComponent);
      if (this.#bundleSeen[index] === stamp) {
        throw new RangeError(`Duplicate component "${this.#infos[index]!.name}" in bundle.`);
      }
      this.#bundleSeen[index] = stamp;
      const record = this.#recordCount + 1 + i;
      this.#ops[record] = OP_ENTRY;
      this.#components[record] = index;
      this.#targets[record] = 0;
      payload = this.#stagePayload(record, this.#infos[index]!, entry.length === 2 ? entry[1] : undefined, payload);
    }

    const handle = this.#encodePending(this.#spawnCount);
    const record = this.#recordCount;
    this.#ops[record] = OP_SPAWN;
    this.#components[record] = 0;
    this.#targets[record] = handle;
    this.#payloadStarts[record] = 0;
    this.#payloadCounts[record] = entryCount;
    this.#masks[record] = 0;
    this.#recordCount += 1 + entryCount;
    this.#payloadCount = payload;
    this.#commandCount++;
    this.#spawnCount++;
    return handle as PendingEntity;
  }

  /**
   * Queue the destruction of an entity.
   * @param entity The entity, or a pending entity from {@link spawn}
   * @throws {SpecError} If `entity` is not a valid handle for this world or buffer
   */
  destroy(entity: Entity | PendingEntity): void {
    this.#assertNotFlushing();
    const target = this.#validateTarget(entity);
    this.#reserveRecords(1);
    this.#commitSimple(OP_DESTROY, 0, target);
  }

  /**
   * Queue adding a component to an entity, or updating its data if already owned (upsert, as `addToEntity`).
   * @param component The component to add
   * @param entity The entity, or a pending entity from {@link spawn}
   * @param data Field values; omitted fields keep their values, or start at zero on new ownership
   * @throws {NotRegisteredError} If the component is not registered in the world
   * @throws {ComponentDataError} If data names an unknown field or a value is not a finite number
   * @throws {SpecError} If `entity` is not a valid handle for this world or buffer
   */
  add(component: Component<null, null>, entity: Entity | PendingEntity): void;
  /**
   * Queue adding a data component to an entity, or updating its data if already owned (upsert).
   * @param component The component to add
   * @param entity The entity, or a pending entity from {@link spawn}
   * @param data Field values; omitted fields keep their values, or start at zero on new ownership
   */
  add<TValue extends Exclude<SchemaOrNull, null>, TStorage extends Exclude<SchemaOrNull, null> = TValue>(
    component: Component<TValue, TStorage>,
    entity: Entity | PendingEntity,
    data?: Partial<SchemaValues<TValue>>,
  ): void;
  add(component: DynamicComponent, entity: Entity | PendingEntity, data?: unknown): void {
    this.#queueData(OP_ADD, component, entity, data);
  }

  /**
   * Queue setting component data on an entity that owns the component (as `setEntityData`).
   * @param component The data component to set
   * @param entity The entity, or a pending entity from {@link spawn}
   * @param data Field values; omitted fields keep their values
   * @throws {NotRegisteredError} If the component is not registered in the world
   * @throws {ComponentDataError} If the component is a tag, data names an unknown field, or a value is not finite
   * @throws {SpecError} If `entity` is not a valid handle for this world or buffer
   */
  set<TValue extends Exclude<SchemaOrNull, null>, TStorage extends Exclude<SchemaOrNull, null> = TValue>(
    component: Component<TValue, TStorage>,
    entity: Entity | PendingEntity,
    data: Partial<SchemaValues<TValue>>,
  ): void {
    this.#queueData(OP_SET, component as unknown as DynamicComponent, entity, data);
  }

  /**
   * Queue removing a component from an entity (as `removeFromEntity`; non-owners are skipped).
   * @param component The component to remove
   * @param entity The entity, or a pending entity from {@link spawn}
   * @throws {NotRegisteredError} If the component is not registered in the world
   * @throws {SpecError} If `entity` is not a valid handle for this world or buffer
   */
  remove<TValue extends SchemaOrNull, TStorage extends SchemaOrNull = TValue>(
    component: Component<TValue, TStorage>,
    entity: Entity | PendingEntity,
  ): void {
    this.#assertNotFlushing();
    const index = this.#infoFor(component as unknown as DynamicComponent);
    const target = this.#validateTarget(entity);
    this.#reserveRecords(1);
    this.#commitSimple(OP_REMOVE, index, target);
  }

  /**
   * Apply every queued command in order, then empty the buffer. Pending handles from before the flush become invalid.
   * @throws {WorldStateError} If called while this buffer is flushing
   * @throws The first error a command raises; earlier commands stay applied and later ones are dropped
   */
  flush(): void {
    this.#assertNotFlushing();
    if (this.#recordCount === 0) return;
    this.#flushing = true;
    let record = 0;
    try {
      const count = this.#recordCount;
      while (record < count) record = this.#apply(record);
    } catch (error) {
      this.#annotate(error, record);
      throw error;
    } finally {
      this.#flushing = false;
      this.#reset();
    }
  }

  /** Discard every queued command. Pending handles from before the clear become invalid. */
  clear(): void {
    this.#assertNotFlushing();
    this.#reset();
  }

  #assertNotFlushing(): void {
    if (this.#flushing) throw new WorldStateError("CommandBuffer is flushing");
  }

  #reset(): void {
    this.#recordCount = 0;
    this.#commandCount = 0;
    this.#payloadCount = 0;
    this.#spawnCount = 0;
    this.#epoch = (this.#epoch + 1) & PENDING_EPOCH_MASK;
  }

  #queueData(op: number, component: DynamicComponent, entity: Entity | PendingEntity, data: unknown): void {
    this.#assertNotFlushing();
    const index = this.#infoFor(component);
    const info = this.#infos[index]!;
    if (op === OP_SET && info.isTag) {
      throw new ComponentDataError(`Component "${info.name}" has no data storage to set.`);
    }
    const target = this.#validateTarget(entity);
    this.#reserveRecords(1);
    const record = this.#recordCount;
    this.#ops[record] = op;
    this.#components[record] = index;
    this.#targets[record] = target;
    this.#payloadCount = this.#stagePayload(record, info, data, this.#payloadCount);
    this.#recordCount++;
    this.#commandCount++;
  }

  #commitSimple(op: number, componentIndex: number, target: number): void {
    const record = this.#recordCount;
    this.#ops[record] = op;
    this.#components[record] = componentIndex;
    this.#targets[record] = target;
    this.#payloadStarts[record] = 0;
    this.#payloadCounts[record] = 0;
    this.#masks[record] = 0;
    this.#recordCount++;
    this.#commandCount++;
  }

  /**
   * Validate `data` and copy its fields into the payload columns from `start`, describing them on `record`.
   * @returns the payload position after the copied fields; the caller commits it
   */
  #stagePayload(record: number, info: ComponentInfo, data: unknown, start: number): number {
    let position = start;
    let mask = 0;
    if (data !== undefined) {
      if (data === null || typeof data !== "object") {
        throw new TypeError(`Component data for "${info.name}" must be an object.`);
      }
      const values = data as Record<string, unknown>;
      for (const key in values) {
        if (!hasOwnProperty(values, key)) continue;
        const field = info.keyIndex[key];
        if (field === undefined) {
          throw new ComponentDataError(`Component ${info.name} does not define data field "${key}".`);
        }
        const value = values[key];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new ComponentDataError(`Component ${info.name} data field "${key}" must be a finite number.`);
        }
        if (position >= this.#payloadFields.length) this.#growPayload(position + 1);
        this.#payloadFields[position] = field;
        this.#payloadValues[position] = value;
        position++;
        mask |= 1 << field;
      }
    }
    this.#payloadStarts[record] = start;
    this.#payloadCounts[record] = position - start;
    this.#masks[record] = info.keys.length > MAX_MASK_FIELDS ? WIDE_MASK : mask;
    return position;
  }

  /** Resolve (and on first use, validate and cache) a component's buffer-local index. */
  #infoFor(component: DynamicComponent): number {
    const cached = this.#infoIndex.get(component);
    if (cached !== undefined) return cached;
    if (!this.#world.components.isRegistered(component)) {
      throw new NotRegisteredError(formatComponentNotRegistered(componentDisplayName(component)));
    }
    const keys = component.schema === null ? [] : Object.keys(component.schema);
    const keyIndex: Record<string, number> = Object.create(null);
    const row: Record<string, number> = {};
    for (let i = 0; i < keys.length; i++) {
      keyIndex[keys[i]!] = i;
      row[keys[i]!] = 0;
    }
    const index = this.#infos.length;
    this.#infos.push({
      component,
      name: component.name,
      keys,
      keyIndex,
      isTag: keys.length === 0,
      byMask: new Map(),
      row,
    });
    this.#infoIndex.set(component, index);
    if (this.#bundleSeen.length <= index) this.#bundleSeen = growUint32(this.#bundleSeen, (index + 1) * 2);
    return index;
  }

  #nextBundleStamp(): number {
    this.#bundleStamp = (this.#bundleStamp + 1) >>> 0;
    if (this.#bundleStamp === 0) {
      this.#bundleSeen.fill(0);
      this.#bundleStamp = 1;
    }
    return this.#bundleStamp;
  }

  #encodePending(index: number): number {
    return -(1 + index + this.#epoch * (PENDING_INDEX_MASK + 1));
  }

  /** Validate a target handle; real entities pass through, pending handles must belong to this buffer and epoch. */
  #validateTarget(entity: Entity | PendingEntity): number {
    const value = entity as number;
    if (!Number.isInteger(value)) throw new SpecError(`Invalid entity handle ${String(entity)}`);
    if (value >= 0) {
      if (!this.#world.entities.isEntity(value as Entity)) {
        throw new SpecError(`Invalid entity handle ${value} for this world`);
      }
      return value;
    }
    const packed = -value - 1;
    const index = packed & PENDING_INDEX_MASK;
    const epoch = Math.floor(packed / (PENDING_INDEX_MASK + 1));
    if (epoch !== this.#epoch || index >= this.#spawnCount) {
      throw new SpecError(
        `Invalid pending entity ${value}: it was not spawned by this CommandBuffer since its last flush or clear`,
      );
    }
    return value;
  }

  #reserveRecords(extra: number): void {
    const needed = this.#recordCount + extra;
    if (needed <= this.#ops.length) return;
    const size = Math.max(needed, this.#ops.length * 2);
    this.#ops = growUint8(this.#ops, size);
    this.#components = growUint16(this.#components, size);
    this.#targets = growInt32(this.#targets, size);
    this.#payloadStarts = growUint32(this.#payloadStarts, size);
    this.#payloadCounts = growUint32(this.#payloadCounts, size);
    this.#masks = growInt32(this.#masks, size);
  }

  #growPayload(needed: number): void {
    const size = Math.max(needed, this.#payloadFields.length * 2);
    this.#payloadFields = growUint16(this.#payloadFields, size);
    this.#payloadValues = growFloat64(this.#payloadValues, size);
  }

  /** The entity a target refers to, or -1 for a pending entity whose spawn has not run. */
  #resolve(target: number): number {
    if (target >= 0) return target;
    const index = (-target - 1) & PENDING_INDEX_MASK;
    return index < this.#spawned.length ? this.#spawned[index]! : -1;
  }

  /** Apply the command at `record`. @returns the index of the next command record */
  #apply(record: number): number {
    const op = this.#ops[record]!;
    if (op === OP_SPAWN) return this.#applySpawn(record);
    const world = this.#world;
    const entity = this.#resolve(this.#targets[record]!) as Entity;
    if ((entity as number) < 0 || !world.entities.isActive(entity)) return record + 1;
    if (op === OP_DESTROY) {
      world.entities.destroy(entity);
      return record + 1;
    }
    const info = this.#infos[this.#components[record]!]!;
    const component = info.component;
    if (op === OP_REMOVE) {
      world.components.removeFromEntity(component, entity);
    } else if (op === OP_SET) {
      world.components.setEntityData(
        component as Component<Record<string, never>>,
        entity,
        this.#dataFor(record, info, entity, false),
      );
    } else if (this.#payloadCounts[record] === 0) {
      world.components.addToEntity(component as Component<null, null>, entity);
    } else {
      world.components.addToEntity(
        component as Component<Record<string, never>>,
        entity,
        this.#dataFor(record, info, entity, false),
      );
    }
    return record + 1;
  }

  #applySpawn(record: number): number {
    const entryCount = this.#payloadCounts[record]!;
    const bundle = this.#bundles[entryCount] ?? (this.#bundles[entryCount] = new Array(entryCount));
    for (let i = 0; i < entryCount; i++) {
      const entry = record + 1 + i;
      const info = this.#infos[this.#components[entry]!]!;
      if (this.#payloadCounts[entry] === 0) {
        const tuple = this.#tagTuples[i] ?? (this.#tagTuples[i] = [info.component]);
        tuple[0] = info.component;
        bundle[i] = tuple;
      } else {
        const data = this.#dataFor(entry, info, -1 as Entity, true);
        const tuple = this.#dataTuples[i] ?? (this.#dataTuples[i] = [info.component, data]);
        tuple[0] = info.component;
        tuple[1] = data;
        bundle[i] = tuple;
      }
    }
    const entity = this.#world.entities.createWith(bundle as unknown as readonly []);
    if (entity === undefined) {
      throw new CapacityError(`World is at capacity (${this.#world.entities.capacity} entities).`);
    }
    const index = (-this.#targets[record]! - 1) & PENDING_INDEX_MASK;
    if (index >= this.#spawned.length) this.#spawned = growInt32(this.#spawned, Math.max(16, (index + 1) * 2));
    this.#spawned[index] = entity;
    return record + 1 + entryCount;
  }

  /**
   * Build the data object for a payload record. Narrow components reuse an object holding exactly the provided
   * fields, so omitted fields stay omitted. Wide components fill omitted fields from the entity's current values
   * (or zero when it is new or not an owner).
   */
  #dataFor(record: number, info: ComponentInfo, entity: Entity, isNew: boolean): Record<string, number> {
    const mask = this.#masks[record]!;
    let data: Record<string, number>;
    if (mask === WIDE_MASK) {
      data = info.row;
      const owned = !isNew && this.#world.components.entityHas(info.component, entity);
      if (owned) {
        this.#world.components.readEntityDataInto(info.component, entity, data);
      } else {
        for (let i = 0; i < info.keys.length; i++) data[info.keys[i]!] = 0;
      }
    } else {
      data = info.byMask.get(mask) ?? this.#createMaskedData(info, mask);
    }
    const start = this.#payloadStarts[record]!;
    const end = start + this.#payloadCounts[record]!;
    for (let i = start; i < end; i++) {
      data[info.keys[this.#payloadFields[i]!]!] = this.#payloadValues[i]!;
    }
    return data;
  }

  #createMaskedData(info: ComponentInfo, mask: number): Record<string, number> {
    const data: Record<string, number> = {};
    for (let i = 0; i < info.keys.length; i++) {
      if ((mask & (1 << i)) !== 0) data[info.keys[i]!] = 0;
    }
    info.byMask.set(mask, data);
    return data;
  }

  /** Prefix a flush error with the command that raised it. */
  #annotate(error: unknown, record: number): void {
    if (!(error instanceof Error) || record >= this.#recordCount) return;
    const op = this.#ops[record]!;
    const target = this.#targets[record]!;
    const name = op === OP_SPAWN || op === OP_DESTROY ? "" : ` ${this.#infos[this.#components[record]!]!.name}`;
    const entity = target < 0 ? `pending entity ${target}` : `entity ${target}`;
    try {
      error.message = `CommandBuffer ${OP_NAMES[op]}${name} on ${entity} failed: ${error.message}`;
    } catch {
      // A non-writable message keeps its original text.
    }
  }
}
