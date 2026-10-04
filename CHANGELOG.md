# Changelog

## [Unreleased]

### Fixed

- **`validate` follows pointers**: values behind a `pointer` were never checked ([#13](https://github.com/JonasWard/densing/issues/13))
- **`getDefaultData` for recursive schemas** returns finite, encodable data: the default discriminator is kept, and recursion below it ends at the smallest variant. Pointers previously defaulted to `null`, which `densing` could not encode ([#13](https://github.com/JonasWard/densing/issues/13))
- **BREAKING: `undensing` rejects malformed input** with a `DenseDecodeError` (with `path`) instead of returning wrong data or crashing: characters outside the alphabet (previously read as digit −1), stored values above a field's maximum (an `int` above `max`, an enum index past the options, which decoded to `undefined`), union discriminator indices past the options (previously a raw `TypeError`), array lengths above `maxLength`, invalid `enum_array` content, too few characters, trailing characters, non-zero padding bits and over-capacity base38 strings. Every payload now has exactly one valid spelling
- **Fields wider than 32 bits** (e.g. millisecond timestamps, longitude at `1e-8`) encoded but could not be decoded (`Cannot read more than 32 bits`). Fields up to 53 bits now round-trip; `int` and `fixed` throw at definition time when they need more
- **Range widths** are computed as integer bit lengths: `ceil(log2(2^49 + 1))` evaluated to 49, one bit too few, for ranges just above large powers of two
- **Fixed-point alignment** at very fine precisions (`1e-10`) allows for the floating-point error of large step counts
- **BREAKING: `densing` rejects invalid data** instead of encoding it silently ([#2](https://github.com/JonasWard/densing/issues/2)). It throws a `DenseEncodeError` (with `path`, same notation as `validate`) for out-of-range or negative ints, non-integer ints (previously rounded), non-boolean bools, unknown enum values (previously encoded as a different option or as `undefined`), array / enum array lengths outside `[minLength, maxLength]` (previously corrupted the following fields), missing values and misaligned fixed-point values. Code that relied on wraparound or rounding must now clamp or round itself. `BitWriter.writeUInt` also throws instead of masking
- **`validate` and `densing` share one set of value rules** (`src/values.ts`), so they cannot disagree
- **Fixed-point precision check** in `validate` could never fail; `3.14` at precision `0.1` is now reported as not aligned, while values that are exact but awkward in binary (`0.1`, `100.3`) stay valid. The tolerance is `PRECISION_ALIGNMENT_TOLERANCE` ([#3](https://github.com/JonasWard/densing/issues/3))
- **Fixed-point values round-trip exactly**: decoding stays in the integer domain and divides once, so `0.1` decodes as `0.1` instead of `0.10000000000000142`. The encoding is unchanged ([#4](https://github.com/JonasWard/densing/issues/4))
- **Size analysis with reused field names**: `getDenseFieldBitWidthRange` keyed its recursion guard on `type:name` and shared it across siblings, so any second field with the same type and name (e.g. `v` in two nested objects, or in two union variants) reported `{ min: 0, max: 9007199254740991 }`, corrupting `analyzeDenseSchemaSize` and `calculateDenseDataSize`. Only pointers now take part in cycle detection, per branch ([#1](https://github.com/JonasWard/densing/issues/1))
- **Minimum size of recursive schemas** is now exact (the expression example reported 1 bit instead of 11)
- **Unknown field types** now throw in every consumer (`densing`, `undensing`, `validate`, `getDefaultData`, `generateTypes`, size analysis, `walkDenseSchema`) instead of writing nothing, reporting 0 bits or returning `undefined`; `assertNeverDenseField` makes a missing case a compile error ([#7](https://github.com/JonasWard/densing/issues/7))
- **README**: the recursive-structures example used `createRecursiveUnion` (removed in 0.2.0) and quoted 190 bits for a 40-bit payload; it now uses `pointer`, and every size figure in the README is asserted by `readme-examples.test.ts` ([#8](https://github.com/JonasWard/densing/issues/8))
- **`getBigIntFrombaseQRCode45UrlSafe`** decoded using its own input as the alphabet (the parameter shadowed the alphabet constant); `@typescript-eslint/no-shadow` is now enforced ([#5](https://github.com/JonasWard/densing/issues/5))
- **Lint coverage**: `bun run lint` now lints all of `src/`; the unquoted `src/**/*.ts` glob skipped the top-level `densing.ts`, `api.ts` and `helpers.ts`

### Changed

- **BREAKING: builders validate at definition time**: default values must be valid for their field (`int('x', 0, 10, 99)`, `enumeration('e', ['a','b'], 'zzz')`, an invalid `optional` or `enumArray` default); `int` bounds must be safe integers and `fixed` bounds finite; enum options must be strings; fields that share a data object must have distinct names (top-level, in an `object`, and in each union variant together with the discriminator); union variants must all be discriminator options
- **`enumArray` default**: without an explicit default it is now `minLength` copies of the enum's default (previously `[]`, which was invalid whenever `minLength > 0`)
- **BREAKING (analysis only)**: the maximum size of a recursive schema is reported as `Infinity` instead of `Number.MAX_SAFE_INTEGER` (and sums of it). `utilizationPercent` is `0` for such schemas. `getDenseFieldBitWidthRange` no longer takes the internal third `visited` parameter
- **Pointer resolution** is implemented once (`src/schema/resolve.ts`) and shared by the codec and the size analysis, and resolved targets are cached per schema ([#6](https://github.com/JonasWard/densing/issues/6))

### Added

- **`validateSchema(schema)`**, run by `schema()`: pointer targets must exist, be unique among the fields a pointer can refer to, and have a finite value (a recursion needs a union variant, optional or possibly-empty array as a way out; `pointer('p', 'p')` used to loop forever) ([#13](https://github.com/JonasWard/densing/issues/13))
- **CI**: GitHub Actions workflow running lint, typecheck, tests and build on every push to `main` and every pull request
- **`typecheck` script**: type-checks sources, tests and the benchmark
- **`FORMAT.md`**: specification of the wire format (bit order, field encodings, padding, alphabets)
- **Golden-vector tests** (`format.test.ts`) pinning the current encoding in four alphabets

## [0.2.3] - 2026-02-12

### Removed

- **`generateTypesFile` removed: caused import problems for some libraries

## [0.2.2] - 2026-02-11

### Changed

- **`validateField` exposed: existing method now externally available

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


The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).