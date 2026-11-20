/// <reference lib="deno.ns" />

import { ComponentDataError, type Entity, EntityNotFoundError, field } from "../mod.ts";
import {
  codecDefault,
  createFieldCodec,
  decodeFieldValue,
  encodeFieldValue,
  type FieldCodec,
  isSideField,
  NULL_ENTITY_REF,
  sideDefault,
  validateSideValue,
} from "../src/component/field-codec.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "./helpers.ts";

const LIVE = new Set<number>([0, 5, 0x7fff_ffff]);
const isActive = (entity: Entity): boolean => LIVE.has(entity);

function codecOf(descriptor: unknown): FieldCodec {
  const codec = createFieldCodec(descriptor);
  if (codec === null) throw new Error("expected a codec");
  return codec;
}

Deno.test("createFieldCodec lowers bool, enum and entity fields and nothing else", () => {
  assertEquals(createFieldCodec(field.bool()), { kind: "bool" }, "bool");
  assertEquals(createFieldCodec(field.entity()), { kind: "entity" }, "entity");
  const states = codecOf(field.enum(["idle", "run"]));
  assertStrictEquals(states.kind, "enum", "enum");
  if (states.kind === "enum") {
    assertEquals(states.labels, ["idle", "run"], "labels kept in order");
    assertEquals([...states.index], [["idle", 0], ["run", 1]], "label index");
  }
  for (const other of [Float32Array, field.string(), field.object(), undefined, null, {}, { kind: "bool" }, "bool"]) {
    assertStrictEquals(createFieldCodec(other), null, `${String(other)} has no codec`);
  }
});

Deno.test("side fields and defaults", () => {
  assertStrictEquals(isSideField(field.string()), true, "string is a side field");
  assertStrictEquals(isSideField(field.object()), true, "object is a side field");
  assertStrictEquals(isSideField(field.bool()), false, "bool is a typed column");
  assertStrictEquals(sideDefault(field.string()), "", "strings start empty");
  assertStrictEquals(sideDefault(field.object()), null, "objects start null");
  assertStrictEquals(codecDefault(null), 0, "numeric columns start at 0");
  assertStrictEquals(codecDefault(codecOf(field.bool())), 0, "bool starts false");
  assertStrictEquals(codecDefault(codecOf(field.enum(["a"]))), 0, "enum starts at its first label");
  assertStrictEquals(codecDefault(codecOf(field.entity())), NULL_ENTITY_REF, "entity starts as no reference");
  assertStrictEquals(NULL_ENTITY_REF, -1, "the null reference is -1");
});

Deno.test("bool fields encode true and false only", () => {
  const codec = codecOf(field.bool());
  assertStrictEquals(encodeFieldValue(codec, "Unit", "alive", true, isActive), 1, "true");
  assertStrictEquals(encodeFieldValue(codec, "Unit", "alive", false, isActive), 0, "false");
  for (const value of [1, 0, "true", null, undefined]) {
    assertThrows(
      () => encodeFieldValue(codec, "Unit", "alive", value, isActive),
      ComponentDataError,
      'Component Unit data field "alive" must be a boolean.',
    );
  }
  assertStrictEquals(decodeFieldValue(codec, 0, isActive), false, "0 reads false");
  assertStrictEquals(decodeFieldValue(codec, 1, isActive), true, "1 reads true");
  assertStrictEquals(decodeFieldValue(codec, 7, isActive), true, "any non-zero raw value reads true");
});

Deno.test("enum fields encode their own labels only", () => {
  const codec = codecOf(field.enum(["idle", "run", "dead"]));
  assertStrictEquals(encodeFieldValue(codec, "Unit", "state", "idle", isActive), 0, "first label");
  assertStrictEquals(encodeFieldValue(codec, "Unit", "state", "dead", isActive), 2, "last label");
  for (const value of ["fly", "", "toString", "constructor", 1, null]) {
    assertThrows(
      () => encodeFieldValue(codec, "Unit", "state", value, isActive),
      ComponentDataError,
      "must be one of its enum labels (idle, run, dead)",
    );
  }
  assertStrictEquals(decodeFieldValue(codec, 1, isActive), "run", "index to label");
  assertStrictEquals(decodeFieldValue(codec, 3, isActive), undefined, "an index past the labels has no label");
});

Deno.test("entity fields encode live handles and null, and decode dead handles as null", () => {
  const codec = codecOf(field.entity());
  assertStrictEquals(encodeFieldValue(codec, "Unit", "target", null, isActive), NULL_ENTITY_REF, "null");
  assertStrictEquals(encodeFieldValue(codec, "Unit", "target", 0, isActive), 0, "handle 0 is a real handle");
  assertStrictEquals(encodeFieldValue(codec, "Unit", "target", 5, isActive), 5, "a live handle");
  assertStrictEquals(encodeFieldValue(codec, "Unit", "target", 0x7fff_ffff, isActive), 0x7fff_ffff, "largest handle");
  for (const value of [-1, 1.5, Number.NaN, 0x8000_0000, "5", undefined, 5n]) {
    assertThrows(
      () => encodeFieldValue(codec, "Unit", "target", value, isActive),
      ComponentDataError,
      'Component Unit data field "target" must be an entity handle or null.',
    );
  }
  assertThrows(() => encodeFieldValue(codec, "Unit", "target", 6, isActive), EntityNotFoundError, "6");

  assertStrictEquals(decodeFieldValue(codec, NULL_ENTITY_REF, isActive), null, "no reference reads null");
  assertStrictEquals(decodeFieldValue(codec, 5, isActive), 5, "a live reference reads its handle");
  assertStrictEquals(decodeFieldValue(codec, 6, isActive), null, "a dead reference reads null");
});

Deno.test("validateSideValue rejects undefined everywhere and non-strings in string fields", () => {
  validateSideValue(field.string(), "Unit", "label", "");
  validateSideValue(field.object(), "Unit", "mesh", null);
  validateSideValue(field.object(), "Unit", "mesh", 42);
  for (const property of [field.string(), field.object()]) {
    assertThrows(
      () => validateSideValue(property, "Unit", "key", undefined),
      ComponentDataError,
      'Component Unit data field "key" cannot be undefined.',
    );
  }
  for (const value of [1, null, {}, false]) {
    assertThrows(
      () => validateSideValue(field.string(), "Unit", "label", value),
      ComponentDataError,
      'Component Unit data field "label" must be a string.',
    );
  }
});
