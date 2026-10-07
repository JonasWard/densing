import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts', 'cli/src/**/*.ts'],
    ignores: ['src/test/**/*.ts', 'src/meta/**/*.ts', 'cli/src/test/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // nearest tsconfig.json, so the cli uses its own
        project: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'error'
    }
  },
  {
    files: ['src/test/**/*.ts', 'cli/src/test/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tseslint
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'error'
    }
  },
  {
    ignores: ['dist/**', 'cli/dist/**', 'node_modules/**', '*.js', 'benchmark.ts']
  }
];
