import { createSlotArray, type EntityArray } from "@/entity/entity.ts";
import type { TypedArray, TypedArrayConstructor } from "@/types/partitions.ts";
import {
  align4,
  align8,
  assertLittleEndian,
  bytesEqual,
  DELTA_MAGIC,
  FIELD_TYPE_CONSTRUCTORS,
  FORMAT_VERSION,
  hashWords,
  slotWidth,
  wordCount,
  WorldSaveError,
} from "./format.ts";
import { type ComponentImage, type ParsedSave, parseSave, type SaveImage, writeImage } from "./image.ts";

/**
 * Delta header (48 bytes, u32 words):
 * 0 magic | 1 version (u16) + flags (u16) | 2 totalBytes | 3 baseBytes | 4 baseHash | 5 nextBytes | 6 nextHash
 * 7 layoutHash low | 8 layoutHash high | 9 next cursor | 10 next archetype count | 11 record count
 *
 * Then one record per changed chunk, in ascending chunk order:
 * u32 chunk | u32 op | u32 next byte length | u32 run count, followed by
 * - op REPLACE: the chunk's bytes, padded to 4;
 * - op PATCH: per run u32 offset | u32 length | bytes padded to 4 (the chunk keeps the base length).
 *
 * A chunk is one array of the save: occupancy, generations, bitsets, the window arrays, each component's owner,
 * changed and value arrays, then each archetype's population. Diffing arrays rather than raw bytes keeps a change
 * in one array from shifting every later byte.
 */
const DELTA_HEADER_BYTES = 48;
const RECORD_BYTES = 16;
const OP_PATCH = 1;
const OP_REPLACE = 2;
/** Unchanged bytes shorter than this between two runs are folded into one run (a run header costs 8 bytes). */
const RUN_GAP = 8;
const MAX_ARCHETYPES = 1 << 20;

/** Chunks of an image in delta order: fixed chunks, per-component chunks, then populations. */
function chunksOf(image: SaveImage): TypedArray[] {
  const chunks: TypedArray[] = [
    image.occupancy,
    image.nextGeneration,
    image.liveGeneration,
    image.archetypeBits,
    image.windowSlots,
    image.windowOrigins,
    image.windowHandles,
  ];
  for (const component of image.components) {
    chunks.push(component.owners, component.changed);
    for (const row of component.rows) chunks.push(row);
  }
  for (const population of image.populations) chunks.push(population);
  return chunks;
}

/** Number of chunks before the populations. */
function fixedChunkCount(image: SaveImage): number {
  let count = 7;
  for (const codes of image.info.codes) count += 2 + (codes === null ? 0 : codes.length);
  return count;
}

/** Element constructor of every fixed chunk. */
function fixedChunkTypes(image: SaveImage): TypedArrayConstructor[] {
  const slots = (slotWidth(image.capacity) === 1 ? Uint8Array : Uint16Array) as TypedArrayConstructor;
  const types: TypedArrayConstructor[] = [
    Uint32Array,
    Uint32Array,
    Uint32Array,
    Uint32Array,
    slots,
    Uint32Array,
    Uint32Array,
  ];
  for (const codes of image.info.codes) {
    types.push(slots, slots);
    if (codes !== null) { for (const code of codes) types.push(FIELD_TYPE_CONSTRUCTORS[code]!); }
  }
  return types;
}

function saveHash(parsed: ParsedSave): number {
  const bytes = parsed.bytes;
  return hashWords(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >>> 2), 0, bytes.byteLength >>> 2);
}

