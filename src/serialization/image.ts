import { ENTITY_GEN_MASK, type EntityArray, entityIndex } from "@/entity/entity.ts";
import type { TypedArray } from "@/types/partitions.ts";
import {
  align4,
  align8,
  assertLittleEndian,
  bytesEqual,
  CODE_OBJECT,
  CODE_STRING,
  ENTITY_REF_LIMIT,
  FIELD_TYPE_BYTES,
  FORMAT_VERSION,
  hashBytes64,
  HEADER_BYTES,
  isSideCode,
  OBJECT_NULL,
  OBJECT_NUMBER,
  OBJECT_STRING,
  objectColumnBytes,
  SAVE_MAGIC,
  SECTION_ARCHETYPES,
  SECTION_COMPONENTS,
  SECTION_COUNT,
  SECTION_ENTITIES,
  SECTION_HEADER_BYTES,
  SECTION_REQUIRED,
  SECTION_WINDOW,
  slotWidth,
  stringColumnBytes,
  utf8Decoder,
  utf8Length,
  ViewCache,
  type Views,
  wordCount,
  WorldSaveError,
  writeUtf8,
} from "./format.ts";
import { decodeLayout, type LayoutInfo, layoutInfo, type WorldSaveLayout } from "./layout.ts";

/** One component's saved state; shaped like a rollback component snapshot so restore can reuse it. */
export type ComponentImage = {
  /** Owner slots in owner-iteration order. */
  readonly owners: EntityArray;
  /** Changed slots in changed-iteration order. */
  readonly changed: EntityArray;
  /** Owned row values per storage column, each parallel to `owners`. */
  readonly rows: readonly TypedArray[];
  /**
   * Owned string / object cells per side column, in layout order, each parallel to `owners`. String columns hold
   * strings. Object columns hold encoded values (`string`, `number` or `null`) in a parsed or document image, and
   * decoded values only in the copy {@link loadWorld} restores from.
   */
  readonly sideRows: readonly (readonly unknown[])[];
};

/** The shared empty side-row list of components without string / object fields. */
export const NO_SIDE_ROWS: readonly (readonly unknown[])[] = Object.freeze([]);

/** A decoded world save. Arrays may be views into the source bytes; treat them as read-only. */
export type SaveImage = {
  readonly capacity: number;
  readonly layout: WorldSaveLayout;
  /** Encoded component table, padded to 8 bytes. */
  readonly layoutBlock: Uint8Array;
  readonly info: LayoutInfo;
  readonly layoutHashLow: number;
  readonly layoutHashHigh: number;
  readonly cursor: number;
  readonly occupancy: Uint32Array;
  /** Next allocation generation of every slot. */
  readonly nextGeneration: Uint32Array;
  /** Generations of occupied slots, ascending by slot. */
  readonly liveGeneration: Uint32Array;
  readonly wordsPerSet: number;
  /** Component bitsets of every archetype in registry order, `wordsPerSet` words each. */
  readonly archetypeBits: Uint32Array;
  /** Population of every archetype in iteration order. */
  readonly populations: readonly EntityArray[];
  readonly components: readonly ComponentImage[];
  /** Touched slots in first-touch order. */
  readonly windowSlots: EntityArray;
  /** Window-start archetype registry index plus one per touched slot (0 = no entity at window start). */
  readonly windowOrigins: Uint32Array;
  /** Window-start handle per touched slot (0 when the origin is 0). */
  readonly windowHandles: Uint32Array;
};

/** A parsed save: the image plus the exact, 8-byte-aligned bytes it was read from. */
export type ParsedSave = {
  readonly image: SaveImage;
  readonly bytes: Uint8Array;
};

/** A layout already known to the caller, letting a matching save skip decoding its component table. */
export type KnownLayout = {
  readonly layout: WorldSaveLayout;
  readonly layoutBlock: Uint8Array;
  readonly info: LayoutInfo;
  readonly layoutHashLow: number;
  readonly layoutHashHigh: number;
};

export function entitiesPayloadBytes(capacity: number, live: number): number {
  return align8(8 + wordCount(capacity) * 4 + capacity * 4 + live * 4);
}

export function archetypesPayloadBytes(count: number, wordsPerSet: number, population: number, width: number): number {
  return align8(8 + count * wordsPerSet * 4 + count * 4 + population * width);
}

/**
 * Payload bytes of one saved component.
 * @param sideBytes - Total bytes of its string / object columns (they are variable-length)
 */
