import { readFile } from 'node:fs/promises';
import { schemaFromJson, type DenseSchema } from 'densing';

/**
 * Error with the exit code the cli should terminate with
 * 1 - data, validation or decode error
 * 2 - usage or schema error
 */
export class CliError extends Error {
  constructor(message: string, readonly exitCode: 1 | 2) {
    super(message);
  }
}

export const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * Read text from a file path, or from stdin when the source is `-`
 */
export const readText = async (source: string, what: string, stdin = readStdin): Promise<string> => {
  if (source === '-') return stdin();
  try {
    return await readFile(source, 'utf8');
  } catch (error) {
    throw new CliError(`could not read ${what} "${source}": ${(error as Error).message}`, 2);
  }
};

export const parseJson = (text: string, what: string, exitCode: 1 | 2): unknown => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`${what} is not valid JSON: ${(error as Error).message}`, exitCode);
  }
};

/**
 * Load a schema from a source, for now only JSON files (or `-` for stdin) are supported
 * @todo 0.5.0 - also accept a densing meta-schema as file, url or string
 */
export const loadSchema = async (source: string, stdin = readStdin): Promise<DenseSchema> => {
  const json = parseJson(await readText(source, 'schema', stdin), 'schema', 2);
  try {
    return schemaFromJson(json);
  } catch (error) {
    throw new CliError((error as Error).message, 2);
  }
};
