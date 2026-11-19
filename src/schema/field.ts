import { SpecError } from "@/errors.ts";
import type { Entity } from "@/entity/entity.ts";

/** The non-numeric field kinds a component schema may declare with {@link field}. */
export type FieldKind = "bool" | "enum" | "entity" | "string" | "object";

/**
 * A boolean field. Stored as a `Uint8Array` column of 0 / 1; guarded reads return `boolean`.
 * New owners start at `false`.
 */
export interface BoolField {
  /** The field kind. */
  readonly kind: "bool";
  /** Stable schema-hash tag. */
  readonly tag: "bool";
  /** Phantom value type for inference; never set at runtime. */
  readonly __value?: boolean;
  /** Phantom raw column type for inference; never set at runtime. */
  readonly __raw?: Uint8Array;
}

/**
 * An enum field over a fixed list of string labels. Stored as a `Uint8Array` column of label indexes
 * (`Uint16Array` above 256 labels); guarded reads and writes use the label string. New owners start at the
 * first label.
 */
export interface EnumField<L extends string = string> {
  /** The field kind. */
  readonly kind: "enum";
  /** Stable schema-hash tag; includes the labels in order. */
  readonly tag: string;
  /** The labels, in declaration order. Raw storage holds an index into this list. */
  readonly labels: readonly L[];
  /** Phantom value type for inference; never set at runtime. */
  readonly __value?: L;
  /** Phantom raw column type for inference; never set at runtime. */
  readonly __raw?: Uint8Array | Uint16Array;
}

/**
 * A generation-checked entity reference. Stored as an `Int32Array` column of packed handles, with `-1` for none.
 * Guarded reads return `null` once the target is destroyed (even if its slot is reused); guarded writes accept a
 * live entity or `null`. New owners start at `null`.
 */
export interface EntityField {
  /** The field kind. */
  readonly kind: "entity";
  /** Stable schema-hash tag. */
  readonly tag: "entity";
  /** Phantom value type for inference; never set at runtime. */
  readonly __value?: Entity | null;
  /** Phantom raw column type for inference; never set at runtime. */
  readonly __raw?: Int32Array;
}

/**
 * A string field. Stored as a slot-indexed JS array sized to world capacity (also under `maxOwners`); new owners
 * start at `""`.
 */
export interface StringField {
  /** The field kind. */
  readonly kind: "string";
  /** Stable schema-hash tag. */
  readonly tag: "string";
  /** Phantom value type for inference; never set at runtime. */
  readonly __value?: string;
  /** Phantom raw column type for inference; never set at runtime. */
  readonly __raw?: string[];
}

/** Options for {@link field.object}. */
export interface ObjectFieldOptions<T> {
  /**
   * Build the value for a new owner that was attached without one. Called once per new owner, before ownership
   * changes. It must not mutate the world: values the running call has already staged are not protected from it.
   */
  create?(): T;
  /**
   * Copy a value for rollback capture, checkpoint capture and apply, and component copies. Without it those paths
   * share references, so changes made inside the object are not undone. Never called with `null`. Like `create`, it
   * must not mutate the world.
   */
  clone?(value: T): T;
  /**
   * Encode a value for saving as a JSON-safe primitive. Never called with `null`. World serialization refuses to save
   * a component whose object field has no `encode` / `decode` pair.
   */
  encode?(value: T): ObjectFieldEncoded;
  /** Rebuild a value from what {@link ObjectFieldOptions.encode} returned. Never called with `null`. */
  decode?(encoded: ObjectFieldEncoded): T;
}

/** The JSON-safe form an object field's `encode` hook produces. */
export type ObjectFieldEncoded = string | number | null;

/**
 * A field holding any JS value by reference (meshes, class instances, ...), or `null`. Stored as a slot-indexed JS
 * array sized to world capacity (also under `maxOwners`). New owners start at `create()` when given, otherwise `null`.
 * Removing the component releases the reference.
 */
export interface ObjectField<T = unknown> extends ObjectFieldOptions<T> {
  /** The field kind. */
  readonly kind: "object";
  /** Stable schema-hash tag. */
  readonly tag: "object";
  /** Phantom value type for inference; never set at runtime. */
  readonly __value?: T | null;
  /** Phantom raw column type for inference; never set at runtime. */
  readonly __raw?: (T | null)[];
}

/** Any non-numeric field descriptor created by {@link field}. */
export type FieldDescriptor = BoolField | EnumField<string> | EntityField | StringField | ObjectField<unknown>;

/** The guarded read / write value type of a field descriptor. */
export type FieldValue<F> = F extends BoolField ? boolean :
  F extends EnumField<infer L> ? L :
  F extends EntityField ? Entity | null :
  F extends StringField ? string :
  F extends ObjectField<infer T> ? T | null :
  never;

/** The raw `storage.partitions` column type of a field descriptor. */
export type FieldRaw<F> = F extends BoolField ? Uint8Array :
  F extends EnumField ? Uint8Array | Uint16Array :
  F extends EntityField ? Int32Array :
  F extends StringField ? string[] :
  F extends ObjectField<infer T> ? (T | null)[] :
  never;

