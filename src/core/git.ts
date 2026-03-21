import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { readFile } from "fs/promises";
import type { IGitChanges } from "../types.js";

const execFileAsync = promisify(execFile);

export class GitService {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  private async execGit(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", args, { cwd: this.cwd });
      return stdout.trim();
    } catch (error: any) {
      const stderr = error.stderr?.toString() || "";
      if (stderr.includes("not a git repository")) {
        throw new Error("Not a git repository. Run 'git init' first.");
      }
      if (stderr.includes("fatal: ambiguous argument 'HEAD'")) {
        throw new Error("No commits found. Make an initial commit first.");
      }
      throw new Error(`Git command failed: git ${args.join(" ")} — ${stderr}`);
    }
  }

  async isGitRepo(): Promise<boolean> {
    try {
      await this.execGit(["rev-parse", "--is-inside-work-tree"]);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentSha(): Promise<string> {
    return this.execGit(["rev-parse", "HEAD"]);
  }

  async getChangedFilesSinceSha(sha: string): Promise<string[]> {
    let stdout: string;
    if (!sha) {
      stdout = await this.execGit(["ls-files"]);
    } else {
      stdout = await this.execGit(["diff", "--name-only", "--diff-filter=ACMR", sha, "HEAD"]);
    }
    return stdout.split("\n").map(f => f.trim()).filter(Boolean);
  }

  async getWorkingChanges(): Promise<IGitChanges> {
    const stagedStdout = await this.execGit(["diff", "--name-only", "--cached", "--diff-filter=ACMR"]);
    const unstagedStdout = await this.execGit(["diff", "--name-only", "--diff-filter=ACMR"]);

    const staged = stagedStdout.split("\n").map(f => f.trim()).filter(Boolean);
    const unstaged = unstagedStdout.split("\n").map(f => f.trim()).filter(Boolean);
    const all = Array.from(new Set([...staged, ...unstaged]));

    return { staged, unstaged, all };
  }

  async getFileDiff(filePath: string): Promise<string> {
    let diff = await this.execGit(["diff", "--", filePath]);
    if (!diff) {
      diff = await this.execGit(["diff", "--cached", "--", filePath]);
    }
    if (!diff) {
      // Might be a new untracked file, or no changes
      try {
        const content = await readFile(join(this.cwd, filePath), "utf-8");
        return content;
      } catch {
        return "";
      }
    }
    return diff;
  }

  async getFileContentSha(filePath: string): Promise<string> {
    try {
      const content = await readFile(join(this.cwd, filePath), "utf-8");
      return createHash("sha256").update(content).digest("hex").slice(0, 12);
    } catch {
      return "";
    }
  }

  async getAllTrackedFiles(): Promise<string[]> {
    const stdout = await this.execGit(["ls-files"]);
    return stdout.split("\n").map(f => f.trim()).filter(Boolean);
  }
}

import { join } from "path";
