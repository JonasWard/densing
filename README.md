# densing

Library for bit level (de)compacting of objects based on a schema. You describe the shape of your
data once, densing works out how many bits every field needs and writes the result as a rather short
string: base64url by default, a QR code friendly base45, or any alphabet you give it. Useful for state
in urls, QR codes and anywhere else where every character counts.

It is an iteration on [url-safe-bitpacking](https://github.com/JonasWard/url-safe-bitpacking), aiming
for a nicer developer experience, more performance and more scalable data types.

Try it in the [Densing Builder](https://jonasward.ch/densing-ui/). No backend at all, the schema and
the data are both stored in the link!

```bash
npm install densing
```

## A schema

A schema is an ordered list of fields, and every field has a range. The range is what decides the
bits: an int between 0 and 1000 has 1001 possible values and therefore needs 10 bits. Nothing else is
written, no names, no separators, no lengths that the schema already knows.

The same schema can be written with the builder functions:

```typescript
import { schema, int, bool, fixed, enumeration } from 'densing';

const DeviceSchema = schema(
  int('deviceId', 0, 1000), // 10 bits
  bool('enabled'), // 1 bit
  fixed('temperature', -40, 125, 0.1), // 11 bits
  enumeration('mode', ['eco', 'normal', 'performance']) // 2 bits
);
```

or as plain JSON:

```json
{
  "fields": [
    { "type": "int", "name": "deviceId", "min": 0, "max": 1000 },
    { "type": "bool", "name": "enabled" },
    { "type": "fixed", "name": "temperature", "min": -40, "max": 125, "precision": 0.1 },
    { "type": "enum", "name": "mode", "options": ["eco", "normal", "performance"] }
  ]
}
```

`schemaFromJson(json)` turns the second into exactly the first. It runs the same checks as the builder
functions and fills in the defaults that were left out.

Treat a schema as immutable once it has been passed to densing: densing caches what it works out per
schema object (union variants, numeric definitions, bit widths). To change a schema, create a new one.

[Open this schema in the Densing Builder](https://jonasward.ch/densing-ui/#n=Device+Config&s=AFI5RY-q-ibRITU1OV4ivSAgQF1QmMk0inx3nnQiRMiFzmJq5bUYXje56-0JLUDcNKew&d=Cqnu).
It shows what every field costs and every bit the data encodes to, colored by the field it belongs to.

## Encode and decode

```typescript
import { densing, undensing } from 'densing';

const data = { deviceId: 42, enabled: true, temperature: 23.5, mode: 'performance' };

const encoded = densing(DeviceSchema, data); // "Cqnu" (24 bits)
undensing(DeviceSchema, encoded); // { deviceId: 42, enabled: true, temperature: 23.5, mode: 'performance' }
```

The same data as JSON is 70 characters. The biggest trade-off is legibility though: without the schema
`Cqnu` means nothing, and a string can only be read back with the schema it was written with.

## Field types

| Field | Value in the data | Bits | Example |
| --- | --- | --- | --- |
| `int(name, min, max, default?)`<br>`int` | a whole number from `min` to `max` | `ceil(log2(max - min + 1))` | `int('age', 0, 120)`: 7 bits |
| `fixed(name, min, max, precision, default?)`<br>`fixed` | a number from `min` to `max`, rounded to a multiple of `precision` | `ceil(log2((max - min) / precision + 1))` | `fixed('temperature', -40, 125, 0.1)`: 11 bits |
| `bool(name, default?)`<br>`bool` | `true` or `false` | 1 | |
| `enumeration(name, options, default?)`<br>`enum` | one of the option strings | `ceil(log2(options))` | 3 options: 2 bits |
| `optional(name, field, default?)`<br>`optional` | the field's value, or `null` | 1 for present or absent, plus the field when present | an optional `int(0, 1000)`: 1 or 11 bits |
| `array(name, minLength, maxLength, items)`<br>`array` | an array of `minLength` to `maxLength` items | the length (`ceil(log2(maxLength - minLength + 1))`), plus every item | 0 to 10 items of `int(0, 100)`: 4 bits + 7 per item |
| `enumArray(name, enumField, minLength, maxLength)`<br>`enum_array` | an array of option strings | the length, plus all values packed as one base-n number | 7 values out of 7 options: 3 + 20 bits (21 when stored one by one) |
| `object(name, ...fields)`<br>`object` | an object with a key per field | the sum of its fields | |
| `union(name, discriminator, variants)`<br>`union` | an object with the discriminator key set to the name of one of its variants, plus the fields of that variant | the variant's index (`ceil(log2(variants))`), plus the fields of the chosen variant | 3 variants: 2 bits + the variant's fields |
| `reference(name, template)`<br>`reference` | the value of the [template](https://github.com/JonasWard/densing/blob/main/GUIDE.md#templates) | whatever the template takes | |
| `referenceNumeric(name, definition)`<br>`reference_numeric` | a number in the range of the active preset of the [definition](https://github.com/JonasWard/densing/blob/main/GUIDE.md#shared-numeric-definitions) | the bits of the active preset, which the data picks in `$presets` | |

The [guide](https://github.com/JonasWard/densing/blob/main/GUIDE.md) has an example for each of them,
including recursive structures like an expression tree.

## Validation

```typescript
validate(DeviceSchema, { ...data, deviceId: 2000 });
// { valid: false, errors: [{ path: 'deviceId', message: 'value 2000 out of range [0, 1000]' }] }
```

`validate` returns every problem it finds. `densing` applies the same rules, though it throws a
`DenseEncodeError` on the first one. `undensing` throws a `DenseDecodeError` for strings the encoder
can not have produced, such as an edited or truncated url.

## Size

```typescript
analyzeDenseSchemaSize(DeviceSchema).staticRange;
// { minBits: 24, maxBits: 24, minBytes: 3, maxBytes: 3, minBase64Chars: 4, maxBase64Chars: 4 }

calculateDenseDataSize(DeviceSchema, data).fieldSizes;
// { deviceId: 10, enabled: 1, temperature: 11, mode: 2 }
```

## Defaults and types

```typescript
getDefaultData(DeviceSchema);
// { deviceId: 0, enabled: false, temperature: -40, mode: 'eco' }

generateTypes(DeviceSchema, 'Device');
// export interface Device {
//   deviceId: number;
//   enabled: boolean;
//   temperature: number;
//   mode: 'eco' | 'normal' | 'performance';
// }
```

## The schema as a string

Since the schema is needed to read anything back, it can also be packed itself. `densingSchema` writes
the Device schema in 68 characters, where its JSON takes 320, so a url can carry the schema next to its
data. That is also how the Densing Builder links work.

```typescript
const text = densingSchema(DeviceSchema);
undensingSchema(text); // equal to DeviceSchema
```

## Command line

[`densing-cli`](https://github.com/JonasWard/densing/blob/main/cli/README.md) encodes, decodes,
validates and analyses data from the terminal, using a schema saved as JSON:

```bash
npm install -g densing-cli

densing encode -s device.json data.json   # Cqnu
densing decode -s device.json Cqnu        # {"deviceId": 42, ...}
densing size -s device.json               # static bit sizes of the schema
densing schema -s device.json --dense     # the schema itself as a compact string
```

## More

- [GUIDE.md](https://github.com/JonasWard/densing/blob/main/GUIDE.md): an example per field type,
  templates, recursion, shared numeric definitions, alphabets and performance
- [API.md](https://github.com/JonasWard/densing/blob/main/API.md): size calculation and schema
  introspection
- [FORMAT.md](https://github.com/JonasWard/densing/blob/main/FORMAT.md): the wire format, bit by bit
- [CHANGELOG.md](https://github.com/JonasWard/densing/blob/main/CHANGELOG.md)
- [Densing Builder](https://jonasward.ch/densing-ui/) and its
  [source](https://github.com/JonasWard/densing-ui)

## Development

```bash
bun test           # unit, format and cli tests
bun run test:json  # every test schema survives JSON.stringify and schemaFromJson
```

Issues and pull requests are welcome.

## License

MIT
