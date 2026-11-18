import type { Entity } from "@/entity/entity.ts";
import { ComponentDataError, EntityNotFoundError, formatEntityNotActive } from "@/errors.ts";
import { type FieldDescriptor, isFieldDescriptor, type ObjectField, type StringField } from "@/schema/field.ts";

/** Largest packed entity handle an entity field can hold. */
const MAX_ENTITY_HANDLE = 0x7fff_ffff;

/** Raw value of an entity field that holds no reference. */
export const NULL_ENTITY_REF = -1;

/** Encode / decode rules for a field lowered into a typed column (bool, enum, entity). */
export type FieldCodec =
  | { readonly kind: "bool" }
  | { readonly kind: "enum"; readonly labels: readonly string[]; readonly index: ReadonlyMap<string, number> }
  | { readonly kind: "entity" };

/** A field stored in a slot-indexed JS array instead of the world buffer. */
export type SideField = StringField | ObjectField<unknown>;

/** @returns the codec for a lowered field, or `null` for numeric columns and side fields */
export function createFieldCodec(property: unknown): FieldCodec | null {
  if (!isFieldDescriptor(property)) return null;
  switch (property.kind) {
    case "bool":
      return { kind: "bool" };
    case "enum":
      return { kind: "enum", labels: property.labels, index: new Map(property.labels.map((label, i) => [label, i])) };
    case "entity":
      return { kind: "entity" };
    default:
      return null;
  }
}

/** @returns `true` if a descriptor is stored in a side (JS array) column */
export function isSideField(property: FieldDescriptor): property is SideField {
  return property.kind === "string" || property.kind === "object";
}

/** Raw value a new owner's typed column starts at. */
export function codecDefault(codec: FieldCodec | null): number {
  return codec !== null && codec.kind === "entity" ? NULL_ENTITY_REF : 0;
}

/** Value a side cell holds when unowned or newly owned without `create`. */
export function sideDefault(property: SideField): unknown {
  return property.kind === "string" ? "" : null;
}

/**
 * Encode a guarded value into its raw typed-column form.
 * @throws {ComponentDataError} If the value has the wrong type
 * @throws {EntityNotFoundError} If an entity field is given a handle that is not live
 */
export function encodeFieldValue(
  codec: FieldCodec,
  componentName: string,
  key: string,
  value: unknown,
  isActive: (entity: Entity) => boolean,
): number {
  switch (codec.kind) {
    case "bool":
      if (typeof value !== "boolean") {
        throw new ComponentDataError(`Component ${componentName} data field "${key}" must be a boolean.`);
      }
      return value ? 1 : 0;
    case "enum": {
      const index = typeof value === "string" ? codec.index.get(value) : undefined;
      if (index === undefined) {
        throw new ComponentDataError(
          `Component ${componentName} data field "${key}" must be one of its enum labels (${codec.labels.join(", ")}).`,
        );
      }
      return index;
    }
    case "entity":
      if (value === null) return NULL_ENTITY_REF;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_ENTITY_HANDLE) {
        throw new ComponentDataError(
          `Component ${componentName} data field "${key}" must be an entity handle or null.`,
        );
      }
      if (!isActive(value as Entity)) throw new EntityNotFoundError(formatEntityNotActive(value as Entity));
      return value;
  }
}

/** Decode a raw typed-column value; stale or absent entity references read as `null`. */
export function decodeFieldValue(
  codec: FieldCodec,
  raw: number,
  isActive: (entity: Entity) => boolean,
): unknown {
  switch (codec.kind) {
    case "bool":
      return raw !== 0;
    case "enum":
      return codec.labels[raw];
    case "entity":
      return raw < 0 || !isActive(raw as Entity) ? null : raw;
  }
}

/**
 * Validate a guarded side-field value.
 * @throws {ComponentDataError} If the value has the wrong type
 */
export function validateSideValue(property: SideField, componentName: string, key: string, value: unknown): void {
  if (value === undefined) {
    throw new ComponentDataError(`Component ${componentName} data field "${key}" cannot be undefined.`);
  }
  if (property.kind === "string" && typeof value !== "string") {
    throw new ComponentDataError(`Component ${componentName} data field "${key}" must be a string.`);
  }
}
