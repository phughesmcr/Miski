import { createSlotArray, type EntityArray, entityIndex } from "@/entity/entity.ts";
import type { ComponentStateSnapshot } from "@/component/component-snapshot.ts";
import type { TypedArray } from "@/types/partitions.ts";
import {
  CODE_OBJECT,
  CODE_STRING,
  FORMAT_VERSION,
  hashBytes64,
  NUMERIC_FIELD_TYPES,
  utf8Length,
  wordCount,
  WorldSaveError,
} from "./format.ts";
import { NO_SIDE_ROWS, type RelationImage, type SaveImage } from "./image-types.ts";
import { parseSave } from "./image-read.ts";
import { validateImage, ValidationScratch } from "./image-validate.ts";
import { writeImage } from "./image-write.ts";
import {
  decodeLayout,
  encodeLayout,
  layoutInfo,
  layoutProblem,
  type RelationInfo,
  type WorldSaveLayout,
} from "./layout.ts";

/** A saved number. Values JSON cannot hold are spelled as strings. */
export type WorldSaveNumber = number | "NaN" | "Infinity" | "-Infinity" | "-0";

/**
 * One saved `field.object()` cell: what the field's `encode` hook returned. `null` is a null object. Numbers JSON
 * cannot hold are spelled `{ number: "NaN" }` (and so on), so they never read as an encoded string.
 */
export type WorldSaveObjectValue =
  | string
  | number
  | null
  | { readonly number: "NaN" | "Infinity" | "-Infinity" | "-0" };

/** One saved field column: numbers for numeric and typed fields, strings, or encoded object cells. */
export type WorldSaveFieldValues = readonly WorldSaveNumber[] | readonly string[] | readonly WorldSaveObjectValue[];

/** One saved component: owners and changed slots in iteration order, and owned values per field. */
export type WorldSaveComponentDocument = {
  /** Owner slots in owner-iteration order. */
  readonly owners: readonly number[];
  /** Changed slots in changed-iteration order (a subset of `owners`). */
  readonly changed: readonly number[];
  /**
   * Owned values per field, each parallel to `owners`; absent for tag components. String fields hold strings and
   * object fields hold {@link WorldSaveObjectValue} cells.
   */
  readonly values?: Readonly<Record<string, WorldSaveFieldValues>>;
};

/** One saved relation pair. */
export type WorldSaveRelationPair = {
  /** Pair row (the index into the relation's pair data; the source slot for an exclusive relation). */
  readonly row: number;
  /** Target entity handle. */
  readonly target: number;
  /** Pair data by field; absent for relations without data. */
  readonly data?: Readonly<Record<string, WorldSaveNumber>>;
};

/** One saved relation: its pair pool, pairs by source, target lists and changed sources, all in store order. */
export type WorldSaveRelationDocument = {
  /** Pair pool high-water mark (0 for exclusive relations). */
  readonly highWater: number;
  /** Free pair rows, bottom of the free stack first. */
  readonly freeRows: readonly number[];
  /** Sources in live order, each with its pairs in target order. */
  readonly sources: readonly { readonly slot: number; readonly pairs: readonly WorldSaveRelationPair[] }[];
  /** Targets in first-targeted order, each with its sources' slots in that target's order. */
  readonly targets: readonly { readonly slot: number; readonly sources: readonly number[] }[];
  /** Changed sources in changed-iteration order. */
  readonly changed: readonly number[];
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
  /** Relations keyed by name; present only when the layout has relations. */
  readonly relations?: Readonly<Record<string, WorldSaveRelationDocument>>;
};

function encodeNumber(value: number): WorldSaveNumber {
  if (Number.isFinite(value)) return Object.is(value, -0) ? "-0" : value;
  if (Number.isNaN(value)) return "NaN";
  return value > 0 ? "Infinity" : "-Infinity";
}

