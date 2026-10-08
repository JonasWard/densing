// definitions.test.ts - numeric definitions with presets, and the `reference_numeric` fields using them
import { describe, test, expect } from 'bun:test';
import {
  array,
  definition,
  enumeration,
  fixed,
  int,
  object,
  optional,
  pointer,
  referenceNumeric,
  schema,
  schemaWithDefinitions,
  union
} from '../schema/builder';
import { densing, undensing } from '../densing';
import { DenseDecodeError, DenseEncodeError } from '../errors';
import { validate, validateField, ValidationError } from '../schema/validation';
import { validateSchema } from '../schema/validate-schema';
import { getDefaultData } from '../schema/default-data';
import { generateTypes } from '../schema/type-generator';
import { schemaFromJson } from '../schema/from-json';
import {
  analyzeDenseSchemaSize,
  calculateDenseDataSize,
  calculateDenseFieldBitWidth,
  getDenseFieldBitWidthRange
} from '../api';
import { DenseSchema } from '../schema-type';

// fine: 0..10 at 0.5 -> 21 steps -> 5 bits; coarse: int 0..3 -> 2 bits; huge: int 0..1000 -> 10 bits
const length = definition('length', {
  fine: { min: 0, max: 10, precision: 0.5 },
  coarse: { min: 0, max: 3 },
  huge: { min: 0, max: 1000, defaultValue: 7 }
});
const count = definition('count', { only: { min: 0, max: 15 } });

const S = schemaWithDefinitions(
  [length, count],
  referenceNumeric('width', length),
  referenceNumeric('height', 'length'),
  referenceNumeric('n', count),
  int('plain', 0, 1)
);

const encodeError = (fn: () => unknown): DenseEncodeError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof DenseEncodeError) return error;
    throw error;
  }
  throw new Error('expected a DenseEncodeError');
};

describe('definition builder', () => {
  test('normalises presets and the default preset', () => {
    expect(length).toEqual({
      name: 'length',
      presets: {
        fine: { min: 0, max: 10, precision: 0.5, defaultValue: 0 },
        coarse: { min: 0, max: 3, defaultValue: 0 },
        huge: { min: 0, max: 1000, defaultValue: 7 }
      },
      defaultPreset: 'fine'
    });
    expect(definition('d', { a: { min: 0, max: 1 }, b: { min: 0, max: 2 } }, 'b').defaultPreset).toBe('b');
  });

  test('checks presets like int / fixed do', () => {
    expect(() => definition('d', {})).toThrow('definition "d": must have at least 1 preset');
    expect(() => definition('d', { a: { min: 0, max: 1 } }, 'b')).toThrow('default preset "b" is not one of [a]');
    expect(() => definition('d', { a: { min: 2, max: 1 } })).toThrow('definition "d" preset "a": int "d.a": max < min');
    expect(() => definition('d', { a: { min: 0, max: 1.5 } })).toThrow('safe integers');
    expect(() => definition('d', { a: { min: 0, max: 1, precision: 0.3 } })).toThrow('1 / precision must be an integer');
    expect(() => definition('d', { a: { min: 0, max: 1, defaultValue: 2 } })).toThrow('invalid default value');
  });

  test('referenceNumeric takes a definition or its name', () => {
    expect(referenceNumeric('a', length)).toEqual({ type: 'reference_numeric', name: 'a', ref: 'length' });
    expect(referenceNumeric('a', 'length')).toEqual({ type: 'reference_numeric', name: 'a', ref: 'length' });
  });
});

describe('wire format', () => {
  test('preset header first, then the fields at the active preset width', () => {
    // header: length (3 presets) 2 bits, count (1 preset) 0 bits
    expect(densing(S, { $presets: { length: 'coarse' }, width: 2, height: 3, n: 5, plain: 1 }, 'binary')).toBe(
      '01' + '10' + '11' + '0101' + '1'
    );
    expect(densing(S, { $presets: { length: 'fine' }, width: 2, height: 9.5, n: 5, plain: 1 }, 'binary')).toBe(
      '00' + '00100' + '10011' + '0101' + '1'
    );
  });

  test('a single preset definition costs no header bits and encodes like the inline field', () => {
    const shared = schemaWithDefinitions([count], referenceNumeric('a', count), referenceNumeric('b', count));
    const inline = schema(int('a', 0, 15), int('b', 0, 15));
    for (const [a, b] of [[0, 0], [3, 15], [15, 7]])
      expect(densing(shared, { a, b })).toBe(densing(inline, { a, b }));
  });

  test('schemas without definitions are unchanged and ignore a $presets key', () => {
    const inline = schema(int('a', 0, 15));
    expect(densing(inline, { a: 3, $presets: { anything: 'x' } }, 'binary')).toBe('0011');
    expect(undensing(inline, '0011', 'binary')).toEqual({ a: 3 });
  });
});

