// benchmark.ts - Performance benchmarks for densing library
import { schema, int, bool, fixed, enumeration, object, array, optional, densing, undensing } from './src/index';

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

console.log('=== Benchmark Complete ===');