function encodeObjectValue(value: unknown): WorldSaveObjectValue {
  if (typeof value !== "number") return value as string | null;
  const encoded = encodeNumber(value);
  return typeof encoded === "number" ? encoded : { number: encoded };
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
        values: (() => {
          const codes = image.info.codes[c]!;
          // Entries, not assignment: a field named `__proto__` must stay an own key.
          const out: [string, WorldSaveFieldValues][] = new Array(codes.length);
          let t = 0;
          let s = 0;
          for (let k = 0; k < codes.length; k++) {
            const name = component.fields![k]!.name;
            if (codes[k] === CODE_STRING) {
              out[k] = [name, (saved.sideRows[s++]! as string[]).slice()];
            } else if (codes[k] === CODE_OBJECT) {
              out[k] = [name, saved.sideRows[s++]!.map(encodeObjectValue)];
            } else {
              const row = saved.rows[t++]!;
              const values: WorldSaveNumber[] = new Array(row.length);
              for (let j = 0; j < row.length; j++) values[j] = encodeNumber(row[j]!);
              out[k] = [name, values];
            }
          }
          return Object.fromEntries(out);
        })(),
      };
    return [component.name, entry];
  }));
  const origins: (number | null)[] = new Array(image.windowOrigins.length);
  for (let i = 0; i < origins.length; i++) {
    origins[i] = image.windowOrigins[i] === 0 ? null : image.windowOrigins[i]! - 1;
  }
  const document: WorldSaveDocument = {
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
  const relations = image.info.relations;
  if (relations.length === 0) return document;
  return {
    ...document,
    relations: Object.fromEntries(relations.map((info, r) => [info.name, relationToDoc(info, image.relations[r]!)])),
  };
}

