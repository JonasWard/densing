// template-variants.test.ts - union variants are object templates, shared by every union that uses them
import { describe, expect, test } from 'bun:test';
import { enumeration, int, object, reference, schema, template, Template, union } from '../schema/builder';
import { densing, undensing } from '../densing';
import { validate } from '../schema/validation';
import { schemaFromJson } from '../schema/from-json';
import { generateTypes } from '../schema/type-generator';
import { getDefaultData } from '../schema/default-data';
import { getDenseFieldBitWidthRange, getFieldByPath } from '../api';
import { densingSchema, undensingSchema } from '../meta/schema-codec';
import { DenseEncodeError } from '../errors';
import { DenseSchema } from '../schema-type';

const roundTrip = (s: DenseSchema, data: any) => {
  const encoded = densing(s, data);
  expect(undensing(s, encoded)).toEqual(data);
  expect(validate(s, data).valid).toBe(true);
  return encoded;
};
const value = (max: number) => [int('value', 0, max)];
const legacyUnion = (name: string, variants: Record<string, unknown[]>) => ({
  type: 'union',
  name,
  discriminator: { type: 'enum', name: 'type', options: Object.keys(variants) },
  variants
});
const intJson = (name: string, max: number) => ({ type: 'int', name, min: 0, max });

// two unions that both offer the operations `double` and `half`: listed directly, their shape stored once
const S = schema(
  union('length', 'type', { literal: value(100), double: value(100), half: value(100) }),
  union('angle', 'type', { degrees: value(359), double: value(100), half: value(100) })
);
const lengthOf = S.fields[0] as unknown as { variants: Record<string, number> };
const angleOf = S.fields[1] as unknown as { variants: Record<string, number> };

describe('works', () => {
  test('flat data', () => {
    roundTrip(S, { length: { type: 'double', value: 3 }, angle: { type: 'degrees', value: 90 } });
  });

  test('variants are template indices; identical shapes are stored once', () => {
    expect(typeof lengthOf.variants.double).toBe('number');
    expect(lengthOf.variants.double).toBe(angleOf.variants.double);
    expect(lengthOf.variants.literal).toBe(lengthOf.variants.double); // the same shape, `value(100)`
    expect(angleOf.variants.degrees).not.toBe(angleOf.variants.double);
    expect(S.templates!.map((t) => t.name)).toEqual(['literal', 'degrees']);
  });

  test('a 0.4 schema (fields per variant) loads as the same schema, with the same bits', () => {
    const old = schemaFromJson({
      fields: [
        legacyUnion('length', { literal: [intJson('value', 100)], double: [intJson('value', 100)], half: [intJson('value', 100)] }),
        legacyUnion('angle', { degrees: [intJson('value', 359)], double: [intJson('value', 100)], half: [intJson('value', 100)] })
      ]
    });
    expect(old).toEqual(S);
    const data = { length: { type: 'half', value: 8 }, angle: { type: 'double', value: 1 } };
    expect(densing(old, data)).toBe(densing(S, data));
  });

  test('a template variant and recursion', () => {
    const vec = template(object('Vec', int('x', 0, 7), int('y', 0, 7)));
    const expr: Template = template(
      union('Expr', 'type', {
        input: [int('input', 0, 255)],
        'Vec2.add': [reference('self', () => expr), reference('other', () => expr)],
        literal: vec
      })
    );
    const R = schema(reference('root', expr));
    roundTrip(R, { root: { type: 'Vec2.add', self: { type: 'input', input: 1 }, other: { type: 'literal', x: 2, y: 3 } } });
    expect(getFieldByPath(R, 'root.other')?.name).toBe('other');
    expect(getFieldByPath(R, 'root.x')?.name).toBe('x');
  });

  test('a template defined later, behind a function', () => {
    const u = union('u', 'type', { a: () => later, b: [] });
    const later = template(object('later', int('n', 0, 3)));
    roundTrip(schema(u), { u: { type: 'a', n: 2 } });
  });

  test('one-option enums and single-variant unions cost 0 bits', () => {
    expect(getDenseFieldBitWidthRange(enumeration('e', ['only']))).toEqual({ min: 0, max: 0 });
    const U = schema(union('u', 'type', { only: [] }));
    expect(getDenseFieldBitWidthRange(U.fields[0], U)).toEqual({ min: 0, max: 0 });
    expect(roundTrip(U, { u: { type: 'only' } })).toBe('');
  });

  test('default variant', () => {
    const U = schema(union('u', 'type', { a: value(3), b: [] }, 'b'));
    expect(getDefaultData(U)).toEqual({ u: { type: 'b' } });
    expect(schemaFromJson(JSON.parse(JSON.stringify(U)))).toEqual(U);
    // the deprecated enum form keeps the enum's default
    const E = schema(union('u', enumeration('type', ['a', 'b'], 'b'), { a: value(3), b: [] }));
    expect(E).toEqual(U);
  });

  test('a union can be used on its own, before schema()', () => {
    const u = union('u', 'type', { a: value(3), b: [] });
    expect(getDenseFieldBitWidthRange(u)).toEqual({ min: 1, max: 3 });
    expect(validate({ fields: [u] }, { u: { type: 'a', value: 9 } }).errors[0].path).toBe('u.value');
  });

  test('JSON, schema strings and types round trip', () => {
    expect(JSON.parse(JSON.stringify(S.fields[0]))).toEqual({ type: 'union', name: 'length', discriminator: 'type', variants: { literal: 0, double: 0, half: 0 } });
    expect(schemaFromJson(JSON.parse(JSON.stringify(S)))).toEqual(S);
    expect(undensingSchema(densingSchema(S))).toEqual(S);
    const types = generateTypes(S);
    expect(types).toContain("type: 'double';");
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(types)).not.toThrow();
  });

  test('validation paths stay at the union level', () =>
    expect(validate(S, { length: { type: 'double', value: 999 }, angle: { type: 'degrees', value: 0 } }).errors[0].path).toBe('length.value'));
});

