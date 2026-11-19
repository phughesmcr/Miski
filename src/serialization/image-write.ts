import type { TypedArray } from "@/types/partitions.ts";
import type { ComponentStateSnapshot } from "@/component/component-snapshot.ts";
import {
  align4,
  align8,
  archetypesPayloadBytes,
  assertLittleEndian,
  CODE_OBJECT,
  CODE_STRING,
  componentPayloadBytes,
  FIELD_TYPE_BYTES,
  FORMAT_VERSION,
  HEADER_BYTES,
  isSideCode,
  OBJECT_NULL,
  OBJECT_NUMBER,
  OBJECT_STRING,
  objectColumnBytes,
  SAVE_MAGIC,
  SECTION_ARCHETYPES,
  SECTION_COMPONENTS,
  SECTION_ENTITIES,
  SECTION_HEADER_BYTES,
  SECTION_RELATIONS,
  SECTION_REQUIRED,
  SECTION_WINDOW,
  sectionCount,
  slotWidth,
  stringColumnBytes,
  utf8Length,
  ViewCache,
  type Views,
  windowPayloadBytes,
  wordCount,
  writeUtf8,
} from "./format.ts";
import type { KnownLayout, SaveImage } from "./image-types.ts";

function entitiesPayloadBytes(capacity: number, live: number): number {
  return align8(8 + wordCount(capacity) * 4 + capacity * 4 + live * 4);
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
  const w = offset >>> 2;
  const heap = offset + (count + 1) * 4;
  const q = slots === null ?
    writeDenseStrings(views.u32, views.u8, w, heap, values, count) :
    writeSlottedStrings(views.u32, views.u8, w, heap, values, slots, count);
  views.u32[w + count] = q - heap;
  const end = align8(q);
  zeroPad(views, q, end);
  return end;
}

// The cell loops live in their own functions, ending in a bare return. The first save of a big column optimizes a
// loop on-stack mid-call, before any code after it has run; code after the loop in the same function would have no
// type feedback, and the optimized loop would deoptimize there on every call until the whole function is optimized.

/** Write cells `values[0..count)`; @returns the heap end offset. */
function writeDenseStrings(
  u32: Uint32Array,
  u8: Uint8Array,
  w: number,
  heap: number,
  values: ArrayLike<unknown>,
  count: number,
): number {
  let q = heap;
  for (let j = 0; j < count; j++) {
    u32[w + j] = q - heap;
    q = writeUtf8(u8, q, values[j] as string);
  }
  return q;
}

