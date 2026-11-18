import type { Archetype } from "@/archetype/archetype.ts";
import type { SideField } from "@/component/field-codec.ts";
import { entityIndex } from "@/entity/entity.ts";
import type { DynamicComponentInstance } from "@/types/component.ts";
import type { TypedArray } from "@/types/partitions.ts";
import { NONE, type RelationStore, type RelationStoreSnapshot } from "@/relation/relation-store.ts";
import type { World } from "@/world/world.ts";
import type { WorldSaveDocument } from "./document.ts";
import { docToImage, imageToDoc } from "./document.ts";
import {
  align8,
  assertLittleEndian,
  CODE_OBJECT,
  CODE_STRING,
  FIELD_TYPE_BYTES,
  FORMAT_VERSION,
  hashBytes64,
  hashHex,
  objectColumnBytes,
  SECTION_ARCHETYPES,
  SECTION_COMPONENTS,
  SECTION_ENTITIES,
  SECTION_HEADER_BYTES,
  SECTION_RELATIONS,
  SECTION_WINDOW,
  sectionCount,
  slotWidth,
  stringColumnBytes,
  ViewCache,
  type Views,
  wordCount,
  WorldSaveError,
} from "./format.ts";
import { type WorldSaveHost, worldSaveHost } from "./host.ts";
import {
  archetypesPayloadBytes,
  type ComponentImage,
  componentPayloadBytes,
  entitiesPayloadBytes,
  heapBytes,
  type KnownLayout,
  parseSave,
  relationPayloadBytes,
  relationTargetOrder,
  type SaveImage,
  validateImage,
  ValidationScratch,
  windowPayloadBytes,
  writeHeader,
  writeObjectCells,
  writeSectionHeader,
  writeStringCells,
  zeroPad,
} from "./image.ts";
import { compareLayouts, encodeLayout, layoutInfo, layoutOfStates, type WorldSaveLayout } from "./layout.ts";

/** Summary of a world save, read without a world. */
export type WorldSaveHeader = {
  /** Save format version. */
  readonly formatVersion: number;
  /** Exact length of the save in bytes. */
  readonly byteLength: number;
  /** Capacity and component layout the save was written with. */
  readonly layout: WorldSaveLayout;
  /** 64-bit fingerprint of the component layout, as 16 hex digits. */
  readonly layoutHash: string;
  /** Number of live entities in the save. */
  readonly entityCount: number;
};

/** Options for {@link loadWorld}. */
export type WorldSaveLoadOptions = {
  /**
   * Upgrade a save whose layout differs from the world's. Called only on a mismatch, with the save as a
   * {@link WorldSaveDocument} and the world's layout; return a document in the world's layout. The result is
   * validated like any other save before the world changes.
   */
  readonly migrate?: (document: WorldSaveDocument, target: WorldSaveLayout) => WorldSaveDocument;
};

type SparseColumn = { readonly getEntity: (slot: number) => number | undefined };

/** One string / object column of a world, as a save reads it. */
type SideColumn = {
  readonly code: number;
  readonly field: SideField;
  /** `component.field`, for error messages. */
  readonly label: string;
  /** The slot-indexed live column. */
  readonly column: readonly unknown[];
  /** Object columns: encoded cells in owner order, filled by `measure` and cleared after each save. */
  readonly encoded: unknown[] | null;
};

/** Per-world save state, built once: the layout never changes after construction. */
type SaveContext = KnownLayout & {
  readonly host: WorldSaveHost;
  readonly capacity: number;
  readonly wordsPerSet: number;
  readonly instances: readonly DynamicComponentInstance[];
  readonly writeViews: ViewCache;
  /** String / object columns per component, in layout order (empty for most components). */
  readonly side: readonly (readonly SideColumn[])[];
  /** Bytes of each component's string / object columns, set by `measure`. */
  readonly sideBytes: Float64Array;
  /** Number of encoded cells currently held in the object columns' `encoded` arrays. */
  encodedCount: number;
  scratch: ValidationScratch | undefined;
  /** Relation stores in layout order. */
  readonly relations: readonly RelationStore[];
  /** Pair and target counts per relation, set by `measure`. */
  readonly relationCounts: Int32Array;
};