describe('round trip', () => {
  test('every preset', () => {
    const cases = [
      { $presets: { length: 'fine', count: 'only' }, width: 9.5, height: 0.5, n: 15, plain: 0 },
      { $presets: { length: 'coarse', count: 'only' }, width: 3, height: 0, n: 0, plain: 1 },
      { $presets: { length: 'huge', count: 'only' }, width: 1000, height: 512, n: 1, plain: 1 }
    ];
    for (const data of cases)
      for (const base of ['base64url', 'baseQRCode45UrlSafe', 'binary'] as const)
        expect(undensing(S, densing(S, data, base), base)).toEqual(data);
  });

  test('without $presets the default presets apply, and decode returns them', () => {
    const data = { width: 1.5, height: 2, n: 3, plain: 0 };
    expect(densing(S, data)).toBe(densing(S, { $presets: { length: 'fine', count: 'only' }, ...data }));
    expect(densing(S, { $presets: { count: 'only' }, ...data })).toBe(densing(S, data));
    expect(undensing(S, densing(S, data))).toEqual({ $presets: { length: 'fine', count: 'only' }, ...data });

    const withDefault = schemaWithDefinitions(
      [definition('d', { a: { min: 0, max: 1 }, b: { min: 0, max: 100 } }, 'b')],
      referenceNumeric('x', 'd')
    );
    expect(undensing(withDefault, densing(withDefault, { x: 50 }))).toEqual({ $presets: { d: 'b' }, x: 50 });
  });

  test('a definition mixing int and fixed presets', () => {
    const mixed = schemaWithDefinitions(
      [definition('m', { ints: { min: -5, max: 5 }, halves: { min: -1, max: 1, precision: 0.5 } })],
      array('values', 0, 4, referenceNumeric('v', 'm'))
    );
    for (const data of [
      { $presets: { m: 'ints' }, values: [-5, 0, 5] },
      { $presets: { m: 'halves' }, values: [-1, -0.5, 0.5, 1] }
    ])
      expect(undensing(mixed, densing(mixed, data))).toEqual(data);
    expect(() => densing(mixed, { $presets: { m: 'ints' }, values: [0.5] })).toThrow('expected integer');
  });

  test('inside arrays, unions, optionals, objects and through pointers', () => {
    const angle = definition('angle', { deg: { min: 0, max: 360 }, rad: { min: 0, max: 6.28, precision: 0.01 } });
    const tree = schemaWithDefinitions(
      [angle],
      union('node', enumeration('kind', ['leaf', 'branch']), {
        leaf: [referenceNumeric('a', angle)],
        branch: [
          object('pose', referenceNumeric('rx', angle), optional('ry', referenceNumeric('ry', angle))),
          array('children', 0, 3, pointer('child', 'node'))
        ]
      })
    );
    const data = {
      $presets: { angle: 'rad' },
      node: {
        kind: 'branch',
        pose: { rx: 3.14, ry: null },
        children: [
          { kind: 'leaf', a: 6.28 },
          { kind: 'branch', pose: { rx: 0.01, ry: 1.57 }, children: [] }
        ]
      }
    };
    expect(undensing(tree, densing(tree, data))).toEqual(data);
    const asDegrees = { ...data, $presets: { angle: 'deg' } };
    expect(() => densing(tree, asDegrees)).toThrow('node.pose.rx: expected integer');
  });
});