describe('does not work', () => {
  test('a variant template that is not an object', () => {
    expect(() => union('u', 'type', { a: template(int('n', 0, 3)), b: [] })).toThrow('the template must be an object, got "int"');
    expect(() => schema(union('u', 'type', { a: () => template(int('n', 0, 3)), b: [] }))).toThrow('must be an object, got "int"');
    expect(() => union('u', 'type', { a: object('plain', int('n', 0, 3)) as Template, b: [] })).toThrow('expected fields or a template');
  });

  test('a field named like the discriminator', () => {
    expect(() => union('u', 'type', { a: [int('type', 0, 3)], b: [] })).toThrow('duplicate field name "type"');
    const shape = template(object('shape', int('type', 0, 3)));
    expect(() => union('u', 'type', { a: shape })).toThrow('duplicate field name "type"');
    expect(() => schema(union('u', 'type', { a: () => shape }))).toThrow('field "type" has the name of the discriminator');
  });

  test('integer-like variant names (JS would reorder them)', () =>
    expect(() => union('u', 'type', { a: [], '1': [] })).toThrow('variant "1" looks like an index'));

  test('a union without variants, or an unknown default', () => {
    expect(() => union('u', 'type', {})).toThrow('needs at least one variant');
    expect(() => union('u', 'type', { a: [] }, 'z')).toThrow('default variant "z" is not one of [a]');
  });

  test('JSON: a variant index without a template', () =>
    expect(() =>
      schemaFromJson({ templates: [], fields: [{ type: 'union', name: 'u', discriminator: 'type', variants: { a: 5 } }] })
    ).toThrow('u.variants.a: template 5 does not exist'));

  test('unknown variant as data', () => {
    expect(() => densing(S, { length: { type: 'triple', value: 1 }, angle: { type: 'degrees', value: 0 } })).toThrow(DenseEncodeError);
    expect(validate(S, { length: { type: 'triple', value: 1 }, angle: { type: 'degrees', value: 0 } }).errors[0].message).toBe(
      'invalid discriminator "triple", expected one of [literal, double, half]'
    );
  });

  test('an enum without options', () => expect(() => enumeration('e', [])).toThrow('must have at least 1 value'));

  test('pointer fields are gone', () =>
    expect(() => schemaFromJson({ fields: [{ type: 'pointer', name: 'p', targetName: 'x' }] })).toThrow('pointersToTemplates'));
});

describe('the vec2 schema of dirty-geometry', async () => {
  const json = JSON.parse(await Bun.file(`${import.meta.dir}/fixtures/vec2.dense.json`).text());
  const cell = (expr: unknown) => ({ stamp: 1, inputs: [], functions: [], cells: [{ name: ['c'], output: true, typed: true, expr }] });
  const before = cell({ type: 'Vec2', value: { type: 'Vec2 call', call: { type: 'Vec2.add', self: { type: 'cell', cell: 0 }, other: { type: 'input', input: 0 } } } });
  const after = cell({ type: 'Vec2', value: { type: 'Vec2.add', self: { type: 'cell', cell: 0 }, other: { type: 'input', input: 0 } } });

  // dirty-geometry's generator change in miniature: every type union lists the operations of its call
  // groups itself (the `call` wrapper and the groups go away)
  const withoutCallGroups = () => {
    const out = structuredClone(json);
    const isGroupVariant = (v: { type: string; name: string }[]) => v.length === 1 && v[0].type === 'reference' && v[0].name === 'call';
    const groups = new Set<number>();
    for (const u of out.templates.filter((t: any) => t.type === 'union')) {
      const variants: Record<string, unknown> = {};
      for (const key of u.discriminator.options) {
        const v = u.variants[key];
        if (!isGroupVariant(v)) variants[key] = v;
        else {
          groups.add(v[0].ref);
          const group = out.templates[v[0].ref];
          for (const op of group.discriminator.options) if (op !== '') variants[op] = structuredClone(group.variants[op]);
        }
      }
      u.discriminator.options = Object.keys(variants);
      u.variants = variants;
    }
    // drop the unused groups, renumbering the references
    const renumber = new Map<number, number>();
    out.templates.forEach((_: unknown, i: number) => groups.has(i) || renumber.set(i, renumber.size));
    const walk = (node: any): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        if (node.type === 'reference') node.ref = renumber.get(node.ref);
        Object.values(node).forEach(walk);
      }
    };
    out.templates = out.templates.filter((_: unknown, i: number) => !groups.has(i));
    walk(out);
    return schemaFromJson(out);
  };

  test('loads as it is: the same bits, a much smaller schema', () => {
    const s = schemaFromJson(json);
    expect(JSON.stringify(s).length).toBeLessThan(0.75 * JSON.stringify(json).length);
    expect(undensing(s, densing(s, before))).toMatchObject(before);
  });

  test('without call groups: flat data, schema strings and types work', () => {
    const s = withoutCallGroups();
    expect(JSON.stringify(s).length).toBeLessThan(0.75 * JSON.stringify(json).length);
    expect(undensing(s, densing(s, after))).toMatchObject(after);
    expect(undensingSchema(densingSchema(s))).toEqual(s);
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(generateTypes(s))).not.toThrow();
  });
});
