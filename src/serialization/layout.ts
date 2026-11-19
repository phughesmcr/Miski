import type { ComponentState } from "@/component/component-state.ts";
import { MIN_WORLD_CAPACITY } from "@/constants.ts";
import { MAX_WORLD_CAPACITY } from "@/entity/entity.ts";
import { isRelation, type Relation } from "@/relation/relation.ts";
import { isFieldDescriptor } from "@/schema/field.ts";
import {
  align8,
  fieldTypeCode,
  fieldTypeCodeOfName,
  fieldValueLimitOfName,
  isSideCode,
  NUMERIC_FIELD_TYPES,
  numericTypeCodeOfName,
  WorldSaveError,
  type WorldSaveFieldType,
} from "./format.ts";

/** One saved data field: its name and storage type, in storage column order. */
export type WorldSaveField = {
  readonly name: string;
  readonly type: WorldSaveFieldType;
};

/** Options and pair data fields of a saved relation. */
export type WorldSaveRelationLayout = {
  readonly exclusive: boolean;
  readonly acyclic: boolean;
  readonly onDeleteTarget: "remove" | "cascade";
  /** Pair data fields in schema order (numeric types only), or `null` for a relation without data. */
  readonly fields: readonly WorldSaveField[] | null;
};

/** One saved component, in world registration order. */
export type WorldSaveComponentLayout = {
  readonly name: string;
  /** The component's owner cap, or `null` when uncapped. */
  readonly maxEntities: number | null;
  /** Data fields in storage column order, or `null` for a tag component (and for a relation's presence tag). */
  readonly fields: readonly WorldSaveField[] | null;
  /** Present only for a relation: its options and pair data fields. */
  readonly relation?: WorldSaveRelationLayout;
};

/**
 * The storage layout a save was written with. A save loads only into a world whose layout is identical: same
 * capacity, and the same components in the same registration order with the same names, caps, fields and types.
 */
export type WorldSaveLayout = {
  readonly capacity: number;
  readonly components: readonly WorldSaveComponentLayout[];
};

/** A relation of a layout, with its pair data type codes. */
export type RelationInfo = {
  /** Index of the relation's presence tag among the layout's components. */
  readonly component: number;
  readonly name: string;
  readonly exclusive: boolean;
  readonly acyclic: boolean;
  /** Pair data type codes in schema order (empty without data). */
  readonly codes: readonly number[];
  /** Pair data field names, parallel to `codes`. */
  readonly keys: readonly string[];
};

/** Field type codes per component (`null` = tag), derived once from a layout. */
export type LayoutInfo = {
  readonly codes: readonly (readonly number[] | null)[];
  /** Owner cap per component, or 0 when uncapped. */
  readonly caps: readonly number[];
  /**
   * Value limit per typed storage row (side columns skipped, so parallel to a component image's `rows`), from
   * `fieldValueLimitOfName`; `null` for tags.
   */
  readonly limits: readonly (readonly number[] | null)[];
  /** Relations in registration order. */
  readonly relations: readonly RelationInfo[];
};

/** Describe a relation's options and pair data columns. */
function relationLayout(relation: Relation<never>): WorldSaveRelationLayout {
  const schema = relation.dataSchema as Record<string, unknown> | null;
  const keys = schema === null ? [] : Object.keys(schema);
  let fields: WorldSaveField[] | null = null;
  if (keys.length > 0) {
    fields = keys.map((key) => {
      const property = schema![key];
      const code = fieldTypeCode(property);
      if (code === 0) {
        throw new WorldSaveError(`Relation ${relation.name} pair field ${key} has an unsaveable storage type.`);
      }
      return Object.freeze({ name: key, type: NUMERIC_FIELD_TYPES[code]!.name });
    });
    Object.freeze(fields);
  }
  return Object.freeze({
    exclusive: relation.exclusive,
    acyclic: relation.acyclic,
    onDeleteTarget: relation.onDeleteTarget,
    fields,
  });
}

