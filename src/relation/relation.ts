import type { SchemaProperty } from "@phughesmcr/partitionedbuffer";
import { Component, isValidComponentSpec } from "@/component/component.ts";
import { SpecError } from "@/errors.ts";
import { isFieldDescriptor } from "@/schema/field.ts";
import type { SchemaOrNull } from "@/types/partitions.ts";

/** What happens to a relation's sources when one of its targets is destroyed. */
export type RelationDeletePolicy = "remove" | "cascade";

/** Options shared by every relation spec. */
export type RelationSpecBase = {
  /** The relation's label (shares the component namespace of the world). */
  name: string;
  /** A source has at most one target; adding another replaces it. Defaults to `false`. */
  exclusive?: boolean;
  /** Reject pairs that would close a cycle (requires `exclusive`). Defaults to `false`. */
  acyclic?: boolean;
  /**
   * When a target is destroyed: `"remove"` (default) drops the pairs that point at it,
   * `"cascade"` destroys their sources as well.
   */
  onDeleteTarget?: RelationDeletePolicy;
};

/** Spec for a relation without pair data. */
export type TagRelationSpec = RelationSpecBase & {
  /** Tag relations omit schema (or pass null explicitly). */
  schema?: null;
};

/** Spec for a relation whose pairs carry numeric data. */
export type DataRelationSpec<TSchema extends Record<string, SchemaProperty>> = RelationSpecBase & {
  /** Per-pair numeric fields, stored as typed-array columns indexed by pair row. */
  schema: TSchema;
};

/** Any relation spec. */
export type RelationSpec = TagRelationSpec | DataRelationSpec<Record<string, SchemaProperty>>;

/**
 * A relation between entities, such as `ChildOf(parent)` or `Targets(enemy)`.
 *
 * A relation is registered like a component (pass it in `WorldSpec.components`). Its presence is a tag
 * component: a source entity owns it while it has at least one target, so `new Query({ all: [ChildOf] })`
 * matches every entity with any target. Targets, reverse lookups and pair data live beside the archetypes
 * and are reached through `world.relations`.
 */
export interface Relation<TSchema extends SchemaOrNull = null> extends Component<null, null> {
  /** A source has at most one target. */
  readonly exclusive: boolean;
  /** Pairs that would close a cycle are rejected. */
  readonly acyclic: boolean;
  /** Policy applied to sources when a target is destroyed. */
  readonly onDeleteTarget: RelationDeletePolicy;
  /** The per-pair data fields, or `null` for relations without data. */
  readonly dataSchema: Readonly<TSchema> | null;
}

/** Construct signatures for {@link Relation}. */
export interface RelationConstructor {
  /** Create a relation whose pairs carry no data. */
  new (spec: TagRelationSpec): Relation<null>;
  /** Create a relation whose pairs carry numeric data, inferring the columns from `schema`. */
  new <TSchema extends Record<string, SchemaProperty>>(spec: DataRelationSpec<TSchema>): Relation<TSchema>;
}

const TagComponentBase = Component as unknown as new (spec: { name: string }) => Component<null, null>;

function invalid(detail: string): Error {
  return new SpecError(`Invalid relation specification: ${detail}`);
}

/** Validate a relation spec, throwing a SpecError that names the faulty option. */
function validateRelationSpec(spec: unknown): asserts spec is RelationSpec {
  if (!spec || typeof spec !== "object") throw invalid("expected an object.");
  const s = spec as RelationSpec;
  // Reuse the component rules for the name and the data columns (supported arrays, reserved fields).
  if (!isValidComponentSpec({ name: s.name, schema: s.schema ?? null })) {
    throw invalid("name or schema is not valid for a component.");
  }
  if (s.schema) {
    for (const key of Object.keys(s.schema)) {
      if (isFieldDescriptor((s.schema as Record<string, unknown>)[key])) {
        throw invalid(`pair data field "${key}" must be a numeric typed array; field.* descriptors are not supported.`);
      }
    }
  }
  if (s.exclusive !== undefined && typeof s.exclusive !== "boolean") throw invalid("exclusive must be a boolean.");
  if (s.acyclic !== undefined && typeof s.acyclic !== "boolean") throw invalid("acyclic must be a boolean.");
  if (s.acyclic === true && s.exclusive !== true) throw invalid("acyclic requires exclusive.");
  if (s.onDeleteTarget !== undefined && s.onDeleteTarget !== "remove" && s.onDeleteTarget !== "cascade") {
    throw invalid('onDeleteTarget must be "remove" or "cascade".');
  }
}

class RelationRuntime<TSchema extends SchemaOrNull = null> extends TagComponentBase {
  readonly exclusive: boolean;
  readonly acyclic: boolean;
  readonly onDeleteTarget: RelationDeletePolicy;
  readonly dataSchema: Readonly<TSchema> | null;

  /**
   * Create a relation.
   * @throws {SpecError} - If the spec is invalid
   */
  constructor(spec: RelationSpec) {
    validateRelationSpec(spec);
    super({ name: spec.name });
    this.exclusive = spec.exclusive === true;
    this.acyclic = spec.acyclic === true;
    this.onDeleteTarget = spec.onDeleteTarget ?? "remove";
    this.dataSchema = spec.schema ? Object.freeze({ ...spec.schema }) as unknown as Readonly<TSchema> : null;
  }
}

/**
 * Check whether a value is a relation (a {@link Relation} presence tag).
 * @param value the value to check
 * @returns `true` if `value` is a {@link Relation}
 */
export function isRelation(value: unknown): value is Relation<SchemaOrNull> {
  return value instanceof RelationRuntime;
}

/** A relation between entities. See the {@link Relation} interface. */
export const Relation: RelationConstructor = RelationRuntime as unknown as RelationConstructor;
