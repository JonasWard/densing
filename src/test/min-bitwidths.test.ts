// Test minimum bit width required for different uInt values

import { expect, test } from 'bun:test';
import { enumeration, schema } from '../schema';
import { densing } from '../densing';

// Note: [0, 0] is skipped because enums require at least 2 options
const minBitWidthForUInt = [
  [1, 1],
  [2, 2],
  [3, 2],
  [4, 3],
  [5, 3],
  [6, 3],
  [7, 3],
  [8, 4],
  [9, 4],
  [10, 4],
  [11, 4],
  [12, 4],
  [13, 4],
  [14, 4],
  [15, 4],
  [16, 5],
  [17, 5],
  [18, 5],
  [19, 5],
  [20, 5],
  [21, 5],
  [22, 5],
  [23, 5],
  [24, 5],
  [25, 5],
  [26, 5],
  [27, 5],
  [28, 5],
  [29, 5],
  [30, 5],
  [31, 5],
  [32, 6],
  [33, 6],
  [34, 6],
  [35, 6],
  [36, 6],
  [37, 6],
  [38, 6],
  [39, 6],
  [40, 6],
  [41, 6],
  [42, 6],
  [43, 6],
  [44, 6],
  [45, 6],
  [46, 6]
];

minBitWidthForUInt.forEach(([uInt, bitWidth]) =>
  test(`minBitWidthForUInt: ${uInt} requires ${bitWidth} bits`, () => {
    const options = Array.from({ length: uInt + 1 }, (_, i) => `Opt${i}`);
    const EnumSchema = schema(enumeration('value', options));
    const data = { value: options[uInt] };
    const encoded = densing(EnumSchema, data, 'binary');
    expect(encoded.length).toBe(bitWidth);
  })
);
