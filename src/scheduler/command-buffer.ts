import {
  assertBundleArray,
  assertBundleEntry,
  duplicateComponentError,
  relationComponentError,
} from "@/component/bundle-entry.ts";
import { type Component, isSupportedColumnConstructor } from "@/component/component.ts";
import { type Entity, isEntityInRange } from "@/entity/entity.ts";
import {
  CapacityError,
  ComponentDataError,
  componentDisplayName,
  formatComponentNotRegistered,
  NotRegisteredError,
  SpecError,
  WorldStateError,
} from "@/errors.ts";
import type { ComponentBundleEntryInput } from "@/types/component-bundle.ts";
import type { DynamicComponent } from "@/types/component.ts";
import type { ComponentValue, SchemaOrNull } from "@/types/partitions.ts";
import type { PendingEntity } from "@/types/scheduler.ts";
import type { AnyRelation, RelationDataInput } from "@/types/world-relation-api.ts";
import { isRelation, type Relation } from "@/relation/relation.ts";
import { type EntityField, isEntityField } from "@/schema/field.ts";
import { growTypedArray, hasOwnProperty } from "@/utils.ts";
import { World } from "@/world/world.ts";

/** Realm-safe error test; `Error.isError` needs Chrome 134 / Node 24.3 / Deno 2.2 / Bun 1.1.39. */
const isError: (value: unknown) => value is Error = typeof Error.isError === "function" ?
  Error.isError :
  (value): value is Error => value instanceof Error;

const OP_SPAWN = 1;
const OP_ENTRY = 2;
const OP_DESTROY = 3;
const OP_ADD = 4;
const OP_SET = 5;
const OP_REMOVE = 6;
const OP_RELATE = 7;
const OP_UNRELATE = 8;
const OP_NAMES: readonly string[] = ["", "spawn", "spawn", "destroy", "add", "set", "remove", "relate", "unrelate"];

/** Components with more fields than this cannot key their payload shape by a 32-bit field mask. */
const MAX_MASK_FIELDS = 31;
/** What to use instead when a relation is passed to a component command. */
const RELATION_ADVICE = "queue its pairs with relate and unrelate";

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

/**
 * Component data accepted by a {@link CommandBuffer}: like the direct API's, except that `field.entity()` fields
 * may also hold a pending entity from the same buffer.
 */
export type CommandData<TValue> = TValue extends null ? never : {
  [K in keyof TValue]?: TValue[K] extends EntityField ? Entity | PendingEntity | null : ComponentValue<TValue>[K];
};

/** A `CommandBuffer.spawn` bundle tuple checked against one concrete component definition. */
export type CommandBundleEntryFor<TComponent extends DynamicComponent> = TComponent extends
  Component<infer TValue, infer TStorage> ? TStorage extends null ? readonly [TComponent] :
  readonly [TComponent] | readonly [TComponent, CommandData<TValue>] :
  never;

/** A `CommandBuffer.spawn` bundle whose entries are checked component-by-component. */
export type CommandBundle<TBundle extends readonly ComponentBundleEntryInput[]> = {
  readonly [I in keyof TBundle]: TBundle[I] extends readonly [infer TComponent extends DynamicComponent] ?
    CommandBundleEntryFor<TComponent> :
    TBundle[I] extends readonly [infer TComponent extends DynamicComponent, unknown] ?
      CommandBundleEntryFor<TComponent> :
    never;
};

/** Per-component (or per-relation) data cached by a buffer on first use. */
type ComponentInfo = {
  readonly component: DynamicComponent;
  readonly name: string;
  /** `true` for a relation: its keys are pair data fields and it is only valid in relate / unrelate. */
  readonly isRelation: boolean;
  /** Storage field names in schema order. */
  readonly keys: readonly string[];
  /** Field name to index in `keys`. */
  readonly keyIndex: Readonly<Record<string, number>>;
  /** Per field: 1 if its values go through the side column (not a typed-array field), else 0. */
  readonly side: Uint8Array;
  /** Names of the side-column fields. */
  readonly sideKeys: readonly string[];
  /** Per field: 1 for `field.entity()` fields, whose dead targets are written as `null` at flush. */
  readonly entityRef: Uint8Array;
  readonly isTag: boolean;
  /** Reusable data objects holding exactly the provided fields, keyed by field mask (unused for relations). */
  readonly byMask: Map<number, Record<string, unknown>>;
  /** Reusable all-fields data object for components too wide for a field mask, and for relation pair data. */
  readonly row: Record<string, unknown>;
  /** Every reusable data object above, so side values can be released after a flush. */
  readonly dataObjects: Record<string, unknown>[];
};

