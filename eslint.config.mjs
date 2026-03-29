import js from '@eslint/js';
import typescriptEslintPlugin from '@typescript-eslint/eslint-plugin';
import typescriptEslintParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: typescriptEslintParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslintPlugin,
      'import': importPlugin,
      'prettier': prettierPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.json',
          extensions: ['.ts', '.tsx'],
        },
      },
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
      'import/no-relative-parent-imports': 'off',
      'import/order': [
        'error',
        {
          'groups': ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          'alphabetize': { 'order': 'asc', 'caseInsensitive': true }
        }
      ],
      '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['src/v2/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          'patterns': [
            {
              'group': ['../*'],
              'message': 'Use path aliases (@v2/* or @root/*) instead of relative imports.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/commands/**/*', 'src/core/**/*', 'src/llm/**/*', 'src/ui/**/*'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'import/no-relative-parent-imports': 'off',
    }
  },
  {
    ignores: ['node_modules', 'dist', 'scripts', 'jest.config.js', 'cypress.config.ts', 'eslint.config.mjs'],
  }
];
