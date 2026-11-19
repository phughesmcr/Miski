import { MiskiError } from "@/errors.ts";
import type { TypedArray, TypedArrayConstructor } from "@/types/partitions.ts";

/** Thrown when a world save or save document is malformed, corrupt or incompatible with its target. */
export class WorldSaveError extends MiskiError {
  /**
   * Create a world save error.
   * @param message - Optional human-readable error message.
   * @param options - Optional standard error options, such as the underlying `cause`.
   */
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorldSaveError";
  }
}

/** "MSKI" read as a little-endian u32. */
export const SAVE_MAGIC = 0x494b534d;
/**
 * Save format version; a reader accepts only its own. Version 2 marks the f16 column code (12) and the relation
 * section, both added after version 1 saves were first written; version 1 saves are rejected.
 */
export const FORMAT_VERSION = 2;

/**
 * Save header (40 bytes, u32 words):
 * 0 magic | 1 version (u16) + flags (u16) | 2 totalBytes | 3 capacity | 4 componentCount | 5 layoutBytes
 * 6 layoutHash low | 7 layoutHash high | 8 sectionCount | 9 reserved (0)
 */
export const HEADER_BYTES = 40;
/** Section header: tag (u16) + flags (u16) + payloadBytes (u32). */
export const SECTION_HEADER_BYTES = 8;
/** Section flag: a reader that does not understand this section must reject the save. */
export const SECTION_REQUIRED = 1;

export const SECTION_ENTITIES = 1;
export const SECTION_ARCHETYPES = 2;
export const SECTION_COMPONENTS = 3;
export const SECTION_WINDOW = 4;
/** Relation pair indexes; written only when the layout has relations. */
export const SECTION_RELATIONS = 5;
/** Number of sections a save of a layout without relations holds (one more with relations). */
const SECTION_COUNT = 4;

/** Number of sections of a save whose layout has `relations` relation components. */
export function sectionCount(relations: number): number {
  return relations === 0 ? SECTION_COUNT : SECTION_COUNT + 1;
}

/** Storage type of one saved numeric component field. */
export type WorldSaveNumericFieldType = "i8" | "i16" | "i32" | "u8" | "u16" | "u32" | "f32" | "f64" | "u8c" | "f16";

/**
 * Type of one saved component field: a numeric storage type, or the hash tag of a `field.*` field: `"bool"`,
 * `"entity"` or `enum:` followed by the JSON label list (typed columns), `"string"` (UTF-8) or `"object"` (saved
 * through the field's `encode` / `decode` hooks). The tag is part of the layout check, so a bool never loads into a
 * `u8` field and reordered enum labels never load at all.
 */
export type WorldSaveFieldType =
  | WorldSaveNumericFieldType
  | "bool"
  | "entity"
  | `enum:${string}`
  | "string"
  | "object";

/** Type code of a `field.string()` column: u32 offsets plus a UTF-8 heap. Append-only, like every code. */
export const CODE_STRING = 10;
/** Type code of a `field.object()` column: kinds, numbers, then u32 offsets plus a UTF-8 heap. */
export const CODE_OBJECT = 11;

/** @returns `true` for variable-length (string / object) type codes, which have no fixed element size */
export function isSideCode(code: number): boolean {
  return code === CODE_STRING || code === CODE_OBJECT;
}

/** One numeric storage type of a saved field. */
export type NumericFieldType = {
  /** Persisted type code. */
  readonly code: number;
  readonly name: WorldSaveNumericFieldType;
  /** Element byte size. */
  readonly bytes: number;
  readonly ctor: TypedArrayConstructor;
  /** Inclusive range of a saved integer cell; `undefined` for float types. */
  readonly intRange: readonly [number, number] | undefined;
};

function numericType(
  code: number,
  name: WorldSaveNumericFieldType,
  ctor: TypedArrayConstructor,
  intRange?: readonly [number, number],
): NumericFieldType {
  return Object.freeze({ code, name, bytes: ctor.BYTES_PER_ELEMENT, ctor, intRange });
}

/**
 * Numeric storage types by type code; `undefined` at code 0, {@link CODE_STRING} and {@link CODE_OBJECT}.
 * Append-only: codes are persisted.
 */
export const NUMERIC_FIELD_TYPES: readonly (NumericFieldType | undefined)[] = Object.freeze([
  undefined,
  numericType(1, "i8", Int8Array, [-0x80, 0x7f]),
  numericType(2, "i16", Int16Array, [-0x8000, 0x7fff]),
  numericType(3, "i32", Int32Array, [-0x8000_0000, 0x7fff_ffff]),
  numericType(4, "u8", Uint8Array, [0, 0xff]),
  numericType(5, "u16", Uint16Array, [0, 0xffff]),
  numericType(6, "u32", Uint32Array, [0, 0xffff_ffff]),
  numericType(7, "f32", Float32Array),
  numericType(8, "f64", Float64Array),
  numericType(9, "u8c", Uint8ClampedArray, [0, 0xff]),
  undefined, // CODE_STRING
  undefined, // CODE_OBJECT
  numericType(12, "f16", Float16Array),
]);

