import mocha from "mocha";
const { describe, it } = mocha;
import { assert } from "chai";

import {
  createWorld,
  createEntity,
  defineDataStore, getDataFromStore, isValidSchema, setDataInStore, createComponent, registerComponent, addComponentToEntity
} from "../demo/miski.min.js";

const guard = (property) => (!isNaN(property));
const initial = () => 0;
const name = "i32";
const arrayType = Int32Array;
const prefill = false;

const i32Proto = {
  arrayType,
  guard,
  initial,
  name,
  prefill,
};

const testComponentProto = {
  name: "test",
  schema: {
    value: null,
  },
};

const EXPECTED_DATASTORE_KEYS = [
  "arrayType",
  "initial",
  "guard",
  "name",
  "prefill",
  "getProp",
  "setProp",
  "isTypedArray"
];

const EXPECTED_INSTANCE_KEYS = [
  "world",
];

describe("Schema", function() {
  it("defines a DataStore without error", function() {
    const i32 = defineDataStore(i32Proto);
    assert.exists(i32);
    assert.isObject(i32);
    assert.equal(i32.arrayType, arrayType);
    assert.equal(i32.guard, guard);
    assert.equal(i32.initial, initial);
    assert.equal(i32.name, name);
    assert.equal(i32.prefill, prefill);
  });
  it("defines a DataStoreInstance without error", function() {
    const i32 = defineDataStore(i32Proto);
    const world = createWorld();
    const component = createComponent({...testComponentProto, schema: { value: i32 }});
    const inst = registerComponent(world, component);
    assert.exists(inst);
    assert.hasAnyKeys(inst.value, EXPECTED_INSTANCE_KEYS);
    assert.instanceOf(inst.value, arrayType);
  });
  it("sets data in a DataStoreInstance without error", function() {
    const i32 = defineDataStore(i32Proto);
    const world = createWorld();
    const component = createComponent({...testComponentProto, schema: { value: i32 }});
    const inst = registerComponent(world, component);
    const entity = createEntity(world);
    addComponentToEntity(inst, entity);
    setDataInStore(inst.value, entity, 100);
    assert.equal(inst.value[entity], 100);
  });
  it("fails to set invalid data in a DataStoreInstance", function() {
    const i32 = defineDataStore(i32Proto);
    const world = createWorld();
    const component = createComponent({...testComponentProto, schema: { value: i32 }});
    const inst = registerComponent(world, component);
    const entity = createEntity(world);
    addComponentToEntity(inst, entity);
    assert.throws(() => setDataInStore(inst.value, entity, "hello"));
  });
  it("fails to set data for nonexistent entity in a DataStoreInstance", function() {
    const i32 = defineDataStore(i32Proto);
    const world = createWorld();
    const component = createComponent({...testComponentProto, schema: { value: i32 }});
    const inst = registerComponent(world, component);
    const entity = createEntity(world);
    addComponentToEntity(inst, entity);
    assert.throws(() => setDataInStore(inst.value, 100_000, 100));
  });
  it("gets data from a DataStoreInstance without error", function() {
    const i32 = defineDataStore(i32Proto);
    const world = createWorld();
    const component = createComponent({...testComponentProto, schema: { value: i32 }});
    const inst = registerComponent(world, component);
    const entity = createEntity(world);
    addComponentToEntity(inst, entity);
    setDataInStore(inst.value, entity, 100);
    const val = getDataFromStore(inst.value, entity);
    assert.equal(val, 100);
    assert.equal(inst.value[entity], 100);
  });
  it("isValidSchema returns true for valid schema", function() {
    const i32 = defineDataStore(i32Proto);
    const isValid = isValidSchema({...testComponentProto, schema: { value: i32 }});
    assert.equal(isValid, true);
  });
  it("isValidSchema returns false for invalid schema", function() {
    const isValid = isValidSchema({name: "test", schema: {}});
    assert.equal(isValid, false);
  });
  it("isValidSchema returns false for non-existent schema", function() {
    const isValid = isValidSchema({name: "test"});
    assert.equal(isValid, false);
  });
  it("isValidSchema returns false when no arguments supplied", function() {
    const isValid = isValidSchema();
    assert.equal(isValid, false);
  });
  it("isValidSchema returns false when non-object value supplied", function() {
    const isValid = isValidSchema(100);
    assert.equal(isValid, false);
  });
});
