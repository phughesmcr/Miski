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
    assert.isArray(component.instances);
    assert.isObject(component.schema);
    assert.isString(component.name);
  });
  it("fails to create a Component without a spec", function() {
    assert.throws(createComponent)
  });
  it("registers a Component in a World correctly", function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const inst = registerComponent(world, component);
    assert.exists(inst);
    assert.isObject(inst.world);
    assert.isNumber(inst.id);
    assert.instanceOf(inst.entities, Set);
    assert.instanceOf(inst.value, Int8Array);
    assert.equal(inst, world.components[0]);
  });
  it("fails to register too many Components", function() {
    const world = createWorld({ maxComponents: 1 });
    const component1 = createComponent(testComponentSpec);
    const component2 = createComponent({...testComponentSpec, name: "test2"});
    registerComponent(world, component1);
    assert.throws(() => registerComponent(world, component2));
  });
  it("unregisters a Component from a World correctly", function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const inst = registerComponent(world, component);
    unregisterComponent(inst);
    assert.notEqual(world.components[0], inst);
    assert.isUndefined(world.components[0])
  });
  it("fails to unregister a Component that doesn't exist", function() {
    assert.throws(() => unregisterComponent({}));
  });
  it("adds a component to an entity correctly", function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const { archetypes, entities } = world;
    const entity = createEntity(world);
    const inst = registerComponent(world, component);
    addComponentToEntity(inst, entity);
    assert.equal(entities[0], 519);
    const archetype = archetypes.get(519);
    assert.exists(archetype);
    assert.equal(archetype.entities.has(entity), true);
  });
  it("fails to add a component to an non-existent entity", function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const inst = registerComponent(world, component);
    assert.throws(() => addComponentToEntity(inst, 100_000));
  });
  it("fails to add to an entity a component which isn't registered", function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const entity = createEntity(world);
    assert.throws(() => addComponentToEntity(component, entity));
  });
  it("removes a component from an entity correctly", function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const { entities } = world;
    const entity = createEntity(world);
    const inst = registerComponent(world, component);
    addComponentToEntity(inst, entity);
    removeComponentFromEntity(inst, entity);
    assert.equal(entities[0], -1);
  });
  it("fails to remove a component from a non-existent entity", function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const entity = createEntity(world);
    const inst = registerComponent(world, component);
    addComponentToEntity(inst, entity);
    assert.throws(() => removeComponentFromEntity(inst, 100_000));
  });
  it("fails to remove a component from an entity that doesn't have it", function() {
    const component = createComponent(testComponentSpec);
    const world = createWorld();
    const inst = registerComponent(world, component);
    const entity = createEntity(world);
    assert.throws(() => removeComponentFromEntity(inst, entity));
  });
});