/** Factory for non-numeric component fields. */
export interface FieldFactory {
  /** A boolean field (`Uint8Array` 0 / 1). */
  bool(): BoolField;
  /** An enum field over fixed string labels (index column; reads and writes use labels). */
  enum<const L extends readonly string[]>(labels: L): EnumField<L[number]>;
  /** A generation-checked entity reference (`Int32Array`, `-1` = none). */
  entity(): EntityField;
  /** A string field (slot-indexed JS array). */
  string(): StringField;
  /** A by-reference JS value field (slot-indexed JS array), with optional create / clone hooks. */
  object<T = unknown>(options?: ObjectFieldOptions<T>): ObjectField<T>;
}

/** Largest enum label count: indexes must fit a `Uint16Array`. */
const MAX_ENUM_LABELS = 65_536;

const descriptors = new WeakSet<object>();

function brand<T extends FieldDescriptor>(descriptor: T): T {
  Object.freeze(descriptor);
  descriptors.add(descriptor);
  return descriptor;
}

const BOOL_FIELD: BoolField = brand({ kind: "bool", tag: "bool" });
const ENTITY_FIELD: EntityField = brand({ kind: "entity", tag: "entity" });
const STRING_FIELD: StringField = brand({ kind: "string", tag: "string" });

function createEnumField<const L extends readonly string[]>(labels: L): EnumField<L[number]> {
  if (!Array.isArray(labels) || labels.length === 0) {
    throw new SpecError("field.enum() needs at least one label.");
  }
  if (labels.length > MAX_ENUM_LABELS) {
    throw new SpecError(`field.enum() supports at most ${MAX_ENUM_LABELS} labels.`);
  }
  const seen = new Set<string>();
  for (const label of labels) {
    if (typeof label !== "string") throw new SpecError("field.enum() labels must be strings.");
    if (seen.has(label)) throw new SpecError(`field.enum() has a duplicate label "${label}".`);
    seen.add(label);
  }
  const frozen = Object.freeze([...labels]) as readonly L[number][];
  return brand({ kind: "enum", tag: `enum:${JSON.stringify(frozen)}`, labels: frozen });
}

/** Optional object-field hooks, validated and copied onto the descriptor. None of them is hashed. */
const OBJECT_FIELD_HOOKS = ["create", "clone", "encode", "decode"] as const;

function createObjectField<T>(options?: ObjectFieldOptions<T>): ObjectField<T> {
  if (options !== undefined && (typeof options !== "object" || options === null)) {
    throw new SpecError("field.object() options must be an object.");
  }
  const descriptor: Record<string, unknown> = { kind: "object", tag: "object" };
  for (const hook of OBJECT_FIELD_HOOKS) {
    const fn = options?.[hook];
    if (fn === undefined) continue;
    if (typeof fn !== "function") throw new SpecError(`field.object() ${hook} must be a function.`);
    descriptor[hook] = fn;
  }
  if ((descriptor["encode"] === undefined) !== (descriptor["decode"] === undefined)) {
    throw new SpecError("field.object() needs both encode and decode, or neither.");
  }
  return brand(descriptor as unknown as ObjectField<unknown>) as ObjectField<T>;
}

/**
 * Declare non-numeric component fields. Numeric fields stay bare typed-array constructors.
 *
 * ```ts
 * const Unit = new Component({
 *   name: "unit",
 *   schema: {
 *     hp: Uint16Array,
 *     alive: field.bool(),
 *     state: field.enum(["idle", "run", "dead"]),
 *     target: field.entity(),
 *     label: field.string(),
 *     mesh: field.object<{ id: number }>({ create: () => ({ id: 0 }) }),
 *   },
 * });
 * ```
 */
export const field: FieldFactory = Object.freeze({
  bool: (): BoolField => BOOL_FIELD,
  enum: createEnumField,
  entity: (): EntityField => ENTITY_FIELD,
  string: (): StringField => STRING_FIELD,
  object: createObjectField,
});

/**
 * Check whether a value is a field descriptor created by {@link field}. Look-alike plain objects are not.
 * @returns `true` if `value` is a descriptor created by {@link field}
 */
export function isFieldDescriptor(value: unknown): value is FieldDescriptor {
  return typeof value === "object" && value !== null && descriptors.has(value);
}

/**
 * Copy one field value the way rollback, checkpoints and component copies do: object fields with a `clone` hook
 * are cloned (except `null`); every other value is returned as is.
 */
export function cloneFieldValue<V>(property: unknown, value: V): V {
  if (value === null || !isFieldDescriptor(property) || property.kind !== "object") return value;
  const clone = property.clone;
  return clone === undefined ? value : clone(value) as V;
}

/**
 * @internal
 * `true` for `field.entity()` descriptors. Lets non-throwing write paths (for example a deferred command buffer) map a
 * target that died since enqueue to `null` before the guarded write, matching how stale references read.
 */
export function isEntityField(value: unknown): value is EntityField {
  return isFieldDescriptor(value) && value.kind === "entity";
}

/**
 * @internal
 * Typed-array constructor backing a field, or `null` for side-stored (JS array) fields.
 */
export function fieldStorageConstructor(
  descriptor: FieldDescriptor,
): Uint8ArrayConstructor | Uint16ArrayConstructor | Int32ArrayConstructor | null {
  switch (descriptor.kind) {
    case "bool":
      return Uint8Array;
    case "enum":
      return descriptor.labels.length <= 256 ? Uint8Array : Uint16Array;
    case "entity":
      return Int32Array;
    default:
      return null;
  }
}