/**
 * A queue of structural changes (spawn, destroy, add, set, remove, relate, unrelate) applied to a world later, at
 * `flush()`.
 *
 * Use it to change entities while iterating a borrowed query view, which direct mutation would invalidate. A
 * {@link Schedule} owns one and flushes it at the end of each phase.
 *
 * Queuing validates components and copies data immediately, so a mistake throws at the call site and data objects
 * may be reused straight away. Numeric fields are copied by value and must be finite numbers. Any other schema field
 * (one whose schema entry is not a typed-array constructor) is held by reference in a side column, validated by the
 * world at flush, and released after the flush. Steady-state queuing and flushing does not allocate.
 *
 * Pending entities from {@link CommandBuffer.spawn} can be used wherever an entity is accepted: as a command target,
 * as either end of a relation pair, and as a `field.entity()` value (including in a later spawn's bundle, so a parent
 * and a child that points at it can be spawned in one buffer).
 *
 * At flush, commands apply in queue order exactly as the direct world calls would, except that a command whose
 * target entity (for a relation command, either entity) is no longer active is skipped, and a queued `field.entity()`
 * value whose target is no longer active (or whose spawn failed) is written as `null` (as a stale stored reference
 * reads) instead of throwing. A flush never stops partway: if a command throws, the remaining commands still apply,
 * and the first error (prefixed with the failing command) is rethrown once the queue is drained. Commands that target
 * the entity of a failed spawn are skipped.
 */
export class CommandBuffer {
  readonly #world: World;

  #ops: Uint8Array = new Uint8Array(INITIAL_COMMANDS);
  /** Buffer-local component index of each command. */
  #components: Uint16Array = new Uint16Array(INITIAL_COMMANDS);
  /** Target entity (for a relation command, the source), or a negative pending handle. */
  #targets: Int32Array = new Int32Array(INITIAL_COMMANDS);
  /** Relation commands: the pair target entity, or a negative pending handle. */
  #pairTargets: Int32Array = new Int32Array(INITIAL_COMMANDS);
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

  /** Values of side-column fields; a payload value is then an index into this array. */
  #sideValues: unknown[] = [];
  /** Side values committed by queued commands. */
  #sideCount = 0;
  /** Side values written by the command being queued (committed only if queuing succeeds). */
  #sideStaged = 0;
  /** One past the highest side slot written since the last release. */
  #sideHigh = 0;
  /** Set when a wide component's reusable row was filled with an entity's values, which may include references. */
  #rowsHoldValues = false;

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
  #dataTuples: [DynamicComponent, Record<string, unknown>][] = [];

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
  get pendingCount(): number {
    return this.#commandCount;
  }

