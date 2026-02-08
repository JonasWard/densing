# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