const contexts = new WeakMap<World, SaveContext>();

function contextOf(world: World): SaveContext {
  return contexts.get(world) ?? createContext(world);
}

// Kept apart from `contextOf`: closures here capture locals, and V8 allocates their context on every call of the
// enclosing function, including calls that return a cached context.
function createContext(world: World): SaveContext {
  const host = (world as unknown as { [worldSaveHost](): WorldSaveHost })[worldSaveHost]();
  const states = host.components.saveStates;
  const layout = layoutOfStates(host.capacity, states);
  const info = layoutInfo(layout);
  const side = states.map((state) =>
    state.sideFields.map((field, s): SideColumn => ({
      code: field.kind === "string" ? CODE_STRING : CODE_OBJECT,
      field,
      label: `${state.instance.type.name}.${state.sideKeys[s]}`,
      column: state.sideColumns[s]!,
      encoded: field.kind === "object" ? [] : null,
    }))
  );
  const layoutBlock = encodeLayout(layout);
  const [low, high] = hashBytes64(layoutBlock);
  const context: SaveContext = {
    host,
    capacity: host.capacity,
    layout,
    layoutBlock,
    info,
    layoutHashLow: low,
    layoutHashHigh: high,
    wordsPerSet: wordCount(states.length),
    instances: states.map((state) => state.instance),
    writeViews: new ViewCache(),
    side,
    sideBytes: new Float64Array(states.length),
    encodedCount: 0,
    scratch: undefined,
    relations: info.relations.map((relation) => host.relations!.store(states[relation.component]!.instance.type)),
    relationCounts: new Int32Array(info.relations.length * 2),
  };
  contexts.set(world, context);
  return context;
}

function liveCount(context: SaveContext): number {
  const archetypes = context.host.archetypes;
  let live = 0;
  for (let i = 0; i < archetypes.archetypeCount; i++) live += archetypes.archetypeAt(i).getPopulationCount();
  return live;
}

/**
 * Run each owned object's `encode` hook into the column's scratch, check the results, and measure the string / object
 * columns of component `c`. Lone surrogates and invalid encode results throw before anything is written.
 */
function measureSide(
  context: SaveContext,
  c: number,
  ownerList: ArrayLike<number> | undefined,
  owners: number,
): number {
  const columns = context.side[c]!;
  let bytes = 0;
  for (let s = 0; s < columns.length; s++) {
    const side = columns[s]!;
    if (side.code === CODE_STRING) {
      const heap = owners === 0 ? 0 : heapBytes(side.column, ownerList!, owners);
      if (heap < 0) {
        throw new WorldSaveError(
          `Component ${side.label} holds a string with a lone surrogate, which UTF-8 cannot store.`,
        );
      }
      bytes += stringColumnBytes(owners, heap);
      continue;
    }
    const encoded = side.encoded!;
    const encode = (side.field as SideField & { kind: "object" }).encode!;
    for (let j = 0; j < owners; j++) {
      const value = side.column[ownerList![j]!];
      if (value === null) {
        encoded[j] = null;
        continue;
      }
      let result: unknown;
      try {
        result = encode(value);
      } catch (cause) {
        throw new WorldSaveError(`Component ${side.label} encode hook threw.`, { cause });
      }
      if (result !== null && typeof result !== "string" && typeof result !== "number") {
        throw new WorldSaveError(
          `Component ${side.label} encode hook must return a string, number or null, not ${typeof result}.`,
        );
      }
      encoded[j] = result;
    }
    if (owners > context.encodedCount) context.encodedCount = owners;
    const heap = heapBytes(encoded, null, owners);
    if (heap < 0) {
      throw new WorldSaveError(
        `Component ${side.label} encode hook returned a string with a lone surrogate, which UTF-8 cannot store.`,
      );
    }
    bytes += objectColumnBytes(owners, heap);
  }
  return bytes;
}

/** Drop the encoded object cells, so a save does not keep them alive. */
function releaseEncoded(context: SaveContext): void {
  const count = context.encodedCount;
  if (count === 0) return;
  for (const columns of context.side) {
    for (const side of columns) side.encoded?.fill(null, 0, Math.min(count, side.encoded.length));
  }
  context.encodedCount = 0;
}

