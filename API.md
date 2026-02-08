# Densing API - Size Calculation & Schema Introspection

This document describes the new high-level API methods added to the densing library to support UI layer implementations.

## Overview

The API provides two main categories of functionality:

1. **Size Calculation** - Calculate encoding sizes (static ranges and actual values)
2. **Schema Introspection** - Navigate and query schema structures

## Size Calculation API

### Static Size Analysis (Without Data)

#### `getDenseFieldBitWidthRange(field: DenseField): { min: number; max: number }`

Returns the minimum and maximum number of bits that can be used to encode a field.

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

### `getFieldByPath(schema: DenseSchema, path: string): DenseField | null`

Get a field definition by its path.

```typescript
// Top-level field
const field = getFieldByPath(schema, 'deviceId');

// Nested field
const nestedField = getFieldByPath(schema, 'network.port');

// Returns null if not found
const missing = getFieldByPath(schema, 'nonexistent'); // null
```

**Use cases:**

- Path-based field lookups in UI
- Dynamic form rendering
- Field-specific overrides

---

### `walkDenseSchema(schema: DenseSchema, callback: (field, path, parent?) => void, prefix?: string)`

Visit all fields in a schema, including nested ones.

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