/** Write cells `values[slots[0..count)]`; @returns the heap end offset. */
function writeSlottedStrings(
  u32: Uint32Array,
  u8: Uint8Array,
  w: number,
  heap: number,
  values: ArrayLike<unknown>,
  slots: ArrayLike<number>,
  count: number,
): number {
  let q = heap;
  for (let j = 0; j < count; j++) {
    u32[w + j] = q - heap;
    q = writeUtf8(u8, q, values[slots[j]!] as string);
  }
  return q;
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
function imageSideBytes(component: ComponentStateSnapshot, codes: readonly number[] | null): number {
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

/**
 * Payload bytes of one saved relation: six u32 counts; u32 free rows, sources, source pair counts, pair rows, pair
 * target handles, target slots, sources by target and changed sources, padded to 8; then each pair data column,
 * padded to 8. Integer math (the save writers' hot path); counts read from bytes go through the
 * reader's float-math twin first.
 */
function relationPayloadBytes(
  free: number,
  sources: number,
  pairs: number,
  targets: number,
  changed: number,
  codes: readonly number[],
): number {
  let bytes = 24 + align8((free + sources * 2 + pairs * 3 + targets + changed) * 4);
  for (let c = 0; c < codes.length; c++) bytes += align8(pairs * FIELD_TYPE_BYTES[codes[c]!]!);
  return bytes;
}

/** Bytes before the first section. */
function prefixBytes(layoutBlock: Uint8Array): number {
  return HEADER_BYTES + layoutBlock.length;
}

/** Write the header and copy the component table; returns the offset of the first section. */
function writeHeader(views: Views, base: number, totalBytes: number, known: KnownLayout, capacity: number): number {
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
  u32[w + 8] = sectionCount(known.info.relations.length);
  u32[w + 9] = 0;
  views.u8.set(known.layoutBlock, base + HEADER_BYTES);
  return base + HEADER_BYTES + known.layoutBlock.length;
}

/** Write a section header; returns the payload offset. */
function writeSectionHeader(views: Views, offset: number, tag: number, payloadBytes: number): number {
  views.u32[offset >>> 2] = tag | (SECTION_REQUIRED << 16);
  views.u32[(offset >>> 2) + 1] = payloadBytes;
  return offset + SECTION_HEADER_BYTES;
}

/** Zero the padding between `from` and `to`, so saves of equal state are byte-identical. */
function zeroPad(views: Views, from: number, to: number): void {
  if (to > from) views.u8.fill(0, from, to);
}

/**
 * What {@link saveBytes} and {@link writeSave} read: counts staged before writing, and writers for list and column
 * bodies. The shared writer owns every header, count word, offset and pad; a source fills bodies only, one call per
 * list or column, so its element loops stay monomorphic. Both sources (a world and an image) produce the same bytes
 * for the same state.
 */
export abstract class SaveSource {
  /** Live entity count. */
  live = 0;
  archetypeCount = 0;
  /** Total population over all archetypes. */
  population = 0;
  /** Owner and changed counts per component, two per component. */
  readonly componentCounts: Int32Array;
  /** Bytes of each component's string / object columns. */
  readonly sideBytes: Float64Array;
  /** Touched slots in the transition window. */
  touched = 0;
  /** Per relation: highWater, free rows, sources, pairs, target slots, changed sources. */
  readonly relationCounts: Int32Array;

  readonly known: KnownLayout;
  readonly capacity: number;
  readonly wordsPerSet: number;

  constructor(known: KnownLayout, capacity: number, wordsPerSet: number) {
    this.known = known;
    this.capacity = capacity;
    this.wordsPerSet = wordsPerSet;
    const components = known.layout.components.length;
    this.componentCounts = new Int32Array(components * 2);
    this.sideBytes = new Float64Array(components);
    this.relationCounts = new Int32Array(known.info.relations.length * 6);
  }

  abstract cursor(): number;
  /** Write occupancy, next generations and live generations from word `w`; returns the end word. */
  abstract writeEntityWords(u32: Uint32Array, w: number): number;
  /** Write every archetype's bitset, `wordsPerSet` words each, from word `w`. */
  abstract writeArchetypeBits(u32: Uint32Array, w: number): void;
  abstract populationCount(archetype: number): number;
  /** Write archetype `i`'s population slots at `offset`; returns the end offset. */
  abstract writePopulation(views: Views, offset: number, width: number, i: number): number;
  /** Write component `c`'s owner slots (count > 0) at `offset`; returns the end offset. */
  abstract writeOwners(views: Views, offset: number, width: number, c: number): number;
  /** Write component `c`'s changed slots (count > 0) at `offset`; returns the end offset. */
  abstract writeChanged(views: Views, offset: number, width: number, c: number): number;
  /** Write component `c`'s numeric storage column `t` (type `code`) at `offset`, one value per owner. */
  abstract writeNumeric(views: Views, offset: number, c: number, t: number, code: number): void;
  /** Write component `c`'s string column `s` at `offset`; returns the 8-aligned end offset. */
  abstract writeStrings(views: Views, offset: number, c: number, s: number): number;
  /** Write component `c`'s object column `s` at `offset`; returns the 8-aligned end offset. */
  abstract writeObjects(views: Views, offset: number, c: number, s: number): number;
  /** Write the touched slots at `offset`. */
  abstract writeWindowSlots(views: Views, offset: number, width: number): void;
  /** Write the window origins, then the window handles, from word `w`. */
  abstract writeWindowWords(u32: Uint32Array, w: number): void;
  /**
   * Write relation `r`'s lists from word `w`: free rows, sources, source pair counts, pair rows, pair targets, target
   * slots, sources by target, changed sources.
   */
  abstract writeRelationWords(u32: Uint32Array, w: number, r: number): void;
  /** Write relation `r`'s pair data column `c` (type `code`) at `offset`, one value per pair. */
  abstract writeRelationData(views: Views, offset: number, r: number, c: number, code: number): void;
}

function componentsPayloadBytes(source: SaveSource, width: number): number {
  const counts = source.componentCounts;
  const codes = source.known.info.codes;
  let bytes = 0;
  for (let c = 0; c < codes.length; c++) {
    bytes += componentPayloadBytes(counts[c * 2]!, counts[c * 2 + 1]!, codes[c]!, width, source.sideBytes[c]!);
  }
  return bytes;
}

function relationsPayloadBytes(source: SaveSource): number {
  const counts = source.relationCounts;
  const relations = source.known.info.relations;
  let bytes = 0;
  for (let r = 0; r < relations.length; r++) {
    const k = r * 6;
    bytes += relationPayloadBytes(
      counts[k + 1]!,
      counts[k + 2]!,
      counts[k + 3]!,
      counts[k + 4]!,
      counts[k + 5]!,
      relations[r]!.codes,
    );
  }
  return bytes;
}

/** Exact byte length of the save a staged source writes. */
export function saveBytes(source: SaveSource): number {
  const width = slotWidth(source.capacity);
  const relations = source.known.info.relations.length;
  let bytes = prefixBytes(source.known.layoutBlock) + sectionCount(relations) * SECTION_HEADER_BYTES;
  bytes += entitiesPayloadBytes(source.capacity, source.live);
  bytes += archetypesPayloadBytes(source.archetypeCount, source.wordsPerSet, source.population, width);
  bytes += componentsPayloadBytes(source, width);
  bytes += windowPayloadBytes(source.touched, width);
  if (relations !== 0) bytes += relationsPayloadBytes(source);
  return bytes;
}

/**
 * Write a staged source's save at `base` (8-byte aligned, `total` = {@link saveBytes} bytes). Every pad byte is
 * written, so the target need not be zeroed. Allocates nothing beyond what the source's writers allocate.
 */
export function writeSave(source: SaveSource, views: Views, base: number, total: number): void {
  const { capacity, wordsPerSet } = source;
  const info = source.known.info;
  const width = slotWidth(capacity);
  const u32 = views.u32;
  let offset = writeHeader(views, base, total, source.known, capacity);

  // Entities: cursor, live count, occupancy, next generations, live generations in slot order.
  const entityBytes = entitiesPayloadBytes(capacity, source.live);
  let p = writeSectionHeader(views, offset, SECTION_ENTITIES, entityBytes);
  u32[p >>> 2] = source.cursor();
  u32[(p >>> 2) + 1] = source.live;
  let w = source.writeEntityWords(u32, (p >>> 2) + 2);
  offset = p + entityBytes;
  zeroPad(views, w << 2, offset);

  // Archetypes: count, bitset width, bitsets, population counts, populations.
  const count = source.archetypeCount;
  const archetypeBytes = archetypesPayloadBytes(count, wordsPerSet, source.population, width);
  p = writeSectionHeader(views, offset, SECTION_ARCHETYPES, archetypeBytes);
  w = p >>> 2;
  u32[w] = count;
  u32[w + 1] = wordsPerSet;
  source.writeArchetypeBits(u32, w + 2);
  w += 2 + count * wordsPerSet;
  for (let i = 0; i < count; i++) u32[w + i] = source.populationCount(i);
  let q = (w + count) << 2;
  for (let i = 0; i < count; i++) q = source.writePopulation(views, q, width, i);
  offset = p + archetypeBytes;
  zeroPad(views, q, offset);

  // Components: owner and changed lists, then owned rows per column in owner order.
  const counts = source.componentCounts;
  p = writeSectionHeader(views, offset, SECTION_COMPONENTS, componentsPayloadBytes(source, width));
  for (let c = 0; c < info.codes.length; c++) {
    const owners = counts[c * 2]!;
    const changed = counts[c * 2 + 1]!;
    u32[p >>> 2] = owners;
    u32[(p >>> 2) + 1] = changed;
    p += 8;
    let end = owners === 0 ? p : source.writeOwners(views, p, width, c);
    zeroPad(views, end, p = align8(end));
    end = changed === 0 ? p : source.writeChanged(views, p, width, c);
    zeroPad(views, end, p = align8(end));
    const codes = info.codes[c]!;
    if (codes === null) continue;
    let t = 0;
    let s = 0;
    for (let k = 0; k < codes.length; k++) {
      const code = codes[k]!;
      if (code === CODE_STRING) {
        p = source.writeStrings(views, p, c, s++);
      } else if (code === CODE_OBJECT) {
        p = source.writeObjects(views, p, c, s++);
      } else {
        source.writeNumeric(views, p, c, t++, code);
        end = p + owners * FIELD_TYPE_BYTES[code]!;
        zeroPad(views, end, p = align8(end));
      }
    }
  }
  offset = p;

  // Window: touched slots, origins as registry index + 1, window-start handles.
  const touched = source.touched;
  p = writeSectionHeader(views, offset, SECTION_WINDOW, windowPayloadBytes(touched, width));
  u32[p >>> 2] = touched;
  u32[(p >>> 2) + 1] = 0;
  source.writeWindowSlots(views, p + 8, width);
  const slotEnd = p + 8 + touched * width;
  q = align4(slotEnd);
  zeroPad(views, slotEnd, q);
  source.writeWindowWords(u32, q >>> 2);
  offset = p + windowPayloadBytes(touched, width);
  zeroPad(views, q + touched * 8, offset);

  // Relations: pools, sources and pairs in store order, target lists, changed sources, pair data.
  const relations = info.relations;
  if (relations.length !== 0) {
    const rc = source.relationCounts;
    p = writeSectionHeader(views, offset, SECTION_RELATIONS, relationsPayloadBytes(source));
    for (let r = 0; r < relations.length; r++) {
      const k = r * 6;
      w = p >>> 2;
      for (let i = 0; i < 6; i++) u32[w + i] = rc[k + i]!;
      source.writeRelationWords(u32, w + 6, r);
      const pairs = rc[k + 3]!;
      const listEnd = (w + 6 + rc[k + 1]! + rc[k + 2]! * 2 + pairs * 3 + rc[k + 4]! + rc[k + 5]!) << 2;
      zeroPad(views, listEnd, p = align8(listEnd));
      const codes = relations[r]!.codes;
      for (let c = 0; c < codes.length; c++) {
        source.writeRelationData(views, p, r, c, codes[c]!);
        const end = p + pairs * FIELD_TYPE_BYTES[codes[c]!]!;
        zeroPad(views, end, p = align8(end));
      }
    }
    offset = p;
  }
  zeroPad(views, offset, base + total);
}

function copySlots(views: Views, offset: number, width: number, slots: ArrayLike<number>, count: number): number {
  const target = views.slots(width);
  const start = width === 1 ? offset : offset >>> 1;
  for (let i = 0; i < count; i++) target[start + i] = slots[i]!;
  return offset + count * width;
}

/** Copy `count` values of `bytes` bytes each, as bytes, so NaN payloads survive exactly. */
function copyBytes(views: Views, offset: number, source: TypedArray, count: number, bytes: number): void {
  views.u8.set(new Uint8Array(source.buffer, source.byteOffset, count * bytes), offset);
}

/** A save image as a {@link SaveSource}; staged on construction. */
class ImageSource extends SaveSource {
  readonly image: SaveImage;

  constructor(image: SaveImage) {
    super(image, image.capacity, image.wordsPerSet);
    this.image = image;
    this.live = image.liveGeneration.length;
    this.archetypeCount = image.populations.length;
    for (let i = 0; i < image.populations.length; i++) this.population += image.populations[i]!.length;
    for (let c = 0; c < image.components.length; c++) {
      const component = image.components[c]!;
      this.componentCounts[c * 2] = component.owners.length;
      this.componentCounts[c * 2 + 1] = component.changed.length;
      this.sideBytes[c] = imageSideBytes(component, image.info.codes[c]!);
    }
    this.touched = image.windowSlots.length;
    for (let r = 0; r < image.relations.length; r++) {
      const relation = image.relations[r]!;
      const k = r * 6;
      this.relationCounts[k] = relation.highWater;
      this.relationCounts[k + 1] = relation.freeRows.length;
      this.relationCounts[k + 2] = relation.sources.length;
      this.relationCounts[k + 3] = relation.rows.length;
      this.relationCounts[k + 4] = relation.targetSlots.length;
      this.relationCounts[k + 5] = relation.changed.length;
    }
  }

  cursor(): number {
    return this.image.cursor;
  }

  writeEntityWords(u32: Uint32Array, w: number): number {
    const image = this.image;
    u32.set(image.occupancy, w);
    w += image.occupancy.length;
    u32.set(image.nextGeneration, w);
    w += image.nextGeneration.length;
    u32.set(image.liveGeneration, w);
    return w + image.liveGeneration.length;
  }

  writeArchetypeBits(u32: Uint32Array, w: number): void {
    u32.set(this.image.archetypeBits, w);
  }

  populationCount(i: number): number {
    return this.image.populations[i]!.length;
  }

  writePopulation(views: Views, offset: number, width: number, i: number): number {
    const slots = this.image.populations[i]!;
    return copySlots(views, offset, width, slots, slots.length);
  }

  writeOwners(views: Views, offset: number, width: number, c: number): number {
    const owners = this.image.components[c]!.owners;
    return copySlots(views, offset, width, owners, owners.length);
  }

  writeChanged(views: Views, offset: number, width: number, c: number): number {
    const changed = this.image.components[c]!.changed;
    return copySlots(views, offset, width, changed, changed.length);
  }

  writeNumeric(views: Views, offset: number, c: number, t: number, code: number): void {
    const component = this.image.components[c]!;
    copyBytes(views, offset, component.rows[t]!, component.owners.length, FIELD_TYPE_BYTES[code]!);
  }

  writeStrings(views: Views, offset: number, c: number, s: number): number {
    const component = this.image.components[c]!;
    return writeStringCells(views, offset, component.sideRows[s]!, null, component.owners.length);
  }

  writeObjects(views: Views, offset: number, c: number, s: number): number {
    const component = this.image.components[c]!;
    return writeObjectCells(views, offset, component.sideRows[s]!, component.owners.length);
  }

  writeWindowSlots(views: Views, offset: number, width: number): void {
    copySlots(views, offset, width, this.image.windowSlots, this.image.windowSlots.length);
  }

  writeWindowWords(u32: Uint32Array, w: number): void {
    u32.set(this.image.windowOrigins, w);
    u32.set(this.image.windowHandles, w + this.image.windowOrigins.length);
  }

  writeRelationWords(u32: Uint32Array, w: number, r: number): void {
    const relation = this.image.relations[r]!;
    u32.set(relation.freeRows, w);
    w += relation.freeRows.length;
    u32.set(relation.sources, w);
    w += relation.sources.length;
    u32.set(relation.sourceCounts, w);
    w += relation.sourceCounts.length;
    u32.set(relation.rows, w);
    w += relation.rows.length;
    u32.set(relation.targets, w);
    w += relation.targets.length;
    u32.set(relation.targetSlots, w);
    w += relation.targetSlots.length;
    u32.set(relation.sourcesByTarget, w);
    w += relation.sourcesByTarget.length;
    u32.set(relation.changed, w);
  }

  writeRelationData(views: Views, offset: number, r: number, c: number, code: number): void {
    const relation = this.image.relations[r]!;
    copyBytes(views, offset, relation.data[c]!, relation.rows.length, FIELD_TYPE_BYTES[code]!);
  }
}

/** Encode a save image into fresh bytes. */
export function writeImage(image: SaveImage): Uint8Array {
  assertLittleEndian();
  const source = new ImageSource(image);
  const out = new Uint8Array(saveBytes(source));
  writeSave(source, new ViewCache().get(out.buffer), 0, out.byteLength);
  return out;
}
