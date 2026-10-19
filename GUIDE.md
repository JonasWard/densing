# densing guide

The [README](./README.md) covers the idea and the Device schema. This page goes through the other field
types one by one, and then through the parts you only need once schemas get bigger: templates,
recursion, shared numbers and alphabets.

Every bit count below is checked by the tests in `src/test/readme-examples.test.ts`.

## Field types

### Optional

One bit says whether the value is there. Only when it is, the value itself follows.

```typescript
const UserSchema = schema(int('id', 0, 10000), optional('age', int('ageValue', 0, 120)));

densing(UserSchema, { id: 100, age: 25 }); // "AZJk" (22 bits)
densing(UserSchema, { id: 100, age: null }); // "AZA" (15 bits)
```

### Objects

An object costs nothing by itself, it only groups its fields.

```typescript
const ConfigSchema = schema(int('version', 1, 10), object('settings', bool('darkMode'), int('fontSize', 8, 24)));

densing(ConfigSchema, { version: 2, settings: { darkMode: true, fontSize: 14 } }); // "GY" (10 bits)
```

### Arrays

The length is written first, with as many bits as the range between `minLength` and `maxLength`
needs. Here that is 0 to 10, so 4 bits, followed by 7 bits per score.

```typescript
const ListSchema = schema(array('scores', 0, 10, int('score', 0, 100)));

densing(ListSchema, { scores: [95] }); // "G-" (11 bits)
densing(ListSchema, { scores: [95, 87, 92, 88] }); // "S_XuWA" (32 bits)
```

### Unions

The discriminator is an enumeration, and every option has its own list of fields. Only the fields of
the chosen variant are written, therefore a `stop` takes 3 bits where a `pause` takes 14.

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

An `array` of enumerations rounds every value up to whole bits: three options take 2 bits each, which
wastes a quarter of the possibilities. An `enumArray` packs all values into one base-n number instead,
so five colors out of three take 8 bits rather than 10.

```typescript
const ColorSchema = schema(enumArray('palette', enumeration('color', ['R', 'G', 'B']), 0, 10));

densing(ColorSchema, { palette: ['R', 'G', 'B', 'R', 'R'] }); // "Ut" (12 bits)
```

## Templates

A template is a shape that is defined once and only used through `reference` fields. It sits under
the schema's `templates` and never appears in the data itself.

```typescript
const vec3 = template(object('vec3', fixed('x', -10, 10, 0.01), fixed('y', -10, 10, 0.01), fixed('z', -10, 10, 0.01)));

const Pose = schema(reference('position', vec3), reference('rotation', vec3));

densing(Pose, { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: -0.5 } }); // "iZLCij6H0O2" (66 bits)
```

In the JSON a reference points at its template by index: `{ "type": "reference", "name": "position", "ref": 0 }`.

## Recursive structures

A template can also contain itself. Since it does not exist yet while it is being built, the
reference gets a function instead of the template:

```typescript
const expr: Template = template(
  union('expr', enumeration('type', ['number', 'add', 'multiply']), {
    number: [int('value', 0, 1000)],
    add: [reference('left', () => expr), reference('right', () => expr)],
    multiply: [reference('left', () => expr), reference('right', () => expr)]
  })
);
const ExpressionSchema = schema(reference('expr', expr));

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

Every recursion needs a way out - a union variant, an optional or an array that may be empty -
otherwise the data could never end. `schema()` checks for it.

[Open the expression tree in the Densing Builder](https://jonasward.ch/densing-ui/#n=Expression+Tree&s=DFM8VProiaUZpZajZ86oem8dXGAJhCsuTK6pBOwJB6K9JbNXTDZ098FW-v0uA&d=kAUAMAI).

## Shared numeric definitions

Quite often several fields share one range, say a width, a height and a depth. A `definition` holds
that range once, with one or more presets (here mm and m). Every payload stores which preset it uses,
and all `referenceNumeric` fields of that definition are written with it.

```typescript
const length = definition('length', {
  mm: { min: 0, max: 1000 },
  m: { min: 0, max: 100, precision: 0.01 }
});

const Box = schema(referenceNumeric('width', length), referenceNumeric('height', length), referenceNumeric('depth', length));

densing(Box, { width: 120, height: 40, depth: 800 }); // "DwFGQA" (31 bits)
densing(Box, { $presets: { length: 'm' }, width: 12.5, height: 0.4, depth: 80 }); // "icQBQ-gA" (43 bits)
```

Without `$presets` the default preset is used, namely the first one, or the one given as third
argument to `definition`. Choosing a preset costs `ceil(log2(presets))` bits, so a definition with a
single preset is free.

`referenceNumeric` also accepts the name of a definition instead of the definition itself. The schema
is then built with `schemaWithDefinitions([length], ...fields)`.

[Open the box in the Densing Builder](https://jonasward.ch/densing-ui/#n=Box+%28shared+units%29&s=EEh5aa6MVHsqHVFkEV6SNHkIccRGU6URynnrmqnASwg&d=DwFGQA).

## Schemas as JSON

A schema is plain data. `JSON.stringify` it to store or send it, and load it again with
`schemaFromJson`. Defaults that were left out get filled in, and a schema that makes no sense is
refused with the path of the field:

```typescript
const loaded = schemaFromJson(JSON.stringify(DeviceSchema));

schemaFromJson({ fields: [{ type: 'int', name: 'age', min: 0, max: 120 }] });
// { fields: [{ type: 'int', name: 'age', min: 0, max: 120, defaultValue: 0 }] }

schemaFromJson({ fields: [{ type: 'int', name: 'age', min: 120, max: 0 }] });
// throws: Invalid schema at fields[0]: int "age": max < min
```

## Schemas as strings

`densingSchema` packs a whole schema into a string, and `undensingSchema` reads it back with the same
checks as `schemaFromJson`. The Device schema takes 68 characters, its JSON 320.

Names and options may use any script (`Größe`, `température`, `θ₀`, `温度`, `🌡️`). Every schema
stores the characters it uses once, and every name as digits over that set. Across the test schemas
the result is 83 to 92% shorter than url encoded JSON, and 21 to 68% shorter than base64 of brotli
compressed JSON.

## Alphabets

```typescript
densing(DeviceSchema, data); // 'Cqnu' (base64url)
densing(DeviceSchema, data, 'baseQRCode45UrlSafe'); // '1CZYG'
densing(DeviceSchema, data, 'binary'); // '000010101010100111101110'
densing(DeviceSchema, data, customBase('0123456789abcdef')); // '0aa9ee'
```

A string has to be decoded with the alphabet it was written with. `customBase` refuses alphabets with
fewer than two characters, with duplicates, or with characters outside the Basic Multilingual Plane.

## Introspection

For editors and tools built on top of a schema, like the Densing Builder:

- `getDenseFieldBitWidthRange(field, schema?)` and `calculateDenseFieldBitWidth(field, value, schema?)`
- `getFieldByPath(schema, path)`, `walkDenseSchema(schema, callback)` and `getAllDenseSchemaPaths(schema)`
- `validateSchema(schema)`, which `schema()` and `schemaFromJson` already run

[API.md](./API.md) describes them in detail.

## Performance

Rough numbers, measured with Bun on an M4 MacBook Air (`bun run benchmark`):

| Schema | Encode | Decode |
| --- | --- | --- |
| 4 fields (int, bool, fixed, enum) | 1,330,000 ops/s | 1,516,000 ops/s |
| nested objects, arrays, optionals | 484,000 ops/s | 394,000 ops/s |
| array of 50 ints | 98,000 ops/s | 91,000 ops/s |