/** Measure the save and stage encoded object cells for `writeWorld`; call `releaseEncoded` afterwards. */
function measure(context: SaveContext): number {
  const { host, capacity, info } = context;
  const width = slotWidth(capacity);
  const live = liveCount(context);
  const relations = context.relations;
  let bytes = 40 + context.layoutBlock.length + sectionCount(relations.length) * SECTION_HEADER_BYTES;
  bytes += entitiesPayloadBytes(capacity, live);
  bytes += archetypesPayloadBytes(host.archetypes.archetypeCount, context.wordsPerSet, live, width);
  const states = host.components.saveStates;
  const sideBytes = context.sideBytes;
  for (let c = 0; c < states.length; c++) {
    const state = states[c]!;
    const side = context.side[c]!.length === 0 ? 0 : measureSide(context, c, state.ownerList, state.ownerCount);
    sideBytes[c] = side;
    bytes += componentPayloadBytes(state.ownerCount, state.changedCount, info.codes[c]!, width, side);
  }
  bytes += windowPayloadBytes(host.archetypes.transitionWindow.touchedCount, width);
  for (let r = 0; r < relations.length; r++) bytes += measureRelation(context, r);
  return bytes;
}

/** Count a relation's pairs and targets into `relationCounts`; returns its payload bytes. */
function measureRelation(context: SaveContext, r: number): number {
  const store = context.relations[r]!;
  let pairs = 0;
  for (let i = 0; i < store.liveSourceCount; i++) pairs += store.sourceCount[store.liveSourceAt(i)]!;
  let targets = 0;
  for (let slot = store.firstTargetSlot; slot !== NONE; slot = store.nextTargetSlot(slot)) targets++;
  context.relationCounts[r * 2] = pairs;
  context.relationCounts[r * 2 + 1] = targets;
  return relationPayloadBytes(
    store.freeRowCount,
    store.liveSourceCount,
    pairs,
    targets,
    store.changedCount,
    context.info.relations[r]!.codes,
  );
}

/** Write one relation at `offset` (8-aligned), right after `measure`. Allocates nothing. @returns the end offset */
function writeRelation(context: SaveContext, views: Views, r: number, offset: number): number {
  const store = context.relations[r]!;
  const pairs = context.relationCounts[r * 2]!;
  const u32 = views.u32;
  const sources = store.liveSourceCount;
  let w = offset >>> 2;
  u32[w++] = store.savedHighWater;
  u32[w++] = store.freeRowCount;
  u32[w++] = sources;
  u32[w++] = pairs;
  u32[w++] = context.relationCounts[r * 2 + 1]!;
  u32[w++] = store.changedCount;
  for (let i = 0; i < store.freeRowCount; i++) u32[w++] = store.freeRowAt(i);
  for (let i = 0; i < sources; i++) u32[w++] = store.liveSourceAt(i);
  for (let i = 0; i < sources; i++) u32[w++] = store.sourceCount[store.liveSourceAt(i)]!;
  for (let i = 0; i < sources; i++) {
    for (let row = store.sourceHead[store.liveSourceAt(i)]!; row !== NONE; row = store.nextRowBySource(row)) {
      u32[w] = row;
      u32[w + pairs] = store.rowTarget[row]!;
      w++;
    }
  }
  w += pairs;
  for (let slot = store.firstTargetSlot; slot !== NONE; slot = store.nextTargetSlot(slot)) u32[w++] = slot;
  for (let slot = store.firstTargetSlot; slot !== NONE; slot = store.nextTargetSlot(slot)) {
    for (let row = store.targetHead[slot]!; row !== NONE; row = store.nextByTarget[row]!) {
      u32[w++] = store.rowSource[row]!;
    }
  }
  for (let i = 0; i < store.changedCount; i++) u32[w++] = store.changedAt(i);
  let p = align8(w << 2);
  zeroPad(views, w << 2, p);
  const codes = context.info.relations[r]!.codes;
  for (let c = 0; c < codes.length; c++) {
    const code = codes[c]!;
    const bytes = FIELD_TYPE_BYTES[code]!;
    const view = views.column(code);
    const column = store.dataColumn(c);
    let j = p / bytes;
    for (let i = 0; i < sources; i++) {
      for (let row = store.sourceHead[store.liveSourceAt(i)]!; row !== NONE; row = store.nextRowBySource(row)) {
        view[j++] = column[row]!;
      }
    }
    const end = p + pairs * bytes;
    zeroPad(views, end, p = align8(end));
  }
  return p;
}

