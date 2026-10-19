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
  reference,
  template,
  Template,
  schemaFromJson,
  getDefaultData
} from '../schema';
import { pointersToTemplates } from '../schema/migrate';
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

const exprTemplate: Template = template(
  union('expr', 'type', {
    number: [int('value', 0, 1000)],
    add: [reference('left', () => exprTemplate), reference('right', () => exprTemplate)],
    multiply: [reference('left', () => exprTemplate), reference('right', () => exprTemplate)]
  })
);
const ExpressionSchema = schema(reference('expr', exprTemplate));

const jsonRoundTrip = (s: unknown) => schemaFromJson(JSON.parse(JSON.stringify(s)));

describe('schemaFromJson - round trip', () => {
  test('complex schema survives JSON.stringify -> schemaFromJson', () => {
    expect(jsonRoundTrip(DeviceConfigSchema)).toEqual(DeviceConfigSchema);
  });

  test('accepts a JSON string', () => {
    expect(schemaFromJson(JSON.stringify(DeviceConfigSchema))).toEqual(DeviceConfigSchema);
  });

  test('recursive schema survives the round trip and encodes identically', () => {
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

  test('checks unions in the 0.5 form', () => {
    const variants = { a: 0 };
    const templates = [{ type: 'object', name: 'a', fields: [] }];
    const union0 = (u: Record<string, unknown>) => () => schemaFromJson({ templates, fields: [{ type: 'union', name: 'u', ...u }] });
    expect(union0({ discriminator: 'type', variants })).not.toThrow();
    expect(union0({ discriminator: 'type', variants: { a: 'x' } })).toThrow('Invalid schema at fields[0].variants.a: must be the index of a template');
    expect(union0({ discriminator: 'type', variants: {} })).toThrow('a union needs at least one variant');
    expect(union0({ discriminator: 'type', variants: { a: 3 } })).toThrow('u.variants.a: template 3 does not exist');
    expect(union0({ discriminator: 'type', variants, defaultVariant: 'z' })).toThrow('default variant "z" is not one of [a]');
    expect(union0({ discriminator: 1, variants })).toThrow('"discriminator" must be a string');
  });

  test('checks unions in the 0.4 form (an enum discriminator and fields per variant)', () => {
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
    expect(field({ type: 'reference', name: 'p', ref: 3 })).toThrow('Invalid schema: p: template 3 does not exist');
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
 * Every way a schema can recurse. A cycle goes through a template and needs an exit (a union variant, an
 * optional or an array that may be empty). Each sample nests at least three levels deep.
 */
const recursive = (build: (self: () => Template) => DenseField, name: string) => {
  const t: Template = template(build(() => t));
  return reference(name, t);
};
const exprT = exprTemplate;
const nodeT: Template = template(object('node', int('value', 0, 7), optional('next', reference('nextNode', () => nodeT))));
const treeT: Template = template(object('tree', int('value', 0, 15), array('children', 0, 3, reference('child', () => treeT))));
const aT: Template = template(union('a', 't', { toB: [reference('b', () => bT)], stop: [] }));
const bT: Template = template(object('bNode', bool('flag'), union('next', 'k', { toA: [reference('back', () => aT)], end: [] })));
const jsonT: Template = template(
  union('json', 'type', {
    null: [],
    bool: [bool('value')],
    number: [fixed('value', -100, 100, 0.5)],
    array: [array('items', 0, 4, reference('item', () => jsonT))],
    object: [array('entries', 0, 3, object('entry', enumeration('key', ['a', 'b', 'c']), reference('value', () => jsonT)))]
  })
);
const negT: Template = template(union('expr', 'type', { number: [int('value', 0, 9)], neg: [reference('inner', () => negT)] }));
const listT: Template = template(object('list', reference('head', negT), optional('tail', reference('rest', () => listT))));
const bareTreeT: Template = template(object('tree', array('children', 0, 2, reference('child', () => bareTreeT))));

const recursiveCases: [string, DenseSchema, unknown][] = [
  [
    'union variants referring back to the union (expression)',
    ExpressionSchema,
    {
      expr: {
        type: 'multiply',
        left: { type: 'add', left: { type: 'number', value: 5 }, right: { type: 'number', value: 3 } },
        right: { type: 'number', value: 2 }
      }
    }
  ],
  ['optional reference (linked list)', schema(reference('node', nodeT)), { node: { value: 1, next: { value: 2, next: { value: 3, next: null } } } }],
  [
    'array that may be empty (n-ary tree)',
    schema(reference('tree', treeT)),
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
      recursive(
        (self) => union('tree', 'kind', { leaf: [int('value', 0, 9)], branch: [array('children', 1, 3, reference('child', self))] }),
        'tree'
      )
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
    'mutual recursion between two templates',
    schema(reference('a', aT), reference('bNode', bT)),
    {
      a: { t: 'toB', b: { flag: true, next: { k: 'toA', back: { t: 'toB', b: { flag: false, next: { k: 'end' } } } } } },
      bNode: { flag: false, next: { k: 'toA', back: { t: 'stop' } } }
    }
  ],
  [
    'recursion nested inside an object',
    schema(
      object(
        'doc',
        int('version', 1, 3),
        recursive(
          (self) => object('section', enumeration('level', ['h1', 'h2', 'h3']), array('subsections', 0, 3, reference('sub', self))),
          'section'
        )
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
    'recursion inside a union variant',
    schema(
      union('shape', 'type', {
        box: [int('size', 0, 10)],
        group: [recursive((self) => object('groupBody', int('id', 0, 99), optional('inner', reference('innerGroup', self))), 'groupBody')]
      })
    ),
    { shape: { type: 'group', groupBody: { id: 1, inner: { id: 2, inner: { id: 3, inner: null } } } } }
  ],
  [
    'recursion in the items of an array',
    schema(array('list', 0, 3, recursive((self) => object('item', int('id', 0, 9), optional('nested', reference('nestedItem', self))), 'item'))),
    { list: [{ id: 1, nested: { id: 2, nested: { id: 3, nested: null } } }, { id: 4, nested: null }] }
  ],
  [
    "recursion in an optional's inner field",
    schema(optional('maybe', recursive((self) => object('inner', bool('on'), optional('again', reference('innerAgain', self))), 'inner'))),
    { maybe: { on: true, again: { on: false, again: { on: true, again: null } } } }
  ],
  [
    'json-like value: references inside arrays and objects inside variants',
    schema(reference('json', jsonT)),
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
    schema(reference('expr', negT), reference('list', listT), reference('tree', bareTreeT)),
    {
      expr: { type: 'neg', inner: { type: 'neg', inner: { type: 'number', value: 4 } } },
      list: { head: { type: 'number', value: 1 }, tail: { head: { type: 'neg', inner: { type: 'number', value: 2 } }, tail: null } },
      tree: { children: [{ children: [{ children: [] }] }, { children: [] }] }
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

  // hand written in the 0.4 form with pointers: no defaults, so these rely on schemaFromJson filling them
  // in like the builders, and on pointersToTemplates
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
    const loaded = schemaFromJson(pointersToTemplates(json));
    expect(loaded).toEqual(original);
    expect(densing(loaded, data)).toBe(densing(original, data));
    expect(getDefaultData(loaded)).toEqual(getDefaultData(original));
  });

  // written by hand, since `schema()` would throw before they could be stringified
  const ref = (name: string, i: number) => ({ type: 'reference', name, ref: i });
  const invalid: [string, unknown, string][] = [
    ['a template that is a reference to itself', { templates: [ref('p', 0)], fields: [ref('p', 0)] }, 'templates[0]: template "p" has no finite value'],
    [
      'an object that always recurses',
      { templates: [{ type: 'object', name: 'n', fields: [{ type: 'int', name: 'v', min: 0, max: 3 }, ref('next', 0)] }], fields: [ref('n', 0)] },
      'templates[0]: template "n" has no finite value'
    ],
    [
      'an array that can never be empty',
      { templates: [{ type: 'array', name: 'list', minLength: 1, maxLength: 3, items: ref('item', 0) }], fields: [ref('list', 0)] },
      'templates[0]: template "list" has no finite value'
    ],
    [
      'a union whose every variant recurses',
      {
        templates: [
          { type: 'union', name: 'u', discriminator: 't', variants: { a: 1, b: 2 } },
          { type: 'object', name: 'a', fields: [ref('x', 0)] },
          { type: 'object', name: 'b', fields: [ref('y', 0)] }
        ],
        fields: [ref('u', 0)]
      },
      'templates[0]: template "u" has no finite value'
    ],
    ['a missing template', { fields: [{ type: 'object', name: 'o', fields: [ref('p', 4)] }] }, 'Invalid schema: o.p: template 4 does not exist']
  ];

  test.each(invalid)('rejects %s', (_name, json, message) => {
    expect(() => schemaFromJson(JSON.stringify(json))).toThrow(message);
  });
});