export function componentPayloadBytes(
  owners: number,
  changed: number,
  codes: readonly number[] | null,
  width: number,
  sideBytes: number,
): number {
  let bytes = 8 + align8(owners * width) + align8(changed * width) + sideBytes;
  if (codes !== null) { for (let c = 0; c < codes.length; c++) bytes += align8(owners * FIELD_TYPE_BYTES[codes[c]!]!); }
  return bytes;
}

/**
 * Write `count` strings as a string column at `offset` (8-aligned): u32 offsets into the heap (count + 1), then the
 * UTF-8 heap, zero-padded to 8. Cell `j` is `values[slots[j]]`, or `values[j]` when `slots` is `null`. The strings
 * must be well-formed (see `utf8Length`). Allocates nothing.
 * @returns the end offset
 */
export function writeStringCells(
  views: Views,
  offset: number,
  values: ArrayLike<unknown>,
  slots: ArrayLike<number> | null,
  count: number,
): number {
  const u32 = views.u32;
  const w = offset >>> 2;
  const heap = offset + (count + 1) * 4;
  let q = heap;
  for (let j = 0; j < count; j++) {
    u32[w + j] = q - heap;
    q = writeUtf8(views.u8, q, (slots === null ? values[j] : values[slots[j]!]) as string);
  }
  u32[w + count] = q - heap;
  const end = align8(q);
  zeroPad(views, q, end);
  return end;
}

/**
 * Write `count` encoded object cells (`null`, numbers or well-formed strings) as an object column at `offset`
 * (8-aligned): u8 kinds, padded to 8; f64 numbers (0 for other kinds); then a string column whose cells are empty for
 * non-strings. Allocates nothing.
 * @returns the end offset
 */
export function writeObjectCells(views: Views, offset: number, values: ArrayLike<unknown>, count: number): number {
  const u8 = views.u8;
  const numbers = offset + align8(count);
  const f64 = views.f64;
  const n = numbers >>> 3;
  for (let j = 0; j < count; j++) {
    const value = values[j];
    if (typeof value === "number") {
      u8[offset + j] = OBJECT_NUMBER;
      f64[n + j] = value;
    } else {
      u8[offset + j] = typeof value === "string" ? OBJECT_STRING : OBJECT_NULL;
      f64[n + j] = 0;
    }
  }
  zeroPad(views, offset + count, numbers);
  const strings = numbers + count * 8;
  const u32 = views.u32;
  const w = strings >>> 2;
  const heap = strings + (count + 1) * 4;
  let q = heap;
  for (let j = 0; j < count; j++) {
    u32[w + j] = q - heap;
    const value = values[j];
    if (typeof value === "string") q = writeUtf8(u8, q, value);
  }
  u32[w + count] = q - heap;
  const end = align8(q);
  zeroPad(views, q, end);
  return end;
}

/**
 * UTF-8 bytes of the strings among `count` cells (`values[slots[j]]`, or `values[j]` when `slots` is `null`);
 * non-strings count as empty.
 * @returns the byte count, or `-(j + 1)` when cell `j` holds a lone surrogate
 */
export function heapBytes(values: ArrayLike<unknown>, slots: ArrayLike<number> | null, count: number): number {
  let bytes = 0;
  for (let j = 0; j < count; j++) {
    const value = slots === null ? values[j] : values[slots[j]!];
    if (typeof value !== "string") continue;
    const length = utf8Length(value);
    if (length < 0) return -(j + 1);
    bytes += length;
  }
  return bytes;
}

/** Total string / object column bytes of an image component whose cells are known to be well-formed. */
function imageSideBytes(component: ComponentImage, codes: readonly number[] | null): number {
  if (codes === null) return 0;
  const count = component.owners.length;
  let bytes = 0;
  let s = 0;
  for (let k = 0; k < codes.length; k++) {
    const code = codes[k]!;
    if (!isSideCode(code)) continue;
    const heap = heapBytes(component.sideRows[s++]!, null, count);
    bytes += code === CODE_STRING ? stringColumnBytes(count, heap) : objectColumnBytes(count, heap);
  }
  return bytes;
}

export function windowPayloadBytes(count: number, width: number): number {
  return align8(8 + align4(count * width) + count * 8);
}

/** Bytes before the first section. */
export function prefixBytes(layoutBlock: Uint8Array): number {
  return HEADER_BYTES + layoutBlock.length;
}

