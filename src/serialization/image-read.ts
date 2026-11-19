import { MIN_WORLD_CAPACITY } from "@/constants.ts";
import type { ComponentStateSnapshot } from "@/component/component-snapshot.ts";
import { type EntityArray, MAX_WORLD_CAPACITY } from "@/entity/entity.ts";
import type { TypedArray } from "@/types/partitions.ts";
import {
  align4,
  align8,
  archetypesPayloadBytes,
  assertLittleEndian,
  bytesEqual,
  CODE_STRING,
  componentPayloadBytes,
  fail,
  FIELD_TYPE_BYTES,
  FORMAT_VERSION,
  hashBytes64,
  HEADER_BYTES,
  isSideCode,
  OBJECT_NULL,
  OBJECT_NUMBER,
  OBJECT_STRING,
  SAVE_MAGIC,
  SECTION_ARCHETYPES,
  SECTION_COMPONENTS,
  SECTION_ENTITIES,
  SECTION_HEADER_BYTES,
  SECTION_RELATIONS,
  SECTION_REQUIRED,
  SECTION_WINDOW,
  slotWidth,
  utf8Decoder,
  ViewCache,
  type Views,
  windowPayloadBytes,
  wordCount,
  WorldSaveError,
} from "./format.ts";
import { type KnownLayout, NO_SIDE_ROWS, type ParsedSave, type RelationImage, type SaveImage } from "./image-types.ts";
import { decodeLayout, type LayoutInfo, layoutInfo, type RelationInfo, type WorldSaveLayout } from "./layout.ts";

// Holds views over the most recently parsed buffer, so repeated loads of one save allocate no views. It keeps that
// one buffer reachable until another save is parsed.
const readViews = new ViewCache();

/**
 * Parse and bounds-check a save. Every count, offset and section length is checked against the bytes before any
 * view is created; semantic consistency is left to {@link validateImage}.
 * @param input - Save bytes; trailing bytes past the recorded length are ignored
 * @param known - A layout to reuse when the save's component table matches it byte for byte
 */
export function parseSave(input: Uint8Array, known?: KnownLayout): ParsedSave {
  assertLittleEndian();
  if (!(input instanceof Uint8Array)) fail("World save must be a Uint8Array.");
  if (input.byteLength < 4) fail("World save is truncated.");
  // Views need 8-byte alignment; copy a misaligned input once. `new Uint8Array` always copies, where a subclass's
  // `slice` may not (Node's `Buffer#slice` returns a view).
  let bytes = (input.byteOffset & 7) === 0 ? input : new Uint8Array(input);
  const views = readViews.get(bytes.buffer);
  const base = bytes.byteOffset;
  const u32 = views.u32;
  const w = base >>> 2;
  if (u32[w] !== SAVE_MAGIC) fail("Not a Miski world save (bad magic).");
  if (bytes.byteLength < HEADER_BYTES) fail("World save is truncated.");
  const version = u32[w + 1]! & 0xffff;
  const flags = u32[w + 1]! >>> 16;
  if (version !== FORMAT_VERSION) {
    fail(`World save format version ${version} is not supported (this version reads ${FORMAT_VERSION}).`);
  }
  if (flags !== 0) fail(`Unsupported world save flags ${flags}.`);
  const total = u32[w + 2]!;
  if (total > bytes.byteLength) fail("World save is truncated.");
  if (total < HEADER_BYTES || (total & 7) !== 0) fail("World save length is corrupt.");
  const capacity = u32[w + 3]!;
  if (capacity < MIN_WORLD_CAPACITY || capacity > MAX_WORLD_CAPACITY) {
    fail(`World save capacity ${capacity} is out of range.`);
  }
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
    layoutBlock = new Uint8Array(block); // a copy, even when `block` is a Buffer view
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
  let components: ComponentStateSnapshot[] | undefined;
  let window: Pick<SaveImage, "windowSlots" | "windowOrigins" | "windowHandles"> | undefined;
  let relations: RelationImage[] | undefined;

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
        const list: ComponentStateSnapshot[] = new Array(componentCount);
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
      case SECTION_RELATIONS: {
        if (relations !== undefined) fail("World save repeats its relation section.");
        if (info.relations.length === 0) fail("World save holds relations its layout does not declare.");
        relations = readRelations(views, p, p + payload, info.relations);
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
  if (relations === undefined && info.relations.length === 0) relations = [];
  if (
    entities === undefined || archetypes === undefined || components === undefined || window === undefined ||
    relations === undefined
  ) {
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
    relations,
  };
  return { image, bytes };
}

/** Bounds-check and view the relation section, one entry per layout relation. */
function readRelations(views: Views, start: number, limit: number, infos: readonly RelationInfo[]): RelationImage[] {
  const u32 = views.u32;
  const out: RelationImage[] = new Array(infos.length);
  let q = start;
  for (let r = 0; r < infos.length; r++) {
    const info = infos[r]!;
    if (q + 24 > limit) fail("World save relation section is truncated.");
    let w = q >>> 2;
    const highWater = u32[w]!;
    const free = u32[w + 1]!;
    const sources = u32[w + 2]!;
    const pairs = u32[w + 3]!;
    const targets = u32[w + 4]!;
    const changed = u32[w + 5]!;
    const bytes = untrustedRelationBytes(free, sources, pairs, targets, changed, info.codes);
    if (bytes > limit - q) fail("World save relation section is truncated.");
    w += 6;
    const take = (count: number): Uint32Array => u32.subarray(w, w += count);
    const freeRows = take(free);
    const sourceSlots = take(sources);
    const sourceCounts = take(sources);
    const rows = take(pairs);
    const pairTargets = take(pairs);
    const targetSlots = take(targets);
    const sourcesByTarget = take(pairs);
    const changedSlots = take(changed);
    let p = align8(w << 2);
    const data: TypedArray[] = new Array(info.codes.length);
    for (let c = 0; c < info.codes.length; c++) {
      const code = info.codes[c]!;
      const index = p / FIELD_TYPE_BYTES[code]!;
      data[c] = views.column(code).subarray(index, index + pairs);
      p = align8(p + pairs * FIELD_TYPE_BYTES[code]!);
    }
    out[r] = {
      highWater,
      freeRows,
      sources: sourceSlots,
      sourceCounts,
      rows,
      targets: pairTargets,
      data,
      targetSlots,
      sourcesByTarget,
      changed: changedSlots,
    };
    q += bytes;
  }
  if (q !== limit) fail("World save relation section length does not match its contents.");
  return out;
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

/** {@link relationPayloadBytes} for untrusted u32 counts: float math, so huge counts cannot wrap to a small size. */
function untrustedRelationBytes(
  free: number,
  sources: number,
  pairs: number,
  targets: number,
  changed: number,
  codes: readonly number[],
): number {
  let bytes = 24 + Math.ceil((free + sources * 2 + pairs * 3 + targets + changed) / 2) * 8;
  for (let c = 0; c < codes.length; c++) bytes += Math.ceil((pairs * FIELD_TYPE_BYTES[codes[c]!]!) / 8) * 8;
  return bytes;
}
