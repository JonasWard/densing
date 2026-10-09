import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schema, int, bool, fixed, enumeration, union, pointer, undensingSchema } from 'densing';
import { main, type CliIO } from '../main';
import { version } from '../../package.json';

const DeviceSchema = schema(
  int('deviceId', 0, 1000),
  bool('enabled'),
  fixed('temperature', -40, 125, 0.1),
  enumeration('mode', ['eco', 'normal', 'performance'])
);
const deviceData = { deviceId: 42, enabled: true, temperature: 23.5, mode: 'performance' };

const ExpressionSchema = schema(
  union('expr', enumeration('type', ['number', 'add']), {
    number: [int('value', 0, 1000)],
    add: [pointer('left', 'expr'), pointer('right', 'expr')]
  })
);
const expressionData = {
  expr: { type: 'add', left: { type: 'number', value: 5 }, right: { type: 'number', value: 3 } }
};

let dir: string;
const file = (name: string) => join(dir, name);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'densing-cli-'));
  await writeFile(file('device.json'), JSON.stringify(DeviceSchema));
  await writeFile(file('device-data.json'), JSON.stringify(deviceData));
  await writeFile(file('expression.json'), JSON.stringify(ExpressionSchema));
  await writeFile(file('expression-data.json'), JSON.stringify(expressionData));
  await writeFile(file('invalid-schema.json'), JSON.stringify({ fields: [{ type: 'int', name: 'x', min: 5, max: 1 }] }));
  await writeFile(file('not-json.json'), '{ nope');
});

afterAll(() => rm(dir, { recursive: true, force: true }));

const run = async (argv: string[], stdin?: string) => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    readStdin: async () => stdin ?? '',
    stdinIsTTY: stdin === undefined
  };
  const code = await main(argv, io);
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
};

