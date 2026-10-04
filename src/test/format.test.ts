import { describe, expect, test } from 'bun:test';
import { densing, undensing } from '../densing';
import { array, bool, enumArray, enumeration, fixed, int, object, optional, pointer, schema, union } from '../schema/builder';
import { DenseSchema } from '../schema-type';

// Pins the wire format described in FORMAT.md. If one of these tests fails, the bytes on the wire
// changed: either the change is a bug, or it is a format change and needs a CHANGELOG entry.

const HEX = '0123456789ABCDEF';
const BASES = ['base64url', 'baseQRCode45UrlSafe', 'binary', HEX] as const;

const expression = union('expr', enumeration('type', ['number', 'add', 'multiply']), {
  number: [int('value', 0, 1000)],
  add: [pointer('left', 'expr'), pointer('right', 'expr')],
  multiply: [pointer('left', 'expr'), pointer('right', 'expr')]
});

const GOLDEN: { name: string; schema: DenseSchema; data: any; encoded: readonly string[] }[] = [
  {
    name: 'ints',
    schema: schema(int('a', 0, 15), int('b', 0, 3), int('c', -100, 100)),
    data: { a: 1, b: 2, c: -37 },
    encoded: ['GPw', '286', '00011000111111', '18FC']
  },
  {
    name: 'fixed + bool',
    schema: schema(fixed('t', -40, 125, 0.1), bool('on'), fixed('h', 0, 1, 0.01)),
    data: { t: 23.5, on: true, h: 0.42 },
    encoded: ['T3VA', '5ZES', '0100111101110101010', '4F754']
  },
  {
    name: 'enum + enum_array',
    schema: schema(enumeration('c', ['R', 'G', 'B']), enumArray('e', enumeration('d', ['x', 'y', 'z']), 0, 5)),
    data: { c: 'B', e: ['y', 'x', 'z', 'z'] },
    encoded: ['oj', 'EEC', '101000100011', 'A23']
  },
  {
    name: 'array + optional',
    schema: schema(array('a', 1, 6, int('v', 0, 7)), optional('o', int('w', 0, 255)), optional('n', bool('q'))),
    data: { a: [7, 0, 3], o: 200, n: null },
    encoded: ['XD5A', 'BMPVY', '0101110000111110010000', '5C3E40']
  },
  {
    name: 'object + union',
    schema: schema(
      object(
        'net',
        int('port', 0, 65535),
        union('mode', enumeration('kind', ['dhcp', 'static']), {
          dhcp: [],
          static: [int('ip', 0, 255), int('mask', 0, 32)]
        })
      )
    ),
    data: { net: { port: 8080, mode: { kind: 'static', ip: 192, mask: 24 } } },
    encoded: ['H5DgMA', '3C.PGS', '0001111110010000111000000011000', '1F90E030']
  },
  {
    name: 'pointer',
    schema: schema(expression),
    data: {
      expr: {
        type: 'multiply',
        left: { type: 'add', left: { type: 'number', value: 5 }, right: { type: 'number', value: 3 } },
        right: { type: 'number', value: 2 }
      }
    },
    encoded: ['kAUAMAI', 'AUX9H0P6', '1001000000000101000000000011000000000010', '9005003002']
  }
];

describe('golden vectors', () => {
  for (const { name, schema: s, data, encoded } of GOLDEN) {
    BASES.forEach((base, i) => {
      test(`${name} in ${base === HEX ? 'hex' : base}`, () => {
        expect(densing(s, data, base)).toBe(encoded[i]);
        expect(undensing(s, encoded[i], base)).toEqual(data);
      });
    });
  }
});

describe('bit order', () => {
  test('earlier fields occupy more significant bits, each value MSB first', () => {
    const S = schema(int('a', 0, 15), int('b', 0, 3));
    expect(densing(S, { a: 1, b: 2 }, 'binary')).toBe('0001' + '10');
  });

  test('enum_array: first element is the most significant digit', () => {
    const S = schema(enumArray('e', enumeration('d', ['0', '1', '2']), 3, 3));
    // ['1', '0', '0'] = 1 * 3^2 = 9, in bitLength(3^3 - 1) = 5 bits
    expect(densing(S, { e: ['1', '0', '0'] }, 'binary')).toBe('01001');
    expect(densing(S, { e: ['0', '0', '1'] }, 'binary')).toBe('00001');
  });

  test('padding goes at the end of the stream', () => {
    const S = schema(int('a', 0, 15), int('b', 0, 3));
    expect(densing(S, { a: 1, b: 2 }, HEX)).toBe('18'); // 0001 10|00
    expect(densing(S, { a: 1, b: 2 })).toBe('G'); // 000110
  });

  test('an empty stream encodes to an empty string', () => {
    expect(densing(schema(int('a', 5, 5)), { a: 5 })).toBe('');
  });
});

describe('power-of-two alphabets cut the stream into k-bit groups', () => {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const chunk = (bits: string, k: number, alphabet: string) => {
    const padded = bits.padEnd(Math.ceil(bits.length / k) * k, '0');
    return Array.from({ length: padded.length / k }, (_, i) => alphabet[parseInt(padded.slice(i * k, i * k + k), 2)]).join('');
  };

  for (const { name, schema: s, data } of GOLDEN) {
    test(name, () => {
      const bits = densing(s, data, 'binary');
      expect(densing(s, data, HEX)).toBe(chunk(bits, 4, HEX));
      expect(densing(s, data, 'base64url')).toBe(chunk(bits, 6, B64));
      expect(densing(s, data, '01234567')).toBe(chunk(bits, 3, '01234567'));
    });
  }
});