/** Describe the layout of a world's registered component states. */
export function layoutOfStates(capacity: number, states: readonly ComponentState[]): WorldSaveLayout {
  const components: WorldSaveComponentLayout[] = new Array(states.length);
  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    const type = state.instance.type;
    let fields: WorldSaveField[] | null = null;
    if (state.instance.storage !== null) {
      fields = new Array(state.storageKeys.length);
      for (let c = 0; c < state.storageKeys.length; c++) {
        const column = state.storageColumns[c]!;
        const constructor = ArrayBuffer.isView(column) ?
          column.constructor :
          (column as unknown as { readonly dense: { readonly constructor: unknown } }).dense.constructor;
        const key = state.storageKeys[c]!;
        const code = fieldTypeCode(constructor);
        if (code === 0) {
          throw new WorldSaveError(`Component ${type.name}.${key} has an unsaveable storage type.`);
        }
        // `field.*` columns record their hash tag, so the layout check sees the field kind and enum labels.
        const property = (type.schema as Record<string, unknown> | null)?.[key];
        const fieldType = isFieldDescriptor(property) ?
          property.tag as WorldSaveFieldType :
          NUMERIC_FIELD_TYPES[code]!.name;
        if (fieldTypeCodeOfName(fieldType) !== code) {
          throw new WorldSaveError(`Component ${type.name}.${key} has an unsaveable field type ${fieldType}.`);
        }
        fields[c] = Object.freeze({ name: key, type: fieldType });
      }
      // String and object fields follow the typed columns, in schema order.
      for (let s = 0; s < state.sideKeys.length; s++) {
        const key = state.sideKeys[s]!;
        const property = state.sideFields[s]!;
        if (property.kind === "object" && (property.encode === undefined || property.decode === undefined)) {
          throw new WorldSaveError(
            `Component ${type.name}.${key} is an object field without encode / decode hooks, so it cannot be saved.`,
          );
        }
        fields.push(Object.freeze({ name: key, type: property.tag }));
      }
      Object.freeze(fields);
    }
    const maxEntities = type.maxEntities ?? null;
    components[i] = Object.freeze(
      isRelation(type) ?
        { name: type.name, maxEntities, fields, relation: relationLayout(type as Relation<never>) } :
        { name: type.name, maxEntities, fields },
    );
  }
  return Object.freeze({ capacity, components: Object.freeze(components) });
}