/** Write a slot list; returns the end offset. */
function writeSlots(
  slots: Uint8Array | Uint16Array,
  offset: number,
  width: number,
  list: ArrayLike<number>,
  count: number,
): number {
  const start = width === 1 ? offset : offset >>> 1;
  for (let i = 0; i < count; i++) slots[start + i] = list[i]!;
  return offset + count * width;
}

/**
 * Serialize live world state at `base` (8-byte aligned, `total` bytes available), right after `measure`.
 * Allocates nothing.
 */
function writeWorld(context: SaveContext, views: Views, base: number, total: number): void {
  const { host, capacity, info, wordsPerSet } = context;
  const width = slotWidth(capacity);
  const u32 = views.u32;
  const slots = views.slots(width);
  const entities = host.entities;
  const archetypes = host.archetypes;
  const live = liveCount(context);

  let offset = writeHeader(views, base, total, context, capacity);

  // Entities: cursor, live count, occupancy, next generations, live generations in slot order.
  const entityBytes = entitiesPayloadBytes(capacity, live);
  let p = writeSectionHeader(views, offset, SECTION_ENTITIES, entityBytes);
  let w = p >>> 2;
  const occupancy = entities.occupancyWords;
  u32[w] = entities.allocationCursor;
  u32[w + 1] = live;
  w += 2;
  u32.set(occupancy, w);
  w += occupancy.length;
  u32.set(entities.nextGenerations, w);
  w += capacity;
  const generation = entities.generations;
  for (let word = 0; word < occupancy.length; word++) {
    let bits = occupancy[word]!;
    while (bits !== 0) {
      u32[w++] = generation[(word << 5) + (31 - Math.clz32(bits & -bits))]!;
      bits &= bits - 1;
    }
  }
  offset = p + entityBytes;
  zeroPad(views, w << 2, offset);

  // Archetypes: count, bitset width, bitsets, population counts, populations.
  const count = archetypes.archetypeCount;
  const archetypeBytes = archetypesPayloadBytes(count, wordsPerSet, live, width);
  p = writeSectionHeader(views, offset, SECTION_ARCHETYPES, archetypeBytes);
  w = p >>> 2;
  u32[w] = count;
  u32[w + 1] = wordsPerSet;
  w += 2;
  for (let i = 0; i < count; i++) {
    const words = archetypes.archetypeAt(i).bitfield.buffer;
    for (let k = 0; k < wordsPerSet; k++) u32[w + k] = k < words.length ? words[k]! : 0;
    w += wordsPerSet;
  }
  for (let i = 0; i < count; i++) u32[w + i] = archetypes.archetypeAt(i).getPopulationCount();
  let q = (w + count) << 2;
  for (let i = 0; i < count; i++) {
    const archetype = archetypes.archetypeAt(i);
    q = writeSlots(slots, q, width, archetype.populationSlots, archetype.getPopulationCount());
  }
  offset = p + archetypeBytes;
  zeroPad(views, q, offset);

  // Components: owner and changed lists, then owned rows per column in owner order.
  const states = host.components.saveStates;
  let componentBytes = 0;
  for (let c = 0; c < states.length; c++) {
    const state = states[c]!;
    componentBytes += componentPayloadBytes(
      state.ownerCount,
      state.changedCount,
      info.codes[c]!,
      width,
      context.sideBytes[c]!,
    );
  }
  p = writeSectionHeader(views, offset, SECTION_COMPONENTS, componentBytes);
  for (let c = 0; c < states.length; c++) {
    const state = states[c]!;
    const owners = state.ownerCount;
    const ownerList = state.ownerList;
    u32[p >>> 2] = owners;
    u32[(p >>> 2) + 1] = state.changedCount;
    p += 8;
    let end = owners === 0 ? p : writeSlots(slots, p, width, ownerList!, owners);
    zeroPad(views, end, p = align8(end));
    end = state.changedCount === 0 ? p : writeSlots(slots, p, width, state.changedList!, state.changedCount);
    zeroPad(views, end, p = align8(end));
    const codes = info.codes[c]!;
    if (codes === null) continue;
    const columns = state.storageColumns;
    const side = context.side[c]!;
    let t = 0;
    let s = 0;
    for (let k = 0; k < codes.length; k++) {
      const code = codes[k]!;
      if (code === CODE_STRING) {
        p = writeStringCells(views, p, side[s++]!.column, ownerList!, owners);
        continue;
      }
      if (code === CODE_OBJECT) {
        p = writeObjectCells(views, p, side[s++]!.encoded!, owners);
        continue;
      }
      const bytes = FIELD_TYPE_BYTES[code]!;
      const view = views.column(code);
      const start = p / bytes;
      const column = columns[t++]!;
      if (ArrayBuffer.isView(column)) {
        for (let j = 0; j < owners; j++) view[start + j] = (column as TypedArray)[ownerList![j]!]!;
      } else {
        const getEntity = (column as unknown as SparseColumn).getEntity;
        for (let j = 0; j < owners; j++) view[start + j] = getEntity(ownerList![j]!)!;
      }
      end = p + owners * bytes;
      zeroPad(views, end, p = align8(end));
    }
  }
  offset = p;

  // Window: touched slots, origins as registry index + 1, window-start handles.
  const window = archetypes.transitionWindow;
  const touched = window.touchedCount;
  p = writeSectionHeader(views, offset, SECTION_WINDOW, windowPayloadBytes(touched, width));
  u32[p >>> 2] = touched;
  u32[(p >>> 2) + 1] = 0;
  q = p + 8;
  const slotStart = width === 1 ? q : q >>> 1;
  for (let i = 0; i < touched; i++) slots[slotStart + i] = window.touchedSlot(i);
  const slotEnd = q + touched * width;
  q = (slotEnd + 3) & ~3;
  zeroPad(views, slotEnd, q);
  w = q >>> 2;
  for (let i = 0; i < touched; i++) {
    const slot = window.touchedSlot(i);
    const origin: Archetype | undefined = window.originAt(slot);
    u32[w + i] = origin === undefined ? 0 : origin.registryIndex + 1;
    u32[w + touched + i] = origin === undefined ? 0 : window.handleAt(slot);
  }
  w += touched * 2;
  offset = p + windowPayloadBytes(touched, width);
  zeroPad(views, w << 2, offset);

  // Relations: pools, sources and pairs in store order, target lists, changed sources, pair data.
  const relations = context.relations;
  if (relations.length === 0) return;
  let relationBytes = 0;
  for (let r = 0; r < relations.length; r++) {
    const store = relations[r]!;
    relationBytes += relationPayloadBytes(
      store.freeRowCount,
      store.liveSourceCount,
      context.relationCounts[r * 2]!,
      context.relationCounts[r * 2 + 1]!,
      store.changedCount,
      info.relations[r]!.codes,
    );
  }
  p = writeSectionHeader(views, offset, SECTION_RELATIONS, relationBytes);
  for (let r = 0; r < relations.length; r++) p = writeRelation(context, views, r, p);
  zeroPad(views, p, base + total);
}

