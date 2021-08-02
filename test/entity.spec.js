import mocha from "mocha";
const { describe, it } = mocha;
import { assert } from "chai";

import {
  createWorld,
  createEntity,
  destroyEntity
} from "../demo/miski.min.js";

describe("Entity", function() {
  it("creates an Entity without error", async function() {
    const world = createWorld();
    const entity = await createEntity(world);
    assert.exists(entity);
    assert.isNumber(entity);
    assert.exists(world.entities[0]);
  });
  it("fails to create too many entities", async function() {
    const world = createWorld({maxEntities: 2});
    const _entity1 = await createEntity(world);
    return Promise.reject(() => createEntity(world)())
      .then(() => { throw new Error("was not supposed to succeed!") })
      .catch((err) => {  assert.throws(err) });
  });
  it("destroys an Entity without error", async function() {
    const world = createWorld();
    const entity = await createEntity(world);
    await destroyEntity(world, entity);
    assert.notExists(world.entities[0]);
  });
  it("fails to destroy an entity that doesn't exist", async function() {
    const world = createWorld();
    return Promise.reject(() => destroyEntity(world, 10)())
      .then(() => { throw new Error("was not supposed to succeed!") })
      .catch((err) => {  assert.throws(err) });
  });
});