export function layoutInfo(layout: WorldSaveLayout): LayoutInfo {
  const codes = layout.components.map((component) =>
    component.fields === null ? null : component.fields.map((field) => fieldTypeCodeOfName(field.type))
  );
  const caps = layout.components.map((component) => component.maxEntities ?? 0);
  const limits = layout.components.map((component) =>
    component.fields === null ? null : component.fields
      .filter((field) => !isSideCode(fieldTypeCodeOfName(field.type)))
      .map((field) => fieldValueLimitOfName(field.type))
  );
  const relations: RelationInfo[] = [];
  layout.components.forEach((component, c) => {
    const relation = component.relation;
    if (relation === undefined) return;
    const fields = relation.fields ?? [];
    relations.push({
      component: c,
      name: component.name,
      exclusive: relation.exclusive,
      acyclic: relation.acyclic,
      codes: fields.map((field) => fieldTypeCodeOfName(field.type)),
      keys: fields.map((field) => field.name),
    });
  });
  return { codes, caps, limits, relations };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Encode the component table (capacity lives in the save header), padded to 8 bytes.
 * Per component: u16 name length, UTF-8 name, u8 kind (0 tag, 1 data, 2 relation), u32 cap (0 = none), and for data
 * components u16 field count then per field u16 name length, UTF-8 name, u16 type tag length, UTF-8 type tag. A
 * relation adds u8 flags (1 exclusive, 2 acyclic, 4 cascade, 8 pair data) and, with pair data, its fields in the
 * same form. Type tags are the component hash tags ("f32", "u8c", ...), so new field types add tags without changing
 * the table format.
 */
export function encodeLayout(layout: WorldSaveLayout): Uint8Array {
  const parts: Uint8Array[] = [];
  let length = 0;
  const push = (part: Uint8Array): void => {
    parts.push(part);
    length += part.length;
  };
  const pushName = (name: string): void => {
    const bytes = encoder.encode(name);
    if (bytes.length > 0xffff) throw new WorldSaveError(`Name is too long to save: ${name.slice(0, 32)}...`);
    push(new Uint8Array([bytes.length & 0xff, bytes.length >>> 8]));
    push(bytes);
  };
  const pushFields = (fields: readonly WorldSaveField[]): void => {
    push(new Uint8Array([fields.length & 0xff, fields.length >>> 8]));
    for (const field of fields) {
      pushName(field.name);
      pushName(field.type);
    }
  };
  for (const component of layout.components) {
    pushName(component.name);
    const cap = component.maxEntities ?? 0;
    const relation = component.relation;
    push(
      new Uint8Array([
        relation !== undefined ? 2 : component.fields === null ? 0 : 1,
        cap & 0xff,
        (cap >>> 8) & 0xff,
        (cap >>> 16) & 0xff,
        cap >>> 24,
      ]),
    );
    if (relation !== undefined) {
      push(
        new Uint8Array([
          (relation.exclusive ? 1 : 0) | (relation.acyclic ? 2 : 0) | (relation.onDeleteTarget === "cascade" ? 4 : 0) |
          (relation.fields !== null ? 8 : 0),
        ]),
      );
      if (relation.fields !== null) pushFields(relation.fields);
      continue;
    }
    if (component.fields !== null) pushFields(component.fields);
  }
  const out = new Uint8Array(align8(length));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Decode a component table written by {@link encodeLayout}; throws {@link WorldSaveError} when malformed. */
export function decodeLayout(block: Uint8Array, capacity: number, componentCount: number): WorldSaveLayout {
  let offset = 0;
  const need = (bytes: number): void => {
    if (offset + bytes > block.length) throw new WorldSaveError("World save layout is truncated.");
  };
  const u8 = (): number => {
    need(1);
    return block[offset++]!;
  };
  const u16 = (): number => u8() | (u8() << 8);
  const name = (): string => {
    const length = u16();
    need(length);
    let text: string;
    try {
      text = decoder.decode(block.subarray(offset, offset + length));
    } catch (cause) {
      throw new WorldSaveError("World save layout holds an invalid name.", { cause });
    }
    offset += length;
    return text;
  };
  const readFields = (componentName: string): WorldSaveField[] => {
    const count = u16();
    const fields: WorldSaveField[] = [];
    for (let f = 0; f < count; f++) {
      const fieldName = name();
      const type = name();
      if (fieldTypeCodeOfName(type) === 0) {
        throw new WorldSaveError(
          `World save layout field ${componentName}.${fieldName} has unsupported type ${JSON.stringify(type)}.`,
        );
      }
      fields.push(Object.freeze({ name: fieldName, type: type as WorldSaveFieldType }));
    }
    return Object.freeze(fields) as WorldSaveField[];
  };
  const components: WorldSaveComponentLayout[] = [];
  for (let i = 0; i < componentCount; i++) {
    const componentName = name();
    const kind = u8();
    const cap = (u8() | (u8() << 8) | (u8() << 16) | (u8() << 24)) >>> 0;
    if (kind > 2) throw new WorldSaveError(`World save layout component ${i} has an unknown kind ${kind}.`);
    const maxEntities = cap === 0 ? null : cap;
    if (kind === 2) {
      const flags = u8();
      if (flags > 15) throw new WorldSaveError(`World save layout relation ${componentName} has unknown flags.`);
      const relation: WorldSaveRelationLayout = Object.freeze({
        exclusive: (flags & 1) !== 0,
        acyclic: (flags & 2) !== 0,
        onDeleteTarget: (flags & 4) !== 0 ? "cascade" : "remove",
        fields: (flags & 8) !== 0 ? readFields(componentName) : null,
      });
      components.push(Object.freeze({ name: componentName, maxEntities, fields: null, relation }));
      continue;
    }
    const fields = kind === 1 ? readFields(componentName) : null;
    components.push(Object.freeze({ name: componentName, maxEntities, fields }));
  }
  for (; offset < block.length; offset++) {
    if (block[offset] !== 0) throw new WorldSaveError("World save layout has trailing data.");
  }
  const layout = Object.freeze({ capacity, components: Object.freeze(components) });
  const problem = layoutProblem(layout);
  if (problem !== undefined) throw new WorldSaveError(`Invalid world save layout: ${problem}`);
  return layout;
}

/** @returns why a layout (for example from a hand-edited document) is invalid, or `undefined` */
export function layoutProblem(layout: unknown): string | undefined {
  if (typeof layout !== "object" || layout === null) return "layout must be an object";
  const { capacity, components } = layout as WorldSaveLayout;
  if (!Number.isInteger(capacity) || capacity < MIN_WORLD_CAPACITY || capacity > MAX_WORLD_CAPACITY) {
    return `capacity must be an integer from ${MIN_WORLD_CAPACITY} to ${MAX_WORLD_CAPACITY}`;
  }
  if (!Array.isArray(components) || components.length === 0) return "components must be a non-empty array";
  const names = new Set<string>();
  for (let i = 0; i < components.length; i++) {
    const component = components[i] as WorldSaveComponentLayout;
    if (typeof component !== "object" || component === null) return `component ${i} must be an object`;
    if (typeof component.name !== "string" || component.name === "") return `component ${i} needs a name`;
    if (names.has(component.name)) return `component name "${component.name}" is repeated`;
    names.add(component.name);
    const cap = component.maxEntities;
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 0xffffffff)) {
      return `component ${component.name} maxEntities must be null or a positive integer`;
    }
    if (component.relation !== undefined) {
      const problem = relationProblem(component);
      if (problem !== undefined) return problem;
      continue;
    }
    if (component.fields === null) continue;
    if (!Array.isArray(component.fields) || component.fields.length === 0) {
      return `component ${component.name} fields must be null (tag) or a non-empty array`;
    }
    const fieldNames = new Set<string>();
    for (const field of component.fields) {
      if (typeof field !== "object" || field === null || typeof field.name !== "string" || field.name === "") {
        return `component ${component.name} has a field without a name`;
      }
      if (fieldNames.has(field.name)) return `field ${component.name}.${field.name} is repeated`;
      fieldNames.add(field.name);
      if (fieldTypeCodeOfName(field.type) === 0) return `field ${component.name}.${field.name} has unknown type`;
    }
  }
  return undefined;
}