/** Write the header and copy the component table; returns the offset of the first section. */
export function writeHeader(
  views: Views,
  base: number,
  totalBytes: number,
  known: KnownLayout,
  capacity: number,
): number {
  const u32 = views.u32;
  const w = base >>> 2;
  u32[w] = SAVE_MAGIC;
  u32[w + 1] = FORMAT_VERSION;
  u32[w + 2] = totalBytes;
  u32[w + 3] = capacity;
  u32[w + 4] = known.layout.components.length;
  u32[w + 5] = known.layoutBlock.length;
  u32[w + 6] = known.layoutHashLow;
  u32[w + 7] = known.layoutHashHigh;
  u32[w + 8] = SECTION_COUNT;
  u32[w + 9] = 0;
  views.u8.set(known.layoutBlock, base + HEADER_BYTES);
  return base + HEADER_BYTES + known.layoutBlock.length;
}

/** Write a section header; returns the payload offset. */
export function writeSectionHeader(views: Views, offset: number, tag: number, payloadBytes: number): number {
  views.u32[offset >>> 2] = tag | (SECTION_REQUIRED << 16);
  views.u32[(offset >>> 2) + 1] = payloadBytes;
  return offset + SECTION_HEADER_BYTES;
}

/** Zero the padding between `from` and `to`, so saves of equal state are byte-identical. */
export function zeroPad(views: Views, from: number, to: number): void {
  if (to > from) views.u8.fill(0, from, to);
}

/** Exact byte length of a save image. */
export function imageBytes(image: SaveImage): number {
  const width = slotWidth(image.capacity);
  let population = 0;
  for (let i = 0; i < image.populations.length; i++) population += image.populations[i]!.length;
  let bytes = prefixBytes(image.layoutBlock) + SECTION_COUNT * SECTION_HEADER_BYTES;
  bytes += entitiesPayloadBytes(image.capacity, image.liveGeneration.length);
  bytes += archetypesPayloadBytes(image.populations.length, image.wordsPerSet, population, width);
  for (let c = 0; c < image.components.length; c++) {
    const component = image.components[c]!;
    const codes = image.info.codes[c]!;
    const sideBytes = imageSideBytes(component, codes);
    bytes += componentPayloadBytes(component.owners.length, component.changed.length, codes, width, sideBytes);
  }
  bytes += windowPayloadBytes(image.windowSlots.length, width);
  return bytes;
}

function copySlots(views: Views, offset: number, width: number, slots: ArrayLike<number>, count: number): number {
  const target = views.slots(width);
  const start = width === 1 ? offset : offset >>> 1;
  for (let i = 0; i < count; i++) target[start + i] = slots[i]!;
  return offset + count * width;
}

