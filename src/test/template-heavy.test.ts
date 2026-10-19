import { expect, test } from 'bun:test';
import { getDenseFieldBitWidthRange } from '../api';
import { densingSchema, undensingSchema } from '../meta/schema-codec';
import { schemaFromJson } from '../schema/from-json';
import { generateTypes } from '../schema/type-generator';
import { validateSchema } from '../schema/validate-schema';

test('templates that refer to each other are measured in linear time', () => {
  // template i is a leaf or a pair of templates i + 1 and i + 2: following every path is exponential
  const count = 60;
  const s = schemaFromJson({
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
  expect(validateSchema(s).valid).toBe(true);
  // 1 discriminator bit + the 3 bit leaf; the pairs nest without limit
  expect(getDenseFieldBitWidthRange(s.fields[0], s)).toEqual({ min: 4, max: Infinity });
});

test('vec2 fixture: 202 templates that refer to each other', async () => {
  const s = schemaFromJson(await Bun.file(`${import.meta.dir}/fixtures/vec2.dense.json`).text());
  expect(validateSchema(s).valid).toBe(true);
  expect(undensingSchema(densingSchema(s))).toEqual(s);

  // the ranges are cached per schema: measuring every template again takes ~600 ms without the cache
  const start = performance.now();
  s.templates!.forEach((t) => getDenseFieldBitWidthRange(t, s));
  expect(performance.now() - start).toBeLessThan(100);

  const types = generateTypes(s);
  expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(types)).not.toThrow();
  const names = [...types.matchAll(/^export (?:type|interface) (\S+)/gm)].map((m) => m[1]);
  expect(new Set(names).size).toBe(names.length);
});
