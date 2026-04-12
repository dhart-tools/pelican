/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  projects: [
    // ─── Core tests (CommonJS, no Ink) ───────────────────────────────
    {
      displayName: 'core',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
      testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '<rootDir>/src/cli/',
      ],
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {
          useESM: true,
        }],
      },
    },
    // ─── CLI tests (ESM, uses Ink) ────────────────────────────────────
    {
      displayName: 'cli',
      testEnvironment: 'node',
      extensionsToTreatAsEsm: ['.ts', '.tsx'],
      testMatch: ['<rootDir>/src/cli/**/*.test.ts', '<rootDir>/src/cli/**/*.test.tsx'],
      testPathIgnorePatterns: ['/node_modules/', '/dist/'],
      moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      transformIgnorePatterns: [
        'node_modules/(?!(ink|ink-spinner|ink-testing-library|ansi-escapes|cli-cursor|restore-cursor|onetime|chalk|strip-ansi|ansi-regex|is-unicode-supported|widest-line|string-width|wrap-ansi)/)',
      ],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', {
          useESM: true,
          tsconfig: 'tsconfig.test.json',
        }],
      },
    },
  ],
};
