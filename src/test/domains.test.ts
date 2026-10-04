import { describe, expect, test } from 'bun:test';
import { analyzeDenseSchemaSize, getFieldByPath } from '../api';
import { densing, undensing } from '../densing';
import { DenseEncodeError } from '../errors';
import { object, schema } from '../schema/builder';
import { getDefaultData } from '../schema/default-data';
import { domain, domains } from '../schema/domains';
import { generateTypes } from '../schema/type-generator';
import { validate } from '../schema/validation';

const fine = domain('fine', -10, 10, 0.01); // 2001 values → 11 bits
const count = domain('count', 0, 1000); // 1001 values → 10 bits
const wide = domain('wide', -1000, 1000, 0.001); // 2000001 values → 21 bits

const S = schema(domains('vec2', ['x', 'y'], [fine, count, wide]));

describe('domains', () => {
  test('the data chooses one of the acceptable domains; widths follow it', () => {
    const cases = [
      [{ domain: 'fine', x: 1.25, y: -3.5 }, 2 + 11 + 11],
      [{ domain: 'count', x: 12, y: 999 }, 2 + 10 + 10],
      [{ domain: 'wide', x: -999.125, y: 0.001 }, 2 + 21 + 21]
    ] as const;
    for (const [vec2, bits] of cases) {
      const encoded = densing(S, { vec2 }, 'binary');
      expect(encoded.length).toBe(bits);
      expect(undensing(S, encoded, 'binary')).toEqual({ vec2 });
      expect(undensing(S, densing(S, { vec2 }))).toEqual({ vec2 });
    }
    expect(analyzeDenseSchemaSize(S).fieldRanges.vec2).toEqual({ min: 22, max: 44 });
  });

  test('values must fit the chosen domain', () => {
    expect(validate(S, { vec2: { domain: 'fine', x: 12, y: 0 } }).errors).toEqual([
      { path: 'vec2.x', message: 'value 12 out of range [-10, 10]' }
    ]);
    expect(validate(S, { vec2: { domain: 'count', x: 1.5, y: 0 } }).errors[0].message).toBe('expected integer');
    expect(validate(S, { vec2: { domain: 'fine', x: 1.234, y: 0 } }).errors[0].message).toContain('does not align');
    expect(() => densing(S, { vec2: { domain: 'huge', x: 0, y: 0 } })).toThrow(DenseEncodeError);
  });

  test('only the domains the schema lists are acceptable', () => {
    const positionOnly = schema(domains('position', ['x', 'y'], [fine, wide]));
    expect(validate(positionOnly, { position: { domain: 'count', x: 1, y: 1 } }).errors[0].message).toBe(
      'invalid discriminator "count", expected one of [fine, wide]'
    );
    // two acceptable domains → one selector bit
    expect(densing(positionOnly, { position: { domain: 'fine', x: 0, y: 0 } }, 'binary').length).toBe(1 + 11 + 11);
  });

  test('domains are reusable across attributes and schemas', () => {
    const scene = schema(
      domains('position', ['x', 'y', 'z'], [fine, wide]),
      domains('velocity', ['dx', 'dy'], [fine, count], { key: 'unit', defaultDomain: 'count' }),
      object('label', fine.field('offset'), count.field('size'))
    );
    const data = {
      position: { domain: 'wide', x: 1, y: 2.5, z: -3.125 },
      velocity: { unit: 'fine', dx: 0.5, dy: -0.25 },
      label: { offset: 0.01, size: 12 }
    };
    expect(undensing(scene, densing(scene, data))).toEqual(data);
    expect(getDefaultData(scene)).toEqual({
      position: { domain: 'fine', x: -10, y: -10, z: -10 },
      velocity: { unit: 'count', dx: 0, dy: 0 },
      label: { offset: -10, size: 0 }
    });
    expect(getFieldByPath(scene, 'velocity.unit')?.type).toBe('enum');
    expect(getFieldByPath(scene, 'position.z')?.type).toBe('fixed');
  });

  test('generated types show the domain choice', () => {
    expect(generateTypes(S)).toContain("domain: 'fine'");
  });

  test('invalid definitions throw where they are made', () => {
    expect(() => domain('d', 10, -10)).toThrow('max < min');
    expect(() => domain('d', 0, 1, 0.3)).toThrow('1 / precision must be an integer');
    expect(() => domain('d', 0, 10, 1, 11)).toThrow('invalid default value');
    expect(() => domains('v', ['x'], [fine])).toThrow('needs at least 2 acceptable domains');
    expect(() => domains('v', [], [fine, count])).toThrow('needs at least one attribute');
    expect(() => domains('v', ['domain'], [fine, count])).toThrow('duplicate field name "domain"');
    expect(() => domains('v', ['x'], [fine, domain('fine', 0, 1)])).toThrow('duplicate values');
  });
});