describe('invalid data', () => {
  test('unknown preset, unknown definition, wrong $presets type', () => {
    const data = { width: 1, height: 1, n: 1, plain: 1 };
    let error = encodeError(() => densing(S, { $presets: { length: 'medium' }, ...data }));
    expect(error.path).toBe('$presets.length');
    expect(error.message).toContain('invalid preset "medium" for definition "length", expected one of [fine, coarse, huge]');

    error = encodeError(() => densing(S, { $presets: { lenght: 'fine' }, ...data }));
    expect(error.path).toBe('$presets.lenght');
    expect(error.message).toContain('definition "lenght" does not exist');

    error = encodeError(() => densing(S, { $presets: 'fine', ...data }));
    expect(error.path).toBe('$presets');
    // inherited properties are not definitions or presets
    expect(() => densing(S, { $presets: { length: 'toString' }, ...data })).toThrow(DenseEncodeError);
  });

  test('values are checked against the active preset', () => {
    // 9 fits `huge` and `fine`, not `coarse`
    const data = { width: 9, height: 0, n: 0, plain: 0 };
    expect(() => densing(S, { $presets: { length: 'huge' }, ...data })).not.toThrow();
    const error = encodeError(() => densing(S, { $presets: { length: 'coarse' }, ...data }));
    expect(error.path).toBe('width');
    expect(error.message).toContain('value 9 out of range [0, 3]');
  });

  test('validate reports the same errors', () => {
    const data = { width: 9, height: 0.5, n: 0, plain: 0 };
    expect(validate(S, data).valid).toBe(true);
    expect(validate(S, { $presets: { length: 'coarse' }, ...data }).errors).toEqual([
      { path: 'width', message: 'value 9 out of range [0, 3]' },
      { path: 'height', message: 'expected integer' }
    ]);
    // with invalid presets the values are only checked to be numbers
    expect(validate(S, { $presets: { length: 'nope', extra: 'x' }, ...data, height: 'x' }).errors).toEqual([
      { path: '$presets.extra', message: 'definition "extra" does not exist' },
      { path: '$presets.length', message: 'invalid preset "nope" for definition "length", expected one of [fine, coarse, huge]' },
      { path: 'height', message: 'expected number' }
    ]);

    const errors: ValidationError[] = [];
    validateField(referenceNumeric('w', length), 9, 'w', errors, S, { length: 'coarse' });
    expect(errors).toEqual([{ path: 'w', message: 'value 9 out of range [0, 3]' }]);
  });

  test('undensing rejects a preset index past the presets', () => {
    // length has 3 presets in 2 bits: index 3 is not a preset
    try {
      undensing(S, '11' + '00' + '00' + '0000' + '0', 'binary');
      throw new Error('expected a DenseDecodeError');
    } catch (error) {
      expect(error).toBeInstanceOf(DenseDecodeError);
      expect((error as DenseDecodeError).path).toBe('$presets.length');
    }
    // and a value past the active preset's maximum: coarse is int 0..3 in 2 bits, huge is 0..1000 in 10 bits
    expect(() => undensing(S, '10' + '1111111111' + '0000000000' + '0000' + '0', 'binary')).toThrow(
      "width: stored value 1023 exceeds the field's maximum 1000"
    );
  });
});

describe('schema checks', () => {
  test('references must exist', () => {
    expect(() => schemaWithDefinitions([length], referenceNumeric('a', 'nope'))).toThrow(
      'a: definition "nope" does not exist'
    );
    expect(() => schema(object('o', referenceNumeric('a', 'length')))).toThrow('o.a: definition "length" does not exist');
  });

  test('hand-built schemas', () => {
    const hand: DenseSchema = {
      definitions: [
        { name: 'd', presets: { a: { min: 0, max: 1 } } },
        { name: 'd', presets: {} },
        { name: 'e', presets: { a: { min: 0, max: 1 } }, defaultPreset: 'b' }
      ],
      fields: [int('$presets', 0, 1)]
    };
    expect(validateSchema(hand).errors).toEqual([
      { path: 'definitions[1]', message: 'duplicate definition name "d"' },
      { path: 'definitions[1]', message: 'definition "d" has no presets' },
      { path: 'definitions[2]', message: 'default preset "b" of definition "e" is not one of [a]' },
      { path: '$presets', message: '"$presets" is reserved for the presets of the definitions' }
    ]);
  });

  test('pointer checks still run with definitions', () => {
    expect(() => schemaWithDefinitions([length], object('p', referenceNumeric('a', length), pointer('q', 'p')))).toThrow(
      'has no finite value'
    );
  });
});

