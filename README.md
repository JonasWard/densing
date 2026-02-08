**Densing** is a TypeScript library for ultra-compact data serialization. It uses bit-level packing to encode structured data into the smallest possible representation, then converts it to character based encodings like urlSafeBase64, or QRBase45-safe strings.

Perfect for embedding complex data in URLs, QR codes, or any scenario where every character counts!

## 🎯 Why Densing?

```typescript
// Traditional JSON: 87 bytes
const json = '{"deviceId":42,"enabled":true,"temperature":23.5,"mode":"performance"}';

// Densing: base64 -> 4 characters (4 bytes) - **94% smaller!**
const densed = 'Cqnu';

// note with:
// deviceId: value form 0 to 1000 -> 1001 states -> 10 bits
// enabled: boolean value -> 2 states -> 1 bit
// temperature: value from -40.0 to 125.0 (one decimal precision) -> 1650 states ->  11 bits
// mode: 'eco' | 'normal' | 'performance' -> 3 states -> 2 bits
// --> 24 bits (3 bytes)
```

### Key Features

- 🔬 **Bit-level precision** - Only uses the exact bits needed for your data
- 📦 **Type-safe schemas** - Define your data structure with full TypeScript support
- 🔐 **URL-safe encoding** - Base64url by default, custom bases supported
- ✅ **Built-in validation method** - Ensure data integrity before encoding
- 📊 **Size analysis** - See exactly how many bits each field uses
- 🔄 **Lossless compression** - Perfect round-trip encoding/decoding
- 🚀 **Zero dependencies** - Lightweight and fast, only uses base javascript types

## 📦 Installation

```bash
npm install densing
# or
bun add densing
```

## 🚀 Quick Start

```typescript
import { schema, int, bool, fixed, enumeration, densing, undensing } from 'densing';

// 1. Define your schema
const DeviceSchema = schema(
  int('deviceId', 0, 1000), // 10 bits (0-1000)
  bool('enabled'), // 1 bit
  fixed('temperature', -40, 125, 0.1), // 11 bits (-40 to 125, precision 0.1)
  enumeration('mode', ['eco', 'normal', 'performance']) // 2 bits (3 options)
);
// total of 24 bits

// 2. Encode your data
const data = {
  deviceId: 42,
  enabled: true,
  temperature: 23.5,
  mode: 'performance'
};

const encoded = densing(DeviceSchema, data);
console.log(encoded); // "Cqnu" (24 bits, 4 base64 chars vs JSON 70 chars, -94%)

// 3. Decode it back
const decoded = undensing(DeviceSchema, encoded);
console.log(decoded); // { deviceId: 42, enabled: true, temperature: 23.5, mode: 'performance' }
```

## 📚 Core Concepts

### Schema Definition

Schemas define the structure and constraints of your data. Densing uses this to calculate the minimum bits needed.

```typescript
import { schema, int, fixed, bool, enumeration } from 'densing';

const MySchema = schema(
  // Integers: specify min and max range
  int('id', 0, 1000), // 10 bits for 1001 possible values

  // Fixed-point numbers: specify range and precision
  fixed('price', 0, 100, 0.01), // 14 bits for $0.00 to $100.00

  // Booleans: just 1 bit
  bool('active'),

  // Enums: bits based on number of options
  enumeration('status', ['pending', 'active', 'done']) // 2 bits for 3 options
);
```

### Field Types

| Type        | Description         | Bits Used                         | Example                                                     |
| ----------- | ------------------- | --------------------------------- | ----------------------------------------------------------- |
| `int`       | Integer range       | `log2(max - min + 1)`             | `int('age', 0, 120)` → 7 bits                               |
| `fixed`     | Fixed-point decimal | `log2((max-min) / precision + 1)` | `fixed('temp', 0, 50, 0.1)` → 9 bits                        |
| `bool`      | Boolean             | 1 bit                             | `bool('enabled')`                                           |
| `enum`      | Enumeration         | `log2(options.length)`            | `enumeration('color', ['R', 'G', 'B'])` → 2 bits            |
| `optional`  | Optional field      | 1 + field bits                    | `optional('metadata', int('version', 0, 10))`               |
| `array`     | Array of fields     | length bits + content             | `array('items', 0, 10, int('value', 0, 100))`               |
| `enumArray` | Packed enum array   | length + packed content           | `enumArray('tags', enum, 0, 5)`                             |
| `object`    | Nested object       | sum of field bits                 | `object('config', bool('debug'), int('port', 1024, 65535))` |
| `union`     | Discriminated union | discriminator + variant           | `union('action', discriminator, variants)`                  |

## 🎨 Examples

### Optional Fields

Optional fields add a single presence bit:

