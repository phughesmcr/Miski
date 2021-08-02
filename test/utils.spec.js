import mocha from "mocha";
const { describe, it } = mocha;
import { assert } from "chai";

import { isValidName } from "../demo/miski.min.js";

describe("isValidName", function() {
  it("returns true for valid name", function() {
    const isValid = isValidName('test');
    assert.equal(isValid, true);
  });
  it("returns false for invalid name", function() {
    const isValid = isValidName('9*');
    assert.equal(isValid, false);
  });
  it("returns false for empty name", function() {
    const isValid = isValidName('');
    assert.equal(isValid, false);
  });
  it("returns false for forbidden name", function() {
    const isValid = isValidName('schema');
    assert.equal(isValid, false);
  });
  it("returns false for non-string name", function() {
    const isValid = isValidName(100);
    assert.equal(isValid, false);
  });
});
