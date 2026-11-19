import type { ComponentStateSnapshot } from "@/component/component-snapshot.ts";
import type { EntityArray } from "@/entity/entity.ts";
import type { TypedArray } from "@/types/partitions.ts";
import type { LayoutInfo, WorldSaveLayout } from "./layout.ts";

/** The shared empty side-row list of components without string / object fields. */
export const NO_SIDE_ROWS: readonly (readonly unknown[])[] = Object.freeze([]);

/**
 * One relation's saved pair index, shaped after the relation store's rollback capture. Pairs are listed by source in
 * live-source order, each source's pairs in its target order; `rows`, `targets` and every `data` column are parallel.
 */
export type RelationImage = {
  /** Pair pool high-water mark (0 for exclusive relations, whose row is the source slot). */
  readonly highWater: number;
  /** Free pair rows, bottom of the free stack first. */
  readonly freeRows: Uint32Array;
  /** Source slots in live-source order. */
  readonly sources: Uint32Array;
  /** Number of pairs of each source, parallel to `sources`. */
  readonly sourceCounts: Uint32Array;
  /** Pair row of each pair. */
  readonly rows: Uint32Array;
  /** Target handle of each pair. */
  readonly targets: Uint32Array;
  /** Pair data columns in schema order. */
  readonly data: readonly TypedArray[];
  /** Target slots in first-targeted order. */
  readonly targetSlots: Uint32Array;
  /** Per target in `targetSlots` order, the source slots of its pairs in that target's source order. */
  readonly sourcesByTarget: Uint32Array;
  /** Changed source slots in changed-iteration order. */
  readonly changed: Uint32Array;
};

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
  readonly components: readonly ComponentStateSnapshot[];
  /** Touched slots in first-touch order. */
  readonly windowSlots: EntityArray;
  /** Window-start archetype registry index plus one per touched slot (0 = no entity at window start). */
  readonly windowOrigins: Uint32Array;
  /** Window-start handle per touched slot (0 when the origin is 0). */
  readonly windowHandles: Uint32Array;
  /** Pair index of every relation, parallel to `info.relations` (empty without relations). */
  readonly relations: readonly RelationImage[];
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
