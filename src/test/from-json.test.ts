import { describe, expect, test } from 'bun:test';
import {
  schema,
  bool,
  int,
  fixed,
  enumeration,
  array,
  enumArray,
  optional,
  object,
  union,
  pointer,
  schemaFromJson,
  getDefaultData
} from '../schema';
import { densing, undensing } from '../densing';

const DeviceConfigSchema = schema(
  int('deviceId', 0, 65535, 7),
  enumeration('deviceType', ['sensor', 'actuator', 'gateway'], 'gateway'),
  optional('customName', int('nameId', 0, 1000), undefined),
  object(
    'network',
    bool('dhcp', true),
    optional('staticIp', array('ipAddress', 4, 4, int('ipAddress', 0, 255))),
    int('port', 1024, 65535)
  ),
  union('sensorConfig', enumeration('type', ['temperature', 'humidity', 'motion']), {
    temperature: [fixed('minTemp', -40, 125, 0.1), fixed('maxTemp', -40, 125, 0.1), int('sampleRate', 1, 3600)],
    humidity: [int('minHumidity', 0, 100), int('maxHumidity', 0, 100), int('sampleRate', 1, 3600)],
    motion: [bool('continuousMode'), int('sensitivity', 0, 100)]
  }),
  optional('calibration', object('cal', fixed('offset', -10, 10, 0.01), fixed('scale', 0.5, 2.0, 0.001)), null),
  array('alerts', 0, 5, object('alert', int('threshold', 0, 1000), bool('enabled'))),
  enumArray('palette', enumeration('color', ['R', 'G', 'B']), 1, 10, ['G'])
);

const ExpressionSchema = schema(
  union('expr', enumeration('type', ['number', 'add', 'multiply']), {
    number: [int('value', 0, 1000)],
    add: [pointer('left', 'expr'), pointer('right', 'expr')],
    multiply: [pointer('left', 'expr'), pointer('right', 'expr')]
  })
);

const jsonRoundTrip = (s: unknown) => schemaFromJson(JSON.parse(JSON.stringify(s)));

describe('schemaFromJson - round trip', () => {
  test('complex schema survives JSON.stringify -> schemaFromJson', () => {
    expect(jsonRoundTrip(DeviceConfigSchema)).toEqual(DeviceConfigSchema);
  });

  test('accepts a JSON string', () => {
    expect(schemaFromJson(JSON.stringify(DeviceConfigSchema))).toEqual(DeviceConfigSchema);
  });

  test('recursive schema with pointers survives the round trip and encodes identically', () => {
    const loaded = jsonRoundTrip(ExpressionSchema);
    expect(loaded).toEqual(ExpressionSchema);

    const data = {
      expr: {
        type: 'multiply',
        left: { type: 'add', left: { type: 'number', value: 5 }, right: { type: 'number', value: 3 } },
        right: { type: 'number', value: 2 }
      }
    };
    const encoded = densing(ExpressionSchema, data);
    expect(densing(loaded, data)).toBe(encoded);
    expect(undensing(loaded, encoded)).toEqual(data);
  });

  test('default data is the same for the loaded schema', () => {
    expect(getDefaultData(jsonRoundTrip(DeviceConfigSchema))).toEqual(getDefaultData(DeviceConfigSchema));
  });
});

