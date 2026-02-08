import { expect, test } from 'bun:test';
import { schema, int } from '../schema/builder';
import { densing, undensing } from '../densing';

// Test values: [value, min, max, bitString]
export const values: [number, number, number, string][] = [
  [0, 0, 1, '0'], // min
  [1, 0, 1, '1'], // max
  [-10, -10, 10, '00000'], // min
  [0, -10, 10, '01010'], // mid
  [10, -10, 10, '10100'], // max
  [0, 0, 15, '0000'], // min
  [3, 0, 15, '0011'], // middle
  [15, 0, 15, '1111'], // max
  [10, 10, 20, '0000'], // min
  [15, 10, 20, '0101'], // mid
  [20, 10, 20, '1010'], // max
  [-10, -10, 20, '00000'], // min
  [20, -10, 20, '11110'], // max
  [-200, -200, 20, '00000000'], // min
  [-100, -200, 20, '01100100'], // mid
  [20, -200, 20, '11011100'] // max
];

values.forEach(([v, min, max, bitString]) =>
  test(`int ${v}, min: ${min}, max: ${max} encodes to '${bitString}'`, () => {
    const IntSchema = schema(int('value', min, max));
    const data = { value: v };
    
    const encoded = densing(IntSchema, data, 'binary');
    expect(encoded).toBe(bitString);
  })
);

values.forEach(([v, min, max, bitString]) =>
  test(`parsing '${bitString}' as int`, () => {
    const IntSchema = schema(int('value', min, max));
    const decoded = undensing(IntSchema, bitString, 'binary');
    
    expect(decoded.value).toBe(v);
  })
);

// Test round-trip encoding/decoding with various ranges
test('int round-trip test with various ranges', () => {
  const ranges: [number, number][] = [
    [0, 0],
    [0, 1],
    [0, 10],
    [0, 100],
    [0, 255],
    [0, 1000],
    [-10, 10],
    [-100, 100],
    [-1000, 1000],
    [100, 200]
  ];
  
  ranges.forEach(([min, max]) => {
    const IntSchema = schema(int('value', min, max));
    
    // Test min, middle, and max values
    const testValues = [min, Math.floor((min + max) / 2), max];
    
    testValues.forEach((value) => {
      const data = { value };
      const encoded = densing(IntSchema, data);
      const decoded = undensing(IntSchema, encoded);
      
      expect(decoded.value).toBe(value);
    });
  });
});

// Test edge cases
test('int edge cases', () => {
  // Single value range
  const SingleSchema = schema(int('value', 5, 5));
  const singleData = { value: 5 };
  expect(undensing(SingleSchema, densing(SingleSchema, singleData)).value).toBe(5);
  
  // Large range
  const LargeSchema = schema(int('value', 0, 65535));
  const largeData = { value: 32768 };
  expect(undensing(LargeSchema, densing(LargeSchema, largeData)).value).toBe(32768);
  
  // Negative range
  const NegativeSchema = schema(int('value', -1000, -100));
  const negativeData = { value: -500 };
  expect(undensing(NegativeSchema, densing(NegativeSchema, negativeData)).value).toBe(-500);
});