function relationProblem(component: WorldSaveComponentLayout): string | undefined {
  const relation = component.relation as unknown;
  const at = `relation ${component.name}`;
  if (typeof relation !== "object" || relation === null) return `${at} must be an object`;
  if (component.fields !== null) return `${at} fields must be null (pair data lives in relation.fields)`;
  const { exclusive, acyclic, onDeleteTarget, fields } = relation as WorldSaveRelationLayout;
  if (typeof exclusive !== "boolean" || typeof acyclic !== "boolean") return `${at} options must be booleans`;
  if (acyclic && !exclusive) return `${at} is acyclic, which requires exclusive`;
  if (onDeleteTarget !== "remove" && onDeleteTarget !== "cascade") {
    return `${at} onDeleteTarget must be "remove" or "cascade"`;
  }
  if (fields === null) return undefined;
  if (!Array.isArray(fields) || fields.length === 0) return `${at} fields must be null or a non-empty array`;
  const names = new Set<string>();
  for (const field of fields) {
    if (typeof field !== "object" || field === null || typeof field.name !== "string" || field.name === "") {
      return `${at} has a pair field without a name`;
    }
    if (names.has(field.name)) return `${at} pair field ${field.name} is repeated`;
    names.add(field.name);
    if (numericTypeCodeOfName(field.type) === 0) return `${at} pair field ${field.name} must have a numeric type`;
  }
  return undefined;
}

function compareFields(
  at: string,
  owner: string,
  a: readonly WorldSaveField[],
  b: readonly WorldSaveField[],
): string | undefined {
  const fields = Math.min(a.length, b.length);
  for (let f = 0; f < fields; f++) {
    const x = a[f]!;
    const y = b[f]!;
    if (x.name !== y.name) return `${at} (${owner}) field ${f}: save "${x.name}", world "${y.name}".`;
    if (x.type !== y.type) return `${at} (${owner}.${x.name}): save ${x.type}, world ${y.type}.`;
  }
  if (a.length !== b.length) return `${at} (${owner}): save has ${a.length} fields, world has ${b.length}.`;
  return undefined;
}

function compareRelations(
  at: string,
  name: string,
  a: WorldSaveRelationLayout | undefined,
  b: WorldSaveRelationLayout | undefined,
): string | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined || b === undefined) {
    return `${at} (${name}): save ${a === undefined ? "component" : "relation"}, world ${
      b === undefined ? "component" : "relation"
    }.`;
  }
  for (const option of ["exclusive", "acyclic", "onDeleteTarget"] as const) {
    if (a[option] !== b[option]) return `${at} (${name}): ${option} save ${a[option]}, world ${b[option]}.`;
  }
  if ((a.fields === null) !== (b.fields === null)) {
    return `${at} (${name}): save ${a.fields === null ? "has no" : "has"} pair data, world ${
      b.fields === null ? "has none" : "has"
    }.`;
  }
  return a.fields === null ? undefined : compareFields(at, `${name} pair data`, a.fields, b.fields!);
}

/** @returns the first difference between a save layout and a world layout, or `undefined` when identical */
export function compareLayouts(save: WorldSaveLayout, world: WorldSaveLayout): string | undefined {
  if (save.capacity !== world.capacity) {
    return `Save capacity ${save.capacity} does not match world capacity ${world.capacity}.`;
  }
  const count = Math.min(save.components.length, world.components.length);
  for (let i = 0; i < count; i++) {
    const a = save.components[i]!;
    const b = world.components[i]!;
    const at = `Save layout differs from the world at component ${i}`;
    if (a.name !== b.name) return `${at}: save "${a.name}", world "${b.name}".`;
    if (a.maxEntities !== b.maxEntities) {
      return `${at} (${a.name}): maxEntities save ${a.maxEntities}, world ${b.maxEntities}.`;
    }
    if ((a.fields === null) !== (b.fields === null)) {
      return `${at} (${a.name}): save ${a.fields === null ? "tag" : "data"}, world ${
        b.fields === null ? "tag" : "data"
      }.`;
    }
    const relation = compareRelations(at, a.name, a.relation, b.relation);
    if (relation !== undefined) return relation;
    if (a.fields === null || b.fields === null) continue;
    const fields = compareFields(at, a.name, a.fields, b.fields);
    if (fields !== undefined) return fields;
  }
  if (save.components.length !== world.components.length) {
    return `Save layout differs from the world at component ${count}: save has ${save.components.length} ` +
      `components, world has ${world.components.length}.`;
  }
  return undefined;
}