```typescript
import { schema, int, optional } from 'densing';

const UserSchema = schema(
  int('id', 0, 10000), // 10001 states -> 14 bits
  optional('age', int('ageValue', 0, 120)) // 2 + 121 states -> 1 bit presence + 7 bits if present
); // 14 + 1 (+ 7 bits) -> 15 or 22 bits

// With age
densing(UserSchema, { id: 100, age: 25 }); // "AZJk" (22 bits, 4 base64 chars vs JSON 19 chars, -79%)

// Without age
densing(UserSchema, { id: 100, age: null }); // "AZA" (15 bits, 3 base64 chars vs JSON 21 chars, -86%)
```

### Nested Objects

```typescript
import { schema, int, object, bool } from 'densing';

const ConfigSchema = schema(int('version', 1, 10), object('settings', bool('darkMode'), int('fontSize', 8, 24)));

const data = {
  version: 2,
  settings: {
    darkMode: true,
    fontSize: 14
  }
};

densing(ConfigSchema, data); // "GY" (10 bits, 2 base64 chars vs JSON 56 chars, -96%)
```

### Arrays

```typescript
import { schema, array, int } from 'densing';

const ListSchema = schema(
  array('scores', 0, 10, int('score', 0, 100)) // 0-10 scores, each 0-100 -> 4 bits + 0-10 x 7 bits
);

// In readme-examples.test.ts, you can add:
const data1 = { scores: [95] }; // 4 + 7 bits -> 11 bits -> 2 characters vs 13 (-85%) => "G-"
const data2 = { scores: [95, 87, 92, 88] }; // 4 + 4 * 7 bits -> 32 bits -> 6 characters vs 22 (-73%) => "S_XuWA"
const data3 = { scores: [95, 87, 92, 88, 10, 12, 13, 15, 16, 99] }; // 4 + 10 * 7 bits -> 74 bits -> 13 characters vs 40 (-68%) => "q_XuWBQwaPIYw"

densing(ListSchema, data1); // "G-" (11 bits, 2 base64 chars vs JSON 15 chars, -87%)
densing(ListSchema, data2); // "S_XuWA" (32 bits, 6 base64 chars vs JSON 24 chars, -75%)
densing(ListSchema, data3); // "q_XuWBQwaPIYw" (74 bits, 13 base64 chars vs JSON 42 chars, -69%)
```

### Unions (Polymorphic Types)

```typescript
import { schema, union, enumeration, int, bool } from 'densing';

const ActionSchema = schema(
  union('action', enumeration('type', ['start', 'stop', 'pause']), {
    start: [int('delay', 0, 60)],
    stop: [bool('force')],
    pause: [int('duration', 0, 3600)]
  })
);

// Start action
densing(ActionSchema, { action: { type: 'start', delay: 5 } }); // "BQ" (8 bits, 2 base64 chars vs JSON 37 chars, -95%)

// Stop action
densing(ActionSchema, { action: { type: 'stop', force: true } }); // "Y" (3 bits, 1 base64 char vs JSON 39 chars, -97%)

// Pause action
densing(ActionSchema, { action: { type: 'pause', duration: 1234 } }); // "k0g" (14 bits, 3 base64 chars vs JSON 43 chars, -93%)
```

### Enum Arrays (Packed)

Enum arrays are packed into minimal bits using base-N encoding:

```typescript
import { schema, enumArray, enumeration } from 'densing';

const ColorSchema = schema(enumArray('palette', enumeration('color', ['R', 'G', 'B']), 0, 10));

const data = { palette: ['R', 'G', 'B', 'R', 'R'] };
const encoded = densing(ColorSchema, data);
// "Ut" (12 bits, 2 base64 chars vs JSON 33 chars, -94%)
```

## 🔧 Advanced Features

### Validation

Validate data before encoding:

```typescript
import { validate } from 'densing';

const result = validate(MySchema, data);

if (!result.valid) {
  console.error('Validation errors:', result.errors);
  // [{ path: 'age', message: 'value 150 out of range [0, 120]' }]
}
```

### Size Analysis

See exactly how your data will be encoded:

```typescript
import { analyzeDenseSchemaSize, calculateDenseDataSize } from 'densing';

// Static analysis (without data)
const schemaSize = analyzeDenseSchemaSize(MySchema);
console.log(schemaSize.staticRange);
// { minBits: 18, maxBits: 45, minBase64Chars: 3, maxBase64Chars: 8 }

// Actual size for specific data
const dataSize = calculateDenseDataSize(MySchema, myData);
console.log(dataSize);
// {
//   totalBits: 32,
//   base64Length: 6,
//   fieldSizes: { deviceId: 10, enabled: 1, temperature: 11, mode: 2 },
//   efficiency: { utilizationPercent: 51.8 }
// }
```

### Default Values

Generate default data for your schema:

```typescript
import { getDefaultData } from 'densing';

const defaultData = getDefaultData(MySchema);
// { deviceId: 0, enabled: false, temperature: -40, mode: 'eco' }
```

### Type Generation

Generate TypeScript types from your schema:

```typescript
import { generateTypes } from 'densing';

const types = generateTypes(MySchema, 'MyData');
console.log(types);
// export interface MyData {
//   deviceId: number;
//   enabled: boolean;
//   temperature: number;
//   mode: 'eco' | 'normal' | 'performance';
// }
```

