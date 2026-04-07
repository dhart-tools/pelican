/**
 * Standard exit codes for the suggestor CLI.
 * Used for reliable CI/CD integration.
 */
export const EXIT_CODES = {
  /** Analysis ran successfully and tests were suggested */
  SUCCESS: 0,
  /** Analysis ran successfully but no tests matched */
  NO_TESTS_FOUND: 0,
  /** No changed files detected */
  NO_CHANGED_FILES: 0,
  /** Git command failed */
  ERROR_GIT: 2,
  /** Config file could not be parsed or found */
  ERROR_CONFIG: 3,
  /** Registry build failed */
  ERROR_REGISTRY: 4,
  /** Unexpected execution error */
  ERROR_UNKNOWN: 1,
} as const;

export type TExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