/**
 * Get the number of bytes {@link saveWorldInto} needs for the world's current state.
 * @param world - An initialized world
 */
export function measureWorldSave(world: World): number {
  const context = contextOf(world);
  context.host.assertSaveReady();
  try {
    return measure(context);
  } finally {
    releaseEncoded(context);
  }
}

/**
 * Write the world's full state into a caller-owned buffer. With a reused buffer this allocates nothing.
 * @param world - An initialized world
 * @param target - Destination; its `byteOffset` must be a multiple of 8 and it must hold {@link measureWorldSave} bytes
 * @returns The number of bytes written, from the start of `target`
 * @throws {RangeError} When `target` is misaligned or too small
 */
export function saveWorldInto(world: World, target: Uint8Array): number {
  assertLittleEndian();
  const context = contextOf(world);
  context.host.assertSaveReady();
  if ((target.byteOffset & 7) !== 0) {
    throw new RangeError("World save target must be 8-byte aligned (byteOffset % 8 === 0).");
  }
  try {
    const total = measure(context);
    if (target.byteLength < total) {
      throw new RangeError(`World save needs ${total} bytes; target has ${target.byteLength} bytes.`);
    }
    writeWorld(context, context.writeViews.get(target.buffer), target.byteOffset, total);
    return total;
  } finally {
    releaseEncoded(context);
  }
}

