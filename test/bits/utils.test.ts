import { assert } from "chai";
import { getPopulationCount } from "../../src/utils/bits/utils.js";

describe('Bit Utils', () => {
  it('should get the set bit count of a value with all bits set', () => {
    const count = getPopulationCount(0xFFFFFFFF);
    assert.equal(count, 32);
  });

  it('should get the set bit count of a value with no bits set', () => {
    const count = getPopulationCount(0x00000000);
    assert.equal(count, 0);
  });

  it('should get the set bit count of a value', () => {
    const count = getPopulationCount(0b10100101);
    assert.equal(count, 4);
  });
});

