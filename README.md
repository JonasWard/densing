# densing

Densing packs structured data into as few bits as a schema allows and writes the result as a short
string: base64url by default, a QR-code friendly base45, or any alphabet you give it. Useful for
state in URLs, QR codes and anywhere else where every character counts.

```bash
npm install densing
```

## Quick start

```typescript
import { schema, int, bool, fixed, enumeration, densing, undensing } from 'densing';

const DeviceSchema = schema(
  int('deviceId', 0, 1000), // 10 bits
  bool('enabled'), // 1 bit
  fixed('temperature', -40, 125, 0.1), // 11 bits
  enumeration('mode', ['eco', 'normal', 'performance']) // 2 bits
);

const data = { deviceId: 42, enabled: true, temperature: 23.5, mode: 'performance' };

const encoded = densing(DeviceSchema, data); // "Cqnu" (24 bits)
undensing(DeviceSchema, encoded); // { deviceId: 42, enabled: true, temperature: 23.5, mode: 'performance' }
```

The same data as JSON is 70 characters.

## Field types

| Builder | Bits |
| --- | --- |
| `int('age', 0, 120)` | `log2(max - min + 1)`, here 7 |
| `fixed('temp', 0, 50, 0.1)` | `log2((max - min) / precision + 1)`, here 9 |
| `bool('enabled')` | 1 |
| `enumeration('color', ['R', 'G', 'B'])` | `log2(options)`, here 2 |
| `optional('note', field)` | 1, plus the field when present |
| `array('items', 0, 10, field)` | length, plus each item |
| `enumArray('tags', enumField, 0, 5)` | length, plus the values packed as one base-n number |
| `object('config', ...fields)` | the sum of its fields |
| `union('action', discriminator, variants)` | the discriminator, plus the chosen variant |
| `pointer('child', 'node')` | whatever the target field takes |
| `referenceNumeric('width', length)` | the active preset of the definition |

## Examples

### Optional fields

```typescript
const UserSchema = schema(int('id', 0, 10000), optional('age', int('ageValue', 0, 120)));

densing(UserSchema, { id: 100, age: 25 }); // "AZJk" (22 bits)
densing(UserSchema, { id: 100, age: null }); // "AZA" (15 bits)
```

### Nested objects

```typescript
const ConfigSchema = schema(int('version', 1, 10), object('settings', bool('darkMode'), int('fontSize', 8, 24)));

densing(ConfigSchema, { version: 2, settings: { darkMode: true, fontSize: 14 } }); // "GY" (10 bits)
```

### Arrays

```typescript
const ListSchema = schema(array('scores', 0, 10, int('score', 0, 100)));

densing(ListSchema, { scores: [95] }); // "G-" (11 bits)
densing(ListSchema, { scores: [95, 87, 92, 88] }); // "S_XuWA" (32 bits)
```

### Unions

```typescript
const ActionSchema = schema(
  union('action', enumeration('type', ['start', 'stop', 'pause']), {
    start: [int('delay', 0, 60)],
    stop: [bool('force')],
    pause: [int('duration', 0, 3600)]
  })
);

densing(ActionSchema, { action: { type: 'start', delay: 5 } }); // "BQ" (8 bits)
densing(ActionSchema, { action: { type: 'stop', force: true } }); // "Y" (3 bits)
densing(ActionSchema, { action: { type: 'pause', duration: 1234 } }); // "k0g" (14 bits)
```

### Enum arrays

```typescript
const ColorSchema = schema(enumArray('palette', enumeration('color', ['R', 'G', 'B']), 0, 10));

densing(ColorSchema, { palette: ['R', 'G', 'B', 'R', 'R'] }); // "Ut" (12 bits)
```

### Recursive structures

A `pointer` refers to another field by name:

```typescript
const ExpressionSchema = schema(
  union('expr', enumeration('type', ['number', 'add', 'multiply']), {
    number: [int('value', 0, 1000)],
    add: [pointer('left', 'expr'), pointer('right', 'expr')],
    multiply: [pointer('left', 'expr'), pointer('right', 'expr')]
  })
);

// (5 + 3) * 2
const data = {
  expr: {
    type: 'multiply',
    left: { type: 'add', left: { type: 'number', value: 5 }, right: { type: 'number', value: 3 } },
    right: { type: 'number', value: 2 }
  }
};

densing(ExpressionSchema, data); // "kAUAMAI" (40 bits)
```

Pointer targets must be unique, and every recursion needs a way out (a union variant, an optional or
an array that may be empty). `schema()` checks both.

### Shared numeric definitions

A `definition` declares a numeric range once, with one or more presets. Each payload stores which
preset is active, and every `referenceNumeric` field using the definition is encoded with it:

