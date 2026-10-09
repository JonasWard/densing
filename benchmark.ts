// benchmark.ts - Performance benchmarks for densing library
import zlib from 'node:zlib';
import { schema, int, bool, fixed, enumeration, object, array, optional, densing, undensing } from './src/index';
import { DenseField } from './src/schema-type';
import { densingSchema, undensingSchema } from './src/meta/schema-codec';
import { schemaSamples } from './src/test/fixtures/schema-samples';
import { GLSLRayMarchingSchema } from './src/test/fixtures/glsl-ray-marching';

// Simple schema - just a few basic fields
const SimpleSchema = schema(
  int('id', 0, 1000),
  bool('active'),
  fixed('value', 0, 100, 0.1),
  enumeration('status', ['pending', 'active', 'done'])
);

const simpleData = {
  id: 500,
  active: true,
  value: 42.5,
  status: 'active'
};

// Complex schema - nested objects, arrays, optionals
const ComplexSchema = schema(
  int('version', 1, 100),
  object('network', int('port', 1024, 65535), bool('secure'), optional('timeout', int('timeoutValue', 0, 300))),
  array('users', 0, 10, object('user', int('id', 0, 10000), enumeration('role', ['admin', 'user', 'guest']))),
  optional('metadata', object('meta', bool('debug'), int('level', 0, 10)))
);

const complexData = {
  version: 2,
  network: {
    port: 8080,
    secure: true,
    timeout: 30
  },
  users: [
    { id: 1, role: 'admin' },
    { id: 2, role: 'user' },
    { id: 3, role: 'guest' }
  ],
  metadata: {
    debug: true,
    level: 5
  }
};

const benchmark = (name: string, fn: () => void, iterations: number = 100000): void => {
  // Warmup
  for (let i = 0; i < 1000; i++) {
    fn();
  }

  // Actual benchmark
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();

  const duration = end - start;
  const opsPerSec = Math.round((iterations / duration) * 1000);
  const usPerOp = (duration * 1000) / iterations;

  console.log(`${name}:`);
  console.log(`  ${iterations.toLocaleString()} iterations in ${duration.toFixed(2)}ms`);
  console.log(`  ${opsPerSec.toLocaleString()} ops/sec`);
  console.log(`  ${usPerOp.toFixed(2)}µs per operation`);
  console.log('');
};

console.log('=== Densing Library Benchmarks ===\n');

// Simple schema benchmarks
console.log('--- Simple Schema (4 fields) ---');
benchmark(
  'Simple: Encoding',
  () => {
    densing(SimpleSchema, simpleData);
  },
  100000
);

const simpleEncoded = densing(SimpleSchema, simpleData);
benchmark(
  'Simple: Decoding',
  () => {
    undensing(SimpleSchema, simpleEncoded);
  },
  100000
);

benchmark(
  'Simple: Round-trip',
  () => {
    undensing(SimpleSchema, densing(SimpleSchema, simpleData));
  },
  100000
);

// Complex schema benchmarks
console.log('--- Complex Schema (nested objects, arrays, optionals) ---');
benchmark(
  'Complex: Encoding',
  () => {
    densing(ComplexSchema, complexData);
  },
  50000
);

const complexEncoded = densing(ComplexSchema, complexData);
benchmark(
  'Complex: Decoding',
  () => {
    undensing(ComplexSchema, complexEncoded);
  },
  50000
);

benchmark(
  'Complex: Round-trip',
  () => {
    undensing(ComplexSchema, densing(ComplexSchema, complexData));
  },
  50000
);

// Large array benchmarks
const LargeArraySchema = schema(array('values', 0, 100, int('value', 0, 1000)));
const largeArrayData = { values: Array.from({ length: 50 }, (_, i) => i * 10) };

console.log('--- Large Array (50 elements) ---');
benchmark(
  'Large Array: Encoding',
  () => {
    densing(LargeArraySchema, largeArrayData);
  },
  20000
);

const largeArrayEncoded = densing(LargeArraySchema, largeArrayData);
benchmark(
  'Large Array: Decoding',
  () => {
    undensing(LargeArraySchema, largeArrayEncoded);
  },
  20000
);

// Binary vs Base64 encoding
console.log('--- Encoding Base Comparison ---');
benchmark(
  'Binary base encoding',
  () => {
    densing(SimpleSchema, simpleData, 'binary');
  },
  100000
);

benchmark(
  'Base64 encoding (default)',
  () => {
    densing(SimpleSchema, simpleData);
  },
  100000
);

benchmark(
  'Hex encoding',
  () => {
    densing(SimpleSchema, simpleData, '0123456789ABCDEF');
  },
  100000
);

// Schema encoding: size against the alternatives, and speed
console.log('--- Schema encoding (densingSchema / undensingSchema) ---');

/** Median time of `runs` calls, in µs */
const median = (fn: () => void, runs = 1000): number => {
  for (let i = 0; i < 50; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(runs / 2)] * 1000;
};

const b64Length = (bytes: number) => Math.ceil((bytes * 8) / 6);
const percentSmaller = (ours: number, other: number) => `${Math.round((1 - ours / other) * 100)}%`;
console.table(
  Object.entries(schemaSamples).map(([name, { schema: s }]) => {
    const encoded = densingSchema(s);
    const json = JSON.stringify(s);
    const brotli = b64Length(
      zlib.brotliCompressSync(Buffer.from(json), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length
    );
    return {
      schema: name,
      chars: encoded.length,
      'JSON chars': json.length,
      'vs URL-encoded JSON': percentSmaller(encoded.length, encodeURIComponent(json).length),
      'vs base64(brotli)': percentSmaller(encoded.length, brotli),
      'encode µs': median(() => densingSchema(s)).toFixed(0),
      'decode µs': median(() => undensingSchema(encoded)).toFixed(0)
    };
  })
);

// scaling: ten renamed copies of the GLSL schema, so every name is new
const renamed = (field: DenseField, suffix: string): DenseField => {
  const copy = { ...field, name: `${field.name} ${suffix}` } as DenseField;
  if (copy.type === 'object') copy.fields = copy.fields.map((f) => renamed(f, suffix));
  if (copy.type === 'optional') copy.field = renamed(copy.field, suffix);
  if (copy.type === 'array') copy.items = renamed(copy.items, suffix);
  return copy;
};
const largeSchema = schema(
  ...Array.from({ length: 10 }, (_, i) => object(`copy ${i}`, ...GLSLRayMarchingSchema.fields.map((f) => renamed(f, `#${i}`))))
);
const glslEncoded = densingSchema(GLSLRayMarchingSchema);
const largeEncoded = densingSchema(largeSchema);
const glslTime = median(() => undensingSchema(densingSchema(GLSLRayMarchingSchema)), 300);
const largeTime = median(() => undensingSchema(densingSchema(largeSchema)), 30);
console.log(
  `GLSL: encode ${median(() => densingSchema(GLSLRayMarchingSchema)).toFixed(0)}µs, decode ${median(() => undensingSchema(glslEncoded)).toFixed(0)}µs`
);
console.log(
  `10x GLSL (${largeEncoded.length} chars): round trip ${(largeTime / 1000).toFixed(2)}ms = ${(largeTime / glslTime).toFixed(1)}x the GLSL round trip`
);
console.log('');

console.log('=== Benchmark Complete ===');