/** Encode a save image into fresh bytes. */
export function writeImage(image: SaveImage): Uint8Array {
  assertLittleEndian();
  const total = imageBytes(image);
  const out = new Uint8Array(total);
  const views = new ViewCache().get(out.buffer);
  const capacity = image.capacity;
  const width = slotWidth(capacity);
  const u32 = views.u32;
  let offset = writeHeader(views, 0, total, image, capacity);

  // Entities
  const live = image.liveGeneration.length;
  let p = writeSectionHeader(views, offset, SECTION_ENTITIES, entitiesPayloadBytes(capacity, live));
  u32[p >>> 2] = image.cursor;
  u32[(p >>> 2) + 1] = live;
  u32.set(image.occupancy, (p + 8) >>> 2);
  u32.set(image.nextGeneration, (p + 8) / 4 + image.occupancy.length);
  u32.set(image.liveGeneration, (p + 8) / 4 + image.occupancy.length + capacity);
  offset = p + entitiesPayloadBytes(capacity, live);

  // Archetypes
  const count = image.populations.length;
  let population = 0;
  for (let i = 0; i < count; i++) population += image.populations[i]!.length;
  const archetypeBytes = archetypesPayloadBytes(count, image.wordsPerSet, population, width);
  p = writeSectionHeader(views, offset, SECTION_ARCHETYPES, archetypeBytes);
  u32[p >>> 2] = count;
  u32[(p >>> 2) + 1] = image.wordsPerSet;
  u32.set(image.archetypeBits, (p + 8) >>> 2);
  const counts = (p + 8) / 4 + image.archetypeBits.length;
  for (let i = 0; i < count; i++) u32[counts + i] = image.populations[i]!.length;
  let q = (counts + count) * 4;
  for (let i = 0; i < count; i++) {
    const slots = image.populations[i]!;
    q = copySlots(views, q, width, slots, slots.length);
  }
  offset = p + archetypeBytes;
  zeroPad(views, q, offset);

  // Components
  let componentBytes = 0;
  for (let c = 0; c < image.components.length; c++) {
    const component = image.components[c]!;
    const codes = image.info.codes[c]!;
    componentBytes += componentPayloadBytes(
      component.owners.length,
      component.changed.length,
      codes,
      width,
      imageSideBytes(component, codes),
    );
  }
  p = writeSectionHeader(views, offset, SECTION_COMPONENTS, componentBytes);
  for (let c = 0; c < image.components.length; c++) {
    const component = image.components[c]!;
    const owners = component.owners.length;
    u32[p >>> 2] = owners;
    u32[(p >>> 2) + 1] = component.changed.length;
    p += 8;
    let end = copySlots(views, p, width, component.owners, owners);
    zeroPad(views, end, p = align8(end));
    end = copySlots(views, p, width, component.changed, component.changed.length);
    zeroPad(views, end, p = align8(end));
    const codes = image.info.codes[c]!;
    if (codes === null) continue;
    let t = 0;
    let s = 0;
    for (let k = 0; k < codes.length; k++) {
      const code = codes[k]!;
      if (code === CODE_STRING) {
        p = writeStringCells(views, p, component.sideRows[s++]!, null, owners);
        continue;
      }
      if (code === CODE_OBJECT) {
        p = writeObjectCells(views, p, component.sideRows[s++]!, owners);
        continue;
      }
      const bytes = FIELD_TYPE_BYTES[code]!;
      // Copy bytes, not numbers, so NaN payloads survive exactly.
      const source = component.rows[t++]!;
      views.u8.set(new Uint8Array(source.buffer, source.byteOffset, owners * bytes), p);
      end = p + owners * bytes;
      zeroPad(views, end, p = align8(end));
    }
  }
  offset = p;

  // Window
  const touched = image.windowSlots.length;
  p = writeSectionHeader(views, offset, SECTION_WINDOW, windowPayloadBytes(touched, width));
  u32[p >>> 2] = touched;
  u32[(p >>> 2) + 1] = 0;
  const end = copySlots(views, p + 8, width, image.windowSlots, touched);
  const origins = align4(end);
  zeroPad(views, end, origins);
  u32.set(image.windowOrigins, origins >>> 2);
  u32.set(image.windowHandles, (origins >>> 2) + touched);
  return out;
}

// Holds views over the most recently parsed buffer, so repeated loads of one save allocate no views. It keeps that
// one buffer reachable until another save is parsed.
const readViews = new ViewCache();

function fail(message: string): never {
  throw new WorldSaveError(message);
}

/**
 * Parse and bounds-check a save. Every count, offset and section length is checked against the bytes before any
 * view is created; semantic consistency is left to {@link validateImage}.
 * @param input - Save bytes; trailing bytes past the recorded length are ignored
 * @param known - A layout to reuse when the save's component table matches it byte for byte
 */
