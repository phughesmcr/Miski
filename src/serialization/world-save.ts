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
  assertLittleEndian,
  CODE_OBJECT,
  CODE_STRING,
  FIELD_TYPE_BYTES,
  FORMAT_VERSION,
  hashBytes64,
  hashHex,
  objectColumnBytes,
  stringColumnBytes,
  ViewCache,
  type Views,
  wordCount,
  WorldSaveError,
} from "./format.ts";
import { type WorldSaveHost, worldSaveHost } from "./host.ts";
import {
  type ComponentImage,
  heapBytes,
  type KnownLayout,
  parseSave,
  relationTargetOrder,
  saveBytes,
  type SaveImage,
  SaveSource,
  validateImage,
  ValidationScratch,
  writeObjectCells,
  writeSave,
  writeStringCells,
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
  /** Number of encoded cells currently held in the object columns' `encoded` arrays. */
  encodedCount: number;
  scratch: ValidationScratch | undefined;
  /** Relation stores in layout order. */
  readonly relations: readonly RelationStore[];
  /** The world as a save source, staged by `measure`. */
  readonly source: WorldSource;
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
  const known: KnownLayout = { layout, layoutBlock, info, layoutHashLow: low, layoutHashHigh: high };
  const relations = info.relations.map((relation) => host.relations!.store(states[relation.component]!.instance.type));
  const context: SaveContext = {
    ...known,
    host,
    capacity: host.capacity,
    wordsPerSet: wordCount(states.length),
    instances: states.map((state) => state.instance),
    writeViews: new ViewCache(),
    side,
    encodedCount: 0,
    scratch: undefined,
    relations,
    source: new WorldSource(known, host, wordCount(states.length), side, relations),
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
  // Indexed loops: `for...of` allocates an iterator and a result per step until the function is optimized.
  const side = context.side;
  for (let c = 0; c < side.length; c++) {
    const columns = side[c]!;
    for (let s = 0; s < columns.length; s++) {
      const encoded = columns[s]!.encoded;
      if (encoded !== null) encoded.fill(null, 0, Math.min(count, encoded.length));
    }
  }
  context.encodedCount = 0;
}

/** Stage the source's counts and encoded object cells, and return the save's length; call `releaseEncoded` after. */
function measure(context: SaveContext): number {
  const { host, source } = context;
  const archetypes = host.archetypes;
  const live = liveCount(context);
  source.live = live;
  source.population = live;
  source.archetypeCount = archetypes.archetypeCount;
  const states = host.components.saveStates;
  const counts = source.componentCounts;
  for (let c = 0; c < states.length; c++) {
    const state = states[c]!;
    counts[c * 2] = state.ownerCount;
    counts[c * 2 + 1] = state.changedCount;
    source.sideBytes[c] = context.side[c]!.length === 0 ?
      0 :
      measureSide(context, c, state.ownerList, state.ownerCount);
  }
  source.touched = archetypes.transitionWindow.touchedCount;
  const relations = context.relations;
  const rc = source.relationCounts;
  for (let r = 0; r < relations.length; r++) {
    const store = relations[r]!;
    let pairs = 0;
    for (let i = 0; i < store.liveSourceCount; i++) pairs += store.sourceCount[store.liveSourceAt(i)]!;
    let targets = 0;
    for (let slot = store.firstTargetSlot; slot !== NONE; slot = store.nextTargetSlot(slot)) targets++;
    const k = r * 6;
    rc[k] = store.savedHighWater;
    rc[k + 1] = store.freeRowCount;
    rc[k + 2] = store.liveSourceCount;
    rc[k + 3] = pairs;
    rc[k + 4] = targets;
    rc[k + 5] = store.changedCount;
  }
  return saveBytes(source);
}

/** Write a slot list; returns the end offset. */
function writeSlots(views: Views, offset: number, width: number, list: ArrayLike<number>, count: number): number {
  const slots = views.slots(width);
  const start = width === 1 ? offset : offset >>> 1;
  for (let i = 0; i < count; i++) slots[start + i] = list[i]!;
  return offset + count * width;
}

/** A world's live state as a {@link SaveSource}, staged by `measure`. Its writers allocate nothing. */
class WorldSource extends SaveSource {
  readonly host: WorldSaveHost;
  readonly side: readonly (readonly SideColumn[])[];
  readonly stores: readonly RelationStore[];

  constructor(
    known: KnownLayout,
    host: WorldSaveHost,
    wordsPerSet: number,
    side: readonly (readonly SideColumn[])[],
    stores: readonly RelationStore[],
  ) {
    super(known, host.capacity, wordsPerSet);
    this.host = host;
    this.side = side;
    this.stores = stores;
  }

  cursor(): number {
    return this.host.entities.allocationCursor;
  }

  writeEntityWords(u32: Uint32Array, w: number): number {
    const entities = this.host.entities;
    const occupancy = entities.occupancyWords;
    u32.set(occupancy, w);
    w += occupancy.length;
    u32.set(entities.nextGenerations, w);
    w += this.capacity;
    const generation = entities.generations;
    for (let word = 0; word < occupancy.length; word++) {
      let bits = occupancy[word]!;
      while (bits !== 0) {
        u32[w++] = generation[(word << 5) + (31 - Math.clz32(bits & -bits))]!;
        bits &= bits - 1;
      }
    }
    return w;
  }

  writeArchetypeBits(u32: Uint32Array, w: number): void {
    const archetypes = this.host.archetypes;
    const wordsPerSet = this.wordsPerSet;
    for (let i = 0; i < this.archetypeCount; i++) {
      const words = archetypes.archetypeAt(i).bitfield.buffer;
      for (let k = 0; k < wordsPerSet; k++) u32[w + k] = k < words.length ? words[k]! : 0;
      w += wordsPerSet;
    }
  }

  populationCount(i: number): number {
    return this.host.archetypes.archetypeAt(i).getPopulationCount();
  }

  writePopulation(views: Views, offset: number, width: number, i: number): number {
    const archetype = this.host.archetypes.archetypeAt(i);
    return writeSlots(views, offset, width, archetype.populationSlots, archetype.getPopulationCount());
  }

  writeOwners(views: Views, offset: number, width: number, c: number): number {
    const state = this.host.components.saveStates[c]!;
    return writeSlots(views, offset, width, state.ownerList!, state.ownerCount);
  }

  writeChanged(views: Views, offset: number, width: number, c: number): number {
    const state = this.host.components.saveStates[c]!;
    return writeSlots(views, offset, width, state.changedList!, state.changedCount);
  }

  writeNumeric(views: Views, offset: number, c: number, t: number, code: number): void {
    const state = this.host.components.saveStates[c]!;
    const owners = state.ownerCount;
    const ownerList = state.ownerList!;
    const view = views.column(code);
    const start = offset / FIELD_TYPE_BYTES[code]!;
    const column = state.storageColumns[t]!;
    if (ArrayBuffer.isView(column)) {
      for (let j = 0; j < owners; j++) view[start + j] = (column as TypedArray)[ownerList[j]!]!;
    } else {
      const getEntity = (column as unknown as SparseColumn).getEntity;
      for (let j = 0; j < owners; j++) view[start + j] = getEntity(ownerList[j]!)!;
    }
  }

  writeStrings(views: Views, offset: number, c: number, s: number): number {
    const state = this.host.components.saveStates[c]!;
    return writeStringCells(views, offset, this.side[c]![s]!.column, state.ownerList!, state.ownerCount);
  }

  writeObjects(views: Views, offset: number, c: number, s: number): number {
    const owners = this.host.components.saveStates[c]!.ownerCount;
    const encoded = this.side[c]![s]!.encoded!;
    const end = writeObjectCells(views, offset, encoded, owners);
    // Drop the cells once written, so a finished save keeps no encoded values alive.
    encoded.fill(null, 0, owners);
    return end;
  }

  writeWindowSlots(views: Views, offset: number, width: number): void {
    const window = this.host.archetypes.transitionWindow;
    const slots = views.slots(width);
    const start = width === 1 ? offset : offset >>> 1;
    for (let i = 0; i < this.touched; i++) slots[start + i] = window.touchedSlot(i);
  }

  writeWindowWords(u32: Uint32Array, w: number): void {
    const window = this.host.archetypes.transitionWindow;
    const touched = this.touched;
    for (let i = 0; i < touched; i++) {
      const slot = window.touchedSlot(i);
      const origin: Archetype | undefined = window.originAt(slot);
      u32[w + i] = origin === undefined ? 0 : origin.registryIndex + 1;
      u32[w + touched + i] = origin === undefined ? 0 : window.handleAt(slot);
    }
  }

  writeRelationWords(u32: Uint32Array, w: number, r: number): void {
    const store = this.stores[r]!;
    const pairs = this.relationCounts[r * 6 + 3]!;
    const sources = store.liveSourceCount;
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
  }

  writeRelationData(views: Views, offset: number, r: number, c: number, code: number): void {
    const store = this.stores[r]!;
    const view = views.column(code);
    const column = store.dataColumn(c);
    let j = offset / FIELD_TYPE_BYTES[code]!;
    for (let i = 0; i < store.liveSourceCount; i++) {
      for (let row = store.sourceHead[store.liveSourceAt(i)]!; row !== NONE; row = store.nextRowBySource(row)) {
        view[j++] = column[row]!;
      }
    }
  }
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
  let total: number;
  try {
    total = measure(context);
    if (target.byteLength < total) {
      throw new RangeError(`World save needs ${total} bytes; target has ${target.byteLength} bytes.`);
    }
    writeSave(context.source, context.writeViews.get(target.buffer), target.byteOffset, total);
  } catch (error) {
    releaseEncoded(context);
    throw error;
  }
  // writeSave dropped every encoded cell as it wrote it. Not calling releaseEncoded here keeps the hot path off a
  // function that reaches its optimized tier late.
  context.encodedCount = 0;
  return total;
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
    writeSave(context.source, new ViewCache().get(out.buffer), 0, out.byteLength);
    return out;
  } finally {
    releaseEncoded(context);
  }
}

/** Whether any side column is an object field. A loop, not `some`: a callback here costs a closure per component per load. */
function hasObjectColumn(columns: readonly SideColumn[]): boolean {
  for (let s = 0; s < columns.length; s++) if (columns[s]!.code === CODE_OBJECT) return true;
  return false;
}

/** Copy the components whose object columns hold encoded cells, with each cell decoded through its field's hook. */
function decodeObjects(context: SaveContext, components: readonly ComponentImage[]): readonly ComponentImage[] {
  let out: ComponentImage[] | undefined;
  for (let c = 0; c < components.length; c++) {
    const columns = context.side[c]!;
    if (!hasObjectColumn(columns)) continue;
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
