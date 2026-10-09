// migrate.test.ts - pointersToTemplates: pointer schemas become template schemas with the same bits
import { describe, test, expect } from 'bun:test';
import { array, bool, enumeration, int, object, optional, pointer, reference, schema, template, Template, union } from '../schema/builder';
import { pointersToTemplates } from '../schema/migrate';
import { densing, undensing } from '../densing';
import { densingSchema, undensingSchema } from '../meta/schema-codec';
import { generateTypes } from '../schema/type-generator';
import { DenseSchema } from '../schema-type';

/** Convert, check nothing pointer-shaped is left, and check every sample encodes and decodes the same */
const migrate = (s: DenseSchema, samples: unknown[]) => {
  const migrated = pointersToTemplates(s);
  expect(JSON.stringify(migrated)).not.toContain('"pointer"');
  for (const data of samples) {
    const encoded = densing(s, data);
    expect(densing(migrated, data)).toBe(encoded);
    expect(undensing(migrated, encoded)).toEqual(undensing(s, encoded));
  }
  expect(undensingSchema(densingSchema(migrated))).toEqual(migrated);
  return migrated;
};

const expr = schema(
  union('expr', enumeration('type', ['number', 'add', 'multiply']), {
    number: [int('value', 0, 1000)],
    add: [pointer('left', 'expr'), pointer('right', 'expr')],
    multiply: [pointer('left', 'expr'), pointer('right', 'expr')]
  })
);
const exprData = {
  expr: {
    type: 'multiply',
    left: { type: 'add', left: { type: 'number', value: 5 }, right: { type: 'number', value: 3 } },
    right: { type: 'number', value: 2 }
  }
};

describe('pointersToTemplates', () => {
  test('recursive union: the target becomes a template, it and its pointers references', () => {
    const migrated = migrate(expr, [exprData, { expr: { type: 'number', value: 7 } }]);
    expect(migrated.fields).toEqual([{ type: 'reference', name: 'expr', ref: 0 }]);
    expect(migrated.templates).toHaveLength(1);
    expect(densing(migrated, exprData)).toBe('kAUAMAI');
    // the same schema written with templates directly
    const node: Template = template(
      union('expr', enumeration('type', ['number', 'add', 'multiply']), {
        number: [int('value', 0, 1000)],
        add: [reference('left', () => node), reference('right', () => node)],
        multiply: [reference('left', () => node), reference('right', () => node)]
      })
    );
    expect(migrated).toEqual(schema(reference('expr', node)));
  });

  test('linked list, tree, and a non-recursive object reused twice', () => {
    migrate(schema(object('node', int('value', 0, 7), optional('next', pointer('nextNode', 'node')))), [
      { node: { value: 1, next: { value: 2, next: null } } }
    ]);
    migrate(schema(object('tree', int('value', 0, 15), array('children', 0, 3, pointer('child', 'tree')))), [
      { tree: { value: 1, children: [{ value: 2, children: [] }, { value: 3, children: [{ value: 4, children: [] }] }] } }
    ]);
    const reused = migrate(schema(object('point', int('x', 0, 9), int('y', 0, 9)), pointer('a', 'point'), pointer('b', 'point')), [
      { point: { x: 1, y: 2 }, a: { x: 3, y: 4 }, b: { x: 5, y: 6 } }
    ]);
    expect(reused.fields.map((f) => f.type)).toEqual(['reference', 'reference', 'reference']);
  });

  test('mutual recursion and pointer chains', () => {
    migrate(
      schema(
        union('a', enumeration('t', ['toB', 'stop']), { toB: [pointer('b', 'bNode')], stop: [] }),
        object('bNode', bool('flag'), union('next', enumeration('k', ['toA', 'end']), { toA: [pointer('back', 'a')], end: [] }))
      ),
      [{ a: { t: 'toB', b: { flag: true, next: { k: 'toA', back: { t: 'stop' } } } }, bNode: { flag: false, next: { k: 'end' } } }]
    );
    // `right` points at `left`, itself a pointer: both end at `expr`
    const chain = migrate(
      schema(union('expr', enumeration('type', ['number', 'add']), { number: [int('value', 0, 9)], add: [pointer('left', 'expr'), pointer('right', 'left')] })),
      [{ expr: { type: 'add', left: { type: 'number', value: 1 }, right: { type: 'number', value: 2 } } }]
    );
    expect(chain.templates).toHaveLength(1);
  });

  test('pointers inside existing templates; template names stay unique', () => {
    const shape = template(object('point', int('x', 0, 9)));
    const migrated = migrate(schema(reference('origin', shape), object('wrapper', object('point', int('y', 0, 9)), pointer('again', 'point'))), [
      { origin: { x: 1 }, wrapper: { point: { y: 2 }, again: { y: 3 } } }
    ]);
    expect(migrated.templates!.map((t) => t.name)).toEqual(['point', 'point2']);
  });

  test('schemas without pointers, and invalid ones, are returned as they are', () => {
    const plain = schema(int('a', 0, 1));
    expect(pointersToTemplates(plain)).toBe(plain);
    const invalid: DenseSchema = { fields: [object('o', pointer('p', 'nope'))] };
    expect(pointersToTemplates(invalid)).toBe(invalid);
  });

  test('generateTypes names the new templates', () => {
    expect(generateTypes(pointersToTemplates(expr))).toContain('export type Expr = Expr_Number | Expr_Add | Expr_Multiply;');
  });
});
