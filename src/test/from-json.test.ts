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
import { calculateDenseDataSize } from '../api';
import type { DenseField, DenseSchema } from '../schema-type';

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

  test('runs the whole-schema checks of schema()', () => {
    expect(field({ type: 'pointer', name: 'p', targetName: 'nowhere' })).toThrow(
      'Invalid schema: p: pointer target "nowhere" does not exist'
    );
    expect(() =>
      schemaFromJson({
        fields: [
          { type: 'bool', name: 'a' },
          { type: 'bool', name: 'a' }
        ]
      })
    ).toThrow('Invalid schema: schema: duplicate field name "a"');
  });

  test('applies the builders\' default value checks', () => {
    expect(field({ type: 'int', name: 'x', min: 0, max: 10, defaultValue: 99 })).toThrow(
      'Invalid schema at fields[0]: int "x": invalid default value'
    );
  });
});

/**
 * Every way a schema can recurse. A cycle needs an exit (a union variant, an optional or an array that may be
 * empty), and a pointer target can be any field a pointer resolves to: top level, inside an object, a union
 * variant, array items or an optional. Each sample nests at least three levels deep.
 */
const recursiveCases: [string, DenseSchema, unknown][] = [
  [
    'union variants pointing back to the union (expression)',
    schema(
      union('expr', enumeration('type', ['number', 'add', 'multiply']), {
        number: [int('value', 0, 1000)],
        add: [pointer('left', 'expr'), pointer('right', 'expr')],
        multiply: [pointer('left', 'expr'), pointer('right', 'expr')]
      })
    ),
    {
      expr: {
        type: 'multiply',
        left: { type: 'add', left: { type: 'number', value: 5 }, right: { type: 'number', value: 3 } },
        right: { type: 'number', value: 2 }
      }
    }
  ],
  [
    'optional pointer (linked list)',
    schema(object('node', int('value', 0, 7), optional('next', pointer('nextNode', 'node')))),
    { node: { value: 1, next: { value: 2, next: { value: 3, next: null } } } }
  ],
  [
    'array that may be empty (n-ary tree)',
    schema(object('tree', int('value', 0, 15), array('children', 0, 3, pointer('child', 'tree')))),
    {
      tree: {
        value: 1,
        children: [
          { value: 2, children: [] },
          { value: 3, children: [{ value: 4, children: [{ value: 5, children: [] }] }] }
        ]
      }
    }
  ],
  [
    'array of at least one, ended by a union variant',
    schema(
      union('tree', enumeration('kind', ['leaf', 'branch']), {
        leaf: [int('value', 0, 9)],
        branch: [array('children', 1, 3, pointer('child', 'tree'))]
      })
    ),
    {
      tree: {
        kind: 'branch',
        children: [
          { kind: 'leaf', value: 1 },
          { kind: 'branch', children: [{ kind: 'branch', children: [{ kind: 'leaf', value: 9 }] }] }
        ]
      }
    }
  ],
  [
    'mutual recursion between top-level fields',
    schema(
      union('a', enumeration('t', ['toB', 'stop']), { toB: [pointer('b', 'bNode')], stop: [] }),
      object('bNode', bool('flag'), union('next', enumeration('k', ['toA', 'end']), { toA: [pointer('back', 'a')], end: [] }))
    ),
    {
      a: { t: 'toB', b: { flag: true, next: { k: 'toA', back: { t: 'toB', b: { flag: false, next: { k: 'end' } } } } } },
      bNode: { flag: false, next: { k: 'toA', back: { t: 'stop' } } }
    }
  ],
  [
    'target nested inside an object',
    schema(
      object(
        'doc',
        int('version', 1, 3),
        object('section', enumeration('level', ['h1', 'h2', 'h3']), array('subsections', 0, 3, pointer('sub', 'section')))
      )
    ),
    {
      doc: {
        version: 2,
        section: {
          level: 'h1',
          subsections: [{ level: 'h2', subsections: [{ level: 'h3', subsections: [] }] }, { level: 'h2', subsections: [] }]
        }
      }
    }
  ],
  [
    'target defined inside a union variant',
    schema(
      union('shape', enumeration('type', ['box', 'group']), {
        box: [int('size', 0, 10)],
        group: [object('groupBody', int('id', 0, 99), optional('inner', pointer('innerGroup', 'groupBody')))]
      })
    ),
    { shape: { type: 'group', groupBody: { id: 1, inner: { id: 2, inner: { id: 3, inner: null } } } } }
  ],
  [
    'target is the item field of an array',
    schema(array('list', 0, 3, object('item', int('id', 0, 9), optional('nested', pointer('nestedItem', 'item'))))),
    { list: [{ id: 1, nested: { id: 2, nested: { id: 3, nested: null } } }, { id: 4, nested: null }] }
  ],
  [
    "target is an optional's inner field",
    schema(optional('maybe', object('inner', bool('on'), optional('again', pointer('innerAgain', 'inner'))))),
    { maybe: { on: true, again: { on: false, again: { on: true, again: null } } } }
  ],
  [
    'json-like value: pointers inside arrays and objects inside variants',
    schema(
      union('json', enumeration('type', ['null', 'bool', 'number', 'array', 'object']), {
        null: [],
        bool: [bool('value')],
        number: [fixed('value', -100, 100, 0.5)],
        array: [array('items', 0, 4, pointer('item', 'json'))],
        object: [array('entries', 0, 3, object('entry', enumeration('key', ['a', 'b', 'c']), pointer('value', 'json')))]
      })
    ),
    {
      json: {
        type: 'object',
        entries: [
          { key: 'a', value: { type: 'array', items: [{ type: 'number', value: -2.5 }, { type: 'null' }] } },
          { key: 'b', value: { type: 'object', entries: [{ key: 'c', value: { type: 'bool', value: true } }] } }
        ]
      }
    }
  ],
  [
    'several recursive structures in one schema, one referring to another',
    schema(
      union('expr', enumeration('type', ['number', 'neg']), { number: [int('value', 0, 9)], neg: [pointer('inner', 'expr')] }),
      object('list', pointer('head', 'expr'), optional('tail', pointer('rest', 'list'))),
      object('tree', array('children', 0, 2, pointer('child', 'tree')))
    ),
    {
      expr: { type: 'neg', inner: { type: 'neg', inner: { type: 'number', value: 4 } } },
      list: { head: { type: 'number', value: 1 }, tail: { head: { type: 'neg', inner: { type: 'number', value: 2 } }, tail: null } },
      tree: { children: [{ children: [{ children: [] }] }, { children: [] }] }
    }
  ],
  [
    'pointer whose target is another pointer',
    schema(
      union('expr', enumeration('type', ['number', 'add']), {
        number: [int('value', 0, 9)],
        add: [pointer('left', 'expr'), pointer('right', 'left')]
      })
    ),
    {
      expr: {
        type: 'add',
        left: { type: 'add', left: { type: 'number', value: 1 }, right: { type: 'number', value: 2 } },
        right: { type: 'add', left: { type: 'number', value: 3 }, right: { type: 'number', value: 4 } }
      }
    }
  ]
];

