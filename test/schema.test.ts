import * as Miski from "../dist/miski.min.js";
import * as $ from "../src/component/schema.js";
import { expect } from 'chai';
import 'mocha';

interface Vec2d {
  x: number;
  y: number;
}

const vec2dSchemaMix: Miski.Schema<Vec2d> = { x: Float64Array, y: Uint16Array };
const vec2dSchemaI8: Miski.Schema<Vec2d> = { x: Int8Array, y: Int8Array };
const vec2dSchemaU16: Miski.Schema<Vec2d> = { x: Uint16Array, y: Uint16Array };
const vec2dSchemaF32: Miski.Schema<Vec2d> = { x: Float32Array, y: Float32Array };
const vec2dSchemaF64: Miski.Schema<Vec2d> = { x: Float64Array, y: Float64Array };
const invalidSchemaProp = { x: true, y: Int8Array };
const invalidSchemaNames = { isTag: Uint8Array, proxy: Uint8Array };

describe('Schema', () => {
  describe('isValidSchema', () => {
    it('should recognise a valid schema', () => {
      const isValid = $.isValidSchema(vec2dSchemaF64);
      expect(isValid).to.equal(true);
    });
    it('should recognise an invalid input', () => {
      let isValid = $.isValidSchema("hello world!");
      expect(isValid).to.equal(false);

      isValid = $.isValidSchema(2);
      expect(isValid).to.equal(false);

      isValid = $.isValidSchema(true);
      expect(isValid).to.equal(false);

      isValid = $.isValidSchema([]);
      expect(isValid).to.equal(false);

      isValid = $.isValidSchema(10n);
      expect(isValid).to.equal(false);

      isValid = $.isValidSchema(Uint16Array);
      expect(isValid).to.equal(false);
    });
    it('should recognise an empty object as invalid input', () => {
      const isValid = $.isValidSchema({});
      expect(isValid).to.equal(false);
    });
    it('should recognise undefined as invalid input', () => {
      // @ts-ignore
      const isValid = $.isValidSchema();
      expect(isValid).to.equal(false);
    });
    it('should recognise null as valid input', () => {
      const isValid = $.isValidSchema(null);
      expect(isValid).to.equal(true);
    });
    it('should recognise an invalid schema property', () => {
      const isValid = $.isValidSchema(invalidSchemaProp);
      expect(isValid).to.equal(false);
    });
    it('should recognise an invalid schema name', () => {
      const isValid = $.isValidSchema(invalidSchemaNames);
      expect(isValid).to.equal(false);
    });
  });

  describe('calculateSchemaSize', () => {
    it('should return the right size', () => {
      let size = $.calculateSchemaSize(vec2dSchemaF64);
      expect(size).to.equal(8 * 2);
      size = $.calculateSchemaSize(vec2dSchemaF32);
      expect(size).to.equal(8);
      size = $.calculateSchemaSize(vec2dSchemaU16);
      expect(size).to.equal(4);
      size = $.calculateSchemaSize(vec2dSchemaI8);
      expect(size).to.equal(2);
      size = $.calculateSchemaSize(vec2dSchemaMix);
      expect(size).to.equal(10);
      size = $.calculateSchemaSize(null);
      expect(size).to.equal(0);
    });

    it('should return NaN on invalid input', () => {
      let size = $.calculateSchemaSize(invalidSchemaProp);
      expect(isNaN(size)).to.equal(true);
      $.calculateSchemaSize(invalidSchemaNames);
      expect(isNaN(size)).to.equal(true);
      size = $.calculateSchemaSize({});
      expect(isNaN(size)).to.equal(true);
      size = $.calculateSchemaSize(false);
      expect(isNaN(size)).to.equal(true);
      size = $.calculateSchemaSize(10n);
      expect(isNaN(size)).to.equal(true);
      size = $.calculateSchemaSize(2);
      expect(isNaN(size)).to.equal(true);
      size = $.calculateSchemaSize([]);
      expect(isNaN(size)).to.equal(true);
      size = $.calculateSchemaSize(Uint16Array);
      expect(isNaN(size)).to.equal(true);
      // @ts-ignore
      size = $.calculateSchemaSize();
      expect(isNaN(size)).to.equal(true);
    });
  });
});
