// migrate.test.ts - pointersToTemplates: 0.4 schemas with pointers become template schemas with the same bits
import { describe, test, expect } from 'bun:test';
import { enumeration, int, reference, schema, template, Template, union } from '../schema/builder';
import { pointersToTemplates } from '../schema/migrate';
import { schemaFromJson } from '../schema/from-json';
import { densing, undensing } from '../densing';
import { densingSchema, undensingSchema } from '../meta/schema-codec';
import { generateTypes } from '../schema/type-generator';
import v0 from './fixtures/v0-schema-strings.json';

// 0.4 schema JSON, which still had pointer fields
const intJ = (name: string, min: number, max: number) => ({ type: 'int', name, min, max });
const ptr = (name: string, targetName: string) => ({ type: 'pointer', name, targetName });
const obj = (name: string, ...fields: object[]) => ({ type: 'object', name, fields });
const unionJ = (name: string, discriminator: string, variants: Record<string, object[]>) => ({
  type: 'union',
  name,
  discriminator: { type: 'enum', name: discriminator, options: Object.keys(variants) },
  variants
});

/** Convert, check nothing pointer-shaped is left, load the result and round trip it as a schema string */
const migrate = (json: object, samples: unknown[] = []) => {
  const migrated = pointersToTemplates(json);
  expect(JSON.stringify(migrated)).not.toContain('"pointer"');
  const s = schemaFromJson(migrated);
  for (const data of samples) expect(undensing(s, densing(s, data))).toEqual(data);
  expect(undensingSchema(densingSchema(s))).toEqual(s);
  return s;
};

const expr = {
  fields: [
    unionJ('expr', 'type', {
      number: [intJ('value', 0, 1000)],
      add: [ptr('left', 'expr'), ptr('right', 'expr')],
      multiply: [ptr('left', 'expr'), ptr('right', 'expr')]
    })
  ]
};
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
    // the payload of the 0.4 pointer schema
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

  test('payloads written by densing 0.4 with the pointer schema decode the same', () => {
    const { json, data, payload } = v0.pointers;
    const migrated = migrate(json, [data]);
    expect(undensing(migrated, payload)).toEqual(data);
    expect(densing(migrated, data)).toBe(payload);
  });

  test('linked list, tree, and a non-recursive object reused twice', () => {
    migrate({ fields: [obj('node', intJ('value', 0, 7), { type: 'optional', name: 'next', field: ptr('nextNode', 'node') })] }, [
      { node: { value: 1, next: { value: 2, next: null } } }
    ]);
    const children = { type: 'array', name: 'children', minLength: 0, maxLength: 3, items: ptr('child', 'tree') };
    migrate({ fields: [obj('tree', intJ('value', 0, 15), children)] }, [
      { tree: { value: 1, children: [{ value: 2, children: [] }, { value: 3, children: [{ value: 4, children: [] }] }] } }
    ]);
    const reused = migrate({ fields: [obj('point', intJ('x', 0, 9), intJ('y', 0, 9)), ptr('a', 'point'), ptr('b', 'point')] }, [
      { point: { x: 1, y: 2 }, a: { x: 3, y: 4 }, b: { x: 5, y: 6 } }
    ]);
    expect(reused.fields.map((f) => f.type)).toEqual(['reference', 'reference', 'reference']);
  });

  test('mutual recursion and pointer chains', () => {
    migrate(
      {
        fields: [
          unionJ('a', 't', { toB: [ptr('b', 'bNode')], stop: [] }),
          obj('bNode', { type: 'bool', name: 'flag' }, unionJ('next', 'k', { toA: [ptr('back', 'a')], end: [] }))
        ]
      },
      [{ a: { t: 'toB', b: { flag: true, next: { k: 'toA', back: { t: 'stop' } } } }, bNode: { flag: false, next: { k: 'end' } } }]
    );
    // `right` points at `left`, itself a pointer: both end at `expr`
    const chain = { fields: [unionJ('expr', 'type', { number: [intJ('value', 0, 9)], add: [ptr('left', 'expr'), ptr('right', 'left')] })] };
    expect(pointersToTemplates(chain).templates).toHaveLength(1);
    migrate(chain, [{ expr: { type: 'add', left: { type: 'number', value: 1 }, right: { type: 'number', value: 2 } } }]);
  });

  test('pointers inside existing templates; template names stay unique', () => {
    const json = {
      templates: [obj('point', intJ('x', 0, 9))],
      fields: [{ type: 'reference', name: 'origin', ref: 0 }, obj('wrapper', obj('point', intJ('y', 0, 9)), ptr('again', 'point'))]
    };
    expect(pointersToTemplates(json).templates.map((t: { name: string }) => t.name)).toEqual(['point', 'point2']);
    migrate(json, [{ origin: { x: 1 }, wrapper: { point: { y: 2 }, again: { y: 3 } } }]);
  });

  test('schemas without pointers are returned as they are; missing or ambiguous targets throw', () => {
    const plain = { fields: [intJ('a', 0, 1)] };
    expect(pointersToTemplates(plain)).toBe(plain);
    expect(pointersToTemplates(JSON.stringify(plain))).toEqual(plain);
    expect(() => pointersToTemplates({ fields: [obj('o', ptr('p', 'nope'))] })).toThrow('pointer target "nope" does not exist');
    expect(() => pointersToTemplates({ fields: [obj('a', intJ('v', 0, 1)), obj('b', intJ('v', 0, 1)), ptr('p', 'v')] })).toThrow(
      'pointer target "v" is ambiguous'
    );
  });

  test('schemaFromJson points to pointersToTemplates', () => {
    expect(() => schemaFromJson(expr)).toThrow('pointersToTemplates');
  });

  test('generateTypes names the new templates', () => {
    expect(generateTypes(migrate(expr))).toContain('export type Expr = Expr_Number | Expr_Add | Expr_Multiply;');
  });
});
