import { execSync } from 'child_process';
import * as path from 'path';

import { findChangedFiles, getRepoRoot, GitError } from '../git';

jest.mock('child_process');

describe('Git Change Detection', () => {
  const mockRepoRoot = path.resolve('/mock/root');

  beforeEach(() => {
    jest.resetAllMocks();
    // Default mocks for standard git environment
    (execSync as jest.Mock).mockImplementation((cmd) => {
      if (cmd.includes('rev-parse --show-toplevel')) return mockRepoRoot;
      if (cmd.includes('rev-parse HEAD~1')) return 'deadbeef';
      return '';
    });
  });

  /**
   * @description Verifies that the analyzer correctly lists staged, unstaged, and untracked files.
   *
   * @example
   * // Mocked git outputs:
   * // committed: src/committed.ts
   * // staged: src/staged.ts
   * // unstaged: src/unstaged.ts
   * // untracked: src/untracked.ts
   *
   * @expected Expects all four files to be present in the returned array as absolute paths.
   */
  test('findChangedFiles(): should unify staged, unstaged, and untracked files', async () => {
    (execSync as jest.Mock).mockImplementation((cmd) => {
      if (cmd.includes('rev-parse --show-toplevel')) return mockRepoRoot;
      if (cmd.includes('rev-parse HEAD~1')) return 'deadbeef';

      if (cmd.includes('diff --name-status')) {
        if (cmd.includes('HEAD~1...HEAD')) return 'M\tsrc/committed.ts';
        if (cmd.includes('--cached HEAD')) return 'A\tsrc/staged.ts';
        return 'M\tsrc/unstaged.ts';
      }

      if (cmd.includes('ls-files --others')) return 'src/untracked.ts';

      return '';
    });

    const files = await findChangedFiles();

    expect(files).toContain(path.resolve(mockRepoRoot, 'src/committed.ts'));
    expect(files).toContain(path.resolve(mockRepoRoot, 'src/staged.ts'));
    expect(files).toContain(path.resolve(mockRepoRoot, 'src/unstaged.ts'));
    expect(files).toContain(path.resolve(mockRepoRoot, 'src/untracked.ts'));
  });

  /**
   * @description Validates handling of renamed files by capturing the new file path.
   *
   * @example
   * // Git status: R100 src/old-name.ts src/new-name.ts
   *
   * @expected Expects 'src/new-name.ts' to be in the list, and 'src/old-name.ts' to be excluded.
   */
  test('findChangedFiles(): should resolve new name for git renames', async () => {
    (execSync as jest.Mock).mockImplementation((cmd) => {
      if (cmd.includes('rev-parse --show-toplevel')) return mockRepoRoot;
      if (cmd.includes('rev-parse HEAD~1')) return 'deadbeef';
      if (cmd.includes('diff --name-status')) {
        return 'R100\tsrc/old-name.ts\tsrc/new-name.ts';
      }
      return '';
    });

    const files = await findChangedFiles();

    expect(files).toContain(path.resolve(mockRepoRoot, 'src/new-name.ts'));
    expect(files).not.toContain(path.resolve(mockRepoRoot, 'src/old-name.ts'));
  });

  /**
   * @description Ensures the analyzer ignores deleted files and filters out unsupported extensions.
   *
   * @example
   * // Status: D src/deleted.ts, M src/style.css, M src/image.png
   *
   * @expected Expects only 'src/style.css' to be included.
   */
  test('findChangedFiles(): should filter out deleted files and non-source extensions', async () => {
    (execSync as jest.Mock).mockImplementation((cmd) => {
      if (cmd.includes('rev-parse --show-toplevel')) return mockRepoRoot;
      if (cmd.includes('rev-parse HEAD~1')) return 'deadbeef';
      if (cmd.includes('diff --name-status')) {
        return 'D\tsrc/deleted.ts\nM\tsrc/style.css\nM\tsrc/image.png';
      }
      return '';
    });

    const files = await findChangedFiles();

    expect(files).toContain(path.resolve(mockRepoRoot, 'src/style.css'));
    expect(files).not.toContain(path.resolve(mockRepoRoot, 'src/deleted.ts'));
    expect(files).not.toContain(path.resolve(mockRepoRoot, 'src/image.png'));
  });

  /**
   * @description Verifies fallback to the empty tree SHA for brand new repositories with only one commit.
   *
   * @expected Expects the analyzer to diff against the empty tree SHA when HEAD~1 is invalid.
   */
  test('getBaseRef(): should fallback to empty tree SHA if HEAD~1 is invalid', async () => {
    (execSync as jest.Mock).mockImplementation((cmd) => {
      if (cmd.includes('rev-parse --show-toplevel')) return mockRepoRoot;
      if (cmd.includes('rev-parse HEAD~1')) throw new Error('Invalid ref');
      if (cmd.includes('diff --name-status 4b825dc642cb6eb9a060e54bf8d69288fbee4904...HEAD')) {
        return 'A\tsrc/first.ts';
      }
      return '';
    });

    const files = await findChangedFiles();
    expect(files).toContain(path.resolve(mockRepoRoot, 'src/first.ts'));
  });

  /**
   * @description Validates that GitError is thrown if the directory is not a git repository.
   *
   * @expected Expects a GitError with a descriptive message.
   */
  test('getRepoRoot(): should throw GitError if git command fails', () => {
    (execSync as jest.Mock).mockImplementation(() => {
      throw new Error();
    });

    expect(() => getRepoRoot()).toThrow(GitError);
  });
});
