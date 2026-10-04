import { describe, expect, test } from 'bun:test';
import { densing, undensing } from '../densing';
import { array, bool, enumeration, int, object, optional, pointer, schema, union } from '../schema/builder';
import { getDefaultData } from '../schema/default-data';
import { validate } from '../schema/validation';
import { validateSchema } from '../schema/validate-schema';
import { DenseSchema } from '../schema-type';

const expr = (defaultType: 'number' | 'add') =>
  union('expr', enumeration('type', ['number', 'add'], defaultType), {
    number: [int('value', 0, 1000)],
    add: [pointer('left', 'expr'), pointer('right', 'expr')]
  });

describe('validateSchema', () => {
  test('a pointer target must exist', () => {
    const S = { fields: [object('o', pointer('p', 'nope'))] };
    expect(validateSchema(S).errors).toEqual([{ path: 'o.p', message: 'pointer target "nope" does not exist' }]);
    expect(() => schema(object('o', pointer('p', 'nope')))).toThrow('invalid schema: o.p: pointer target "nope" does not exist');
  });

  test('a pointer target must be unambiguous', () => {
    const fields = [object('a', object('node', int('v', 0, 1))), object('b', object('node', bool('w'))), pointer('p', 'node')];
    expect(validateSchema({ fields }).errors).toEqual([
      { path: 'p', message: 'pointer target "node" is ambiguous, it matches a.node, b.node' }
    ]);
    expect(() => schema(...fields)).toThrow('is ambiguous');
  });

  test('names that no pointer refers to may repeat', () => {
    expect(validateSchema(schema(object('a', int('v', 0, 1)), object('b', int('v', 0, 1)))).valid).toBe(true);
  });

  test('a pointer target must have a finite value', () => {
    const cases: DenseSchema[] = [
      { fields: [pointer('p', 'p')] },
      { fields: [object('n', int('v', 0, 3), pointer('next', 'n'))] },
      { fields: [array('list', 1, 3, pointer('item', 'list'))] },
      { fields: [union('u', enumeration('t', ['a', 'b']), { a: [pointer('x', 'u')], b: [pointer('y', 'u')] })] }
    ];
    for (const S of cases) {
      expect(validateSchema(S).valid).toBe(false);
      expect(validateSchema(S).errors[0].message).toContain('has no finite value');
    }
  });

  test('recursion through a union, an optional or a possibly empty array is fine', () => {
    expect(() => schema(expr('number'))).not.toThrow();
    expect(() => schema(object('n', int('v', 0, 3), optional('next', pointer('p', 'n'))))).not.toThrow();
    expect(() => schema(object('t', array('children', 0, 3, pointer('c', 't'))))).not.toThrow();
  });
});

describe('validate follows pointers', () => {
  const S = schema(expr('number'));

  test('invalid values behind a pointer are reported', () => {
    const data = { expr: { type: 'add', left: { type: 'number', value: 5000 }, right: 'garbage' } };
    expect(validate(S, data).errors).toEqual([
      { path: 'expr.left.value', message: 'value 5000 out of range [0, 1000]' },
      { path: 'expr.right', message: 'expected object' }
    ]);
  });

  test('valid recursive data passes, and validate agrees with densing', () => {
    const data = { expr: { type: 'add', left: { type: 'number', value: 5 }, right: { type: 'number', value: 7 } } };
    expect(validate(S, data).valid).toBe(true);
    expect(undensing(S, densing(S, data))).toEqual(data);
  });
});

describe('getDefaultData for recursive schemas', () => {
  test('the default discriminator is kept, recursion below it ends at the smallest variant', () => {
    expect(getDefaultData(schema(expr('add')))).toEqual({
      expr: { type: 'add', left: { type: 'number', value: 0 }, right: { type: 'number', value: 0 } }
    });
    expect(getDefaultData(schema(expr('number')))).toEqual({ expr: { type: 'number', value: 0 } });
  });

  const schemas: [string, DenseSchema][] = [
    ['expression (default add)', schema(expr('add'))],
    ['linked list', schema(object('node', int('v', 0, 7), optional('next', pointer('n', 'node'))))],
    ['tree with min one child', schema(union('tree', enumeration('kind', ['branch', 'leaf']), {
      branch: [array('children', 1, 3, pointer('child', 'tree'))],
      leaf: [int('value', 0, 9)]
    }))],
    ['mutual recursion', schema(
      union('a', enumeration('t', ['toB', 'stop']), { toB: [pointer('b', 'bNode')], stop: [] }),
      object('bNode', bool('flag'), union('next', enumeration('k', ['toA', 'end']), { toA: [pointer('back', 'a')], end: [] }))
    )],
    ['json-like', schema(union('json', enumeration('type', ['array', 'null', 'number']), {
      array: [array('items', 1, 5, pointer('item', 'json'))],
      null: [],
      number: [int('value', -1000, 1000)]
    }))]
  ];

  for (const [name, S] of schemas) {
    test(`${name}: default data is valid and round-trips`, () => {
      const data = getDefaultData(S);
      expect(validate(S, data).valid).toBe(true);
      expect(undensing(S, densing(S, data))).toEqual(data);
    });
  }
});
