# Densing API - Size Calculation & Schema Introspection

This document describes the new high-level API methods added to the densing library to support UI layer implementations.

## Overview

The API provides two main categories of functionality:

1. **Size Calculation** - Calculate encoding sizes (static ranges and actual values)
2. **Schema Introspection** - Navigate and query schema structures

## Size Calculation API

### Static Size Analysis (Without Data)

#### `getDenseFieldBitWidthRange(field: DenseField, schema?: DenseSchema): { min: number; max: number }`

Returns the minimum and maximum number of bits that can be used to encode a field.
Pass the root `schema` when the field contains `pointer` fields. For a recursive schema `max` is
`Infinity` (there is no static upper bound) and `min` is the size of the smallest finite value.

```typescript
const field = schema.fields.find((f) => f.name === 'optional');
const range = getDenseFieldBitWidthRange(field);
console.log(range); // { min: 1, max: 9 }
```

**Use cases:**

- Schema documentation ("this field uses 5-10 bits")
- Design-time optimization
- UI hints for field efficiency

---

#### `analyzeDenseSchemaSize(schema: DenseSchema): SchemaSizeInfo`

Analyzes a schema to return comprehensive size information.

```typescript
const sizeInfo = analyzeDenseSchemaSize(DeviceConfigSchema);

console.log(sizeInfo.staticRange);
// {
//   minBits: 45,
//   maxBits: 312,
//   minBytes: 6,
//   maxBytes: 39,
//   minBase64Chars: 8,
//   maxBase64Chars: 52
// }

console.log(sizeInfo.fieldRanges);
// {
//   deviceId: { min: 10, max: 10 },
//   enabled: { min: 1, max: 1 },
//   metadata: { min: 1, max: 89 }, // optional field!
//   alerts: { min: 21, max: 200 }  // array field!
// }
```

**Use cases:**

- Schema comparison ("schema A is more efficient than schema B")
- Documentation generation
- Optimization insights

---

### Dynamic Size Calculation (With Actual Data)

#### `calculateDenseFieldBitWidth(field: DenseField, value: any): number`

Returns the exact number of bits that will be used when encoding a specific value.

```typescript
const optionalField = schema.fields.find((f) => f.name === 'metadata');

// With value present
calculateDenseFieldBitWidth(optionalField, { version: 2 }); // 9 bits

// With value absent
calculateDenseFieldBitWidth(optionalField, null); // 1 bit
```

**Use cases:**

- Real-time UI feedback as user edits
- Per-field size display
- Efficiency optimization hints

---

#### `calculateDenseDataSize(schema: DenseSchema, data: any): DataSizeInfo`

Calculates the actual encoding size for specific data.

```typescript
const sizeInfo = calculateDenseDataSize(schema, data);

console.log(sizeInfo);
// {
//   totalBits: 156,
//   totalBytes: 20,
//   base64Length: 26,
//   fieldSizes: {
//     deviceId: 10,
//     enabled: 1,
//     metadata: 9,
//     alerts: 136
//   },
//   efficiency: {
//     usedBits: 156,
//     minPossibleBits: 45,
//     maxPossibleBits: 312,
//     utilizationPercent: 41.6  // (156-45)/(312-45) * 100
//   }
// }
```

**Use cases:**

- Real-time encoding preview
- "You're using X of Y characters"
- Efficiency metrics in UI
- Before/after comparison

---

## Schema Introspection API

### Path grammar

`getFieldByPath`, `walkDenseSchema` and `getAllDenseSchemaPaths` share one path format: every nested
field adds its own name as a segment, separated by `.`, and an array segment gets `[]` when the path
continues into its items.

| Field | Example | Refers to |
|---|---|---|
| object | `settings.enabled` | a field of the object |
| array | `users[].user`, `users[].user.id` | the items field (and its fields) |
| optional | `maybe.inner` | the wrapped field |
| union | `action.type`, `action.delay` | the discriminator, or a field of any variant (the first variant wins when several declare the name) |
| pointer | `expr.left.value` | `getFieldByPath` continues in the pointer's target; the walk does not descend into pointers |

Every path the walk produces resolves with `getFieldByPath`. For compatibility, `getFieldByPath`
also accepts `list.child` for a field of an array's object items (`list[].item.child`).

### `getFieldByPath(schema: DenseSchema, path: string): DenseField | null`

Get a field definition by its path.

```typescript
// Top-level field
const field = getFieldByPath(schema, 'deviceId');

// Nested field
const nestedField = getFieldByPath(schema, 'network.port');

// Array items, union variants, pointers
getFieldByPath(schema, 'users[].user.id');
getFieldByPath(schema, 'action.delay');
getFieldByPath(schema, 'expr.left.value');

// Returns null if not found
const missing = getFieldByPath(schema, 'nonexistent'); // null
```

**Use cases:**

- Path-based field lookups in UI
- Dynamic form rendering
- Field-specific overrides

---

### `walkDenseSchema(schema: DenseSchema, callback: (field, path, parent?) => void, prefix?: string)`

Visit all fields in a schema, including nested ones. The callback receives each field, its path
(see the path grammar) and its parent field (`undefined` at the top level).

```typescript
walkDenseSchema(schema, (field, path) => {
  console.log(`${path}: ${field.type}`);
});

// Output:
// id: int
// settings: object
// settings.enabled: bool
// settings.timeout: int
```

