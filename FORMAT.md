# Densing wire format

This document describes how `densing()` turns data into a string and how `undensing()` reads it back.
It describes the format as implemented; `src/test/format.test.ts` pins it with golden vectors, so any
change to the bytes on the wire shows up as a failing test.

A payload is produced in two steps:

1. every field is written into a single **bit stream** (section 1-2)
2. the bit stream is written as **text** in an alphabet (section 3)

There is no header, no version and no length prefix: the schema is required to read a payload.

## 1. Bit stream

- The bit stream is a sequence of `N` bits, written and read **most-significant bit first**.
- Fields are written in schema order (depth-first, in declaration order).
- Each value is an unsigned integer of a fixed width `w`, written MSB first. A field of width `0`
  writes nothing.

Densing has no byte layer, so "endianness" only ever means this: earlier data occupies more
significant bits. There is no little-endian ordering anywhere in the format.

### Widths

`bits(r)` is the number of bits needed for `r` distinct values: `0` for `r <= 1`, otherwise the bit
length of `r - 1` (i.e. `ceil(log2(r))`).

## 2. Field encodings

| Field | Encoding |
|---|---|
| `bool` | 1 bit, `1` = `true` |
| `int(min, max)` | `value - min` in `bits(max - min + 1)` bits |
| `fixed(min, max, precision)` | with `scale = round(1 / precision)`: `round((value - min) * scale)` in `bits(round((max - min) * scale) + 1)` bits |
| `enum(options)` | index of the value in `options`, in `bits(options.length)` bits |
| `array(minLength, maxLength, items)` | length prefix `length - minLength` in `bits(maxLength - minLength + 1)` bits, then each item in order |
| `enum_array(enum, minLength, maxLength)` | length prefix as for `array`, then the content (below) |
| `optional(field)` | 1 presence bit (`1` = present), then the inner field if present |
| `object(fields)` | each field in declaration order, nothing else |
| `union(discriminator, variants)` | the discriminator as an `enum`, then the fields of the selected variant in declaration order |
| `pointer(targetName)` | exactly the encoding of the field it resolves to |

### `enum_array` content

With `n` options and indices `i_0 … i_(L-1)`, the content is the single integer

```
i_0 * n^(L-1) + i_1 * n^(L-2) + … + i_(L-1)
```

(the **first element is the most significant digit**), written in the bit length of `n^L - 1`
bits (`ceil(L * log2(n))`). An empty array has no content bits.

### Decoding notes

- An absent `optional` decodes to the field's `defaultValue` when one is set, otherwise `null`.
- A `pointer` resolves to the first field named `targetName` in a depth-first walk of the schema.

## 3. Text

Given an alphabet of `b` characters (`alphabet[d]` is digit `d`) and a bit stream `S` of `N` bits:

1. `c` = the smallest number of characters with `b^c >= 2^N` (`c = 0` when `N = 0`)
2. `P` = the number of whole bits `c` characters can hold: `floor(log2(b^c))`, so `P >= N`
3. the stream is **left-aligned** in those bits: `V = S << (P - N)` (padding goes at the end)
4. `V` is written in base `b` as exactly `c` digits, **most significant digit first**, with leading
   zero digits (`alphabet[0]`) as needed

Decoding reverses this: `P = floor(log2(b^length))`, `V` is read from the digits, and fields are read
from the top of `V` downwards.

### Two families of alphabets

- **Power-of-two alphabets** (`binary`, hex, `base64url`, …, `b = 2^k`): `P = c * k` and every
  character holds exactly `k` consecutive bits of the stream. The text is the bit stream cut into
  `k`-bit groups, with the last group zero-padded on the right.
- **Other alphabets** (`baseQRCode45UrlSafe`, custom alphabets): the whole padded stream is converted
  to base `b` as one number. A character does not correspond to a fixed group of bits; changing one
  bit can change every character.

### Named alphabets

| Name | Size | Characters |
|---|---|---|
| `base64url` (default) | 64 | `A–Z a–z 0–9 - _` |
| `baseQRCode45UrlSafe` | 38 | `0–9 A–Z - .` (the URL-safe subset of QR alphanumeric mode) |
| `binary` | 2 | `0 1` |

Any other string passed as the base is used as a custom alphabet.

## Example

`schema(int('a', 0, 15), int('b', 0, 3))` with `{ a: 1, b: 2 }`:

```
a = 1 in 4 bits → 0001
b = 2 in 2 bits →     10
stream (N = 6)  → 000110

binary  (k = 1): 000110
hex     (k = 4): 0001 1000 → "18"   (two padding bits)
base64  (k = 6): 000110    → "G"
```
