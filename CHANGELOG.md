# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-02-11

### Added

- **Schema Introspection Tests**: 19 comprehensive tests for `walkDenseSchema` and `getAllDenseSchemaPaths` API methods
  - Tests for nested objects, arrays, optionals, unions, and pointers
  - Tests for deeply nested structures (3+ levels)
  - Tests for custom prefix parameter
  - Tests for field metadata collection
  - Tests for arrays of objects and union with nested objects
- **Meta-Schema Utilities**: New `getAllUniqueNamesAndOptions()` function with 15 tests
  - Collects all field names and enum options from a schema
  - Supports all field types including pointer fields
  - Automatic deduplication of shared names
  - Tested with real-world GLSL Ray Marching schema (50+ unique names)
- **Schema Compression Testing**: Added `zstd-codec` dev dependency for schema compression tests
  - GLSL Ray Marching schema compresses 75.30% (4.05x smaller: 2935 → 725 bytes)
  - Round-trip integrity verification
  - Useful for schema storage, versioning, and URL embedding

### Fixed

- **`walkField` Path Construction**: Fixed incorrect path building in nested fields
  - Paths now correctly use `fieldPath` as prefix instead of original `prefix`
  - Union fields now properly walk discriminator field
  - All nested paths are now correctly formatted
- **`getAllUniqueNamesAndOptions` Bug**: Fixed accumulation of names across schema walk
  - Now correctly passes the same `Set` instance throughout traversal
  - Collects all field names, not just enum/pointer fields
  - Properly handles enum_array discriminator names

### Changed

- **Test Coverage**: Total test count increased from 352 to 382 tests
  - `api.test.ts`: 28 → 47 tests
  - New `meta-schema.test.ts`: 25 tests (including compression test)
- **`walkDenseSchemaField`**: Now collects all field names and properly recurses through container types

## [0.2.0] - 2026-02-10

### Added

- **First-Class Pointer Support**: New `pointer()` field type for clean recursive schemas
  - `PointerField` type added to core schema system
  - `pointer(name, targetName)` builder function
  - Name-based field references (stable, order-independent)
  - Unlimited recursion depth (no artificial limits)
  - Automatic cycle detection in schema analysis
  - Full support in encoding/decoding, validation, type generation, and API functions
- **Comprehensive Pointer Tests**: 9 new tests covering various recursive patterns
  - Linked lists, binary trees, expression ASTs
  - Arrays of recursive structures
  - Optional recursive fields
  - Deep recursion validation
  - Graph-like structures with multiple pointers

### Changed

- **Schema Introspection**: All API functions now support pointer fields
  - `getDenseFieldBitWidthRange()` handles recursive pointers gracefully
  - `calculateDenseFieldBitWidth()` follows pointers in actual data
  - `analyzeDenseSchemaSize()` accounts for pointer field ranges
- **Type Generation**: `generateTypes()` creates proper self-referential TypeScript types for pointers
- **Default Data**: `getDefaultData()` returns `null` for pointer fields to avoid infinite recursion

### Removed

- **BREAKING**: Removed `createRecursiveUnion()` helper function
  - Replaced by first-class `pointer()` support with cleaner syntax
  - Migration: Use `pointer('fieldName', 'targetName')` instead of `createRecursiveUnion()`
  - Old API had artificial depth limits; new API has unlimited depth
- Removed `recursive-builder-helper.ts` module

### Migration Guide

**Before (0.1.x):**
```typescript
const ExprSchema = schema(
  createRecursiveUnion(
    'expr',
    ['number', 'add'],
    (recurse) => ({
      number: [int('value', 0, 1000)],
      add: [recurse('left'), recurse('right')]
    }),
    5 // max depth
  )
);
```

**After (0.2.0):**
```typescript
const ExprSchema = schema(
  union(
    'expr',
    enumeration('type', ['number', 'add']),
    {
      number: [int('value', 0, 1000)],
      add: [pointer('left', 'expr'), pointer('right', 'expr')]
    }
  )
);
```

## [0.1.1] - 2026-02-08

### Fixed

- **Browser Compatibility**: Removed static `fs` and `path` imports from type-generator module
  - `generateTypes()` now works in all environments (Node.js, browser, edge runtimes)
  - `generateTypesFile()` now uses dynamic imports and is async
  - Bundle is now fully browser-compatible with no Node.js dependencies at runtime

### Changed

- `generateTypesFile()` is now async and returns a `Promise<void>`
- Bundle size increased slightly from 30.0 KB to 30.99 KB due to dynamic imports

## [0.1.0] - 2026-02-08

### Added

- Initial release
- Bit-level data serialization with schema definition
- Support for int, fixed, bool, enum, optional, array, enumArray, object, and union types
- Base64url encoding by default with support for custom bases
- Built-in validation
- Size analysis utilities
- Type generation from schemas
- Comprehensive test suite (364 tests)
- Performance benchmarks
- Complete documentation and examples
