import mocha from "mocha";
const { describe, it } = mocha;
import { assert } from "chai";

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

/* describe("System", function() {
  it("defines a DataStore without error", function() {
    const i32 = defineDataStore(i32Proto);
    assert.exists(i32);
    assert.isObject(i32);
    assert.hasAllKeys(i32, EXPECTED_DATASTORE_KEYS);
    assert.equal(i32.arrayType, arrayType);
    assert.equal(i32.guard, guard);
    assert.equal(i32.initial, initial);
    assert.equal(i32.name, name);
    assert.equal(i32.prefill, prefill);
  });
}); */