describe('schemaFromJson - defaults', () => {
  test('fills in missing defaults like the builders do', () => {
    const loaded = schemaFromJson({
      fields: [
        { type: 'bool', name: 'b' },
        { type: 'int', name: 'i', min: 3, max: 9 },
        { type: 'fixed', name: 'f', min: -1, max: 1, precision: 0.5 },
        { type: 'enum', name: 'e', options: ['x', 'y'] },
        { type: 'enum_array', name: 'ea', enum: { type: 'enum', name: 'c', options: ['x', 'y'] }, minLength: 0, maxLength: 3 }
      ]
    });

    expect(loaded).toEqual(
      schema(
        bool('b'),
        int('i', 3, 9),
        fixed('f', -1, 1, 0.5),
        enumeration('e', ['x', 'y']),
        enumArray('ea', enumeration('c', ['x', 'y']), 0, 3)
      )
    );
    expect(getDefaultData(loaded)).toEqual({ b: false, i: 3, f: -1, e: 'x', ea: [] });
  });

  test('a hand written schema encodes like the builder version', () => {
    const loaded = schemaFromJson({
      fields: [
        { type: 'int', name: 'deviceId', min: 0, max: 1000 },
        { type: 'bool', name: 'enabled' },
        { type: 'fixed', name: 'temperature', min: -40, max: 125, precision: 0.1 },
        { type: 'enum', name: 'mode', options: ['eco', 'normal', 'performance'] }
      ]
    });
    expect(densing(loaded, { deviceId: 42, enabled: true, temperature: 23.5, mode: 'performance' })).toBe('Cqnu');
  });
});

describe('schemaFromJson - errors', () => {
  const field = (f: Record<string, unknown>) => () => schemaFromJson({ fields: [f] });

  test('rejects input that is not a schema', () => {
    expect(() => schemaFromJson('not json')).toThrow('not valid JSON');
    expect(() => schemaFromJson([])).toThrow('Invalid schema at root');
    expect(() => schemaFromJson({})).toThrow('Invalid schema at fields: must be an array of fields');
    expect(() => schemaFromJson({ fields: [], extra: 1 })).toThrow('unknown property extra');
  });

  test('rejects unknown field types and missing names', () => {
    expect(field({ type: 'string', name: 'x' })).toThrow('Invalid schema at fields[0]: "type" must be one of');
    expect(field({ type: 'bool' })).toThrow('"name" must be a string');
  });

  test('rejects unknown and mistyped properties', () => {
    expect(field({ type: 'int', name: 'x', min: 0, max: 5, maximum: 9 })).toThrow('unknown property maximum');
    expect(field({ type: 'int', name: 'x', min: '0', max: 5 })).toThrow('"min" must be a finite number');
    expect(field({ type: 'enum', name: 'x', options: ['a', 1] })).toThrow('"options" must be an array of strings');
    expect(field({ type: 'bool', name: 'x', defaultValue: 'yes' })).toThrow('"defaultValue" must be a boolean');
  });

  test('applies builder validation with the path of the field', () => {
    expect(field({ type: 'array', name: 'scores', minLength: 0, maxLength: 3, items: { type: 'int', name: 'score', min: 9, max: 1 } })).toThrow(
      'Invalid schema at fields[0].items: int "score": max < min'
    );
    expect(field({ type: 'enum', name: 'e', options: ['a', 'a'] })).toThrow('enum "e": duplicate values');
    expect(field({ type: 'fixed', name: 'f', min: 0, max: 1, precision: 0.3 })).toThrow('1 / precision must be an integer');
  });

  test('checks union discriminators and variants', () => {
    const discriminator = { type: 'enum', name: 'type', options: ['a', 'b'] };
    expect(field({ type: 'union', name: 'u', discriminator, variants: { a: [] } })).toThrow(
      'union "u": missing variant definition for "b"'
    );
    expect(field({ type: 'union', name: 'u', discriminator: { type: 'bool', name: 'type' }, variants: {} })).toThrow(
      'Invalid schema at fields[0].discriminator: expected an enum field, got "bool"'
    );
    expect(
      field({ type: 'union', name: 'u', discriminator, variants: { a: [], b: [{ type: 'int', name: 'i', min: 1 }] } })
    ).toThrow('Invalid schema at fields[0].variants.b[0]: "max" must be a finite number');
  });

  test('rejects pointers to unknown fields', () => {
    expect(field({ type: 'pointer', name: 'p', targetName: 'nowhere' })).toThrow(
      'Invalid schema at fields[0]: pointer "p" references unknown field "nowhere"'
    );
  });
});
