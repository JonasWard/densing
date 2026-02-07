import { schema, int, bool, optional, object, array, union, enumeration } from '../schema/builder';
import { encodeDebugWrapper, decodeDebugWrapper } from './testHelper';

console.log('=== Test Helper with Nested Logging ===\n');

const TestSchema = schema(
  int('id', 0, 100),
  object(
    'settings',
    bool('enabled', true),
    optional('timeout', int('value', 0, 1000)),
    array('items', 0, 3, int('item', 0, 10))
  ),
  union('data', enumeration('type', ['text', 'number']), {
    text: [int('length', 0, 100)],
    number: [int('value', 0, 1000)]
  })
);

const testData = {
  id: 42,
  settings: {
    enabled: true,
    timeout: 500,
    items: [1, 2, 3]
  },
  data: {
    type: 'text',
    length: 25
  }
};

console.log('Original data:');
console.log(JSON.stringify(testData, null, 2));

console.log('\n--- Encoding with logging on "timeout" and "items" ---');
const encoded = encodeDebugWrapper(TestSchema, testData, 'timeout', 'items');

console.log('\nEncoded:', encoded);

console.log('\n--- Decoding with logging on "timeout" and "items" ---');
const decoded = decodeDebugWrapper(TestSchema, encoded!, 'timeout', 'items');

console.log('\nDecoded data:');
console.log(JSON.stringify(decoded, null, 2));

console.log('\nMatch:', JSON.stringify(testData) === JSON.stringify(decoded) ? '✓' : '✗');
