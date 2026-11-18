import { createSlotArray, type EntityArray } from "@/entity/entity.ts";
import type { TypedArray } from "@/types/partitions.ts";
import { FIELD_TYPE_CONSTRUCTORS, FORMAT_VERSION, hashBytes64, wordCount, WorldSaveError } from "./format.ts";
import {
  type ComponentImage,
  parseSave,
  type SaveImage,
  validateImage,
  ValidationScratch,
  writeImage,
} from "./image.ts";
import { decodeLayout, encodeLayout, layoutInfo, layoutProblem, type WorldSaveLayout } from "./layout.ts";

/** A saved number. Values JSON cannot hold are spelled as strings. */
export type WorldSaveNumber = number | "NaN" | "Infinity" | "-Infinity" | "-0";

/** One saved component: owners and changed slots in iteration order, and owned values per field. */
export type WorldSaveComponentDocument = {
  /** Owner slots in owner-iteration order. */
  readonly owners: readonly number[];
  /** Changed slots in changed-iteration order (a subset of `owners`). */
  readonly changed: readonly number[];
  /** Owned values per field, each parallel to `owners`; absent for tag components. */
  readonly values?: Readonly<Record<string, readonly WorldSaveNumber[]>>;
};

/**
 * A world save as plain JSON-safe data: the same information as the binary save, keyed by component and field
 * name. Use it to inspect saves, store them as text, or migrate them between layouts.
 */
export type WorldSaveDocument = {
  readonly format: "miski-world";
  readonly version: number;
  readonly layout: WorldSaveLayout;
  readonly entities: {
    /** Slot where the next entity allocation starts searching. */
    readonly cursor: number;
    /** Live slots, ascending. */
    readonly slots: readonly number[];
    /** Generation of each live slot, parallel to `slots`. */
    readonly generations: readonly number[];
    /** Next allocation generation of every slot (length = capacity). */
    readonly nextGenerations: readonly number[];
  };
  /** Every archetype in registry order (the first is the empty root), with its population in iteration order. */
  readonly archetypes: readonly { readonly components: readonly string[]; readonly slots: readonly number[] }[];
  /** Saved components keyed by name. */
  readonly components: Readonly<Record<string, WorldSaveComponentDocument>>;
  /** The open transition window: touched slots, each slot's window-start archetype index and handle. */
  readonly window: {
    readonly slots: readonly number[];
    /** Archetype index at window start, or `null` when the slot held no entity. */
    readonly origins: readonly (number | null)[];
    readonly handles: readonly number[];
  };
};

function encodeNumber(value: number): WorldSaveNumber {
  if (Number.isFinite(value)) return Object.is(value, -0) ? "-0" : value;
  if (Number.isNaN(value)) return "NaN";
  return value > 0 ? "Infinity" : "-Infinity";
}

function toArray(list: ArrayLike<number>): number[] {
  const out: number[] = new Array(list.length);
  for (let i = 0; i < list.length; i++) out[i] = list[i]!;
  return out;
}

/** Convert a validated image to a document. */
export function imageToDoc(image: SaveImage): WorldSaveDocument {
  const layout = image.layout;
  const names = layout.components.map((component) => component.name);
  const liveSlots: number[] = [];
  const occupancy = image.occupancy;
  for (let word = 0; word < occupancy.length; word++) {
    let bits = occupancy[word]!;
    while (bits !== 0) {
      liveSlots.push((word << 5) + (31 - Math.clz32(bits & -bits)));
      bits &= bits - 1;
    }
  }
  const archetypes = image.populations.map((population, i) => {
    const components: string[] = [];
    for (let c = 0; c < names.length; c++) {
      if (((image.archetypeBits[i * image.wordsPerSet + (c >>> 5)]! >>> (c & 31)) & 1) === 1) {
        components.push(names[c]!);
      }
    }
    return { components, slots: toArray(population) };
  });
  const components = Object.fromEntries(layout.components.map((component, c) => {
    const saved = image.components[c]!;
    const entry: WorldSaveComponentDocument = component.fields === null ?
      { owners: toArray(saved.owners), changed: toArray(saved.changed) } :
      {
        owners: toArray(saved.owners),
        changed: toArray(saved.changed),
        values: Object.fromEntries(component.fields.map((field, k) => {
          const row = saved.rows[k]!;
          const values: WorldSaveNumber[] = new Array(row.length);
          for (let j = 0; j < row.length; j++) values[j] = encodeNumber(row[j]!);
          return [field.name, values];
        })),
      };
    return [component.name, entry];
  }));
  const origins: (number | null)[] = new Array(image.windowOrigins.length);
  for (let i = 0; i < origins.length; i++) {
    origins[i] = image.windowOrigins[i] === 0 ? null : image.windowOrigins[i]! - 1;
  }
  return {
    format: "miski-world",
    version: FORMAT_VERSION,
    layout,
    entities: {
      cursor: image.cursor,
      slots: liveSlots,
      generations: toArray(image.liveGeneration),
      nextGenerations: toArray(image.nextGeneration),
    },
    archetypes,
    components,
    window: { slots: toArray(image.windowSlots), origins, handles: toArray(image.windowHandles) },
  };
}

