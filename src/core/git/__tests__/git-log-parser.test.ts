import { parseGitLog } from '@/core/git/git-log-parser';
import { IFileGitHistory } from '@/types/git';

/** Build one commit record as the NUL-prefixed `%x00%ct` + name-status lines. */
const rec = (ts: number, ...statusLines: string[]) => `\x00${ts}\n\n${statusLines.join('\n')}\n`;

const tsOf = (h: IFileGitHistory | undefined) => h?.commits.map((c) => c.ts);

describe('parseGitLog', () => {
  it('extracts createdAt / updatedAt / commit timestamps per file', () => {
    // newest → oldest, as git log emits
    const raw =
      rec(300, 'M\tsrc/a.ts') + rec(200, 'M\tsrc/a.ts', 'A\tsrc/b.ts') + rec(100, 'A\tsrc/a.ts');
    const m = parseGitLog(raw);

    const a = m.get('src/a.ts')!;
    expect(a.createdAt).toBe(100);
    expect(a.updatedAt).toBe(300);
    expect(tsOf(a)).toEqual([300, 200, 100]);

    const b = m.get('src/b.ts')!;
    expect(b.createdAt).toBe(200);
    expect(tsOf(b)).toEqual([200]);
  });

  it('records each commit size = number of files that commit touched', () => {
    // commit @200 touches two files → size 2; the others touch one → size 1
    const raw =
      rec(300, 'M\tsrc/a.ts') + rec(200, 'M\tsrc/a.ts', 'A\tsrc/b.ts') + rec(100, 'A\tsrc/a.ts');
    const a = parseGitLog(raw).get('src/a.ts')!;

    expect(a.commits).toEqual([
      { ts: 300, size: 1 },
      { ts: 200, size: 2 },
      { ts: 100, size: 1 },
    ]);
    // deletes count toward a commit's size even though they create no entry
    const big = parseGitLog(rec(500, 'M\tsrc/a.ts', 'D\tsrc/x.ts', 'D\tsrc/y.ts')).get('src/a.ts')!;
    expect(big.commits[0]).toEqual({ ts: 500, size: 3 });
  });

  it('follows a rename so pre-rename history rolls into the current name', () => {
    const raw =
      rec(300, 'R100\tsrc/old.ts\tsrc/new.ts') +
      rec(200, 'M\tsrc/old.ts') +
      rec(100, 'A\tsrc/old.ts');
    const m = parseGitLog(raw);

    expect(m.has('src/old.ts')).toBe(false);
    const n = m.get('src/new.ts')!;
    expect(n.createdAt).toBe(100);
    expect(n.updatedAt).toBe(300);
    expect(tsOf(n)).toEqual([300, 200, 100]);
  });

  it('chains multiple renames a → b → c', () => {
    const raw = rec(300, 'R100\tb.ts\tc.ts') + rec(200, 'R100\ta.ts\tb.ts') + rec(100, 'A\ta.ts');
    const m = parseGitLog(raw);

    expect([...m.keys()]).toEqual(['c.ts']);
    expect(tsOf(m.get('c.ts'))).toEqual([300, 200, 100]);
  });

  it('preserves paths containing spaces (e.g. cypress dirs)', () => {
    const raw = rec(100, 'A\tcypress/e2e/03 Device Groups/foo.cy.ts');
    const m = parseGitLog(raw);

    expect(m.get('cypress/e2e/03 Device Groups/foo.cy.ts')?.createdAt).toBe(100);
  });

  it('ignores deletes and tolerates empty input', () => {
    expect(parseGitLog('').size).toBe(0);
    expect(parseGitLog(rec(100, 'D\tsrc/gone.ts')).has('src/gone.ts')).toBe(false);
  });

  it('records a copy destination as touched', () => {
    const m = parseGitLog(rec(100, 'C100\tsrc/src.ts\tsrc/copy.ts'));
    expect(m.get('src/copy.ts')?.createdAt).toBe(100);
    expect(m.has('src/src.ts')).toBe(false);
  });
});
