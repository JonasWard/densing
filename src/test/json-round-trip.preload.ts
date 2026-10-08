// json-round-trip.preload.ts - `bun run test:json`
// Runs the whole test suite while recording every schema built with `schema()` and every successful `densing()`
// call, then checks that each schema survives `JSON.stringify` -> `schemaFromJson`: the loaded schema is equal,
// its default data encodes the same, and the recorded encodes give the same string and decode to the same data.
import { afterAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { DenseSchema } from '../schema-type';

type Recorder = (name: 'schema' | 'densing', args: unknown[], result: unknown) => void;
declare global {
  var __densingJsonRecorder: Recorder | undefined;
}

const MAX_ENCODES_PER_SCHEMA = 25;

const schemas = new Map<DenseSchema, string>(); // schema -> test file it was defined in
const encodes = new Map<DenseSchema, { data: unknown; base: unknown; encoded: string }[]>();

const testFile = (): string =>
  new Error().stack
    ?.split('\n')
    .map((line) => line.match(/src\/test\/[^/:]+\.test\.ts/)?.[0])
    .find(Boolean) ?? 'unknown test file';

globalThis.__densingJsonRecorder = (name, args, result) => {
  if (name === 'schema') {
    if (!schemas.has(result as DenseSchema)) schemas.set(result as DenseSchema, testFile());
    return;
  }
  const list = encodes.get(args[0] as DenseSchema) ?? [];
  if (list.length >= MAX_ENCODES_PER_SCHEMA) return;
  try {
    list.push({ data: structuredClone(args[1]), base: args[2], encoded: result as string });
    encodes.set(args[0] as DenseSchema, list);
  } catch {
    // data that cannot be cloned is not replayed
  }
};

// wrap the exported schema builders and `densing` so that every call goes through the recorder
// (the loader is synchronous, an async one would break tests that `require()` these modules)
Bun.plugin({
  name: 'densing-json-round-trip',
  setup(build) {
    build.onLoad({ filter: /\/src\/(schema\/builder|densing)\.ts$/ }, (args) => {
      const isBuilder = args.path.endsWith('builder.ts');
      const recordAs = isBuilder ? 'schema' : 'densing';
      let contents = readFileSync(args.path, 'utf8');
      for (const name of isBuilder ? ['schema', 'schemaWithDefinitions'] : ['densing']) {
        const declaration = `export const ${name} = `;
        if (!contents.includes(declaration)) throw new Error(`json round trip: "${declaration}" not found in ${args.path}`);
        contents =
          contents.replace(declaration, `const __original_${name} = `) +
          `\nexport const ${name} = (...args: any[]) => {` +
          `\n  const result = (__original_${name} as any)(...args);` +
          `\n  globalThis.__densingJsonRecorder?.('${recordAs}', args, result);` +
          `\n  return result;` +
          `\n};\n`;
      }
      return { loader: 'ts', contents };
    });
  }
});

afterAll(async () => {
  // the checks call `schema()` and `densing()` themselves, those calls must not be recorded
  globalThis.__densingJsonRecorder = undefined;
  if (schemas.size === 0) throw new Error('json round trip: no schemas were recorded, is the preload wrapping broken?');

  const { schemaFromJson } = await import('../schema/from-json');
  const { densing, undensing } = await import('../densing');
  const { getDefaultData } = await import('../schema/default-data');

  const failures: string[] = [];
  const loadedSchemas = new Map<DenseSchema, DenseSchema>();
  const fail = (file: string, message: string) => failures.push(`${file}: ${message}`);

  for (const [original, file] of schemas) {
    let loaded: DenseSchema;
    try {
      loaded = schemaFromJson(JSON.parse(JSON.stringify(original)));
    } catch (error) {
      fail(file, `schemaFromJson throws: ${(error as Error).message}`);
      continue;
    }
    loadedSchemas.set(original, loaded);
    if (!Bun.deepEquals(loaded, original))
      fail(file, `schema changes in the round trip: ${JSON.stringify(original).slice(0, 200)}`);

    let defaults: unknown;
    try {
      defaults = getDefaultData(original);
    } catch {
      continue; // schemas without encodable default data are covered by their recorded encodes
    }
    if (densing(loaded, defaults) !== densing(original, defaults))
      fail(file, `default data encodes differently: ${JSON.stringify(original).slice(0, 200)}`);
  }

  let replayed = 0;
  for (const [original, list] of encodes) {
    const loaded = loadedSchemas.get(original);
    if (!loaded) continue; // a schema not built with `schema()`, or one that already failed above
    const file = schemas.get(original)!;
    for (const { data, base, encoded } of list) {
      replayed++;
      try {
        const reencoded = densing(loaded, data, base as string);
        if (reencoded !== encoded) fail(file, `"${encoded}" encodes as "${reencoded}" with the loaded schema`);
        else if (!Bun.deepEquals(undensing(loaded, encoded, base as string), undensing(original, encoded, base as string)))
          fail(file, `"${encoded}" decodes differently with the loaded schema`);
      } catch (error) {
        fail(file, `encoding "${encoded}" again throws: ${(error as Error).message}`);
      }
    }
  }

  console.log(
    `\njson round trip: ${schemas.size} schemas, ${replayed} encodes replayed, ${failures.length} failures`
  );
  if (failures.length) throw new Error(`json round trip failed:\n${failures.map((f) => `  ${f}`).join('\n')}`);
});
