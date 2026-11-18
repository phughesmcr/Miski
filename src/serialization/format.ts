import { MiskiError } from "@/errors.ts";
import type { TypedArray, TypedArrayConstructor } from "@/types/partitions.ts";

/** Thrown when a world save, save document or delta is malformed, corrupt or incompatible with its target. */
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
/** "MSKD" read as a little-endian u32. */
export const DELTA_MAGIC = 0x444b534d;
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

/** Storage type of one saved component field. */
export type WorldSaveFieldType = "i8" | "i16" | "i32" | "u8" | "u16" | "u32" | "f32" | "f64" | "u8c";

/** Field type names by type code (code 0 is unused). Append-only: codes are persisted. */
export const FIELD_TYPE_NAMES: readonly (WorldSaveFieldType | "")[] = Object.freeze([
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
]);

/** Element byte size by type code. */
export const FIELD_TYPE_BYTES: readonly number[] = Object.freeze([0, 1, 2, 4, 1, 2, 4, 4, 8, 1]);

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
]);

/** @returns the type code of a typed-array constructor, or 0 when it has none */
export function fieldTypeCode(constructor: unknown): number {
  for (let code = 1; code < FIELD_TYPE_CONSTRUCTORS.length; code++) {
    if (FIELD_TYPE_CONSTRUCTORS[code] === constructor) return code;
  }
  return 0;
}

/** @returns the type code of a field type name, or 0 when unknown */
export function fieldTypeCodeOfName(name: unknown): number {
  if (typeof name !== "string" || name === "") return 0;
  const code = FIELD_TYPE_NAMES.indexOf(name as WorldSaveFieldType);
  return code === -1 ? 0 : code;
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

/** Word-wise FNV-1a over `count` u32 words starting at word `start`; used to bind deltas to their saves. */
export function hashWords(words: Uint32Array, start: number, count: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < count; i++) {
    hash = Math.imul(hash ^ words[start + i]!, 0x01000193);
  }
  return hash >>> 0;
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

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
