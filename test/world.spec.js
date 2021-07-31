import mocha from "mocha";
const { describe, it } = mocha;
import { assert } from "chai";

import { createWorld } from "../dist/es2020/index.min.js";

const EXPECTED_WORLD_KEYS = [
  "spec",
  "id",
  "archetypes",
  "components",
  "entities",
  "queries",
  "systems",
];

describe("World", function() {
  it("creates a World without error", function() {
    const world = createWorld();
    assert.exists(world);
  });
  it("creates a World with expected keys", function() {
    const world = createWorld();
    assert.hasAllKeys(world, EXPECTED_WORLD_KEYS);
  });
  it("creates a World with correct property types", function() {
    const world = createWorld();
    const { spec, id, archetypes, components, entities, queries, systems } = world;
    assert.isObject(spec);
    assert.isFrozen(spec);
    assert.isObject(archetypes);
    assert.isNotFrozen(archetypes);
    assert.isExtensible(archetypes);
    assert.isArray(components);
    assert.isNotFrozen(components);
    assert.isArray(entities);
    assert.isNotFrozen(entities);
    assert.isArray(systems);
    assert.isNotFrozen(systems);
    assert.isString(id);
    assert.instanceOf(queries, Map);
  });
  it("creates a World with expected default spec", function() {
    const world = createWorld();
    const { spec } = world;
    const { maxComponents, maxEntities } = spec;
    assert.exists(maxComponents);
    assert.equal(maxComponents, 128);
    assert.exists(maxEntities);
    assert.equal(maxEntities, 10_000);
  });
  it("handles empty spec object correctly on world creation", function() {
    const world = createWorld({});
    const { spec } = world;
    const { maxComponents, maxEntities } = spec;
    assert.exists(maxComponents);
    assert.equal(maxComponents, 128);
    assert.exists(maxEntities);
    assert.equal(maxEntities, 10_000);
  });
  it("handles maxComponents spec correctly on world creation", function() {
    const world = createWorld({ maxComponents: 256 });
    const { spec } = world;
    const { maxComponents, maxEntities } = spec;
    assert.exists(maxComponents);
    assert.equal(maxComponents, 256);
    assert.exists(maxEntities);
    assert.equal(maxEntities, 10_000);
  });
  it("handles maxEntity spec correctly on world creation", function() {
    const world = createWorld({ maxEntities: 1_000 });
    const { spec } = world;
    const { maxComponents, maxEntities } = spec;
    assert.exists(maxComponents);
    assert.equal(maxComponents, 128);
    assert.exists(maxEntities);
    assert.equal(maxEntities, 1_000);
  });
});
