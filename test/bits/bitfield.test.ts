import * as Bitfield from '../../src/utils/bits/bitfield.js';
import { assert } from 'chai';

describe('Bitfield', () => {
  it('should create a new Bitfield', () => {
    const bitfield = Bitfield.create(64);
    assert.instanceOf(bitfield, Uint32Array);
    assert.equal(bitfield.length, 2);
  });

  it('should create an empty Bitfield', () => {
    const bitfield = Bitfield.create(0);
    assert.instanceOf(bitfield, Uint32Array);
    assert.equal(bitfield.length, 0);
  });

  it('should handle large bit numbers', () => {
    const bitfield = Bitfield.create(1024);
    Bitfield.toggle(bitfield, 1000);
    assert.isTrue(Bitfield.isSet(bitfield, 1000));
    Bitfield.toggle(bitfield, 1000);
    assert.isFalse(Bitfield.isSet(bitfield, 1000));
  });

  it('should clone a Bitfield', () => {
    const original = Bitfield.create(64);
    Bitfield.toggle(original, 7);
    const clone = Bitfield.clone(original);
    assert.deepEqual(clone, original);
  });

  it('should clone with toggled bits', () => {
    const original = Bitfield.create(64);
    const sources = [
      { id: 7 },
      { id: 15 },
    ];
    const clone = Bitfield.cloneWithToggle(original, 'id', sources);
    assert.isTrue(Bitfield.isSet(clone, 7));
    assert.isTrue(Bitfield.isSet(clone, 15));
    assert.isFalse(Bitfield.isSet(clone, 0));
    assert.isFalse(Bitfield.isSet(clone, 10));
  });

  it('should create from objects', () => {
    const objs = [
      { id: 7 },
      { id: 15 },
    ];
    const bitfield = Bitfield.fromObjects(64, 'id', objs);
    assert.isTrue(Bitfield.isSet(bitfield, 7));
    assert.isTrue(Bitfield.isSet(bitfield, 15));
    assert.isFalse(Bitfield.isSet(bitfield, 0));
    assert.isFalse(Bitfield.isSet(bitfield, 10));
  });

  it('should create a Bitfield from objects with non-unique keys', () => {
    const objs = [
      { id: 7 },
      { id: 15 },
      { id: 7 },
    ];
    const bitfield = Bitfield.fromObjects(64, 'id', objs);
    assert.isTrue(Bitfield.isSet(bitfield, 7));
    assert.isTrue(Bitfield.isSet(bitfield, 15));
  });

  it('should get position of a bit', () => {
    const { index, position } = Bitfield.getPosition(40);
    assert.equal(index, 1);
    assert.equal(position, 8);
  });

  it('should get the set bit count in a Bitfield', () => {
    const bitfield = Bitfield.create(64);
    Bitfield.toggle(bitfield, 7);
    Bitfield.toggle(bitfield, 15);
    Bitfield.toggle(bitfield, 30);
    const count = Bitfield.getPopulationCount(bitfield);
    assert.equal(count, 3);
  });

  it('should get the size of a Bitfield', () => {
    const bitfield = Bitfield.create(64);
    const size = Bitfield.getSize(bitfield);
    assert.equal(size, 64);
  });

  it('should throw error on invalid bit', () => {
    const bitfield = Bitfield.create(64);
    assert.throws(() => Bitfield.isSet(bitfield, -1), RangeError);
    assert.throws(() => Bitfield.toggle(bitfield, -1), RangeError);
  });

  it('should toggle and check bit state', () => {
    const bitfield = Bitfield.create(64);
    assert.isFalse(Bitfield.isSet(bitfield, 7));
    Bitfield.toggle(bitfield, 7);
    assert.isTrue(Bitfield.isSet(bitfield, 7));
    Bitfield.toggle(bitfield, 7);
    assert.isFalse(Bitfield.isSet(bitfield, 7));
  });

  it('should return NO_INDEX for out of range bit', () => {
    const index = Bitfield.indexOf(-100);
    assert.equal(index, -1);
  });

  it('should throw an error on non-numeric bit', () => {
    // @ts-ignore
    assert.throws(() => Bitfield.indexOf('invalid'), TypeError);
  });

  it('should handle toggling bits at the edge of the array', () => {
    const bitfield = Bitfield.create(64);
    Bitfield.toggle(bitfield, 0);
    Bitfield.toggle(bitfield, 31);
    Bitfield.toggle(bitfield, 32);
    Bitfield.toggle(bitfield, 63);
    assert.isTrue(Bitfield.isSet(bitfield, 0));
    assert.isTrue(Bitfield.isSet(bitfield, 31));
    assert.isTrue(Bitfield.isSet(bitfield, 32));
    assert.isTrue(Bitfield.isSet(bitfield, 63));
  });

  it('should clone a Bitfield with different instances', () => {
    const original = Bitfield.create(64);
    Bitfield.toggle(original, 7);
    const clone = Bitfield.clone(original);
    assert.notStrictEqual(clone, original);
  });
});
