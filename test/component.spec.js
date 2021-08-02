import mocha from "mocha";
const { describe, it } = mocha;
import { assert, } from "chai";


import {
  addComponentToEntity,
  createComponent,
  registerComponent,
  removeComponentFromEntity,
  unregisterComponent,
  i8,
  createWorld,
  createEntity
} from "../demo/miski.min.js";

const EXPECTED_COMPONENT_KEYS = [
  "name",
  "schema",
  "instances",
]

const testComponentSpec = {
  name: "test",
  schema: {
    value: i8,
  },
}

describe("Component", function() {
  it("creates a Component without error", function() {
    const component = createComponent(testComponentSpec);
    assert.exists(component);
  });
  it("creates a Component with expected keys of correct type", function() {
    const component = createComponent(testComponentSpec);
    assert.hasAllKeys(component, EXPECTED_COMPONENT_KEYS);
    assert.isArray(component.instances);
    assert.isObject(component.schema);
    assert.isString(component.name);
  });
  it("fails to create a Component without a spec", function() {
    assert.throws(createComponent)
  });
  it("registers a Component in a World correctly", async function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const inst = await registerComponent(world, component);
    assert.exists(inst);
    assert.isObject(inst.world);
    assert.isNumber(inst.id);
    assert.instanceOf(inst.entities, Set);
    assert.instanceOf(inst.value, Int8Array);
    assert.equal(inst, world.components[0]);
  });
  it("fails to register too many Components", async function() {
    const world = createWorld({ maxComponents: 2 });
    const component1 = createComponent(testComponentSpec);
    const component2 = createComponent({...testComponentSpec, name: "test2"});
    await registerComponent(world, component1);
    return Promise.reject(() => registerComponent(world, component2)())
      .then(() => { throw new Error("was not supposed to succeed!") })
      .catch((err) => {  assert.throws(err) });
  });
  it("unregisters a Component from a World correctly", async function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const inst = await registerComponent(world, component);
    await unregisterComponent(inst);
    assert.notEqual(world.components[0], inst);
    assert.isUndefined(world.components[0])
  });
  it("fails to unregister a Component that doesn't exist", async function() {
    return Promise.reject(() => unregisterComponent({})())
      .then(() => { throw new Error("was not supposed to succeed!") })
      .catch((err) => {  assert.throws(err) });
  });
  it("adds a component to an entity correctly", async function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const { archetypes, entities } = world;
    const entity = await createEntity(world);
    const inst = await registerComponent(world, component);
    await addComponentToEntity(inst, entity);
    assert.exists(entities[0]);
    assert.exists(archetypes["1,0,0,0"]);
    assert.equal(archetypes["1,0,0,0"].entities.has(entity), true);
  });
  it("fails to add a component to an non-existent entity", async function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const inst = await registerComponent(world, component);
    return Promise.reject(() => addComponentToEntity(inst, 100_000)())
      .then(() => { throw new Error("was not supposed to succeed!") })
      .catch((err) => {  assert.throws(err) });
  });
  it("fails to add to an entity a component which isn't registered", async function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const entity = await createEntity(world);
    return Promise.reject(() => addComponentToEntity(component, entity)())
      .then(() => { throw new Error("was not supposed to succeed!") })
      .catch((err) => {  assert.throws(err) });
  });
  it("removes a component from an entity correctly", async function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const { archetypes, entities } = world;
    const entity = await createEntity(world);
    const inst = await registerComponent(world, component);
    await addComponentToEntity(inst, entity);
    await removeComponentFromEntity(inst, entity);
    assert.exists(entities[0]);
    assert.exists(archetypes["0,0,0,0"]);
    assert.equal(archetypes["0,0,0,0"].entities.has(entity), true);
  });
  it("fails to remove a component from a non-existent entity", async function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const entity = await createEntity(world);
    const inst = await registerComponent(world, component);
    await addComponentToEntity(inst, entity);
    return Promise.reject(() => removeComponentFromEntity(inst, 100_000)())
      .then(() => { throw new Error("was not supposed to succeed!") })
      .catch((err) => {  assert.throws(err) });
  });
  it("fails to remove a component from an entity that doesn't have it", async function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const inst = await registerComponent(world, component);
    const entity = await createEntity(world);
    return Promise.reject(() => removeComponentFromEntity(inst, entity)())
      .then(() => { throw new Error("was not supposed to succeed!") })
      .catch((err) => {  assert.throws(err) });
  });
});