  /**
   * Queue the creation of an entity, optionally with a component bundle applied atomically (as `entities.create`).
   * @param bundle Unique `[component]` or `[component, data]` tuples
   * @returns A placeholder handle usable as the target of later commands on this buffer until it flushes
   * @throws {CapacityError} If more entities are queued than the world can ever hold
   * @throws {NotRegisteredError} If a component is not registered in the world
   * @throws {TypeError} If a component is a relation
   * @throws {RangeError} If a component appears twice in the bundle
   * @throws {ComponentDataError} If data names an unknown field or a numeric field value is not a finite number
   * @throws {SpecError} If a `field.entity()` value is a pending entity this buffer did not spawn since its last flush
   */
  spawn<const TBundle extends readonly ComponentBundleEntryInput[]>(
    bundle?: TBundle & CommandBundle<TBundle>,
  ): PendingEntity {
    this.#assertNotFlushing();
    if (this.#spawnCount >= this.#world.entities.capacity) {
      throw new CapacityError(`World is at capacity (${this.#world.entities.capacity} entities).`);
    }
    const entries = bundle as readonly ComponentBundleEntryInput[] | undefined;
    if (entries !== undefined) assertBundleArray(entries, "Bundle");
    const entryCount = entries === undefined ? 0 : entries.length;
    this.#reserveRecords(1 + entryCount);

    // Stage every entry before committing anything, so a rejected bundle queues nothing.
    const stamp = this.#nextBundleStamp();
    this.#sideStaged = this.#sideCount;
    let payload = this.#payloadCount;
    try {
      for (let i = 0; i < entryCount; i++) {
        const entry: unknown = entries![i];
        assertBundleEntry(entry, "Bundle entries");
        const index = this.#infoFor(entry[0] as DynamicComponent);
        if (this.#bundleSeen[index] === stamp) {
          throw duplicateComponentError(this.#infos[index]!.name, "bundle");
        }
        this.#bundleSeen[index] = stamp;
        const record = this.#recordCount + 1 + i;
        this.#ops[record] = OP_ENTRY;
        this.#components[record] = index;
        this.#targets[record] = 0;
        payload = this.#stagePayload(record, this.#infos[index]!, entry.length === 2 ? entry[1] : undefined, payload);
      }
    } catch (error) {
      this.#dropStagedSide();
      throw error;
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
    this.#sideCount = this.#sideStaged;
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
   * @throws {TypeError} If the component is a relation
   * @throws {ComponentDataError} If data names an unknown field or a numeric field value is not a finite number
   * @throws {SpecError} If `entity`, or a pending `field.entity()` value, is not a valid handle for this world or buffer
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
    data?: CommandData<TValue>,
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
   * @throws {TypeError} If the component is a relation
   * @throws {ComponentDataError} If the component is a tag, data names an unknown field, or a numeric value is not finite
   * @throws {SpecError} If `entity`, or a pending `field.entity()` value, is not a valid handle for this world or buffer
   */
  set<TValue extends Exclude<SchemaOrNull, null>, TStorage extends Exclude<SchemaOrNull, null> = TValue>(
    component: Component<TValue, TStorage>,
    entity: Entity | PendingEntity,
    data: CommandData<TValue>,
  ): void {
    this.#queueData(OP_SET, component as unknown as DynamicComponent, entity, data);
  }

  /**
   * Queue removing a component from an entity (as `removeFromEntity`; non-owners are skipped).
   * @param component The component to remove
   * @param entity The entity, or a pending entity from {@link spawn}
   * @throws {NotRegisteredError} If the component is not registered in the world
   * @throws {TypeError} If the component is a relation
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
   * Queue relating `source` to `target` (as `world.relations.add`).
   * @param relation The relation
   * @param source The source entity, or a pending entity from {@link spawn}
   * @param target The target entity, or a pending entity from {@link spawn}
   * @param data Pair data; omitted fields keep their values, or start at zero on a new pair
   * @throws {NotRegisteredError} If the relation is not registered in the world
   * @throws {TypeError} If `relation` is not a relation, or `data` is not an object
   * @throws {ComponentDataError} If data names an unknown field or a value is not a finite number
   * @throws {SpecError} If `source` or `target` is not a valid handle for this world or buffer
   */
  relate<TSchema extends SchemaOrNull>(
    relation: Relation<TSchema>,
    source: Entity | PendingEntity,
    target: Entity | PendingEntity,
    data?: RelationDataInput<TSchema>,
  ): void {
    this.#queuePair(OP_RELATE, relation, source, target, data);
  }

  /**
   * Queue removing the pair `source -> target` (as `world.relations.remove`; a missing pair is skipped).
   * @param relation The relation
   * @param source The source entity, or a pending entity from {@link spawn}
   * @param target The target entity, or a pending entity from {@link spawn}
   * @throws {NotRegisteredError} If the relation is not registered in the world
   * @throws {TypeError} If `relation` is not a relation
   * @throws {SpecError} If `source` or `target` is not a valid handle for this world or buffer
   */
  unrelate(relation: AnyRelation, source: Entity | PendingEntity, target: Entity | PendingEntity): void {
    this.#queuePair(OP_UNRELATE, relation, source, target, undefined);
  }

  /**
   * Apply every queued command in order, then empty the buffer. Pending handles from before the flush become invalid.
   *
   * A failing command does not stop the flush: every other command still applies, then the first error is rethrown.
   * @throws {WorldStateError} If called while this buffer is flushing
   * @throws The first error a command raised, prefixed with that command
   */
  flush(): void {
    this.#assertNotFlushing();
    if (this.#recordCount === 0) return;
    this.#flushing = true;
    let failed = false;
    let failure: unknown;
    try {
      const count = this.#recordCount;
      let record = 0;
      while (record < count) {
        const next = this.#ops[record] === OP_SPAWN ? record + 1 + this.#payloadCounts[record]! : record + 1;
        try {
          this.#apply(record);
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
            this.#annotate(error, record);
          }
        }
        record = next;
      }
    } finally {
      this.#flushing = false;
      this.#reset();
    }
    if (failed) throw failure;
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
    if (this.#sideHigh > 0 || this.#rowsHoldValues) this.#releaseSideValues();
  }

  /** Drop references to queued side values so they can be collected; the arrays keep their size for reuse. */
  #releaseSideValues(): void {
    const values = this.#sideValues;
    for (let i = 0; i < this.#sideHigh; i++) values[i] = undefined;
    this.#sideHigh = 0;
    this.#rowsHoldValues = false;
    this.#sideCount = 0;
    this.#sideStaged = 0;
    const infos = this.#infos;
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i]!;
      const keys = info.sideKeys;
      if (keys.length === 0) continue;
      const objects = info.dataObjects;
      for (let j = 0; j < objects.length; j++) {
        const data = objects[j]!;
        for (let k = 0; k < keys.length; k++) {
          if (hasOwnProperty(data, keys[k]!)) data[keys[k]!] = undefined;
        }
      }
    }
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
    this.#sideStaged = this.#sideCount;
    try {
      this.#payloadCount = this.#stagePayload(record, info, data, this.#payloadCount);
    } catch (error) {
      this.#dropStagedSide();
      throw error;
    }
    this.#sideCount = this.#sideStaged;
    this.#recordCount++;
    this.#commandCount++;
  }

  #queuePair(op: number, relation: AnyRelation, source: unknown, target: unknown, data: unknown): void {
    this.#assertNotFlushing();
    const index = this.#relationInfoFor(relation);
    const info = this.#infos[index]!;
    const sourceHandle = this.#validateTarget(source as Entity);
    const targetHandle = this.#validateTarget(target as Entity);
    this.#reserveRecords(1);
    const record = this.#recordCount;
    this.#ops[record] = op;
    this.#components[record] = index;
    this.#targets[record] = sourceHandle;
    this.#pairTargets[record] = targetHandle;
    // Pair data is numeric only, so staging never touches the side column.
    this.#payloadCount = this.#stagePayload(record, info, data, this.#payloadCount);
    this.#recordCount++;
    this.#commandCount++;
  }

  /** Forget side values staged by a rejected command, so the buffer does not keep them alive. */
  #dropStagedSide(): void {
    const values = this.#sideValues;
    for (let i = this.#sideCount; i < this.#sideStaged; i++) values[i] = undefined;
    this.#sideStaged = this.#sideCount;
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
        throw new TypeError(`${info.isRelation ? "Relation" : "Component"} data for "${info.name}" must be an object.`);
      }
      const values = data as Record<string, unknown>;
      for (const key in values) {
        if (!hasOwnProperty(values, key)) continue;
        const field = info.keyIndex[key];
        if (field === undefined) {
          const kind = info.isRelation ? "Relation" : "Component";
          throw new ComponentDataError(`${kind} ${info.name} does not define data field "${key}".`);
        }
        const value = values[key];
        if (position >= this.#payloadFields.length) this.#growPayload(position + 1);
        if (info.side[field] === 1) {
          // Validated by the world at flush; queued by reference. A pending entity must come from this buffer.
          if (info.entityRef[field] === 1 && typeof value === "number" && value < 0) this.#validateTarget(value);
          const slot = this.#sideStaged++;
          this.#sideValues[slot] = value;
          if (this.#sideStaged > this.#sideHigh) this.#sideHigh = this.#sideStaged;
          this.#payloadValues[position] = slot;
        } else {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            const kind = info.isRelation ? "Relation" : "Component";
            throw new ComponentDataError(`${kind} ${info.name} data field "${key}" must be a finite number.`);
          }
          this.#payloadValues[position] = value;
        }
        this.#payloadFields[position] = field;
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
    const index = this.#cachedInfoFor(component);
    // Rejected at enqueue, like the direct calls, so a spawn never applies half a bundle.
    if (this.#infos[index]!.isRelation) throw relationComponentError(component.name, RELATION_ADVICE);
    return index;
  }

  /** Resolve a relation's buffer-local index; its info describes the pair data fields. */
  #relationInfoFor(relation: AnyRelation): number {
    const index = this.#cachedInfoFor(relation as unknown as DynamicComponent);
    const info = this.#infos[index]!;
    if (!info.isRelation) throw new TypeError(`Component "${info.name}" is not a relation.`);
    return index;
  }

  #cachedInfoFor(component: DynamicComponent): number {
    const cached = this.#infoIndex.get(component);
    if (cached !== undefined) return cached;
    if (!this.#world.components.isRegistered(component)) {
      throw new NotRegisteredError(formatComponentNotRegistered(componentDisplayName(component)));
    }
    const relation = isRelation(component);
    const schema = (relation ? component.dataSchema : component.schema) as Readonly<Record<string, unknown>> | null;
    const keys = schema === null ? [] : Object.keys(schema);
    const keyIndex: Record<string, number> = Object.create(null);
    const side = new Uint8Array(keys.length);
    const sideKeys: string[] = [];
    const entityRef = new Uint8Array(keys.length);
    const row: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      keyIndex[key] = i;
      row[key] = 0;
      if (!isSupportedColumnConstructor(schema![key])) {
        side[i] = 1;
        sideKeys.push(key);
        if (isEntityField(schema![key])) entityRef[i] = 1;
      }
    }
    const index = this.#infos.length;
    this.#infos.push({
      component,
      name: component.name,
      isRelation: relation,
      keys,
      keyIndex,
      side,
      sideKeys,
      entityRef,
      isTag: keys.length === 0,
      byMask: new Map(),
      row,
      dataObjects: [row],
    });
    this.#infoIndex.set(component, index);
    if (this.#bundleSeen.length <= index) this.#bundleSeen = growTypedArray(this.#bundleSeen, (index + 1) * 2);
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
  #validateTarget(entity: Entity | PendingEntity | number): number {
    const value = entity as number;
    if (!Number.isInteger(value)) throw new SpecError(`Invalid entity handle ${String(entity)}`);
    if (value >= 0) {
      if (!isEntityInRange(value, this.#world.entities.capacity)) {
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
    this.#ops = growTypedArray(this.#ops, size);
    this.#components = growTypedArray(this.#components, size);
    this.#targets = growTypedArray(this.#targets, size);
    this.#pairTargets = growTypedArray(this.#pairTargets, size);
    this.#payloadStarts = growTypedArray(this.#payloadStarts, size);
    this.#payloadCounts = growTypedArray(this.#payloadCounts, size);
    this.#masks = growTypedArray(this.#masks, size);
  }

  #growPayload(needed: number): void {
    const size = Math.max(needed, this.#payloadFields.length * 2);
    this.#payloadFields = growTypedArray(this.#payloadFields, size);
    this.#payloadValues = growTypedArray(this.#payloadValues, size);
  }

  /** The entity a target refers to, or -1 for a pending entity whose spawn has not run. */
  #resolve(target: number): number {
    if (target >= 0) return target;
    const index = (-target - 1) & PENDING_INDEX_MASK;
    return index < this.#spawned.length ? this.#spawned[index]! : -1;
  }

  /** Apply the command at `record`. */
  #apply(record: number): void {
    const op = this.#ops[record]!;
    if (op === OP_SPAWN) {
      this.#applySpawn(record);
      return;
    }
    const world = this.#world;
    const entity = this.#resolve(this.#targets[record]!) as Entity;
    if ((entity as number) < 0 || !world.entities.isActive(entity)) return;
    if (op === OP_DESTROY) {
      world.entities.destroy(entity);
      return;
    }
    const info = this.#infos[this.#components[record]!]!;
    if (op === OP_RELATE || op === OP_UNRELATE) {
      this.#applyPair(op, record, info, entity);
      return;
    }
    const component = info.component;
    if (op === OP_REMOVE) {
      world.components.removeFromEntity(component, entity);
    } else if (op === OP_SET) {
      world.components.setEntityData(
        component as Component<Record<string, never>>,
        entity,
        this.#dataFor(record, info, entity, false) as never,
      );
    } else if (this.#payloadCounts[record] === 0) {
      world.components.addToEntity(component as Component<null, null>, entity);
    } else {
      world.components.addToEntity(
        component as Component<Record<string, never>>,
        entity,
        this.#dataFor(record, info, entity, false) as never,
      );
    }
  }

  #applyPair(op: number, record: number, info: ComponentInfo, source: Entity): void {
    const target = this.#resolve(this.#pairTargets[record]!) as Entity;
    if ((target as number) < 0 || !this.#world.entities.isActive(target)) return;
    const relation = info.component as unknown as AnyRelation;
    if (op === OP_UNRELATE) {
      this.#world.relations.remove(relation, source, target);
    } else if (this.#payloadCounts[record] === 0) {
      this.#world.relations.add(relation, source, target);
    } else {
      this.#world.relations.add(relation, source, target, this.#pairDataFor(record, info) as never);
    }
  }

  /** Fill the relation's reusable row with the provided fields; omitted ones are `undefined`, which reads as absent. */
  #pairDataFor(record: number, info: ComponentInfo): Record<string, unknown> {
    const data = info.row;
    for (let i = 0; i < info.keys.length; i++) data[info.keys[i]!] = undefined;
    const start = this.#payloadStarts[record]!;
    const end = start + this.#payloadCounts[record]!;
    for (let i = start; i < end; i++) data[info.keys[this.#payloadFields[i]!]!] = this.#payloadValues[i]!;
    return data;
  }

  #applySpawn(record: number): void {
    const entryCount = this.#payloadCounts[record]!;
    // Mark the spawn failed until it succeeds, so later commands on its pending handle are skipped.
    const index = (-this.#targets[record]! - 1) & PENDING_INDEX_MASK;
    if (index >= this.#spawned.length) this.#spawned = growTypedArray(this.#spawned, Math.max(16, (index + 1) * 2));
    this.#spawned[index] = -1;
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
    const entity = this.#world.entities.create(bundle as unknown as readonly []);
    if (entity === undefined) {
      throw new CapacityError(`World is at capacity (${this.#world.entities.capacity} entities).`);
    }
    this.#spawned[index] = entity;
  }

  /**
   * Build the data object for a payload record. Narrow components reuse an object holding exactly the provided
   * fields, so omitted fields stay omitted. Wide components fill omitted fields from the entity's current values;
   * when it is new or not an owner, omitted numeric fields are zero and omitted side fields are left out (a fresh
   * object, so that cold case allocates).
   */
  #dataFor(record: number, info: ComponentInfo, entity: Entity, isNew: boolean): Record<string, unknown> {
    const mask = this.#masks[record]!;
    const start = this.#payloadStarts[record]!;
    const end = start + this.#payloadCounts[record]!;
    let data: Record<string, unknown>;
    if (mask === WIDE_MASK) {
      const owned = !isNew && this.#world.components.entityHas(info.component, entity);
      if (owned) {
        data = info.row;
        if (info.sideKeys.length > 0) this.#rowsHoldValues = true;
        this.#world.components.readEntityDataInto(info.component, entity, data as Record<string, number>);
      } else if (info.sideKeys.length === 0) {
        data = info.row;
        for (let i = 0; i < info.keys.length; i++) data[info.keys[i]!] = 0;
      } else {
        data = {};
        for (let i = 0; i < info.keys.length; i++) {
          if (info.side[i] === 0) data[info.keys[i]!] = 0;
        }
      }
    } else {
      data = info.byMask.get(mask) ?? this.#createMaskedData(info, mask);
    }
    for (let i = start; i < end; i++) {
      const field = this.#payloadFields[i]!;
      const value = this.#payloadValues[i]!;
      if (info.side[field] === 0) {
        data[info.keys[field]!] = value;
        continue;
      }
      const sideValue = this.#sideValues[value];
      if (info.entityRef[field] === 1 && typeof sideValue === "number") {
        // A pending entity resolves to its spawned entity (validated when queued). A queued reference whose target
        // died before flush, or whose spawn failed, reads as null, exactly like a stale stored reference.
        const entity = sideValue < 0 ? this.#resolve(sideValue) : sideValue;
        data[info.keys[field]!] = entity >= 0 && this.#world.entities.isActive(entity as Entity) ? entity : null;
      } else {
        data[info.keys[field]!] = sideValue;
      }
    }
    return data;
  }

  #createMaskedData(info: ComponentInfo, mask: number): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < info.keys.length; i++) {
      if ((mask & (1 << i)) !== 0) data[info.keys[i]!] = 0;
    }
    info.byMask.set(mask, data);
    info.dataObjects.push(data);
    return data;
  }

  /** Prefix a flush error with the command that raised it. */
  #annotate(error: unknown, record: number): void {
    if (!isError(error) || record >= this.#recordCount) return;
    const op = this.#ops[record]!;
    const target = this.#targets[record]!;
    const name = op === OP_SPAWN || op === OP_DESTROY ? "" : ` ${this.#infos[this.#components[record]!]!.name}`;
    let entity = target < 0 ? `pending entity ${target}` : `entity ${target}`;
    if (op === OP_RELATE || op === OP_UNRELATE) {
      const pairTarget = this.#pairTargets[record]!;
      entity += ` -> ${pairTarget < 0 ? `pending entity ${pairTarget}` : `entity ${pairTarget}`}`;
    }
    try {
      error.message = `CommandBuffer ${OP_NAMES[op]}${name} on ${entity} failed: ${error.message}`;
    } catch {
      // A non-writable message keeps its original text.
    }
  }
}