describe('schemaFromJson - recursion', () => {
  test.each(recursiveCases)('%s', (_name, original, data) => {
    const loaded = jsonRoundTrip(original);
    expect(loaded).toEqual(original);

    const encoded = densing(original, data);
    expect(densing(loaded, data)).toBe(encoded);
    expect(undensing(loaded, encoded)).toEqual(data as any);

    const defaults = getDefaultData(original);
    expect(getDefaultData(loaded)).toEqual(defaults);
    expect(densing(loaded, defaults)).toBe(densing(original, defaults));

    expect(calculateDenseDataSize(loaded, data)).toEqual(calculateDenseDataSize(original, data));
  });

  // hand written: no defaults, so these rely on schemaFromJson filling them in like the builders
  const handWritten: [string, unknown, number][] = [
    [
      'expression',
      {
        fields: [
          {
            type: 'union',
            name: 'expr',
            discriminator: { type: 'enum', name: 'type', options: ['number', 'add', 'multiply'] },
            variants: {
              number: [{ type: 'int', name: 'value', min: 0, max: 1000 }],
              add: [
                { type: 'pointer', name: 'left', targetName: 'expr' },
                { type: 'pointer', name: 'right', targetName: 'expr' }
              ],
              multiply: [
                { type: 'pointer', name: 'left', targetName: 'expr' },
                { type: 'pointer', name: 'right', targetName: 'expr' }
              ]
            }
          }
        ]
      },
      0
    ],
    [
      'linked list',
      {
        fields: [
          {
            type: 'object',
            name: 'node',
            fields: [
              { type: 'int', name: 'value', min: 0, max: 7 },
              { type: 'optional', name: 'next', field: { type: 'pointer', name: 'nextNode', targetName: 'node' } }
            ]
          }
        ]
      },
      1
    ],
    [
      'n-ary tree',
      {
        fields: [
          {
            type: 'object',
            name: 'tree',
            fields: [
              { type: 'int', name: 'value', min: 0, max: 15 },
              { type: 'array', name: 'children', minLength: 0, maxLength: 3, items: { type: 'pointer', name: 'child', targetName: 'tree' } }
            ]
          }
        ]
      },
      2
    ]
  ];

  test.each(handWritten)('hand written %s loads like the builder version', (_name, json, index) => {
    const [, original, data] = recursiveCases[index];
    const loaded = schemaFromJson(json);
    expect(loaded).toEqual(original);
    expect(densing(loaded, data)).toBe(densing(original, data));
    expect(getDefaultData(loaded)).toEqual(getDefaultData(original));
  });

  // built without `schema()`, which would throw before they could be stringified
  const invalid: [string, DenseField[], string][] = [
    ['a pointer to itself', [pointer('p', 'p')], 'Invalid schema: p: pointer target "p" has no finite value'],
    [
      'an object that always recurses',
      [object('n', int('v', 0, 3), pointer('next', 'n'))],
      'Invalid schema: n.next: pointer target "n" has no finite value'
    ],
    [
      'an array that can never be empty',
      [array('list', 1, 3, pointer('item', 'list'))],
      'Invalid schema: list[].item: pointer target "list" has no finite value'
    ],
    [
      'a union whose every variant recurses',
      [union('u', enumeration('t', ['a', 'b']), { a: [pointer('x', 'u')], b: [pointer('y', 'u')] })],
      'Invalid schema: u.x: pointer target "u" has no finite value'
    ],
    ['a missing target', [object('o', pointer('p', 'nope'))], 'Invalid schema: o.p: pointer target "nope" does not exist'],
    [
      'an ambiguous target',
      [object('a', object('node', int('v', 0, 1))), object('b', object('node', int('w', 0, 1))), pointer('p', 'node')],
      'Invalid schema: p: pointer target "node" is ambiguous, it matches a.node, b.node'
    ]
  ];

  test.each(invalid)('rejects %s', (_name, fields, message) => {
    expect(() => schemaFromJson(JSON.stringify({ fields }))).toThrow(message);
  });
});
