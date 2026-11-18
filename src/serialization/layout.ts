import type { SaveableComponentState } from "@/component/component-snapshot.ts";
import { MIN_WORLD_CAPACITY } from "@/constants.ts";
import { MAX_WORLD_CAPACITY } from "@/entity/entity.ts";
import {
  align8,
  FIELD_TYPE_NAMES,
  fieldTypeCode,
  fieldTypeCodeOfName,
  WorldSaveError,
  type WorldSaveFieldType,
} from "./format.ts";

/** One saved data field: its name and storage type, in storage column order. */
export type WorldSaveField = {
  readonly name: string;
  readonly type: WorldSaveFieldType;
};

/** One saved component, in world registration order. */
export type WorldSaveComponentLayout = {
  readonly name: string;
  /** The component's owner cap, or `null` when uncapped. */
  readonly maxEntities: number | null;
  /** Data fields in storage column order, or `null` for a tag component. */
  readonly fields: readonly WorldSaveField[] | null;
};

/**
 * The storage layout a save was written with. A save loads only into a world whose layout is identical: same
 * capacity, and the same components in the same registration order with the same names, caps, fields and types.
 */
export type WorldSaveLayout = {
  readonly capacity: number;
  readonly components: readonly WorldSaveComponentLayout[];
};

/** Field type codes per component (`null` = tag), derived once from a layout. */
export type LayoutInfo = {
  readonly codes: readonly (readonly number[] | null)[];
  /** Owner cap per component, or 0 when uncapped. */
  readonly caps: readonly number[];
};

/** Describe the layout of a world's registered component states. */
export function layoutOfStates(capacity: number, states: readonly SaveableComponentState[]): WorldSaveLayout {
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
        const code = fieldTypeCode(constructor);
        if (code === 0) {
          throw new WorldSaveError(`Component ${type.name}.${state.storageKeys[c]} has an unsaveable storage type.`);
        }
        fields[c] = Object.freeze({ name: state.storageKeys[c]!, type: FIELD_TYPE_NAMES[code] as WorldSaveFieldType });
      }
      Object.freeze(fields);
    }
    components[i] = Object.freeze({ name: type.name, maxEntities: type.maxEntities ?? null, fields });
  }
  return Object.freeze({ capacity, components: Object.freeze(components) });
}

export function layoutInfo(layout: WorldSaveLayout): LayoutInfo {
  const codes = layout.components.map((component) =>
    component.fields === null ? null : component.fields.map((field) => fieldTypeCodeOfName(field.type))
  );
  const caps = layout.components.map((component) => component.maxEntities ?? 0);
  return { codes, caps };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Encode the component table (capacity lives in the save header), padded to 8 bytes.
 * Per component: u16 name length, UTF-8 name, u8 kind (0 tag, 1 data), u32 cap (0 = none), and for data components
 * u16 field count then per field u16 name length, UTF-8 name, u8 type code.
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
  for (const component of layout.components) {
    pushName(component.name);
    const cap = component.maxEntities ?? 0;
    push(
      new Uint8Array([
        component.fields === null ? 0 : 1,
        cap & 0xff,
        (cap >>> 8) & 0xff,
        (cap >>> 16) & 0xff,
        cap >>> 24,
      ]),
    );
    if (component.fields === null) continue;
    push(new Uint8Array([component.fields.length & 0xff, component.fields.length >>> 8]));
    for (const field of component.fields) {
      pushName(field.name);
      push(new Uint8Array([fieldTypeCodeOfName(field.type)]));
    }
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
  const components: WorldSaveComponentLayout[] = [];
  for (let i = 0; i < componentCount; i++) {
    const componentName = name();
    const kind = u8();
    const cap = (u8() | (u8() << 8) | (u8() << 16) | (u8() << 24)) >>> 0;
    if (kind > 1) throw new WorldSaveError(`World save layout component ${i} has an unknown kind ${kind}.`);
    let fields: WorldSaveField[] | null = null;
    if (kind === 1) {
      const count = u16();
      fields = [];
      for (let f = 0; f < count; f++) {
        const fieldName = name();
        const code = u8();
        if (code === 0 || code >= FIELD_TYPE_NAMES.length) {
          throw new WorldSaveError(`World save layout field ${componentName}.${fieldName} has unknown type ${code}.`);
        }
        fields.push(Object.freeze({ name: fieldName, type: FIELD_TYPE_NAMES[code] as WorldSaveFieldType }));
      }
      Object.freeze(fields);
    }
    components.push(Object.freeze({ name: componentName, maxEntities: cap === 0 ? null : cap, fields }));
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
    if (a.fields === null || b.fields === null) continue;
    const fields = Math.min(a.fields.length, b.fields.length);
    for (let f = 0; f < fields; f++) {
      const x = a.fields[f]!;
      const y = b.fields[f]!;
      if (x.name !== y.name) return `${at} (${a.name}) field ${f}: save "${x.name}", world "${y.name}".`;
      if (x.type !== y.type) return `${at} (${a.name}.${x.name}): save ${x.type}, world ${y.type}.`;
    }
    if (a.fields.length !== b.fields.length) {
      return `${at} (${a.name}): save has ${a.fields.length} fields, world has ${b.fields.length}.`;
    }
  }
  if (save.components.length !== world.components.length) {
    return `Save layout differs from the world at component ${count}: save has ${save.components.length} ` +
      `components, world has ${world.components.length}.`;
  }
  return undefined;
}