```typescript
const length = definition('length', {
  mm: { min: 0, max: 1000 },
  m: { min: 0, max: 100, precision: 0.01 }
});

const Box = schemaWithDefinitions(
  [length],
  referenceNumeric('width', length),
  referenceNumeric('height', length),
  referenceNumeric('depth', length)
);

densing(Box, { width: 120, height: 40, depth: 800 }); // "DwFGQA" (31 bits)
densing(Box, { $presets: { length: 'm' }, width: 12.5, height: 0.4, depth: 80 }); // "icQBQ-gA" (43 bits)
```

Without `$presets` the default preset is used (the first, or the third argument of `definition`).
Picking a preset costs `log2(presets)` bits, so a definition with a single preset is free.

## Validation

```typescript
validate(DeviceSchema, { ...data, deviceId: 2000 });
// { valid: false, errors: [{ path: 'deviceId', message: 'value 2000 out of range [0, 1000]' }] }
```

`densing` applies the same rules and throws a `DenseEncodeError` for the first invalid value;
`validate` returns all of them. `undensing` throws a `DenseDecodeError` for strings the encoder
cannot produce, such as edited or truncated URLs.

## Size analysis

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

## Schemas as JSON

A schema is plain data. `JSON.stringify` it to store or send it, and load it with `schemaFromJson`,
which runs the same checks as the builders and fills in missing defaults:

```typescript
const loaded = schemaFromJson(JSON.stringify(DeviceSchema));

schemaFromJson({ fields: [{ type: 'int', name: 'age', min: 0, max: 120 }] });
// { fields: [{ type: 'int', name: 'age', min: 0, max: 120, defaultValue: 0 }] }

schemaFromJson({ fields: [{ type: 'int', name: 'age', min: 120, max: 0 }] });
// throws: Invalid schema at fields[0]: int "age": max < min
```

## Alphabets

```typescript
densing(DeviceSchema, data); // 'Cqnu' (base64url)
densing(DeviceSchema, data, 'baseQRCode45UrlSafe'); // '1CZYG'
densing(DeviceSchema, data, 'binary'); // '000010101010100111101110'
densing(DeviceSchema, data, customBase('0123456789abcdef')); // '0aa9ee'
```

Decode with the same alphabet. `customBase` rejects alphabets with fewer than two characters,
duplicates, or characters outside the Basic Multilingual Plane.

## Command line

[`densing-cli`](./cli/README.md) encodes, decodes, validates and analyses data from the terminal,
using a schema saved as JSON:

```bash
npm install -g densing-cli

densing encode -s device.json data.json   # Cqnu
densing decode -s device.json Cqnu        # {"deviceId": 42, ...}
densing size -s device.json               # static bit sizes of the schema
```

## API

Full reference in [API.md](./API.md); the wire format is specified in [FORMAT.md](./FORMAT.md).

Schemas and data
- `schema(...fields)`, `schemaWithDefinitions(definitions, ...fields)`
- `densing(schema, data, base?)`, `undensing(schema, encoded, base?)`
- `validate(schema, data)`, `validateSchema(schema)` (run by `schema()`)
- `getDefaultData(schema)`, `generateTypes(schema, typeName?)`
- `schemaFromJson(json)`, `customBase(alphabet)`

Fields
- `int(name, min, max, default?)`, `fixed(name, min, max, precision, default?)`
- `bool(name, default?)`, `enumeration(name, options, default?)`
- `optional(name, field, default?)`, `array(name, minLength, maxLength, items)`
- `enumArray(name, enumField, minLength, maxLength)`, `object(name, ...fields)`
- `union(name, discriminator, variants)`, `pointer(name, targetName)`
- `definition(name, presets, defaultPreset?)`, `referenceNumeric(name, definition)`

Introspection
- `analyzeDenseSchemaSize(schema)`, `calculateDenseDataSize(schema, data)`
- `getDenseFieldBitWidthRange(field, schema?)`, `calculateDenseFieldBitWidth(field, value, schema?)`
- `getFieldByPath(schema, path)`, `walkDenseSchema(schema, callback)`, `getAllDenseSchemaPaths(schema)`

## Performance

Bun on an M4 MacBook Air (`bun run benchmark`):

| Schema | Encode | Decode |
| --- | --- | --- |
| 4 fields (int, bool, fixed, enum) | ~1,330,000 ops/s | ~1,516,000 ops/s |
| nested objects, arrays, optionals | ~484,000 ops/s | ~394,000 ops/s |
| array of 50 ints | ~98,000 ops/s | ~91,000 ops/s |

## Development

```bash
bun test           # unit, format and cli tests
bun run test:json  # every test schema survives JSON.stringify -> schemaFromJson
```

Issues and pull requests are welcome.

## License

MIT