/**
 * Save the world's full state: entities with their generations and allocator state, component ownership, values
 * and changed lists, archetype registry and iteration order, and the open transition window. Loading the save into
 * a world with the same layout makes it behave exactly as the saved world would have.
 * @param world - An initialized world
 * @returns A new buffer holding exactly the save
 */
export function saveWorld(world: World): Uint8Array {
  const context = contextOf(world);
  context.host.assertSaveReady();
  try {
    const out = new Uint8Array(measure(context));
    writeWorld(context, new ViewCache().get(out.buffer), 0, out.byteLength);
    return out;
  } finally {
    releaseEncoded(context);
  }
}

/** Copy the components whose object columns hold encoded cells, with each cell decoded through its field's hook. */
function decodeObjects(context: SaveContext, components: readonly ComponentImage[]): readonly ComponentImage[] {
  let out: ComponentImage[] | undefined;
  for (let c = 0; c < components.length; c++) {
    const columns = context.side[c]!;
    if (!columns.some((side) => side.code === CODE_OBJECT)) continue;
    const component = components[c]!;
    const sideRows = component.sideRows.map((cells, s) => {
      const side = columns[s]!;
      if (side.code !== CODE_OBJECT) return cells;
      const decode = (side.field as SideField & { kind: "object" }).decode!;
      const values = new Array<unknown>(cells.length);
      for (let j = 0; j < cells.length; j++) {
        const encoded = cells[j] as string | number | null;
        if (encoded === null) {
          values[j] = null;
          continue;
        }
        let value: unknown;
        try {
          value = decode(encoded);
        } catch (cause) {
          throw new WorldSaveError(`Component ${side.label} decode hook threw.`, { cause });
        }
        if (value === undefined) throw new WorldSaveError(`Component ${side.label} decode hook returned undefined.`);
        values[j] = value;
      }
      return values;
    });
    out ??= components.slice();
    out[c] = { ...component, sideRows };
  }
  return out ?? components;
}

/** Build a rollback snapshot of a validated relation, linking each target's pairs in its saved order. */
function relationSnapshot(image: SaveImage, r: number, scratch: ValidationScratch): RelationStoreSnapshot {
  const relation = image.relations[r]!;
  const order = relationTargetOrder(image, r, scratch);
  const pairs = relation.rows.length;
  const rows = relation.rows;
  const rowNextByTarget = new Int32Array(pairs);
  const rowPrevByTarget = new Int32Array(pairs);
  const count = relation.targetSlots.length;
  const targetHandles = new Uint32Array(count);
  const targetHeads = new Int32Array(count);
  const targetTails = new Int32Array(count);
  const targetCounts = new Uint32Array(count);
  let j = 0;
  for (let t = 0; t < count; t++) {
    const slot = relation.targetSlots[t]!;
    const first = order[j]!;
    targetHandles[t] = relation.targets[first]!;
    targetHeads[t] = rows[first]!;
    let prev = NONE;
    let previous = -1;
    for (; j < pairs && entityIndex(relation.targets[order[j]!]!) === slot; j++) {
      const k = order[j]!;
      rowPrevByTarget[k] = prev;
      if (previous !== -1) rowNextByTarget[previous] = rows[k]!;
      prev = rows[k]!;
      previous = k;
      targetCounts[t]!++;
    }
    rowNextByTarget[previous] = NONE;
    targetTails[t] = prev;
  }
  return {
    highWater: relation.highWater,
    freeRows: Int32Array.from(relation.freeRows),
    sources: Int32Array.from(relation.sources),
    sourceCounts: relation.sourceCounts,
    rows: Int32Array.from(rows),
    rowTargets: relation.targets,
    rowNextByTarget,
    rowPrevByTarget,
    rowData: relation.data,
    targets: Int32Array.from(relation.targetSlots),
    targetHandles,
    targetHeads,
    targetTails,
    targetCounts,
    changed: Int32Array.from(relation.changed),
  };
}