### Custom Bases

Use any character set for encoding:

```typescript
// Default: base64url (URL-safe)
densing(schema, data); // "VA" (example)

// Binary string
densing(schema, data, 'binary'); // "0101010"

// Custom base (hexadecimal)
densing(schema, data, '0123456789ABCDEF'); // "54"

// Decode with same base
undensing(schema, encoded, 'binary');
```

### Recursive Structures

Define recursive data structures with `createRecursiveUnion`:

```typescript
import { schema, createRecursiveUnion, int, enumeration } from 'densing';

const ExpressionSchema = schema(
  createRecursiveUnion(
    'expr',
    ['number', 'add', 'multiply'],
    (recurse) => ({
      number: [int('value', 0, 1000)],
      add: [recurse('left'), recurse('right')],
      multiply: [recurse('left'), recurse('right')]
    }),
    5 // max depth
  )
);

// Encode: (5 + 3) * 2
const data = {
  expr: {
    type: 'multiply',
    left: {
      type: 'add',
      left: { type: 'number', value: 5 },
      right: { type: 'number', value: 3 }
    },
    right: { type: 'number', value: 2 }
  }
};

densing(ExpressionSchema, data); // "kAUAMAI" (190 bits, 7 base64 chars vs JSON 157 chars, -96%)
```

## 📊 Use Cases

### URL Parameters

```typescript
// Embed complex state in URLs
const state = { page: 5, sortBy: 'date', filters: [1, 3] };
const url = `https://app.com/search?state=${densing(StateSchema, state)}`;
// https://app.com/search?state=CCEw (4 base64 chars, 20 bits vs JSON 42 chars, -90%)
```

### QR Codes

```typescript
// Fit more data in QR codes
const deviceConfig = { id: 123, settings: {...} };
const qrData = densing(ConfigSchema, deviceConfig);
// Compact encoding means lower error correction level or more data capacity
```

### IoT & Embedded Systems

```typescript
// Minimize bandwidth for sensor data
const sensorData = { temp: 23.5, humidity: 65.2, battery: 87 };
const payload = densing(SensorSchema, sensorData);
// "T3Rlc" (28 bits, 5 base64 chars vs JSON 42 chars, -88%)
```

### Local Storage

```typescript
// Reduce storage footprint
localStorage.setItem('userPrefs', densing(PrefsSchema, preferences));
// Store 10 preferences in compact form instead of verbose JSON
```

## 🧪 Testing

The library includes comprehensive tests:

```bash
bun test
# 348 tests pass
```

## 📖 API Reference

For detailed API documentation, see [API.md](./API.md).

### Core Functions

- `schema(...fields)` - Define a schema
- `densing(schema, data, base?)` - Encode data
- `undensing(schema, encoded, base?)` - Decode data
- `validate(schema, data)` - Validate data
- `getDefaultData(schema)` - Generate default values

### Field Builders

- `int(name, min, max, default?)` - Integer field
- `fixed(name, min, max, precision, default?)` - Fixed-point number
- `bool(name, default?)` - Boolean field
- `enumeration(name, options, default?)` - Enum field
- `optional(name, field, default?)` - Optional field
- `array(name, minLength, maxLength, itemField)` - Array field
- `enumArray(name, enumField, minLength, maxLength)` - Packed enum array
- `object(name, ...fields)` - Nested object
- `union(name, discriminator, variants)` - Discriminated union

### Utility Functions

- `analyzeDenseSchemaSize(schema)` - Static size analysis
- `calculateDenseDataSize(schema, data)` - Actual size calculation
- `getDenseFieldBitWidthRange(field)` - Min/max bits for field
- `calculateDenseFieldBitWidth(field, value)` - Actual bits used
- `getFieldByPath(schema, path)` - Get field by path
- `walkDenseSchema(schema, callback)` - Visit all fields
- `getAllDenseSchemaPaths(schema)` - Get all field paths
- `generateTypes(schema, typeName?)` - Generate TypeScript types

## 🎯 Performance

Densing is designed for efficiency (benchmarked on Bun runtime on m4 macbookAir):

**Simple Schema (4 fields: int, bool, fixed, enum):**
- Encoding: **~1,330,000 ops/sec** (0.75µs per operation)
- Decoding: **~1,516,000 ops/sec** (0.66µs per operation)
- Round-trip: **~753,000 ops/sec** (1.33µs per operation)

**Complex Schema (nested objects, arrays, optionals):**
- Encoding: **~484,000 ops/sec** (2.06µs per operation)
- Decoding: **~394,000 ops/sec** (2.54µs per operation)

**Large Arrays (50 integer elements):**
- Encoding: **~98,000 ops/sec** (10.23µs per operation)
- Decoding: **~91,000 ops/sec** (11.02µs per operation)

Run your own benchmarks:
```bash
bun run benchmark.ts
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## 🙏 Acknowledgments

Built with TypeScript and tested with Bun.

---

**Made with ❤️ for applications where every character matters**
