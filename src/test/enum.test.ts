import { expect, test } from 'bun:test';
import { schema, enumeration } from '../schema/builder';
import { densing, undensing } from '../densing';

// Test values: [value, maxValue, bitWidth, bitString]
export const values: [number, number, number, string][] = [
  [0, 1, 1, '0'], // 2 options = 1 bit
  [1, 1, 1, '1'], // 2 options = 1 bit
  [0, 3, 2, '00'], // 4 options = 2 bits
  [2, 3, 2, '10'], // 4 options = 2 bits
  [3, 3, 2, '11'], // 4 options = 2 bits
  [0, 7, 3, '000'], // 8 options = 3 bits
  [2, 7, 3, '010'], // 8 options = 3 bits
  [7, 7, 3, '111'], // 8 options = 3 bits
  [0, 15, 4, '0000'], // 16 options = 4 bits
  [5, 15, 4, '0101'], // 16 options = 4 bits
  [15, 15, 4, '1111'] // 16 options = 4 bits
];

// Map numeric indices to enum options for testing
const createEnumOptions = (maxValue: number): string[] => Array.from({ length: maxValue + 1 }, (_, i) => `Option${i}`);

values.forEach(([v, maxValue, bitWidth, bitString]) =>
  test(`enum ${v} (${maxValue + 1} options, ${bitWidth} bits) encodes to '${bitString}'`, () => {
    const options = createEnumOptions(maxValue);
    const EnumSchema = schema(enumeration('value', options));
    const data = { value: options[v] };

    const encoded = densing(EnumSchema, data, 'binary');
    expect(encoded).toBe(bitString);
    expect(encoded.length).toBe(bitWidth); // Verify bit width
  })
);

values.forEach(([v, maxValue, bitWidth, bitString]) =>
  test(`parsing '${bitString}' (${bitWidth} bits) as enum`, () => {
    const options = createEnumOptions(maxValue);
    const EnumSchema = schema(enumeration('value', options));
    const decoded = undensing(EnumSchema, bitString, 'binary');

    expect(decoded.value).toBe(options[v]);
  })
);

// Test enum encoding/decoding with different option counts
const testEnumCases = [
  { options: ['A', 'B'], value: 'A', description: '2 options - first' },
  { options: ['A', 'B'], value: 'B', description: '2 options - second' },
  { options: ['R', 'G', 'B'], value: 'R', description: '3 options - first' },
  { options: ['R', 'G', 'B'], value: 'G', description: '3 options - middle' },
  { options: ['R', 'G', 'B'], value: 'B', description: '3 options - last' },
  { options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], value: 'Mon', description: '7 options - first' },
  { options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], value: 'Wed', description: '7 options - middle' },
  { options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], value: 'Sun', description: '7 options - last' }
];

testEnumCases.forEach(({ options, value, description }) =>
  test(`enum ${description}`, () => {
    const EnumSchema = schema(enumeration('value', options as readonly string[]));
    const data = { value };

    const encoded = densing(EnumSchema, data);
    const decoded = undensing(EnumSchema, encoded);

    expect(decoded.value).toBe(value);
  })
);

// Test round-trip with various enum sizes
test('enum round-trip test with different sizes', () => {
  const sizes = [2, 3, 4, 5, 8, 16, 32, 64, 128, 256];

  sizes.forEach((size) => {
    const options = Array.from({ length: size }, (_, i) => `Option${i}`);
    const EnumSchema = schema(enumeration('choice', options));

    // Test first, middle, and last options
    [0, Math.floor(size / 2), size - 1].forEach((index) => {
      const data = { choice: options[index] };
      const encoded = densing(EnumSchema, data);
      const decoded = undensing(EnumSchema, encoded);

      expect(decoded.choice).toBe(options[index]);
    });
  });
});

// Test enum with color values (practical example)
test('enum with color values', () => {
  const ColorSchema = schema(enumeration('color', ['red', 'green', 'blue', 'yellow', 'purple']));

  const colors = ['red', 'green', 'blue', 'yellow', 'purple'];

  colors.forEach((color) => {
    const data = { color };
    const encoded = densing(ColorSchema, data);
    const decoded = undensing(ColorSchema, encoded);

    expect(decoded.color).toBe(color);
  });
});

// Test bitCountValue: verifying bit width for specific enum sizes
// These tests verify the calculated bit width matches the expected value
const bitCountValueTests: [number, number, string][] = [
  // [enumOptionCount, expectedBitWidth, description]
  [2, 1, '2 options require 1 bit'],
  [3, 2, '3 options require 2 bits'],
  [4, 2, '4 options require 2 bits'],
  [5, 3, '5 options require 3 bits'],
  [8, 3, '8 options require 3 bits'],
  [9, 4, '9 options require 4 bits'],
  [16, 4, '16 options require 4 bits'],
  [17, 5, '17 options require 5 bits'],
  [32, 5, '32 options require 5 bits'],
  [64, 6, '64 options require 6 bits'],
  [128, 7, '128 options require 7 bits'],
  [256, 8, '256 options require 8 bits']
];

bitCountValueTests.forEach(([optionCount, expectedBitWidth, description]) =>
  test(`bitCountValue: ${description}`, () => {
    const options = Array.from({ length: optionCount }, (_, i) => `Opt${i}`);
    const EnumSchema = schema(enumeration('value', options));

    // Encode first option
    const data = { value: options[0] };
    const encoded = densing(EnumSchema, data, 'binary');

    // Verify the bit width
    expect(encoded.length).toBe(expectedBitWidth);

    // Verify round-trip
    const decoded = undensing(EnumSchema, encoded, 'binary');
    expect(decoded.value).toBe(options[0]);
  })
);