function relationToDoc(info: RelationInfo, relation: RelationImage): WorldSaveRelationDocument {
  const sources: { slot: number; pairs: WorldSaveRelationPair[] }[] = [];
  let k = 0;
  for (let i = 0; i < relation.sources.length; i++) {
    const pairs: WorldSaveRelationPair[] = [];
    const end = k + relation.sourceCounts[i]!;
    for (; k < end; k++) {
      const pair = { row: relation.rows[k]!, target: relation.targets[k]! };
      if (info.codes.length === 0) {
        pairs.push(pair);
        continue;
      }
      const data: [string, WorldSaveNumber][] = new Array(info.codes.length);
      for (let c = 0; c < info.codes.length; c++) data[c] = [info.keys[c]!, encodeNumber(relation.data[c]![k]!)];
      pairs.push({ ...pair, data: Object.fromEntries(data) });
    }
    sources.push({ slot: relation.sources[i]!, pairs });
  }
  // Target list lengths are not stored: count each target's pairs.
  const counts = new Map<number, number>();
  for (let j = 0; j < relation.targets.length; j++) {
    const slot = entityIndex(relation.targets[j]!);
    counts.set(slot, (counts.get(slot) ?? 0) + 1);
  }
  let j = 0;
  const targets = Array.from(relation.targetSlots, (slot) => {
    const end = j + (counts.get(slot) ?? 0);
    const list = toArray(relation.sourcesByTarget.subarray(j, end));
    j = end;
    return { slot, sources: list };
  });
  return {
    highWater: relation.highWater,
    freeRows: toArray(relation.freeRows),
    sources,
    targets,
    changed: toArray(relation.changed),
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

/** Check one string or object cell of a document and return its image form. */
function sideCell(code: number, value: unknown, path: string): unknown {
  if (typeof value === "string") {
    if (utf8Length(value) < 0) fail(path, "must not hold a lone surrogate");
    return value;
  }
  if (code === CODE_STRING) fail(path, "must be a string");
  if (value === null || typeof value === "number") return value;
  if (isRecord(value) && Object.keys(value).length === 1 && typeof value["number"] === "string") {
    const number = decodeNumber(value["number"]);
    if (number !== undefined) return number;
  }
  fail(path, 'must be a string, number, null or { number: "NaN" | "Infinity" | "-Infinity" | "-0" }');
}

function slotsOf(capacity: number, list: readonly number[]): EntityArray {
  const out = createSlotArray(capacity, list.length);
  for (let i = 0; i < list.length; i++) out[i] = list[i]!;
  return out;
}

/**
 * Convert and fully validate a document; throws {@link WorldSaveError} naming the first problem.
 * @param scratch - Validation scratch to reuse when its capacity matches the document's
 */
export function docToImage(document: unknown, scratch?: ValidationScratch): SaveImage {
  if (!isRecord(document)) fail("document", "must be an object");
  if (document["format"] !== "miski-world") fail("format", 'must be "miski-world"');
  const version = document["version"];
  if (version !== FORMAT_VERSION) fail("version", `must be ${FORMAT_VERSION} (got ${String(version)})`);
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
  const components: ComponentStateSnapshot[] = layout.components.map((component, c) => {
    const path = `components[${JSON.stringify(component.name)}]`;
    const saved = Object.hasOwn(savedComponents, component.name) ? savedComponents[component.name] : undefined;
    if (!isRecord(saved)) fail(path, "must be an object");
    const owners = integers(saved["owners"], `${path}.owners`, maxSlot);
    const changed = integers(saved["changed"], `${path}.changed`, maxSlot);
    const rows: TypedArray[] = [];
    let sideRows = NO_SIDE_ROWS;
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
        if (code === CODE_STRING || code === CODE_OBJECT) {
          const cells = new Array<unknown>(list.length);
          for (let j = 0; j < list.length; j++) cells[j] = sideCell(code, list[j], `${fieldPath}[${j}]`);
          if (sideRows === NO_SIDE_ROWS) sideRows = [];
          (sideRows as unknown[][]).push(cells);
          continue;
        }
        const type = NUMERIC_FIELD_TYPES[code]!;
        const row = new type.ctor(owners.length);
        const range = type.intRange;
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
    return { owners: slotsOf(capacity, owners), changed: slotsOf(capacity, changed), rows, sideRows };
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

  const relations = relationsFromDoc(document["relations"], info.relations, capacity);

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
    relations,
  };
  validateImage(image, scratch?.capacity === capacity ? scratch : new ValidationScratch(capacity), 0);
  return image;
}

function integerAt(value: unknown, path: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    fail(path, `must be an integer from 0 to ${max}`);
  }
  return value;
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, "must be an object");
  return value;
}

/** Shape-check the document's relations; the pair index itself is checked by `validateImage`. */
function relationsFromDoc(value: unknown, infos: readonly RelationInfo[], capacity: number): RelationImage[] {
  if (infos.length === 0) {
    if (value !== undefined) fail("relations", "must be absent for a layout without relations");
    return [];
  }
  const saved = recordAt(value, "relations");
  for (const name of Object.keys(saved)) {
    if (!infos.some((info) => info.name === name)) fail("relations", `holds unknown relation ${JSON.stringify(name)}`);
  }
  const maxSlot = capacity - 1;
  return infos.map((info): RelationImage => {
    const path = `relations[${JSON.stringify(info.name)}]`;
    const entry = recordAt(Object.hasOwn(saved, info.name) ? saved[info.name] : undefined, path);
    const highWater = integerAt(entry["highWater"], `${path}.highWater`, 0xffff_ffff);
    const freeRows = Uint32Array.from(integers(entry["freeRows"], `${path}.freeRows`, 0xffff_ffff));
    const sourceList = arrayAt(entry["sources"], `${path}.sources`);
    const sources = new Uint32Array(sourceList.length);
    const sourceCounts = new Uint32Array(sourceList.length);
    const rows: number[] = [];
    const targets: number[] = [];
    const columns: number[][] = info.codes.map(() => []);
    for (let i = 0; i < sourceList.length; i++) {
      const sourcePath = `${path}.sources[${i}]`;
      const source = recordAt(sourceList[i], sourcePath);
      sources[i] = integerAt(source["slot"], `${sourcePath}.slot`, maxSlot);
      const pairs = arrayAt(source["pairs"], `${sourcePath}.pairs`);
      sourceCounts[i] = pairs.length;
      for (let p = 0; p < pairs.length; p++) {
        const pairPath = `${sourcePath}.pairs[${p}]`;
        const pair = recordAt(pairs[p], pairPath);
        rows.push(integerAt(pair["row"], `${pairPath}.row`, 0xffff_ffff));
        targets.push(integerAt(pair["target"], `${pairPath}.target`, 0x7fff_ffff));
        const data = pair["data"];
        if (info.codes.length === 0) {
          if (data !== undefined) fail(`${pairPath}.data`, "must be absent for a relation without data");
          continue;
        }
        const values = recordAt(data, `${pairPath}.data`);
        for (const key of Object.keys(values)) {
          if (!info.keys.includes(key)) fail(`${pairPath}.data`, `holds unknown field ${JSON.stringify(key)}`);
        }
        for (let c = 0; c < info.codes.length; c++) {
          const fieldPath = `${pairPath}.data[${JSON.stringify(info.keys[c])}]`;
          const number = decodeNumber(Object.hasOwn(values, info.keys[c]!) ? values[info.keys[c]!] : undefined);
          if (number === undefined) fail(fieldPath, "must be a number");
          const range = NUMERIC_FIELD_TYPES[info.codes[c]!]!.intRange;
          if (range !== undefined && (!Number.isInteger(number) || number < range[0] || number > range[1])) {
            fail(fieldPath, `must be an integer from ${range[0]} to ${range[1]}`);
          }
          columns[c]!.push(number);
        }
      }
    }
    const targetList = arrayAt(entry["targets"], `${path}.targets`);
    const targetSlots = new Uint32Array(targetList.length);
    const sourcesByTarget: number[] = [];
    for (let t = 0; t < targetList.length; t++) {
      const targetPath = `${path}.targets[${t}]`;
      const target = recordAt(targetList[t], targetPath);
      targetSlots[t] = integerAt(target["slot"], `${targetPath}.slot`, maxSlot);
      for (const slot of integers(target["sources"], `${targetPath}.sources`, maxSlot)) sourcesByTarget.push(slot);
    }
    // The section stores target lists back to back, so their total length must be the pair count.
    if (sourcesByTarget.length !== rows.length) {
      fail(`${path}.targets`, "must name one source per pair, so its target lists are corrupt");
    }
    return {
      highWater,
      freeRows,
      sources,
      sourceCounts,
      rows: Uint32Array.from(rows),
      targets: Uint32Array.from(targets),
      data: columns.map((column, c) => {
        const out = new NUMERIC_FIELD_TYPES[info.codes[c]!]!.ctor(column.length);
        for (let j = 0; j < column.length; j++) out[j] = column[j]!;
        return out;
      }),
      targetSlots,
      sourcesByTarget: Uint32Array.from(sourcesByTarget),
      changed: Uint32Array.from(integers(entry["changed"], `${path}.changed`, maxSlot)),
    };
  });
}

/**
 * Convert a binary world save to a plain, JSON-safe document. `JSON.stringify` of the result round-trips losslessly
 * through {@link worldSaveFromDocument}, except that NaN payload bits are canonicalized.
 * @throws {WorldSaveError} When the save is malformed
 */
export function worldSaveToDocument(bytes: Uint8Array): WorldSaveDocument {
  const { image } = parseSave(bytes);
  validateImage(image, new ValidationScratch(image.capacity), 0);
  return imageToDoc(image);
}

/**
 * Convert a document from {@link worldSaveToDocument} (or a parsed, hand-built or migrated one) back to binary save
 * bytes.
 * @throws {WorldSaveError} When the document is malformed or inconsistent
 */
export function worldSaveFromDocument(document: WorldSaveDocument): Uint8Array {
  return writeImage(docToImage(document));
}
