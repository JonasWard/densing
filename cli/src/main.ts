import { isatty } from 'node:tty';
import { parseArgs } from 'node:util';
import { version } from '../package.json';
import {
  decodeCommand,
  defaultsCommand,
  encodeCommand,
  pathsCommand,
  schemaCommand,
  sizeCommand,
  typesCommand,
  validateCommand
} from './commands';
import { CliError, loadSchema, parseJson, readStdin, readText } from './io';

export const helpText = `densing ${version} - bit-pack JSON data into compact strings

Usage: densing <command> -s <schema.json> [input] [options]

Commands:
  encode   [data.json | -]      encode data into a string
  decode   [encoded | -]        decode a string back into JSON data
  validate [data.json | -]      check data against the schema
  size     [data.json | -]      bit sizes of the schema, or of the data when given
  defaults                      print the default data of the schema
  types                         print TypeScript types for the schema
  paths                         print all field paths of the schema
  schema                        print the schema with all defaults filled in
                                (--dense: as a compact string, see densingSchema)

Input is read from stdin when it is "-" or omitted while piping.

Options:
  -s, --schema <file>   schema as JSON file (output of JSON.stringify(schema)), "-" for stdin
  -d, --data <json>     data as inline JSON instead of a file
  -b, --base <base>     base64url (default), baseQRCode45UrlSafe, binary or a custom alphabet
  -n, --name <name>     root type name for "types" (default: SchemaData)
  -c, --compact         print JSON on a single line
      --dense           with "schema": print the schema as a compact string in --base
  -h, --help            show this help
  -v, --version         show the version

Exit codes: 0 ok, 1 invalid data / decode error, 2 usage / schema error`;

const commands = ['encode', 'decode', 'validate', 'size', 'defaults', 'types', 'paths', 'schema'] as const;
type Command = (typeof commands)[number];
const inputCommands: readonly Command[] = ['encode', 'decode', 'validate', 'size'];

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
  stdinIsTTY: boolean;
}

const defaultIO: CliIO = {
  stdout: (text) => process.stdout.write(text + '\n'),
  stderr: (text) => process.stderr.write(text + '\n'),
  readStdin,
  // not `process.stdin.isTTY`: that creates the stdin stream, and on bun 1.3 piped input is lost when the
  // stream is created before an await and read after it
  stdinIsTTY: isatty(0)
};

const parse = (argv: string[]) => {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        schema: { type: 'string', short: 's' },
        data: { type: 'string', short: 'd' },
        base: { type: 'string', short: 'b', default: 'base64url' },
        name: { type: 'string', short: 'n', default: 'SchemaData' },
        compact: { type: 'boolean', short: 'c', default: false },
        dense: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false }
      }
    });
  } catch (error) {
    throw new CliError((error as Error).message, 2);
  }
};

/**
 * Run the cli
 * @param argv - the arguments without the node executable and script path
 * @returns the exit code
 */
export const main = async (argv: string[], io: CliIO = defaultIO): Promise<number> => {
  try {
    const { values, positionals } = parse(argv);
    if (values.version || values.help) {
      io.stdout(values.version ? version : helpText);
      return 0;
    }
    if (positionals.length === 0) {
      io.stderr(helpText);
      return 2;
    }

    const [command, input, ...rest] = positionals;
    if (!commands.includes(command as Command))
      throw new CliError(`unknown command "${command}", run "densing --help" for usage`, 2);
    const extra = inputCommands.includes(command as Command) ? rest : positionals.slice(1);
    if (extra.length) throw new CliError(`unexpected arguments: ${extra.join(' ')}`, 2);
    if (!values.schema) throw new CliError('missing schema, pass it with -s <schema.json>', 2);
    if (values.schema === '-' && input === '-') throw new CliError('schema and input cannot both be read from stdin', 2);

    const schema = await loadSchema(values.schema, io.readStdin);

    // reads the input argument as text: file / `-` / piped stdin, or the encoded string itself for decode
    const readInput = async (required: boolean): Promise<string | undefined> => {
      if (input === '-' || (input === undefined && !io.stdinIsTTY && values.schema !== '-')) {
        const text = await io.readStdin();
        if (!text.trim()) throw new CliError(`missing input for "${command}", stdin was empty`, 2);
        return text;
      }
      if (input !== undefined) return command === 'decode' ? input : readText(input, 'data', io.readStdin);
      if (required) throw new CliError(`missing input for "${command}"`, 2);
      return undefined;
    };
    const readData = async (required: boolean): Promise<unknown> => {
      if (values.data !== undefined) {
        if (input !== undefined) throw new CliError('pass data either with --data or as input, not both', 2);
        return parseJson(values.data, 'data', 1);
      }
      const text = await readInput(required);
      return text === undefined ? undefined : parseJson(text, 'data', 1);
    };

    const output = await (async (): Promise<string> => {
      switch (command as Command) {
        case 'encode':
          return encodeCommand(schema, await readData(true), values.base);
        case 'decode':
          return decodeCommand(schema, ((await readInput(true)) ?? '').trim(), values.base, values.compact);
        case 'validate':
          return validateCommand(schema, await readData(true));
        case 'size':
          // only read piped stdin for size when explicitly asked for, the data is optional
          return sizeCommand(
            schema,
            input === undefined && values.data === undefined ? undefined : await readData(false),
            values.compact
          );
        case 'defaults':
          return defaultsCommand(schema, values.compact);
        case 'types':
          return typesCommand(schema, values.name);
        case 'paths':
          return pathsCommand(schema);
        case 'schema':
          return schemaCommand(schema, values.compact, values.dense, values.base);
      }
    })();

    io.stdout(output);
    return 0;
  } catch (error) {
    if (error instanceof CliError) {
      io.stderr(`densing: ${error.message}`);
      return error.exitCode;
    }
    io.stderr(`densing: ${(error as Error).message ?? String(error)}`);
    return 1;
  }
};