/** Element byte size by type code (0 for variable-length codes): {@link NUMERIC_FIELD_TYPES} flattened for hot loops. */
export const FIELD_TYPE_BYTES: readonly number[] = Object.freeze(NUMERIC_FIELD_TYPES.map((type) => type?.bytes ?? 0));

/** @returns the type code of a typed-array constructor, or 0 when it has none */
export function fieldTypeCode(constructor: unknown): number {
  for (let code = 1; code < NUMERIC_FIELD_TYPES.length; code++) {
    if (NUMERIC_FIELD_TYPES[code]?.ctor === constructor) return code;
  }
  return 0;
}

/** @returns the type code of a numeric storage type name, or 0 when `name` is not one */
export function numericTypeCodeOfName(name: unknown): number {
  for (let code = 1; code < NUMERIC_FIELD_TYPES.length; code++) {
    if (NUMERIC_FIELD_TYPES[code]?.name === name) return code;
  }
  return 0;
}

/** Type codes `field.*` tags store as (bool as u8, entity as i32, enum as u8 or u16 by label count). */
const CODE_U8 = 4;
const CODE_U16 = 5;
const CODE_I32 = 3;

/** @returns the label count of a valid `enum:[...]` tag, or 0 when the tag is malformed */
function enumTagLabelCount(name: string): number {
  let labels: unknown;
  try {
    labels = JSON.parse(name.slice(5));
  } catch {
    return 0;
  }
  if (!Array.isArray(labels) || labels.length === 0 || labels.length > 65_536) return 0;
  const seen = new Set<string>();
  for (const label of labels) {
    if (typeof label !== "string" || seen.has(label)) return 0;
    seen.add(label);
  }
  // Only the canonical spelling matches a world's tag, so reject any other formatting of the same labels.
  return JSON.stringify(labels) === name.slice(5) ? labels.length : 0;
}

/** @returns the storage type code of a field type name or `field.*` tag, or 0 when unknown */
export function fieldTypeCodeOfName(name: unknown): number {
  if (typeof name !== "string" || name === "") return 0;
  const code = numericTypeCodeOfName(name);
  if (code !== 0) return code;
  if (name === "bool") return CODE_U8;
  if (name === "entity") return CODE_I32;
  if (name === "string") return CODE_STRING;
  if (name === "object") return CODE_OBJECT;
  if (name.startsWith("enum:")) {
    const count = enumTagLabelCount(name);
    return count === 0 ? 0 : count <= 256 ? CODE_U8 : CODE_U16;
  }
  return 0;
}

/** {@link fieldValueLimitOfName} result for `field.entity()` columns: cells hold -1 or a handle. */
export const ENTITY_REF_LIMIT = -1;

/**
 * The value range a typed field's saved cells must fall in, from its layout type name: `n > 0` for indexes below
 * `n` (`bool` and `enum:` columns), {@link ENTITY_REF_LIMIT} for entity refs, or 0 when any stored value is valid.
 */
export function fieldValueLimitOfName(name: string): number {
  if (name === "bool") return 2;
  if (name === "entity") return ENTITY_REF_LIMIT;
  return name.startsWith("enum:") ? enumTagLabelCount(name) : 0;
}

export function align8(bytes: number): number {
  return (bytes + 7) & ~7;
}

export function align4(bytes: number): number {
  return (bytes + 3) & ~3;
}

/** Occupancy bitmap words for a capacity. */
export function wordCount(bits: number): number {
  return (bits + 31) >>> 5;
}

