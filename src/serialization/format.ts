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
export const FORMAT_VERSION = 1;

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
/** Number of sections a version 1 writer emits. */
export const SECTION_COUNT = 4;

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

/** Numeric field type names by type code (code 0 is unused). Append-only: codes are persisted. */
export const FIELD_TYPE_NAMES: readonly (WorldSaveNumericFieldType | "")[] = Object.freeze([
  "",
  "i8",
  "i16",
  "i32",
  "u8",
  "u16",
  "u32",
  "f32",
  "f64",
  "u8c",
  "", // 10: CODE_STRING
  "", // 11: CODE_OBJECT
  "f16",
]);

/** Type code of a `field.string()` column: u32 offsets plus a UTF-8 heap. Append-only, like every code. */
export const CODE_STRING = 10;
/** Type code of a `field.object()` column: kinds, numbers, then u32 offsets plus a UTF-8 heap. */
export const CODE_OBJECT = 11;

/** @returns `true` for variable-length (string / object) type codes, which have no fixed element size */
export function isSideCode(code: number): boolean {
  return code === CODE_STRING || code === CODE_OBJECT;
}

/** Element byte size by type code (0 for variable-length codes). */
export const FIELD_TYPE_BYTES: readonly number[] = Object.freeze([0, 1, 2, 4, 1, 2, 4, 4, 8, 1, 0, 0, 2]);

/** Typed-array constructor by type code. */
export const FIELD_TYPE_CONSTRUCTORS: readonly (TypedArrayConstructor | undefined)[] = Object.freeze([
  undefined,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  Uint8ClampedArray,
  undefined, // 10: CODE_STRING
  undefined, // 11: CODE_OBJECT
  Float16Array,
]);

/** @returns the type code of a typed-array constructor, or 0 when it has none */
export function fieldTypeCode(constructor: unknown): number {
  for (let code = 1; code < FIELD_TYPE_CONSTRUCTORS.length; code++) {
    if (FIELD_TYPE_CONSTRUCTORS[code] === constructor) return code;
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
  const code = FIELD_TYPE_NAMES.indexOf(name as WorldSaveNumericFieldType);
  if (code !== -1) return code;
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
  readonly i8: Int8Array;
  readonly u16: Uint16Array;
  readonly i16: Int16Array;
  readonly u32: Uint32Array;
  readonly i32: Int32Array;
  readonly f32: Float32Array;
  readonly f64: Float64Array;
  readonly f16: Float16Array;

  constructor(buffer: ArrayBufferLike) {
    const length = buffer.byteLength;
    this.buffer = buffer;
    this.u8 = new Uint8Array(buffer);
    this.i8 = new Int8Array(buffer);
    this.u16 = new Uint16Array(buffer, 0, length >>> 1);
    this.i16 = new Int16Array(buffer, 0, length >>> 1);
    this.u32 = new Uint32Array(buffer, 0, length >>> 2);
    this.i32 = new Int32Array(buffer, 0, length >>> 2);
    this.f32 = new Float32Array(buffer, 0, length >>> 2);
    this.f64 = new Float64Array(buffer, 0, length >>> 3);
    this.f16 = new Float16Array(buffer, 0, length >>> 1);
  }

  /** The view a type code is written through (`u8c` shares the `u8` view). */
  column(code: number): TypedArray {
    switch (code) {
      case 1:
        return this.i8;
      case 2:
        return this.i16;
      case 3:
        return this.i32;
      case 5:
        return this.u16;
      case 6:
        return this.u32;
      case 7:
        return this.f32;
      case 8:
        return this.f64;
      case 12:
        return this.f16;
      default:
        return this.u8;
    }
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