function bytesOf(array: TypedArray): Uint8Array {
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

type DeltaRecord = {
  readonly chunk: number;
  readonly op: number;
  readonly length: number;
  /** PATCH: flat [offset, length] pairs. */
  readonly runs: readonly number[];
};

/**
 * Encode the difference between two saves of one layout. {@link applyWorldDelta} rebuilds `next` byte for byte from
 * `base` and the delta. The delta is bound to `base`: applying it to any other save throws.
 * @param base - The save the receiver already has
 * @param next - The save to transmit
 * @throws {WorldSaveError} When either save is malformed or their layouts differ
 */
export function createWorldDelta(base: Uint8Array, next: Uint8Array): Uint8Array {
  assertLittleEndian();
  const a = parseSave(base);
  const b = parseSave(next);
  if (a.image.capacity !== b.image.capacity || !bytesEqual(a.image.layoutBlock, b.image.layoutBlock)) {
    throw new WorldSaveError("Saves have different layouts; a delta needs both saves to share one layout.");
  }
  const from = chunksOf(a.image);
  const to = chunksOf(b.image);
  const records: DeltaRecord[] = [];
  let total = DELTA_HEADER_BYTES;
  for (let i = 0; i < to.length; i++) {
    const target = to[i]!;
    const source = i < from.length ? from[i] : undefined;
    const length = target.byteLength;
    const sourceLength = source === undefined ? 0 : source.byteLength;
    if (length !== sourceLength) {
      records.push({ chunk: i, op: OP_REPLACE, length, runs: [] });
      total += RECORD_BYTES + align4(length);
      continue;
    }
    if (length === 0) continue;
    const x = bytesOf(source!);
    const y = bytesOf(target);
    const runs: number[] = [];
    let patchBytes = 0;
    let j = 0;
    while (j < length) {
      if (x[j] === y[j]) {
        j++;
        continue;
      }
      const start = j;
      let end = j + 1;
      for (let k = end; k < length && k - end < RUN_GAP; k++) {
        if (x[k] !== y[k]) end = k + 1;
      }
      runs.push(start, end - start);
      patchBytes += 8 + align4(end - start);
      j = end;
    }
    if (runs.length === 0) continue;
    if (patchBytes < align4(length)) {
      records.push({ chunk: i, op: OP_PATCH, length, runs });
      total += RECORD_BYTES + patchBytes;
    } else {
      records.push({ chunk: i, op: OP_REPLACE, length, runs: [] });
      total += RECORD_BYTES + align4(length);
    }
  }
  total = align8(total);

  const out = new Uint8Array(total);
  const u32 = new Uint32Array(out.buffer);
  u32[0] = DELTA_MAGIC;
  u32[1] = FORMAT_VERSION;
  u32[2] = total;
  u32[3] = a.bytes.byteLength;
  u32[4] = saveHash(a);
  u32[5] = b.bytes.byteLength;
  u32[6] = saveHash(b);
  u32[7] = a.image.layoutHashLow;
  u32[8] = a.image.layoutHashHigh;
  u32[9] = b.image.cursor;
  u32[10] = b.image.populations.length;
  u32[11] = records.length;
  let offset = DELTA_HEADER_BYTES;
  for (const record of records) {
    const target = bytesOf(to[record.chunk]!);
    u32[offset >>> 2] = record.chunk;
    u32[(offset >>> 2) + 1] = record.op;
    u32[(offset >>> 2) + 2] = record.length;
    u32[(offset >>> 2) + 3] = record.runs.length >>> 1;
    offset += RECORD_BYTES;
    if (record.op === OP_REPLACE) {
      out.set(target, offset);
      offset += align4(record.length);
      continue;
    }
    for (let r = 0; r < record.runs.length; r += 2) {
      const start = record.runs[r]!;
      const length = record.runs[r + 1]!;
      u32[offset >>> 2] = start;
      u32[(offset >>> 2) + 1] = length;
      out.set(target.subarray(start, start + length), offset + 8);
      offset += 8 + align4(length);
    }
  }
  return out;
}

function fail(message: string): never {
  throw new WorldSaveError(message);
}

const EMPTY_U8 = new Uint8Array(0);

/**
 * Rebuild the next save from a base save and a delta made by {@link createWorldDelta}.
 * @returns The next save, byte-identical to the one the delta was made from
 * @throws {WorldSaveError} When the delta is malformed, belongs to another base, or does not reproduce its target
 */
export function applyWorldDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  assertLittleEndian();
  if (!(delta instanceof Uint8Array)) throw new TypeError("World delta must be a Uint8Array.");
  const d = (delta.byteOffset & 3) === 0 ? delta : delta.slice();
  if (d.byteLength < DELTA_HEADER_BYTES) fail("World delta is truncated.");
  const head = new Uint32Array(d.buffer, d.byteOffset, d.byteLength >>> 2);
  if (head[0] !== DELTA_MAGIC) fail("Not a Miski world delta (bad magic).");
  if ((head[1]! & 0xffff) !== FORMAT_VERSION || head[1]! >>> 16 !== 0) {
    fail(`Unsupported world delta format version ${head[1]! & 0xffff}.`);
  }
  const total = head[2]!;
  if (total > d.byteLength || total < DELTA_HEADER_BYTES || (total & 7) !== 0) fail("World delta length is corrupt.");

  const parsed = parseSave(base);
  const image = parsed.image;
  if (head[7] !== image.layoutHashLow || head[8] !== image.layoutHashHigh) {
    fail("World delta was made for a different layout than this base save.");
  }
  if (head[3] !== parsed.bytes.byteLength || head[4] !== saveHash(parsed)) {
    fail("World delta does not apply to this base save.");
  }
  const cursor = head[9]!;
  const archetypeCount = head[10]!;
  const recordCount = head[11]!;
  if (archetypeCount === 0 || archetypeCount > MAX_ARCHETYPES) fail("World delta archetype count is corrupt.");

  const from = chunksOf(image);
  const fixed = fixedChunkCount(image);
  const types = fixedChunkTypes(image);
  const slotType = (slotWidth(image.capacity) === 1 ? Uint8Array : Uint16Array) as TypedArrayConstructor;
  const chunkCount = fixed + archetypeCount;
  const chunks: TypedArray[] = new Array(chunkCount);
  for (let i = 0; i < chunkCount; i++) {
    chunks[i] = i < from.length ? from[i]! : (createSlotArray(image.capacity, 0) as TypedArray);
  }

  const bytes = new Uint8Array(d.buffer, d.byteOffset, total);
  let offset = DELTA_HEADER_BYTES;
  let previous = -1;
  for (let r = 0; r < recordCount; r++) {
    if (offset + RECORD_BYTES > total) fail("World delta is truncated.");
    const w = offset >>> 2;
    const chunk = head[w]!;
    const op = head[w + 1]!;
    const length = head[w + 2]!;
    const runCount = head[w + 3]!;
    offset += RECORD_BYTES;
    if (chunk <= previous || chunk >= chunkCount) fail("World delta chunk order is corrupt.");
    previous = chunk;
    const type = chunk < fixed ? types[chunk]! : slotType;
    if (length % type.BYTES_PER_ELEMENT !== 0) fail("World delta chunk length is corrupt.");
    const current = chunks[chunk]!;
    const storage = new ArrayBuffer(align8(length));
    const target = new Uint8Array(storage, 0, length);
    if (op === OP_REPLACE) {
      if (runCount !== 0 || offset + align4(length) > total) fail("World delta is truncated.");
      target.set(bytes.subarray(offset, offset + length));
      offset += align4(length);
    } else if (op === OP_PATCH) {
      if (length !== current.byteLength) fail("World delta patches a chunk of the wrong length.");
      target.set(current.byteLength === 0 ? EMPTY_U8 : bytesOf(current));
      for (let run = 0; run < runCount; run++) {
        if (offset + 8 > total) fail("World delta is truncated.");
        const start = head[offset >>> 2]!;
        const size = head[(offset >>> 2) + 1]!;
        offset += 8;
        if (start > length || size > length - start || offset + align4(size) > total) {
          fail("World delta run is corrupt.");
        }
        target.set(bytes.subarray(offset, offset + size), start);
        offset += align4(size);
      }
    } else {
      fail(`World delta has an unknown record type ${op}.`);
    }
    chunks[chunk] = new type(storage, 0, length / type.BYTES_PER_ELEMENT);
  }

  const capacity = image.capacity;
  const wordsPerSet = image.wordsPerSet;
  const components: ComponentImage[] = new Array(image.components.length);
  let c = 7;
  for (let i = 0; i < components.length; i++) {
    const owners = chunks[c++] as EntityArray;
    const changed = chunks[c++] as EntityArray;
    const codes = image.info.codes[i]!;
    const rows: TypedArray[] = [];
    if (codes !== null) {
      for (let k = 0; k < codes.length; k++) {
        const row = chunks[c++]!;
        if (row.length !== owners.length) fail("World delta leaves a value column out of step with its owners.");
        rows.push(row);
      }
    }
    if (owners.length > capacity || changed.length > owners.length) fail("World delta component counts are corrupt.");
    components[i] = { owners, changed, rows };
  }
  const populations = chunks.slice(fixed) as EntityArray[];
  const nextImage: SaveImage = {
    ...image,
    cursor,
    occupancy: chunks[0] as Uint32Array,
    nextGeneration: chunks[1] as Uint32Array,
    liveGeneration: chunks[2] as Uint32Array,
    archetypeBits: chunks[3] as Uint32Array,
    windowSlots: chunks[4] as EntityArray,
    windowOrigins: chunks[5] as Uint32Array,
    windowHandles: chunks[6] as Uint32Array,
    components,
    populations,
  };
  let population = 0;
  for (const slots of populations) population += slots.length;
  if (
    nextImage.occupancy.length !== wordCount(capacity) || nextImage.nextGeneration.length !== capacity ||
    nextImage.liveGeneration.length > capacity || nextImage.archetypeBits.length !== archetypeCount * wordsPerSet ||
    nextImage.windowSlots.length > capacity || nextImage.windowOrigins.length !== nextImage.windowSlots.length ||
    nextImage.windowHandles.length !== nextImage.windowSlots.length || population > capacity
  ) {
    fail("World delta does not reproduce a consistent save.");
  }

  const out = writeImage(nextImage);
  const check = new Uint32Array(out.buffer, 0, out.byteLength >>> 2);
  if (out.byteLength !== head[5] || hashWords(check, 0, check.length) !== head[6]) {
    fail("World delta does not reproduce its target save.");
  }
  return out;
}