/** Byte width of a saved slot index: one byte up to 256 slots, otherwise two (world capacity is at most 65,536). */
export function slotWidth(capacity: number): number {
  return capacity <= 0x100 ? 1 : 2;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Saves are little-endian and written through native typed-array views. */
export function assertLittleEndian(): void {
  if (!LITTLE_ENDIAN) throw new WorldSaveError("World saves require a little-endian host.");
}

/** Typed views over one buffer; with 8-byte-aligned sections every element index is `byteOffset / BYTES`. */
export class Views {
  readonly buffer: ArrayBufferLike;
  readonly u8: Uint8Array;
  readonly u16: Uint16Array;
  readonly u32: Uint32Array;
  readonly f64: Float64Array;
  /** One view per numeric type code, over the whole buffer. */
  readonly #columns: (TypedArray | undefined)[];

  constructor(buffer: ArrayBufferLike) {
    const length = buffer.byteLength;
    this.buffer = buffer;
    this.u8 = new Uint8Array(buffer);
    this.u16 = new Uint16Array(buffer, 0, length >>> 1);
    this.u32 = new Uint32Array(buffer, 0, length >>> 2);
    this.f64 = new Float64Array(buffer, 0, length >>> 3);
    const columns: (TypedArray | undefined)[] = new Array(NUMERIC_FIELD_TYPES.length);
    for (let code = 0; code < NUMERIC_FIELD_TYPES.length; code++) {
      const type = NUMERIC_FIELD_TYPES[code];
      if (type === undefined) continue;
      const ctor = type.ctor;
      columns[code] = ctor === Uint8Array ?
        this.u8 :
        ctor === Uint16Array ?
        this.u16 :
        ctor === Uint32Array ?
        this.u32 :
        ctor === Float64Array ?
        this.f64 :
        new ctor(buffer as ArrayBuffer, 0, Math.floor(length / type.bytes));
    }
    this.#columns = columns;
  }

  /** The view a numeric type code is written through. */
  column(code: number): TypedArray {
    const view = this.#columns[code];
    if (view === undefined) throw new WorldSaveError(`World save type code ${code} has no column view.`);
    return view;
  }

  /** The view a saved slot list of `width` bytes is written through. */
  slots(width: number): Uint8Array | Uint16Array {
    return width === 1 ? this.u8 : this.u16;
  }
}

/** Single-entry view cache, so repeated writes into (or reads from) one buffer allocate nothing. */
export class ViewCache {
  #views: Views | undefined;
  #length = -1;

  get(buffer: ArrayBufferLike): Views {
    const views = this.#views;
    // A resizable buffer may change length under the same identity; rebuild when it does.
    if (views !== undefined && views.buffer === buffer && this.#length === buffer.byteLength) return views;
    const fresh = new Views(buffer);
    this.#views = fresh;
    this.#length = buffer.byteLength;
    return fresh;
  }
}

/** Two independent byte-wise FNV-1a 32 hashes, giving a 64-bit layout fingerprint `[low, high]`. */
export function hashBytes64(bytes: Uint8Array): [number, number] {
  let low = 0x811c9dc5;
  let high = 0x050c5d1f;
  for (let i = 0; i < bytes.length; i++) {
    low = Math.imul(low ^ bytes[i]!, 0x01000193);
    high = Math.imul(high ^ bytes[i]!, 0x01000193);
  }
  return [low >>> 0, high >>> 0];
}

export function hashHex(low: number, high: number): string {
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

/** Object cell kinds in a saved object column. */
export const OBJECT_NULL = 0;
export const OBJECT_NUMBER = 1;
export const OBJECT_STRING = 2;

/**
 * UTF-8 byte length of a string, without allocating.
 * @returns the length, or -1 when the string holds a lone surrogate (UTF-8 cannot represent it)
 */
export function utf8Length(text: string): number {
  let bytes = 0;
  const length = text.length;
  for (let i = 0; i < length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c < 0xd800 || c > 0xdfff) bytes += 3;
    else if (c <= 0xdbff && i + 1 < length) {
      const d = text.charCodeAt(i + 1);
      if (d < 0xdc00 || d > 0xdfff) return -1;
      bytes += 4;
      i++;
    } else return -1;
  }
  return bytes;
}

/**
 * Write a well-formed string (see {@link utf8Length}) as UTF-8 at `offset`, without allocating.
 * @returns the end offset
 */
export function writeUtf8(target: Uint8Array, offset: number, text: string): number {
  let p = offset;
  const length = text.length;
  for (let i = 0; i < length; i++) {
    let c = text.charCodeAt(i);
    if (c < 0x80) {
      target[p++] = c;
    } else if (c < 0x800) {
      target[p++] = 0xc0 | (c >>> 6);
      target[p++] = 0x80 | (c & 0x3f);
    } else if (c < 0xd800 || c > 0xdfff) {
      target[p++] = 0xe0 | (c >>> 12);
      target[p++] = 0x80 | ((c >>> 6) & 0x3f);
      target[p++] = 0x80 | (c & 0x3f);
    } else {
      c = 0x10000 + ((c - 0xd800) << 10) + (text.charCodeAt(++i) - 0xdc00);
      target[p++] = 0xf0 | (c >>> 18);
      target[p++] = 0x80 | ((c >>> 12) & 0x3f);
      target[p++] = 0x80 | ((c >>> 6) & 0x3f);
      target[p++] = 0x80 | (c & 0x3f);
    }
  }
  return p;
}

/** Strict UTF-8 decoder that keeps a leading U+FEFF, so saved strings read back exactly. */
export const utf8Decoder: TextDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Bytes a string column of `count` cells takes: u32 offsets (count + 1), then the heap, padded to 8. */
export function stringColumnBytes(count: number, heapBytes: number): number {
  return align8((count + 1) * 4 + heapBytes);
}

/** Bytes an object column of `count` cells takes: u8 kinds, f64 numbers, then a string column. */
export function objectColumnBytes(count: number, heapBytes: number): number {
  return align8(count) + count * 8 + stringColumnBytes(count, heapBytes);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Payload bytes of the archetype section. */
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

/** Payload bytes of the transition-window section. */
export function windowPayloadBytes(count: number, width: number): number {
  return align8(8 + align4(count * width) + count * 8);
}

/** Throw a {@link WorldSaveError}. */
export function fail(message: string): never {
  throw new WorldSaveError(message);
}