/** Number of leading saved archetypes whose component sets match the world's registry. */
function matchingPrefix(context: SaveContext, image: SaveImage): number {
  const archetypes = context.host.archetypes;
  const wordsPerSet = context.wordsPerSet;
  const limit = Math.min(archetypes.archetypeCount, image.populations.length);
  const bits = image.archetypeBits;
  let keep = 0;
  for (; keep < limit; keep++) {
    const words = archetypes.archetypeAt(keep).bitfield.buffer;
    let same = true;
    for (let k = 0; k < wordsPerSet; k++) {
      if ((k < words.length ? words[k]! : 0) !== bits[keep * wordsPerSet + k]) {
        same = false;
        break;
      }
    }
    if (!same) break;
  }
  return keep;
}

/**
 * Replace the world's state with a save. The save is fully validated first: a corrupt, truncated or incompatible
 * save throws {@link WorldSaveError} and leaves the world untouched. Systems are code, not data, so the world keeps
 * its registered systems. Query and component revisions move forward.
 * @param world - An initialized world outside any rollback scope, with the save's layout (or a `migrate` hook)
 * @param bytes - A save from {@link saveWorld}, {@link saveWorldInto} or {@link worldSaveFromJSON}
 * @param options - Optional migration hook for saves written with a different layout
 * @throws {WorldStateError} When the world is not initialized or a rollback scope is active
 * @throws {WorldSaveError} When the save is malformed or its layout differs and cannot be migrated
 */
export function loadWorld(world: World, bytes: Uint8Array, options?: WorldSaveLoadOptions): void {
  const context = contextOf(world);
  const host = context.host;
  host.assertLoadReady();
  let image = parseSave(bytes, context).image;
  context.scratch ??= new ValidationScratch(context.capacity);
  if (image.layout !== context.layout) {
    const problem = compareLayouts(image.layout, context.layout);
    if (problem !== undefined) {
      const migrate = options?.migrate;
      if (migrate === undefined) throw new WorldSaveError(problem);
      validateImage(
        image,
        image.capacity === context.capacity ? context.scratch : new ValidationScratch(image.capacity),
        0,
      );
      image = docToImage(migrate(imageToDoc(image), context.layout));
      const after = compareLayouts(image.layout, context.layout);
      if (after !== undefined) throw new WorldSaveError(`Migrated save does not match the world. ${after}`);
    }
  }
  validateImage(image, context.scratch, matchingPrefix(context, image));
  // Decode objects before anything changes, so a throwing hook leaves the world untouched.
  const components = decodeObjects(context, image.components);
  const relations = image.relations.map((_, r) => relationSnapshot(image, r, context.scratch!));

  host.entities.restoreSaved(image.occupancy, image.cursor, image.nextGeneration, image.liveGeneration);
  host.components.restoreSnapshot({ states: components });
  host.archetypes.restoreSaved(context.instances, image.archetypeBits, context.wordsPerSet, image.populations, {
    slots: image.windowSlots,
    origins: image.windowOrigins,
    handles: image.windowHandles,
  });
  if (relations.length !== 0) host.relations!.restoreState(relations);
  host.finishLoad();
}

/**
 * Read a save's format version, length, layout and entity count without a world.
 * @throws {WorldSaveError} When the bytes are not a well-formed save
 */
export function readWorldSaveHeader(bytes: Uint8Array): WorldSaveHeader {
  const { image, bytes: exact } = parseSave(bytes);
  return Object.freeze({
    formatVersion: FORMAT_VERSION,
    byteLength: exact.byteLength,
    layout: image.layout,
    layoutHash: hashHex(image.layoutHashLow, image.layoutHashHigh),
    entityCount: image.liveGeneration.length,
  });
}

/** Describe the layout a world writes its saves with; a save loads directly only into a world with an equal layout. */
export function describeWorldSaveLayout(world: World): WorldSaveLayout {
  return contextOf(world).layout;
}
