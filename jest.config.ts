/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  // Ink + jest's experimental VM-ESM leaves open handles, so jest can hang on
  // exit (worse on Node >= 22). Force it to exit after the run so CI never
  // stalls, and bound any single slow test.
  forceExit: true,
  projects: [
    // ─── Core tests (CommonJS, no Ink) ───────────────────────────────
    {
      displayName: 'core',
      testEnvironment: 'node',
      testTimeout: 30000,
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
      testTimeout: 30000,
      extensionsToTreatAsEsm: ['.ts', '.tsx'],
      testMatch: ['<rootDir>/src/cli/**/*.test.ts', '<rootDir>/src/cli/**/*.test.tsx'],
      testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        // QUARANTINED: views.test renders the full TUI view tree (AnalyzeView /
        // SetupView / RegistryBuildView) through ink-testing-library. Under
        // jest's experimental VM-ESM linker on Node >= 22 it deadlocks at
        // module-link (the modules themselves load fine outside jest, e.g. tsx),
        // hanging CI indefinitely. Quarantined to keep CI reliable; re-enable
        // once the TUI tests move off --experimental-vm-modules.
        // TODO(pelican): migrate ink tests off experimental VM-ESM.
        '<rootDir>/src/cli/__tests__/views.test.tsx',
      ],
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
