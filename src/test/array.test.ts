import { expect, test } from 'bun:test';
import { schema, int, array, bool } from '../schema/builder';
import { densing, undensing } from '../densing';

// Binary encoding tests for arrays
// Test values: [arrayData, minLength, maxLength, bitString, description]
const binaryArrayTests: [number[], number, number, string, string][] = [
  [[], 0, 3, '00', 'empty array (2 bits for length 0-3)'],
  [[0], 0, 3, '010000000', 'single element [0] (2 bits length + 8 bits value)'],
  [[5], 0, 3, '010000101', 'single element [5] (2 bits length + 8 bits value)'],
  [[10], 0, 3, '010001010', 'single element [10] (2 bits length + 8 bits value)'],
  [[0, 1], 0, 3, '1000000000000001', 'two elements [0,1]'],
  [[0, 1, 2], 0, 3, '11000000000000010000010', 'three elements [0,1,2]'],
  [[5], 1, 5, '0000000101', 'single element with minLength=1 (3 bits length + 8 bits value)'],
  [[5, 10], 1, 5, '00100001010001010', 'two elements with minLength=1']
];

binaryArrayTests.forEach(([arrayData, minLength, maxLength, bitString, description]) =>
  test(`binary array: ${description}`, () => {
    const ArraySchema = schema(array('values', minLength, maxLength, int('value', 0, 127)));
    const data = { values: arrayData };

    const encoded = densing(ArraySchema, data, 'binary');
    expect(encoded).toBe(bitString);

    // Verify round-trip
    const decoded = undensing(ArraySchema, encoded, 'binary');
    expect(decoded.values).toEqual(arrayData);
  })
);

// Binary encoding tests for fixed-length arrays
test('binary array: fixed length [3,3] with values [1,2,3]', () => {
  const FixedArraySchema = schema(array('values', 3, 3, int('value', 0, 15)));
  const data = { values: [1, 2, 3] };

  const encoded = densing(FixedArraySchema, data, 'binary');
  // Fixed length array needs 0 bits for length, 4 bits per element
  expect(encoded).toBe('000100100011'); // 1='0001', 2='0010', 3='0011'

  const decoded = undensing(FixedArraySchema, encoded, 'binary');
  expect(decoded.values).toEqual([1, 2, 3]);
});

// Binary encoding tests for array of booleans
test('binary array: array of booleans', () => {
  const BoolArraySchema = schema(array('flags', 0, 7, bool('value')));
  const data = { flags: [true, false, true, true] };

  const encoded = densing(BoolArraySchema, data, 'binary');
  // 3 bits for length (4 in range 0-7), then 4 bits for values
  expect(encoded).toBe('1001011'); // length=4='100', values='1011'

  const decoded = undensing(BoolArraySchema, encoded, 'binary');
  expect(decoded.flags).toEqual([true, false, true, true]);
});

// Test basic array encoding/decoding
test('array of integers - basic', () => {
  const ArraySchema = schema(array('numbers', 0, 5, int('value', 0, 100)));

  const testCases = [
    { numbers: [] },
    { numbers: [0] },
    { numbers: [50] },
    { numbers: [100] },
    { numbers: [0, 50, 100] },
    { numbers: [10, 20, 30, 40, 50] }
  ];

  testCases.forEach((data) => {
    const encoded = densing(ArraySchema, data);
    const decoded = undensing(ArraySchema, encoded);

    expect(decoded).toEqual(data);
  });
});

// Test fixed-length array
test('array with fixed length', () => {
  const FixedArraySchema = schema(array('coords', 3, 3, int('value', -100, 100)));

  const data = { coords: [10, 20, 30] };
  const encoded = densing(FixedArraySchema, data);
  const decoded = undensing(FixedArraySchema, encoded);

  expect(decoded).toEqual(data);
});

// Test array with minimum length
test('array with minimum length', () => {
  const MinArraySchema = schema(array('items', 1, 5, int('value', 0, 10)));

  const testCases = [{ items: [1] }, { items: [1, 2] }, { items: [3, 4, 5] }, { items: [6, 7, 8, 9, 10] }];

  testCases.forEach((data) => {
    const encoded = densing(MinArraySchema, data);
    const decoded = undensing(MinArraySchema, encoded);

    expect(decoded).toEqual(data);
  });
});

// Test nested arrays
test('array of arrays', () => {
  const NestedArraySchema = schema(array('matrix', 0, 3, array('row', 0, 3, int('value', 0, 9))));

  const testCases = [
    {
      matrix: [
        [1, 2],
        [3, 4]
      ]
    },
    { matrix: [[1], [2], [3]] },
    { matrix: [[1, 2, 3]] }
  ];

  testCases.forEach((data) => {
    const encoded = densing(NestedArraySchema, data);
    const decoded = undensing(NestedArraySchema, encoded);

    expect(decoded).toEqual(data);
  });
});

// Test empty array
test('empty array', () => {
  const EmptyArraySchema = schema(array('items', 0, 10, int('value', 0, 100)));

  const data = { items: [] };
  const encoded = densing(EmptyArraySchema, data);
  const decoded = undensing(EmptyArraySchema, encoded);

  expect(decoded).toEqual(data);
});

// Test array size encoding efficiency
test('array size variations', () => {
  const ArraySchema = schema(array('values', 0, 100, int('value', 0, 255)));

  const sizes = [0, 1, 5, 10, 50, 100];

  sizes.forEach((size) => {
    const data = { values: Array.from({ length: size }, (_, i) => i % 256) };
    const encoded = densing(ArraySchema, data);
    const decoded = undensing(ArraySchema, encoded);

    expect(decoded.values).toEqual(data.values);
  });
});
