import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GitHistoryProvider, defaultGitRunner } from '@/core/git/git-history-provider';
import { IGitRunner } from '@/types/git';

describe('GitHistoryProvider — degradation & caching (fake runner)', () => {
  it('non-repo → unavailable, empty, and never logs', async () => {
    let logged = false;
    const runner: IGitRunner = {
      probe: async () => ({ isRepo: false, isShallow: false }),
      logRaw: async () => {
        logged = true;
        return '';
      },
    };
    const h = await new GitHistoryProvider(runner).getHistory('/nope');
    expect(h.available).toBe(false);
    expect(h.files.size).toBe(0);
    expect(logged).toBe(false);
  });

  it('shallow clone → unavailable, and skips the log entirely', async () => {
    let logged = false;
    const runner: IGitRunner = {
      probe: async () => ({ isRepo: true, isShallow: true }),
      logRaw: async () => {
        logged = true;
        return '';
      },
    };
    const h = await new GitHistoryProvider(runner).getHistory('/shallow');
    expect(h.available).toBe(false);
    expect(logged).toBe(false);
  });

  it('caches per repo — probe and log run once across repeated calls', async () => {
    let probes = 0;
    let logs = 0;
    const runner: IGitRunner = {
      probe: async () => {
        probes++;
        return { isRepo: true, isShallow: false };
      },
      logRaw: async () => {
        logs++;
        return '\x00100\n\nA\tx.ts\n';
      },
    };
    const provider = new GitHistoryProvider(runner);
    const a = await provider.getHistory('/repo');
    const b = await provider.getHistory('/repo');
    expect(a).toBe(b); // same cached object
    expect(a.files.get('x.ts')?.createdAt).toBe(100);
    expect(probes).toBe(1);
    expect(logs).toBe(1);
  });
});

describe('GitHistoryProvider — real synthetic git repo', () => {
  let repo: string;
  const run = (args: string[], env?: Record<string, string>) =>
    execFileSync('git', args, { cwd: repo, env: { ...process.env, ...env } });

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pelican-git-'));
    run(['init', '-q']);
    run(['config', 'user.email', 'test@pelican.dev']);
    run(['config', 'user.name', 'pelican']);
    run(['config', 'commit.gpgsign', 'false']);

    const at = (date: string) => ({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });

    fs.writeFileSync(path.join(repo, 'a.ts'), 'v1');
    run(['add', 'a.ts']);
    run(['commit', '-q', '-m', 'add a'], at('2021-01-01T00:00:00 +0000'));

    fs.writeFileSync(path.join(repo, 'a.ts'), 'v2');
    run(['add', 'a.ts']);
    run(['commit', '-q', '-m', 'edit a'], at('2021-06-01T00:00:00 +0000'));

    run(['mv', 'a.ts', 'b.ts']);
    run(['commit', '-q', '-m', 'rename a -> b'], at('2022-01-01T00:00:00 +0000'));
  });

  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('mines creation, update, and rename-followed history', async () => {
    const h = await new GitHistoryProvider(defaultGitRunner).getHistory(repo);
    expect(h.available).toBe(true);

    const b = h.files.get('b.ts');
    expect(b).toBeDefined();
    expect(b!.commits).toHaveLength(3); // add + edit + rename, all folded in
    expect(new Date(b!.createdAt * 1000).getUTCFullYear()).toBe(2021);
    expect(new Date(b!.updatedAt * 1000).getUTCFullYear()).toBe(2022);
    expect(b!.createdAt).toBeLessThan(b!.updatedAt);

    // pre-rename name is gone — history rolled into the current name
    expect(h.files.has('a.ts')).toBe(false);
  });

  it('a directory with no git → unavailable (no throw)', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pelican-nogit-'));
    try {
      const h = await new GitHistoryProvider(defaultGitRunner).getHistory(bare);
      expect(h.available).toBe(false);
      expect(h.files.size).toBe(0);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
