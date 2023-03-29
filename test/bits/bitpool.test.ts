import * as Bitpool from '../../src/utils/bits/bitpool.js';
import { expect } from 'chai';

describe('Bitpool', () => {
  it('create', () => {
    const size = 64;
    const bitpool = Bitpool.create(size);

    expect(bitpool.field).to.be.instanceOf(Uint32Array);
    expect(bitpool.field.length).to.equal(size / 32);
    expect(bitpool.nextAvailableIdx).to.equal(0);
  });

  it('getPopulationCount', () => {
    const size = 64;
    const bitpool = Bitpool.create(size);

    expect(Bitpool.getPopulationCount(bitpool)).to.equal(size);

    Bitpool.acquire(bitpool);
    expect(Bitpool.getPopulationCount(bitpool)).to.equal(size - 1);

    Bitpool.release(bitpool, 0);
    expect(Bitpool.getPopulationCount(bitpool)).to.equal(size);
  });

  it('acquire', () => {
    const size = 64;
    const bitpool = Bitpool.create(size);

    const acquiredBit = Bitpool.acquire(bitpool);
    expect(acquiredBit).to.equal(0);
    expect(Bitpool.getPopulationCount(bitpool)).to.equal(size - 1);

    Bitpool.release(bitpool, acquiredBit);
    expect(Bitpool.getPopulationCount(bitpool)).to.equal(size);
  });

  it('acquire all bits and overflow', () => {
    const size = 64;
    const bitpool = Bitpool.create(size);

    for (let i = 0; i < size; i++) {
      const b = Bitpool.acquire(bitpool);
      expect(b).to.equal(i);
    }

    expect(Bitpool.acquire(bitpool)).to.equal(-1);
  });

  it('release', () => {
    const size = 64;
    const bitpool = Bitpool.create(size);

    const acquiredBit = Bitpool.acquire(bitpool);
    expect(Bitpool.getPopulationCount(bitpool)).to.equal(size - 1);

    const acquiredBit2 = Bitpool.acquire(bitpool);
    expect(Bitpool.getPopulationCount(bitpool)).to.equal(size - 2);

    Bitpool.release(bitpool, acquiredBit);
    Bitpool.release(bitpool, acquiredBit2);
    expect(Bitpool.getPopulationCount(bitpool)).to.equal(size);
  });

  it('release invalid bit', () => {
    const size = 64;
    const bitpool = Bitpool.create(size);

    const originalBitpool = Bitpool.create(size);
    originalBitpool.field.set(bitpool.field);

    Bitpool.release(bitpool, size + 1);
    expect(bitpool.field.every((idx) => bitpool.field[idx] === originalBitpool.field[idx])).to.be.true;
  });

  it('create with non-multiple of 32 size', () => {
    const size = 50;
    const bitpool = Bitpool.create(size);

    expect(bitpool.field).to.be.instanceOf(Uint32Array);
    expect(bitpool.field.length).to.equal(Math.ceil(size / 32));
    expect(bitpool.nextAvailableIdx).to.equal(0);
  });

  it('acquire beyond pool size', () => {
    const size = 5;
    const bitpool = Bitpool.create(size);

    for (let i = 0; i < size; i++) {
      expect(Bitpool.acquire(bitpool)).to.equal(i);
    }

    // Check if the function returns -1 when all bits are acquired and no more bits are available
    expect(Bitpool.acquire(bitpool)).to.equal(-1);
  });

  it('release already released bit', () => {
    const size = 64;
    const bitpool = Bitpool.create(size);

    const acquiredBit = Bitpool.acquire(bitpool);
    Bitpool.release(bitpool, acquiredBit);

    const populationCountBefore = Bitpool.getPopulationCount(bitpool);
    Bitpool.release(bitpool, acquiredBit); // Try to release the same bit again
    const populationCountAfter = Bitpool.getPopulationCount(bitpool);

    expect(populationCountBefore).to.equal(populationCountAfter);
  });

  it('release bit out of range', () => {
    const size = 64;
    const bitpool = Bitpool.create(size);

    const populationCountBefore = Bitpool.getPopulationCount(bitpool);
    Bitpool.release(bitpool, size + 10); // Attempt to release a bit out of the valid range
    const populationCountAfter = Bitpool.getPopulationCount(bitpool);

    expect(populationCountBefore).to.equal(populationCountAfter);
  });
});
