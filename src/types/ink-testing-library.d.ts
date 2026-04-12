/**
 * Ambient module declaration for ink-testing-library.
 *
 * ink-testing-library@4 only exposes types via the package.json "exports"
 * field, which is not reliably resolved across all TypeScript/ts-jest
 * environments. This declaration provides a fallback so the module is
 * always found.
 */
declare module 'ink-testing-library' {
  import type { ReactElement } from 'react';

  interface Instance {
    rerender: (tree: ReactElement) => void;
    unmount: () => void;
    cleanup: () => void;
    stdout: {
      readonly frames: string[];
      lastFrame: () => string | undefined;
      write: (frame: string) => void;
    };
    stderr: {
      readonly frames: string[];
      lastFrame: () => string | undefined;
      write: (frame: string) => void;
    };
    stdin: {
      write: (data: string) => void;
    };
    frames: string[];
    lastFrame: () => string | undefined;
  }

  export const render: (tree: ReactElement) => Instance;
  export const cleanup: () => void;
}
