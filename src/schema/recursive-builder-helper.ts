import { DenseField } from '../schema-type';
import { int, enumeration, union, schema } from './builder';
import { undensing, densing } from '../densing';

/**
 * Helper function to create a recursive union field with a specified max depth.
 * This allows you to define the structure ONCE and it gets expanded automatically.
 */
export const createRecursiveUnion = (
  name: string,
  discriminatorOptions: readonly string[],
  createVariants: (recurse: (fieldName: string, depth?: number) => DenseField) => Record<string, DenseField[]>,
  maxDepth: number,
  currentDepth: number = 0
): DenseField => {
  // Base case: at max depth, create terminal variants only
  if (currentDepth >= maxDepth) {
    // Get variants but with recursion disabled (returns dummy or simplified version)
    const terminalVariants = createVariants((fieldName: string) => {
      // Return a dummy field that satisfies enum requirement
      return union(fieldName, enumeration('type', ['end', 'dummy']), {
        end: [],
        dummy: []
      });
    });

    return union(name, enumeration('type', discriminatorOptions), terminalVariants);
  }

  // Recursive case: create variants with recursion enabled
  const recursiveVariants = createVariants((fieldName: string, depth = currentDepth + 1) => {
    return createRecursiveUnion(fieldName, discriminatorOptions, createVariants, maxDepth, depth);
  });

  return union(name, enumeration('type', discriminatorOptions), recursiveVariants);
};