**Use cases:**

- Schema analysis tools
- Validation logic
- Automatic documentation generation
- Field mapping/transformation

---

### `getAllDenseSchemaPaths(schema: DenseSchema): string[]`

Get all field paths in a schema.

```typescript
const paths = getAllDenseSchemaPaths(schema);
console.log(paths);
// ['id', 'settings', 'settings.enabled', 'settings.timeout']
```

**Use cases:**

- Auto-completion in config UIs
- Path validation
- Schema diffing

---

## Schema Validation API

### `validateSchema(schema: DenseSchema): ValidationResult`

Checks the rules that depend on the whole schema. `schema()` runs it and throws on the first error;
call it yourself for schemas built by hand or loaded from JSON.

- every `pointer` target exists
- every `pointer` target name is unique among the fields a pointer can refer to (object fields,
  union variant fields, array items, optional inner fields), so the target never depends on
  declaration order
- every `pointer` target has a finite value: a recursive cycle must pass through a union variant, an
  optional or an array that may be empty

```typescript
validateSchema({ fields: [object('node', int('v', 0, 3), pointer('next', 'node'))] });
// { valid: false, errors: [{ path: 'node.next', message: 'pointer target "node" has no finite value: ...' }] }
```

### `schemaFromJson(input: unknown): DenseSchema`

Loads a schema from its JSON representation: a JSON string or a parsed object, for example the
output of `JSON.stringify(schema)`. Every field is rebuilt with the builders and the result with
`schema()`, so the builder checks and `validateSchema` apply, and missing `defaultValue`s are filled
in. Unknown field types and unknown or mistyped properties are rejected. Errors name the field:

```typescript
schemaFromJson('{"fields":[{"type":"int","name":"age","min":0,"max":120}]}');
// { fields: [{ type: 'int', name: 'age', min: 0, max: 120, defaultValue: 0 }] }

schemaFromJson({ fields: [{ type: 'array', name: 'scores', minLength: 0, maxLength: 3, items: { type: 'int', name: 'score', min: 9, max: 1 } }] });
// throws: Invalid schema at fields[0].items: int "score": max < min
```

---

## Type Definitions

### `SchemaSizeInfo`

```typescript
interface SchemaSizeInfo {
  staticRange: {
    minBits: number;
    maxBits: number;
    minBytes: number;
    maxBytes: number;
    minBase64Chars: number;
    maxBase64Chars: number;
  };
  fieldRanges: Record<string, { min: number; max: number }>;
}
```

### `DataSizeInfo`

```typescript
interface DataSizeInfo {
  totalBits: number;
  totalBytes: number;
  base64Length: number;
  fieldSizes: Record<string, number>;
  efficiency: {
    usedBits: number;
    minPossibleBits: number;
    maxPossibleBits: number;
    utilizationPercent: number;
  };
}
```

---

## Usage Examples

### Real-Time Size Display

```typescript
import { calculateDenseDataSize } from 'densing';

const MyForm = () => {
  const [data, setData] = useState(getDefaultData(schema));
  const sizeInfo = calculateDenseDataSize(schema, data);

  return (
    <div>
      <SchemaForm schema={schema} value={data} onChange={setData} />

      <div className="encoding-stats">
        <h4>
          Encoding Size: {sizeInfo.base64Length} chars ({sizeInfo.totalBits} bits)
        </h4>
        <ProgressBar value={sizeInfo.efficiency.utilizationPercent} max={100} />
        <small>Using {sizeInfo.efficiency.utilizationPercent.toFixed(1)}% of max size</small>
      </div>
    </div>
  );
};
```

### Field-Level Size Badge

```typescript
import { calculateDenseFieldBitWidth, getDenseFieldBitWidthRange } from 'densing';

const SchemaField = ({ field, value }) => {
  const range = getDenseFieldBitWidthRange(field);
  const actualBits = calculateDenseFieldBitWidth(field, value);

  return (
    <div>
      <label>{field.name}</label>
      <input value={value} onChange={...} />
      <span className="size-badge">
        {range.min === range.max
          ? `${actualBits} bits (fixed)`
          : `${actualBits}/${range.max} bits`
        }
      </span>
    </div>
  );
};
```

### Schema Comparison Tool

```typescript
import { analyzeDenseSchemaSize } from 'densing';

const compareSchemas = (schemaA, schemaB) => {
  const sizeA = analyzeDenseSchemaSize(schemaA);
  const sizeB = analyzeDenseSchemaSize(schemaB);

  console.log(`Schema A: ${sizeA.staticRange.minBase64Chars}-${sizeA.staticRange.maxBase64Chars} chars`);
  console.log(`Schema B: ${sizeB.staticRange.minBase64Chars}-${sizeB.staticRange.maxBase64Chars} chars`);

  if (sizeA.staticRange.maxBase64Chars < sizeB.staticRange.maxBase64Chars) {
    console.log('✓ Schema A is more efficient');
  }
};
```

### Path-Based Field Customization

```typescript
import { getFieldByPath } from 'densing';

const renderField = (schema, path, value) => {
  const field = getFieldByPath(schema, path);

  // Custom rendering for specific paths
  if (path === 'network.port') {
    return <PortSelector field={field} value={value} />;
  }

  // Default rendering
  return <DefaultField field={field} value={value} />;
};
```