export function parseSave(input: Uint8Array, known?: KnownLayout): ParsedSave {
  assertLittleEndian();
  if (!(input instanceof Uint8Array)) throw new TypeError("World save must be a Uint8Array.");
  if (input.byteLength < 4) fail("World save is truncated.");
  // Views need 8-byte alignment; copy a misaligned slice once.
  let bytes = (input.byteOffset & 7) === 0 ? input : input.slice();
  const views = readViews.get(bytes.buffer);
  const base = bytes.byteOffset;
  const u32 = views.u32;
  const w = base >>> 2;
  if (u32[w] !== SAVE_MAGIC) fail("Not a Miski world save (bad magic).");
  if (bytes.byteLength < HEADER_BYTES) fail("World save is truncated.");
  const version = u32[w + 1]! & 0xffff;
  const flags = u32[w + 1]! >>> 16;
  if (version !== FORMAT_VERSION) fail(`Unsupported world save format version ${version}.`);
  if (flags !== 0) fail(`Unsupported world save flags ${flags}.`);
  const total = u32[w + 2]!;
  if (total > bytes.byteLength) fail("World save is truncated.");
  if (total < HEADER_BYTES || (total & 7) !== 0) fail("World save length is corrupt.");
  const capacity = u32[w + 3]!;
  if (capacity < 8 || capacity > 0x1_0000) fail(`World save capacity ${capacity} is out of range.`);
  const componentCount = u32[w + 4]!;
  const layoutBytes = u32[w + 5]!;
  if (componentCount === 0 || componentCount > 0xffff) fail("World save component count is corrupt.");
  if ((layoutBytes & 7) !== 0 || HEADER_BYTES + layoutBytes > total) fail("World save layout length is corrupt.");
  if (u32[w + 9] !== 0) fail("World save header is corrupt.");
  if (total < bytes.byteLength) bytes = bytes.subarray(0, total);

  const block = bytes.subarray(HEADER_BYTES, HEADER_BYTES + layoutBytes);
  const hashLow = u32[w + 6]!;
  const hashHigh = u32[w + 7]!;
  let layout: WorldSaveLayout;
  let info: LayoutInfo;
  let layoutBlock: Uint8Array;
  if (
    known !== undefined && known.layout.capacity === capacity && known.layout.components.length === componentCount &&
    bytesEqual(block, known.layoutBlock)
  ) {
    if (hashLow !== known.layoutHashLow || hashHigh !== known.layoutHashHigh) {
      fail("World save layout hash is corrupt.");
    }
    layout = known.layout;
    info = known.info;
    layoutBlock = known.layoutBlock;
  } else {
    const [low, high] = hashBytes64(block);
    if (hashLow !== low || hashHigh !== high) fail("World save layout hash is corrupt.");
    layout = decodeLayout(block, capacity, componentCount);
    info = layoutInfo(layout);
    layoutBlock = block.slice();
  }

  const width = slotWidth(capacity);
  const slots = views.slots(width);
  const slotView = (offset: number, count: number): EntityArray => {
    const start = width === 1 ? offset : offset >>> 1;
    return slots.subarray(start, start + count);
  };
  const words = wordCount(capacity);
  const wordsPerSet = wordCount(componentCount);

  let entities: Pick<SaveImage, "cursor" | "occupancy" | "nextGeneration" | "liveGeneration"> | undefined;
  let archetypes: Pick<SaveImage, "wordsPerSet" | "archetypeBits" | "populations"> | undefined;
  let components: ComponentImage[] | undefined;
  let window: Pick<SaveImage, "windowSlots" | "windowOrigins" | "windowHandles"> | undefined;

  const sectionCount = u32[w + 8]!;
  let offset = HEADER_BYTES + layoutBytes;
  for (let s = 0; s < sectionCount; s++) {
    if (offset + SECTION_HEADER_BYTES > total) fail("World save section table is truncated.");
    const head = u32[(base + offset) >>> 2]!;
    const tag = head & 0xffff;
    const sectionFlags = head >>> 16;
    const payload = u32[((base + offset) >>> 2) + 1]!;
    const start = offset + SECTION_HEADER_BYTES;
    if ((payload & 7) !== 0 || payload > total - start) fail(`World save section ${tag} length is corrupt.`);
    const p = base + start;
    const pw = p >>> 2;
    const end = start + payload;
    const expect = (bytesNeeded: number): void => {
      if (bytesNeeded !== payload) fail(`World save section ${tag} length does not match its contents.`);
    };
    const within = (bytesNeeded: number): void => {
      if (bytesNeeded > payload) fail(`World save section ${tag} is truncated.`);
    };
    switch (tag) {
      case SECTION_ENTITIES: {
        if (entities !== undefined) fail("World save repeats its entity section.");
        within(8);
        const cursor = u32[pw]!;
        const live = u32[pw + 1]!;
        if (live > capacity) fail("World save live entity count exceeds capacity.");
        expect(8 + words * 4 + capacity * 4 + live * 4 + ((8 + words * 4 + capacity * 4 + live * 4) & 4));
        entities = {
          cursor,
          occupancy: u32.subarray(pw + 2, pw + 2 + words),
          nextGeneration: u32.subarray(pw + 2 + words, pw + 2 + words + capacity),
          liveGeneration: u32.subarray(pw + 2 + words + capacity, pw + 2 + words + capacity + live),
        };
        break;
      }
      case SECTION_ARCHETYPES: {
        if (archetypes !== undefined) fail("World save repeats its archetype section.");
        within(8);
        const count = u32[pw]!;
        const savedWords = u32[pw + 1]!;
        if (savedWords !== wordsPerSet) fail("World save archetype bitset width is corrupt.");
        if (count === 0 || count > (payload - 8) / (wordsPerSet * 4 + 4)) {
          fail("World save archetype count is corrupt.");
        }
        const bitsEnd = pw + 2 + count * wordsPerSet;
        let population = 0;
        for (let i = 0; i < count; i++) {
          const length = u32[bitsEnd + i]!;
          if (length > capacity) fail("World save archetype population exceeds capacity.");
          population += length;
        }
        if (population > capacity) fail("World save archetype populations exceed capacity.");
        expect(archetypesPayloadBytes(count, wordsPerSet, population, width));
        const populations: EntityArray[] = new Array(count);
        let q = (bitsEnd + count) * 4;
        for (let i = 0; i < count; i++) {
          const length = u32[bitsEnd + i]!;
          populations[i] = slotView(q, length);
          q += length * width;
        }
        archetypes = { wordsPerSet, archetypeBits: u32.subarray(pw + 2, bitsEnd), populations };
        break;
      }
      case SECTION_COMPONENTS: {
        if (components !== undefined) fail("World save repeats its component section.");
        const list: ComponentImage[] = new Array(componentCount);
        let q = p;
        const limit = p + payload;
        for (let c = 0; c < componentCount; c++) {
          if (q + 8 > limit) fail("World save component section is truncated.");
          const owners = u32[q >>> 2]!;
          const changed = u32[(q >>> 2) + 1]!;
          if (owners > capacity || changed > owners) fail(`World save component ${c} counts are corrupt.`);
          const codes = info.codes[c]!;
          // A lower bound: string / object columns are checked as they are read.
          if (q + componentPayloadBytes(owners, changed, codes, width, 0) > limit) {
            fail("World save component section is truncated.");
          }
          q += 8;
          const ownerSlots = slotView(q, owners);
          q = align8(q + owners * width);
          const changedSlots = slotView(q, changed);
          q = align8(q + changed * width);
          const rows: TypedArray[] = [];
          let sideRows = NO_SIDE_ROWS;
          if (codes !== null) {
            for (let k = 0; k < codes.length; k++) {
              const code = codes[k]!;
              if (isSideCode(code)) {
                if (sideRows === NO_SIDE_ROWS) sideRows = [];
                const cells = new Array<unknown>(owners);
                q = code === CODE_STRING ?
                  readStringCells(views, q, owners, limit, cells, null, c) :
                  readObjectCells(views, q, owners, limit, cells, c);
                (sideRows as unknown[][]).push(cells);
                continue;
              }
              const bytesPer = FIELD_TYPE_BYTES[code]!;
              if (q + owners * bytesPer > limit) fail("World save component section is truncated.");
              const view = views.column(code);
              const index = q / bytesPer;
              rows.push(view.subarray(index, index + owners));
              q = align8(q + owners * bytesPer);
            }
          }
          list[c] = { owners: ownerSlots, changed: changedSlots, rows, sideRows };
        }
        if (q !== limit) fail("World save component section length does not match its contents.");
        components = list;
        break;
      }
      case SECTION_WINDOW: {
        if (window !== undefined) fail("World save repeats its window section.");
        within(8);
        const touched = u32[pw]!;
        if (touched > capacity || u32[pw + 1] !== 0) fail("World save window is corrupt.");
        expect(windowPayloadBytes(touched, width));
        const origins = align4(p + 8 + touched * width) >>> 2;
        window = {
          windowSlots: slotView(p + 8, touched),
          windowOrigins: u32.subarray(origins, origins + touched),
          windowHandles: u32.subarray(origins + touched, origins + touched * 2),
        };
        break;
      }
      default: {
        if ((sectionFlags & SECTION_REQUIRED) !== 0) {
          fail(`World save requires an unsupported feature (section ${tag}).`);
        }
      }
    }
    offset = end;
  }
  if (offset !== total) fail("World save length does not match its sections.");
  if (entities === undefined || archetypes === undefined || components === undefined || window === undefined) {
    fail("World save is missing a required section.");
  }
  const image: SaveImage = {
    capacity,
    layout,
    layoutBlock,
    info,
    layoutHashLow: hashLow,
    layoutHashHigh: hashHigh,
    ...entities,
    ...archetypes,
    components,
    ...window,
  };
  return { image, bytes };
}