describe('encode / decode', () => {
  test('encodes the README example', async () => {
    expect(await run(['encode', '-s', file('device.json'), file('device-data.json')])).toEqual({
      code: 0,
      stdout: 'Cqnu',
      stderr: ''
    });
  });

  test('decodes back to the original data', async () => {
    const { code, stdout } = await run(['decode', '-s', file('device.json'), 'Cqnu']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(deviceData);
  });

  test('reads data and encoded strings from stdin', async () => {
    expect((await run(['encode', '-s', file('device.json')], JSON.stringify(deviceData))).stdout).toBe('Cqnu');
    expect((await run(['encode', '-s', file('device.json'), '-'], JSON.stringify(deviceData))).stdout).toBe('Cqnu');
    expect(JSON.parse((await run(['decode', '-s', file('device.json')], 'Cqnu\n')).stdout)).toEqual(deviceData);
  });

  test('reads the schema from stdin', async () => {
    const { stdout } = await run(['encode', '-s', '-', '-d', JSON.stringify(deviceData)], JSON.stringify(DeviceSchema));
    expect(stdout).toBe('Cqnu');
  });

  test('accepts inline data with --data', async () => {
    const { stdout } = await run(['encode', '-s', file('device.json'), '--data', JSON.stringify(deviceData)]);
    expect(stdout).toBe('Cqnu');
  });

  test('round trips with other bases', async () => {
    for (const base of ['binary', 'baseQRCode45UrlSafe', '0123456789abcdef']) {
      const encoded = await run(['encode', '-s', file('device.json'), file('device-data.json'), '-b', base]);
      expect(encoded.code).toBe(0);
      const decoded = await run(['decode', '-s', file('device.json'), encoded.stdout, '--base', base]);
      expect(JSON.parse(decoded.stdout)).toEqual(deviceData);
    }
    expect((await run(['encode', '-s', file('device.json'), file('device-data.json'), '-b', 'binary'])).stdout).toBe(
      '000010101010100111101110'
    );
  });

  test('round trips recursive schemas with pointers', async () => {
    const encoded = await run(['encode', '-s', file('expression.json'), file('expression-data.json')]);
    expect(encoded.code).toBe(0);
    const decoded = await run(['decode', '-s', file('expression.json'), encoded.stdout, '--compact']);
    expect(decoded.stdout).toBe(JSON.stringify(expressionData));
  });

  test('rejects invalid data with the failing paths', async () => {
    const { code, stdout, stderr } = await run([
      'encode',
      '-s',
      file('device.json'),
      '-d',
      JSON.stringify({ ...deviceData, deviceId: 4200 })
    ]);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('deviceId: value 4200 out of range [0, 1000]');
  });

  test('rejects strings the encoder cannot produce', async () => {
    const { code, stderr } = await run(['decode', '-s', file('device.json'), 'Cqnu', '-b', 'binary']);
    expect(code).toBe(1);
    expect(stderr).toContain('could not decode "Cqnu"');
  });

  test('rejects encoded strings with characters outside of the base', async () => {
    const { code, stderr } = await run(['decode', '-s', file('device.json'), 'Cq!u']);
    expect(code).toBe(1);
    expect(stderr).toContain('invalid character "!" at position 2');
  });

  test('rejects invalid custom bases', async () => {
    const { code, stderr } = await run(['encode', '-s', file('device.json'), file('device-data.json'), '-b', 'aab']);
    expect(code).toBe(2);
    expect(stderr).toContain('invalid base: alphabet "aab": duplicate character "a"');
  });
});

describe('schema commands', () => {
  test('validate', async () => {
    expect(await run(['validate', '-s', file('device.json'), file('device-data.json')])).toEqual({
      code: 0,
      stdout: 'valid',
      stderr: ''
    });
    const invalid = await run(['validate', '-s', file('device.json'), '-d', '{"deviceId":1}']);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('enabled: missing value');
  });

  test('size without and with data', async () => {
    const staticSize = JSON.parse((await run(['size', '-s', file('device.json')])).stdout);
    expect(staticSize.staticRange.maxBits).toBe(24);
    const dataSize = JSON.parse((await run(['size', '-s', file('device.json'), file('device-data.json')])).stdout);
    expect(dataSize.totalBits).toBe(24);
    expect(dataSize.base64Length).toBe(4);
  });

  test('defaults', async () => {
    const { stdout } = await run(['defaults', '-s', file('device.json'), '-c']);
    expect(stdout).toBe('{"deviceId":0,"enabled":false,"temperature":-40,"mode":"eco"}');
  });

  test('types', async () => {
    const { stdout } = await run(['types', '-s', file('device.json'), '-n', 'Device']);
    expect(stdout).toContain('export interface Device {');
    expect(stdout).toContain("mode: 'eco' | 'normal' | 'performance';");
  });

  test('paths', async () => {
    expect((await run(['paths', '-s', file('device.json')])).stdout).toBe('deviceId\nenabled\ntemperature\nmode');
  });

  test('schema fills in defaults', async () => {
    const { stdout } = await run(['schema', '-s', '-'], '{"fields":[{"type":"int","name":"x","min":3,"max":9}]}');
    expect(JSON.parse(stdout)).toEqual(schema(int('x', 3, 9)));
  });

  test('schema --dense prints the schema as a compact string', async () => {
    const { stdout } = await run(['schema', '-s', file('device.json'), '--dense']);
    expect(undensingSchema(stdout)).toEqual(DeviceSchema);
    expect(stdout.length).toBeLessThan(JSON.stringify(DeviceSchema).length / 3);
    const binary = (await run(['schema', '-s', file('device.json'), '--dense', '-b', 'binary'])).stdout;
    expect(undensingSchema(binary, 'binary')).toEqual(DeviceSchema);
  });
});

describe('usage errors', () => {
  test('help and version', async () => {
    expect((await run(['--version'])).stdout).toBe(version);
    const help = await run(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: densing <command>');
    const noCommand = await run([]);
    expect(noCommand.code).toBe(2);
    expect(noCommand.stderr).toContain('Usage: densing <command>');
  });

  test.each([
    [['frob', '-s', 'x'], 'unknown command "frob"'],
    [['encode', '--nope'], "Unknown option '--nope'"],
    [['encode', '@device-data.json'], 'missing schema'],
    [['encode', '-s', '@device.json'], 'missing input for "encode"'],
    [['paths', '-s', '@device.json', 'extra'], 'unexpected arguments: extra'],
    [['encode', '-s', '-', '-'], 'schema and input cannot both be read from stdin'],
    [['paths', '-s', '@missing.json'], 'could not read schema'],
    [['paths', '-s', '@not-json.json'], 'schema is not valid JSON'],
    [['paths', '-s', '@invalid-schema.json'], 'Invalid schema at fields[0]: int "x": max < min']
  ])('%p exits with 2', async (argv, message) => {
    // `@name` refers to a file in the temp dir, which only exists once the tests run
    const { code, stderr } = await run((argv as string[]).map((a) => (a.startsWith('@') ? file(a.slice(1)) : a)));
    expect(code).toBe(2);
    expect(stderr).toContain(message as string);
  });

  test('empty stdin is reported as missing input', async () => {
    const { code, stderr } = await run(['encode', '-s', file('device.json')], '');
    expect(code).toBe(2);
    expect(stderr).toContain('stdin was empty');
  });
});

describe('executable', () => {
  test('runs as a process with piped stdin and exit codes', async () => {
    const entry = join(import.meta.dir, '..', 'cli.ts');
    const ok = Bun.spawnSync(['bun', entry, 'encode', '-s', file('device.json')], {
      stdin: Buffer.from(JSON.stringify(deviceData))
    });
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.toString()).toBe('Cqnu\n');

    const fail = Bun.spawnSync(['bun', entry, 'decode', '-s', file('device.json'), 'Cq!u']);
    expect(fail.exitCode).toBe(1);
    expect(fail.stderr.toString()).toContain('invalid character "!"');
  });
});
