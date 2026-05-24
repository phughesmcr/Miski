export type EntityArray = Uint8Array | Uint16Array | Uint32Array;

export function createEntityArray(capacity: number, length: number = capacity): EntityArray {
  if (capacity <= 0x100) return new Uint8Array(length);
  if (capacity <= 0x1_0000) return new Uint16Array(length);
  return new Uint32Array(length);
}