/**
 * Read a string column of `count` cells at `offset` into `out`, bounds-checking against `limit`. When `kinds` is
 * given, only cells of kind {@link OBJECT_STRING} hold strings and every other cell must be empty.
 * @returns the end offset
 */
function readStringCells(
  views: Views,
  offset: number,
  count: number,
  limit: number,
  out: unknown[],
  kinds: Uint8Array | null,
  component: number,
): number {
  const heap = offset + (count + 1) * 4;
  if (heap > limit) fail("World save component section is truncated.");
  const u32 = views.u32;
  const w = offset >>> 2;
  const heapLength = u32[w + count]!;
  if (u32[w] !== 0 || heapLength > limit - heap || align8(heap + heapLength) > limit) {
    fail(`World save component ${component} string column is corrupt.`);
  }
  const u8 = views.u8;
  for (let j = 0; j < count; j++) {
    const start = u32[w + j]!;
    const end = u32[w + j + 1]!;
    if (end < start || end > heapLength) fail(`World save component ${component} string column is corrupt.`);
    if (kinds !== null && kinds[j] !== OBJECT_STRING) {
      if (end !== start) fail(`World save component ${component} object column is corrupt.`);
      continue;
    }
    if (start === end) {
      out[j] = "";
      continue;
    }
    try {
      out[j] = utf8Decoder.decode(u8.subarray(heap + start, heap + end));
    } catch (cause) {
      throw new WorldSaveError(`World save component ${component} holds an invalid UTF-8 string.`, { cause });
    }
  }
  return align8(heap + heapLength);
}