function fail(path: string, problem: string): never {
  throw new WorldSaveError(`Invalid world save document: ${path} ${problem}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayAt(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function integers(value: unknown, path: string, max: number, length?: number): number[] {
  const list = arrayAt(value, path);
  if (length !== undefined && list.length !== length) fail(path, `must have ${length} entries`);
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > max) {
      fail(`${path}[${i}]`, `must be an integer from 0 to ${max}`);
    }
  }
  return list as number[];
}

function decodeNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  switch (value) {
    case "NaN":
      return Number.NaN;
    case "Infinity":
      return Number.POSITIVE_INFINITY;
    case "-Infinity":
      return Number.NEGATIVE_INFINITY;
    case "-0":
      return -0;
    default:
      return undefined;
  }
}

/** Inclusive integer range per type code; float codes have none. */
const INTEGER_RANGE: readonly (readonly [number, number] | undefined)[] = [
  undefined,
  [-0x80, 0x7f],
  [-0x8000, 0x7fff],
  [-0x8000_0000, 0x7fff_ffff],
  [0, 0xff],
  [0, 0xffff],
  [0, 0xffff_ffff],
  undefined,
  undefined,
  [0, 0xff],
];

function slotsOf(capacity: number, list: readonly number[]): EntityArray {
  const out = createSlotArray(capacity, list.length);
  for (let i = 0; i < list.length; i++) out[i] = list[i]!;
  return out;
}

/** Convert and fully validate a document; throws {@link WorldSaveError} naming the first problem. */
export function docToImage(document: unknown): SaveImage {
  if (!isRecord(document)) fail("document", "must be an object");
  if (document["format"] !== "miski-world") fail("format", 'must be "miski-world"');
  if (document["version"] !== FORMAT_VERSION) fail("version", `must be ${FORMAT_VERSION}`);
  const problem = layoutProblem(document["layout"]);
  if (problem !== undefined) fail("layout", `is invalid: ${problem}`);
  const rawLayout = document["layout"] as WorldSaveLayout;
  const capacity = rawLayout.capacity;
  // Normalize through the binary table: frozen, canonical key order, and the exact bytes a save carries.
  const layoutBlock = encodeLayout(rawLayout);
  const layout = decodeLayout(layoutBlock, capacity, rawLayout.components.length);
  const info = layoutInfo(layout);
  const [layoutHashLow, layoutHashHigh] = hashBytes64(layoutBlock);
  const maxSlot = capacity - 1;

  const entities = document["entities"];
  if (!isRecord(entities)) fail("entities", "must be an object");
  const cursor = entities["cursor"];
  if (typeof cursor !== "number" || !Number.isInteger(cursor) || cursor < 0 || cursor > maxSlot) {
    fail("entities.cursor", `must be an integer from 0 to ${maxSlot}`);
  }
  const liveSlots = integers(entities["slots"], "entities.slots", maxSlot);
  const generations = integers(entities["generations"], "entities.generations", 0xffff_ffff, liveSlots.length);
  const nextGenerations = integers(entities["nextGenerations"], "entities.nextGenerations", 0xffff_ffff, capacity);
  const occupancy = new Uint32Array(wordCount(capacity));
  for (let i = 0; i < liveSlots.length; i++) {
    const slot = liveSlots[i]!;
    if (i > 0 && slot <= liveSlots[i - 1]!) fail("entities.slots", "must be strictly ascending");
    occupancy[slot >>> 5]! |= 1 << (slot & 31);
  }

  const componentIndex = new Map<string, number>();
  layout.components.forEach((component, c) => componentIndex.set(component.name, c));
  const wordsPerSet = wordCount(layout.components.length);
  const archetypeList = arrayAt(document["archetypes"], "archetypes");
  if (archetypeList.length === 0) fail("archetypes", "must list at least the root archetype");
  const archetypeBits = new Uint32Array(archetypeList.length * wordsPerSet);
  const populations: EntityArray[] = new Array(archetypeList.length);
  for (let i = 0; i < archetypeList.length; i++) {
    const archetype = archetypeList[i];
    const path = `archetypes[${i}]`;
    if (!isRecord(archetype)) fail(path, "must be an object");
    const names = arrayAt(archetype["components"], `${path}.components`);
    for (const name of names) {
      const c = typeof name === "string" ? componentIndex.get(name) : undefined;
      if (c === undefined) fail(`${path}.components`, `names an unknown component ${JSON.stringify(name)}`);
      const word = i * wordsPerSet + (c >>> 5);
      const bit = 1 << (c & 31);
      if ((archetypeBits[word]! & bit) !== 0) fail(`${path}.components`, `repeats ${name}`);
      archetypeBits[word]! |= bit;
    }
    populations[i] = slotsOf(capacity, integers(archetype["slots"], `${path}.slots`, maxSlot));
  }

  const savedComponents = document["components"];
  if (!isRecord(savedComponents)) fail("components", "must be an object");
  for (const name of Object.keys(savedComponents)) {
    if (!componentIndex.has(name)) fail("components", `holds unknown component ${JSON.stringify(name)}`);
  }
  const components: ComponentImage[] = layout.components.map((component, c) => {
    const path = `components[${JSON.stringify(component.name)}]`;
    const saved = Object.hasOwn(savedComponents, component.name) ? savedComponents[component.name] : undefined;
    if (!isRecord(saved)) fail(path, "must be an object");
    const owners = integers(saved["owners"], `${path}.owners`, maxSlot);
    const changed = integers(saved["changed"], `${path}.changed`, maxSlot);
    const rows: TypedArray[] = [];
    const fields = component.fields;
    if (fields === null) {
      if (saved["values"] !== undefined) fail(`${path}.values`, "must be absent for a tag component");
    } else {
      const values = saved["values"];
      if (!isRecord(values)) fail(`${path}.values`, "must be an object");
      for (const key of Object.keys(values)) {
        if (!fields.some((field) => field.name === key)) {
          fail(`${path}.values`, `holds unknown field ${JSON.stringify(key)}`);
        }
      }
      for (let k = 0; k < fields.length; k++) {
        const fieldPath = `${path}.values[${JSON.stringify(fields[k]!.name)}]`;
        const list = arrayAt(Object.hasOwn(values, fields[k]!.name) ? values[fields[k]!.name] : undefined, fieldPath);
        if (list.length !== owners.length) fail(fieldPath, `must have one value per owner (${owners.length})`);
        const code = info.codes[c]![k]!;
        const row = new FIELD_TYPE_CONSTRUCTORS[code]!(owners.length);
        const range = INTEGER_RANGE[code];
        for (let j = 0; j < list.length; j++) {
          const value = decodeNumber(list[j]);
          if (value === undefined) fail(`${fieldPath}[${j}]`, "must be a number");
          if (range !== undefined && (!Number.isInteger(value) || value < range[0] || value > range[1])) {
            fail(`${fieldPath}[${j}]`, `must be an integer from ${range[0]} to ${range[1]}`);
          }
          row[j] = value;
        }
        rows.push(row);
      }
    }
    return { owners: slotsOf(capacity, owners), changed: slotsOf(capacity, changed), rows };
  });

  const window = document["window"];
  if (!isRecord(window)) fail("window", "must be an object");
  const windowSlots = integers(window["slots"], "window.slots", maxSlot);
  const originList = arrayAt(window["origins"], "window.origins");
  if (originList.length !== windowSlots.length) fail("window.origins", "must parallel window.slots");
  const windowOrigins = new Uint32Array(originList.length);
  for (let i = 0; i < originList.length; i++) {
    const origin = originList[i];
    if (origin === null) continue;
    if (typeof origin !== "number" || !Number.isInteger(origin) || origin < 0 || origin >= archetypeList.length) {
      fail(`window.origins[${i}]`, "must be null or an archetype index");
    }
    windowOrigins[i] = origin + 1;
  }
  const windowHandles = Uint32Array.from(
    integers(window["handles"], "window.handles", 0xffff_ffff, windowSlots.length),
  );

  const image: SaveImage = {
    capacity,
    layout,
    layoutBlock,
    info,
    layoutHashLow,
    layoutHashHigh,
    cursor,
    occupancy,
    nextGeneration: Uint32Array.from(nextGenerations),
    liveGeneration: Uint32Array.from(generations),
    wordsPerSet,
    archetypeBits,
    populations,
    components,
    windowSlots: slotsOf(capacity, windowSlots),
    windowOrigins,
    windowHandles,
  };
  validateImage(image, new ValidationScratch(capacity), 0);
  return image;
}

/**
 * Convert a binary world save to a JSON-safe document. `JSON.stringify` of the result round-trips losslessly through
 * {@link worldSaveFromJSON}, except that NaN payload bits are canonicalized.
 * @throws {WorldSaveError} When the save is malformed
 */
export function worldSaveToJSON(bytes: Uint8Array): WorldSaveDocument {
  const { image } = parseSave(bytes);
  validateImage(image, new ValidationScratch(image.capacity), 0);
  return imageToDoc(image);
}

/**
 * Convert a document from {@link worldSaveToJSON} (or a hand-built or migrated one) back to binary save bytes.
 * @throws {WorldSaveError} When the document is malformed or inconsistent
 */
export function worldSaveFromJSON(document: WorldSaveDocument): Uint8Array {
  return writeImage(docToImage(document));
}
