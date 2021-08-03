import mocha from "mocha";
const { describe, it } = mocha;
import { assert } from "chai";

import {
  createWorld,
  createEntity,
  destroyEntity
} from "../demo/miski.min.js";

describe("Entity", function() {
  it("creates an Entity without error", function() {
    const world = createWorld();
    const entity = createEntity(world);
    assert.exists(entity);
    assert.isNumber(entity);
    assert.exists(world.entities[0]);
  });
  it("fails to create too many entities", function() {
    const world = createWorld({maxEntities: 1});
    const _entity1 = createEntity(world);
    assert.equal(createEntity(world), undefined);
  });
  it("destroys an Entity without error", function() {
    const world = createWorld();
    const entity = createEntity(world);
    const status = destroyEntity(world, entity);
    assert.equal(status, true);
    assert.equal(world.entities[entity], -2);
  });
  it("fails to destroy an entity that doesn't exist", function() {
    const world = createWorld();
    assert.equal(destroyEntity(world, 10), false)
  });
});
