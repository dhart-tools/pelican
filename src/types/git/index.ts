/**
 * Per-file git history, mined once per repository. Timestamps are unix seconds
 * (committer date). Consumed by the temporal-coherence scorer to reason about
 * when files were created and how often they change together.
 */
/** One commit that touched a file: when, and how many files it changed. */
export interface IFileCommit {
  /** Committer timestamp, unix seconds. */
  ts: number;
  /** Total files this commit touched. Lets coupling ignore bulk/refactor
   * commits (migrations, mass formatting) that aren't logical co-changes. */
  size: number;
}

export interface IFileGitHistory {
  /** Earliest commit touching this file, rename-followed. Unix seconds. */
  createdAt: number;
  /** Most recent commit touching this file. Unix seconds. */
  updatedAt: number;
  /** Every commit that touched this file, newest first. */
  commits: IFileCommit[];
}

/**
 * History for one repository. `files` is keyed by repo-relative path (forward
 * slashes), matching the registry's normalized keys. `available` is false when
 * the repo can't be mined (no git, shallow clone, or empty history) — callers
 * must treat that as "no signal", never as an error.
 */
export interface IRepoGitHistory {
  repoRoot: string;
  available: boolean;
  files: Map<string, IFileGitHistory>;
}

/** Result of probing a directory for git usability. */
export interface IGitProbe {
  isRepo: boolean;
  isShallow: boolean;
}

/**
 * The thin IO surface the provider depends on. The default implementation
 * shells out to `git`; tests inject a fake that returns canned strings, so the
 * pure parsing logic is exercised without touching a real repo.
 */
export interface IGitRunner {
  probe(repoRoot: string): Promise<IGitProbe>;
  logRaw(repoRoot: string): Promise<string>;
}
