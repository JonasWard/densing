import { describe, expect, test } from 'bun:test';
import { analyzeDenseSchemaSize, calculateDenseDataSize, getDenseFieldBitWidthRange } from '../api';
import { densing, undensing } from '../densing';
import { densingSchema, undensingSchema } from '../meta/schema-codec';
import { getDefaultData } from '../schema/default-data';
import { schemaFromJson } from '../schema/from-json';
import { generateTypes } from '../schema/type-generator';
import { validateSchema } from '../schema/validate-schema';
import { validate } from '../schema/validation';
import { DenseSchema } from '../schema-type';

/** Declared type names that occur more than once */
const duplicateDeclarations = (types: string): string[] => {
  const names = [...types.matchAll(/^export (?:type|interface) (\S+)/gm)].map((m) => m[1]);
  return names.filter((name, i) => names.indexOf(name) !== i);
};

/**
 * `count` templates; template i is either a leaf or a pair of templates i + 1 and i + 2. Following
 * every path through it doubles (roughly) with each template: 2^count-ish work without sharing.
 */
const chainOfPairs = (count: number): DenseSchema =>
  schemaFromJson({
    templates: Array.from({ length: count }, (_, i) => ({
      type: 'union',
      name: `t${i}`,
      discriminator: { type: 'enum', name: 'type', options: ['leaf', 'pair'] },
      variants: {
        leaf: [{ type: 'int', name: 'value', min: 0, max: 7 }],
        pair: [
          { type: 'reference', name: 'a', ref: (i + 1) % count },
          { type: 'reference', name: 'b', ref: (i + 2) % count }
        ]
      }
    })),
    fields: [{ type: 'reference', name: 'root', ref: 0 }]
  });

describe('schemas whose templates refer to each other a lot', () => {
  test('bit widths are shared between the paths through a template', () => {
    // 1 discriminator bit + the 3 bit leaf; the pairs nest without limit
    const s = chainOfPairs(60);
    expect(validateSchema(s)).toEqual({ valid: true, errors: [] });
    expect(analyzeDenseSchemaSize(s).fieldRanges.root).toEqual({ min: 4, max: Infinity });
    s.templates!.forEach((t) => expect(getDenseFieldBitWidthRange(t, s)).toEqual({ min: 4, max: Infinity }));
    expect(getDefaultData(s)).toEqual({ root: { type: 'leaf', value: 0 } });
  });

  test('a cycle through an array that is always empty has a finite max', () => {
    // the builders reject maxLength 0, a schema built by hand can have it
    const s = {
      templates: [
        {
          type: 'object',
          name: 'node',
          fields: [
            { type: 'int', name: 'x', min: 0, max: 3, defaultValue: 0 },
            { type: 'array', name: 'none', minLength: 0, maxLength: 0, items: { type: 'reference', name: 'n', ref: 1 } }
          ]
        },
        { type: 'reference', name: 'alias', ref: 0 }
      ],
      fields: [{ type: 'reference', name: 'root', ref: 1 }]
    } as DenseSchema;
    expect(getDenseFieldBitWidthRange(s.fields[0], s)).toEqual({ min: 2, max: 2 });
    expect(getDenseFieldBitWidthRange(s.templates![1], s)).toEqual({ min: 2, max: 2 });
  });

  test('a template that only refers to itself has no finite value', () => {
    const s = {
      templates: [{ type: 'reference', name: 'loop', ref: 0 }],
      fields: [{ type: 'reference', name: 'root', ref: 0 }]
    } as DenseSchema;
    expect(validateSchema(s).errors).toEqual([
      { path: 'templates[0]', message: 'template "loop" has no finite value: every path through it recurses forever' }
    ]);
  });
});

describe('vec2 fixture: 202 MathJson templates that refer to each other', async () => {
  const json = await Bun.file(`${import.meta.dir}/fixtures/vec2.dense.json`).text();
  const s = schemaFromJson(json);

  test('loads, validates and measures', () => {
    expect(s.templates).toHaveLength(202);
    expect(validateSchema(s)).toEqual({ valid: true, errors: [] });
    const { staticRange, fieldRanges } = analyzeDenseSchemaSize(s);
    expect(staticRange.minBits).toBe(73);
    expect(staticRange.maxBits).toBe(Infinity);
    expect(fieldRanges.stamp).toEqual({ min: 32, max: 32 });
  });

  test('the schema survives JSON and the schema codec', () => {
    expect(schemaFromJson(JSON.stringify(s))).toEqual(s);
    expect(undensingSchema(densingSchema(s))).toEqual(s);
  });

  test('default data validates, encodes and decodes', () => {
    const data = getDefaultData(s);
    expect(validate(s, data)).toEqual({ valid: true, errors: [] });
    const encoded = densing(s, data);
    expect(undensing(s, encoded)).toEqual(data);
    expect(calculateDenseDataSize(s, data).base64Length).toBe(encoded.length);
  });

  test('generateTypes output is valid TypeScript with one declaration per name', () => {
    const types = generateTypes(s);
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(types)).not.toThrow();
    expect(duplicateDeclarations(types)).toEqual([]);
    // `fields` objects of different shapes each get their own type
    expect(types).toContain('export interface Fields2 {');
  });
});
