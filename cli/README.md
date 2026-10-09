# densing-cli

Command line interface for [densing](https://github.com/JonasWard/densing): bit-pack JSON data into compact, URL and QR code safe strings, straight from your terminal.

```bash
npm install -g densing-cli
# or run it without installing
npx densing-cli --help
```

The installed command is called `densing`. It runs on Node.js 18.3 or newer and has no dependencies, because the matching densing version is bundled in. `densing-cli@0.4.4` contains `densing@0.4.4`.

## Schemas

The cli reads schemas as JSON. A densing schema is plain data, so you can create the file from a schema written in TypeScript:

```typescript
import { writeFileSync } from 'node:fs';
import { schema, int, bool, fixed, enumeration } from 'densing';

const DeviceSchema = schema(
  int('deviceId', 0, 1000),
  bool('enabled'),
  fixed('temperature', -40, 125, 0.1),
  enumeration('mode', ['eco', 'normal', 'performance'])
);

writeFileSync('device.json', JSON.stringify(DeviceSchema));
```

You can also write the schema by hand. Default values are optional, and missing ones are filled in the same way the builder functions fill them:

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

Every schema is checked when it is loaded, with the same checks the builder functions run. An error names the field that caused it, for example `Invalid schema at fields[0]: int "deviceId": max < min`.

## Usage

```
densing <command> -s <schema.json> [input] [options]
```

| Command | Input | Output |
| --- | --- | --- |
| `encode` | data JSON file, `-` or piped stdin | the encoded string |
| `decode` | encoded string, `-` or piped stdin | the data as JSON |
| `validate` | data JSON file, `-` or piped stdin | `valid`, or the errors per field |
| `size` | optional data JSON | static bit sizes of the schema, or the size of the data |
| `defaults` | – | the default data of the schema |
| `types` | – | TypeScript types for the schema |
| `paths` | – | all field paths, one per line |
| `schema` | – | the schema with all defaults filled in; with `--dense` the schema as a compact string (`densingSchema`, in `--base`) |
| `upgrade` | – | the schema with deprecated pointers turned into templates (`pointersToTemplates`); data and encodings stay the same |

| Option | |
| --- | --- |
| `-s, --schema <file>` | schema JSON file, `-` for stdin |
| `-d, --data <json>` | data as inline JSON instead of a file |
| `-b, --base <base>` | `base64url` (default), `baseQRCode45UrlSafe`, `binary` or a custom alphabet such as `0123456789abcdef` |
| `-n, --name <name>` | root type name for `types` (default `SchemaData`) |
| `-c, --compact` | print JSON on a single line |
| `-h, --help` / `-v, --version` | |

Exit codes: `0` ok, `1` invalid data or decode error, `2` usage or schema error. Errors are written to stderr.

### Examples

```bash
$ echo '{"deviceId":42,"enabled":true,"temperature":23.5,"mode":"performance"}' > data.json

$ densing encode -s device.json data.json
Cqnu

$ densing decode -s device.json Cqnu --compact
{"deviceId":42,"enabled":true,"temperature":23.5,"mode":"performance"}

$ densing encode -s device.json --base binary -d '{"deviceId":42,"enabled":true,"temperature":23.5,"mode":"performance"}'
000010101010100111101110

$ cat data.json | densing encode -s device.json | densing decode -s device.json -c
{"deviceId":42,"enabled":true,"temperature":23.5,"mode":"performance"}

$ densing validate -s device.json -d '{"deviceId":4200,"enabled":true,"temperature":23.5,"mode":"turbo"}'
densing: data does not match the schema:
  deviceId: value 4200 out of range [0, 1000]
  mode: invalid enum value turbo, expected one of [eco, normal, performance]

$ densing types -s device.json -n Device
export interface Device {
  deviceId: number;
  enabled: boolean;
  temperature: number;
  mode: 'eco' | 'normal' | 'performance';
}
```

## Development

The cli lives in the `cli/` folder of the densing repository. It imports `densing` from the library source in `../src` through `tsconfig.json` `paths`, and the build bundles that source into `dist/cli.js`. A change to the library is therefore picked up right away, with no linking or publishing in between.

```bash
cd cli
bun test          # tests, run against the library source
bun run build     # bundle into dist/cli.js
node dist/cli.js --help
```

To release, give `densing` and `densing-cli` the same version, then run `bun publish` (or `npm publish`) in both the repository root and `cli/`.