describe('introspection', () => {
  test('getDefaultData uses the default presets', () => {
    expect(getDefaultData(S)).toEqual({ $presets: { length: 'fine', count: 'only' }, width: 0, height: 0, n: 0, plain: 0 });
    const huge = schemaWithDefinitions([definition('l', length.presets, 'huge')], referenceNumeric('w', 'l'));
    expect(getDefaultData(huge)).toEqual({ $presets: { l: 'huge' }, w: 7 });
  });

  test('sizes', () => {
    const width = S.fields[0];
    expect(getDenseFieldBitWidthRange(width, S)).toEqual({ min: 2, max: 10 });
    expect(calculateDenseFieldBitWidth(width, 1, S)).toBe(5);
    expect(calculateDenseFieldBitWidth(width, 1, S, { length: 'huge' })).toBe(10);

    const analysis = analyzeDenseSchemaSize(S);
    expect(analysis.fieldRanges.$presets).toEqual({ min: 2, max: 2 });
    expect(analysis.staticRange.minBits).toBe(2 + 2 + 2 + 4 + 1);
    expect(analysis.staticRange.maxBits).toBe(2 + 10 + 10 + 4 + 1);

    const data = { $presets: { length: 'coarse' }, width: 1, height: 2, n: 3, plain: 1 };
    const size = calculateDenseDataSize(S, data);
    expect(size.fieldSizes).toEqual({ $presets: 2, width: 2, height: 2, n: 4, plain: 1 });
    expect(size.totalBits).toBe(densing(S, data, 'binary').length);
    expect(analyzeDenseSchemaSize(schema(int('a', 0, 1))).fieldRanges).toEqual({ a: { min: 1, max: 1 } });
  });

  test('generateTypes', () => {
    expect(generateTypes(S)).toBe(
      [
        'export interface SchemaData {',
        '  $presets?: {',
        "    length?: 'fine' | 'coarse' | 'huge';",
        "    count?: 'only';",
        '  };',
        '  width: number;',
        '  height: number;',
        '  n: number;',
        '  plain: number;',
        '}'
      ].join('\n')
    );
  });
});

describe('JSON', () => {
  test('round trip keeps the references', () => {
    const json = JSON.parse(JSON.stringify(S));
    expect(json.fields[0]).toEqual({ type: 'reference_numeric', name: 'width', ref: 'length' });
    const loaded = schemaFromJson(json);
    expect(loaded).toEqual(S);
    const data = { $presets: { length: 'huge' }, width: 999, height: 1, n: 2, plain: 0 };
    expect(densing(loaded, data)).toBe(densing(S, data));
  });

  test('minimal JSON is completed by the builders', () => {
    const loaded = schemaFromJson({
      definitions: [
        {
          name: 'length',
          defaultPreset: 'coarse',
          presets: { fine: { min: 0, max: 10, precision: 0.001 }, coarse: { min: 0, max: 1000, defaultValue: 1 } }
        }
      ],
      fields: [
        { type: 'reference_numeric', name: 'width', ref: 'length' },
        { type: 'fixed', name: 'inline', min: 0, max: 1, precision: 0.1 }
      ]
    });
    expect(loaded).toEqual(
      schemaWithDefinitions(
        [definition('length', { fine: { min: 0, max: 10, precision: 0.001 }, coarse: { min: 0, max: 1000, defaultValue: 1 } }, 'coarse')],
        referenceNumeric('width', 'length'),
        fixed('inline', 0, 1, 0.1)
      )
    );
    expect(getDefaultData(loaded)).toEqual({ $presets: { length: 'coarse' }, width: 1, inline: 0 });
  });

  test('errors carry the path', () => {
    const preset = { min: 0, max: 1 };
    expect(() => schemaFromJson({ definitions: {}, fields: [] })).toThrow('Invalid schema at definitions: must be an array');
    expect(() => schemaFromJson({ definitions: [{ name: 'd', presets: { a: { ...preset, step: 1 } } }], fields: [] })).toThrow(
      'Invalid schema at definitions[0].presets.a: unknown property step'
    );
    expect(() => schemaFromJson({ definitions: [{ name: 'd', presets: { a: { min: 0 } } }], fields: [] })).toThrow(
      'Invalid schema at definitions[0].presets.a: "max" must be a finite number'
    );
    expect(() => schemaFromJson({ definitions: [{ name: 'd', presets: { a: { min: 1, max: 0 } } }], fields: [] })).toThrow(
      'Invalid schema at definitions[0]: definition "d" preset "a": int "d.a": max < min'
    );
    expect(() =>
      schemaFromJson({ definitions: [], fields: [{ type: 'reference_numeric', name: 'w', ref: 'd', min: 0 }] })
    ).toThrow('Invalid schema at fields[0]: unknown property min');
    expect(() => schemaFromJson({ fields: [{ type: 'reference_numeric', name: 'w', ref: 'd' }] })).toThrow(
      'Invalid schema: w: definition "d" does not exist'
    );
  });
});