/**
 * Read an object column of `count` encoded cells at `offset` into `out`, bounds-checking against `limit`.
 * @returns the end offset
 */
function readObjectCells(
  views: Views,
  offset: number,
  count: number,
  limit: number,
  out: unknown[],
  component: number,
): number {
  const numbers = offset + align8(count);
  const strings = numbers + count * 8;
  if (strings > limit) fail("World save component section is truncated.");
  const kinds = views.u8.subarray(offset, offset + count);
  const f64 = views.f64;
  const n = numbers >>> 3;
  for (let j = 0; j < count; j++) {
    const kind = kinds[j]!;
    if (kind === OBJECT_NUMBER) out[j] = f64[n + j]!;
    else if (kind === OBJECT_NULL) out[j] = null;
    else if (kind !== OBJECT_STRING) fail(`World save component ${component} object column is corrupt.`);
  }
  return readStringCells(views, strings, count, limit, out, kinds, component);
}

/** Reusable per-capacity scratch for {@link validateImage}. */
export class ValidationScratch {
  readonly archetypeOf: Int32Array;
  readonly marks: Uint32Array;
  readonly changedMarks: Uint32Array;
  epoch = 0;

  constructor(capacity: number) {
    this.archetypeOf = new Int32Array(capacity);
    this.marks = new Uint32Array(capacity);
    this.changedMarks = new Uint32Array(capacity);
  }

  next(): number {
    if (this.epoch === 0xffffffff) {
      this.marks.fill(0);
      this.changedMarks.fill(0);
      this.epoch = 0;
    }
    return ++this.epoch;
  }
}

function bitSet(bits: Uint32Array, offset: number, index: number): boolean {
  return ((bits[offset + (index >>> 5)]! >>> (index & 31)) & 1) === 1;
}

/**
 * Check that an image describes a world the managers can hold: every live slot sits in exactly one archetype,
 * ownership matches archetype membership, caps hold, changed lists are subsets of owners, and the window refers to
 * real archetypes and slots.
 * @param knownPrefix - Leading archetypes already known to be distinct (they match a live registry)
 */
export function validateImage(image: SaveImage, scratch: ValidationScratch, knownPrefix: number): void {
  const capacity = image.capacity;
  const occupancy = image.occupancy;
  const tail = capacity & 31;
  if (tail !== 0 && (occupancy[occupancy.length - 1]! >>> tail) !== 0) fail("World save marks slots past capacity.");
  let live = 0;
  for (let i = 0; i < occupancy.length; i++) {
    let bits = occupancy[i]!;
    while (bits !== 0) {
      bits &= bits - 1;
      live++;
    }
  }
  if (live !== image.liveGeneration.length) fail("World save live entity count does not match occupancy.");
  // A live slot's next generation must differ from its current one, or destroying and re-creating it would
  // reissue the live handle.
  let k = 0;
  for (let word = 0; word < occupancy.length; word++) {
    let bits = occupancy[word]!;
    while (bits !== 0) {
      const slot = (word << 5) + (31 - Math.clz32(bits & -bits));
      // Handles keep only the masked generation bits, so compare those.
      if (((image.liveGeneration[k++]! ^ image.nextGeneration[slot]!) & ENTITY_GEN_MASK) === 0) {
        fail(`World save slot ${slot} would reissue its handle.`);
      }
      bits &= bits - 1;
    }
  }
  if (image.cursor >= capacity) fail("World save allocation cursor is out of range.");

  const componentCount = image.layout.components.length;
  const wordsPerSet = image.wordsPerSet;
  const bits = image.archetypeBits;
  const count = image.populations.length;
  const extra = componentCount & 31;
  for (let i = 0; i < count; i++) {
    const offset = i * wordsPerSet;
    if (extra !== 0 && (bits[offset + wordsPerSet - 1]! >>> extra) !== 0) {
      fail(`World save archetype ${i} names an unknown component.`);
    }
    if (i === 0) {
      for (let k = 0; k < wordsPerSet; k++) if (bits[k] !== 0) fail("World save root archetype is not empty.");
      continue;
    }
    if (i < knownPrefix) continue;
    for (let j = 0; j < i; j++) {
      let same = true;
      for (let k = 0; k < wordsPerSet; k++) {
        if (bits[offset + k] !== bits[j * wordsPerSet + k]) {
          same = false;
          break;
        }
      }
      if (same) fail(`World save archetypes ${j} and ${i} are identical.`);
    }
  }

  const archetypeOf = scratch.archetypeOf;
  archetypeOf.fill(-1);
  let population = 0;
  for (let i = 0; i < count; i++) {
    const slots = image.populations[i]!;
    for (let p = 0; p < slots.length; p++) {
      const slot = slots[p]!;
      if (slot >= capacity || ((occupancy[slot >>> 5]! >>> (slot & 31)) & 1) === 0) {
        fail(`World save archetype ${i} holds a slot that is not live.`);
      }
      if (archetypeOf[slot] !== -1) fail(`World save places slot ${slot} in two archetypes.`);
      archetypeOf[slot] = i;
    }
    population += slots.length;
  }
  if (population !== live) fail("World save leaves live slots outside every archetype.");

  const marks = scratch.marks;
  const changedMarks = scratch.changedMarks;
  for (let c = 0; c < componentCount; c++) {
    const component = image.components[c]!;
    const owners = component.owners;
    const cap = image.info.caps[c]!;
    if (cap !== 0 && owners.length > cap) fail(`World save component ${c} exceeds its owner cap.`);
    let expected = 0;
    for (let i = 0; i < count; i++) if (bitSet(bits, i * wordsPerSet, c)) expected += image.populations[i]!.length;
    if (expected !== owners.length) fail(`World save component ${c} owners do not match archetype membership.`);
    const epoch = scratch.next();
    for (let j = 0; j < owners.length; j++) {
      const slot = owners[j]!;
      const archetype = slot < capacity ? archetypeOf[slot]! : -1;
      if (archetype === -1 || !bitSet(bits, archetype * wordsPerSet, c)) {
        fail(`World save component ${c} lists a slot outside its archetypes.`);
      }
      if (marks[slot] === epoch) fail(`World save component ${c} lists slot ${slot} twice.`);
      marks[slot] = epoch;
    }
    const changed = component.changed;
    if (image.info.codes[c] === null && changed.length !== 0) fail(`World save tag component ${c} lists changes.`);
    for (let j = 0; j < changed.length; j++) {
      const slot = changed[j]!;
      if (slot >= capacity || marks[slot] !== epoch) fail(`World save component ${c} marks a non-owner changed.`);
      if (changedMarks[slot] === epoch) fail(`World save component ${c} marks slot ${slot} changed twice.`);
      changedMarks[slot] = epoch;
    }
    const limits = image.info.limits[c];
    if (limits !== null && limits !== undefined) {
      for (let r = 0; r < limits.length; r++) {
        const limit = limits[r]!;
        if (limit === 0) continue;
        const row = component.rows[r]!;
        for (let j = 0; j < row.length; j++) {
          const value = row[j]!;
          if (
            limit === ENTITY_REF_LIMIT ? value !== -1 && (value < 0 || entityIndex(value) >= capacity) : value >= limit
          ) {
            fail(`World save component ${c} holds a field value outside its type.`);
          }
        }
      }
    }
  }

  const epoch = scratch.next();
  const slots = image.windowSlots;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (slot >= capacity || marks[slot] === epoch) fail("World save window lists a slot twice or out of range.");
    marks[slot] = epoch;
    const origin = image.windowOrigins[i]!;
    const handle = image.windowHandles[i]!;
    if (origin > count) fail("World save window refers to an unknown archetype.");
    if (origin === 0 ? handle !== 0 : handle > 0x7fffffff || entityIndex(handle) !== slot) {
      fail("World save window holds an invalid handle.");
    }
  }
}
