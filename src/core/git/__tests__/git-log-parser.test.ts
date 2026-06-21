import { parseGitLog } from '@/core/git/git-log-parser';

/** Build one commit record as the NUL-prefixed `%x00%ct` + name-status lines. */
const rec = (ts: number, ...statusLines: string[]) => `\x00${ts}\n\n${statusLines.join('\n')}\n`;

describe('parseGitLog', () => {
  it('extracts createdAt / updatedAt / commitTimes per file', () => {
    // newest → oldest, as git log emits
    const raw =
      rec(300, 'M\tsrc/a.ts') + rec(200, 'M\tsrc/a.ts', 'A\tsrc/b.ts') + rec(100, 'A\tsrc/a.ts');
    const m = parseGitLog(raw);

    expect(m.get('src/a.ts')).toEqual({
      createdAt: 100,
      updatedAt: 300,
      commitTimes: [300, 200, 100],
    });
    expect(m.get('src/b.ts')).toEqual({ createdAt: 200, updatedAt: 200, commitTimes: [200] });
  });

  it('follows a rename so pre-rename history rolls into the current name', () => {
    const raw =
      rec(300, 'R100\tsrc/old.ts\tsrc/new.ts') +
      rec(200, 'M\tsrc/old.ts') +
      rec(100, 'A\tsrc/old.ts');
    const m = parseGitLog(raw);

    expect(m.has('src/old.ts')).toBe(false);
    expect(m.get('src/new.ts')).toEqual({
      createdAt: 100,
      updatedAt: 300,
      commitTimes: [300, 200, 100],
    });
  });

  it('chains multiple renames a → b → c', () => {
    const raw = rec(300, 'R100\tb.ts\tc.ts') + rec(200, 'R100\ta.ts\tb.ts') + rec(100, 'A\ta.ts');
    const m = parseGitLog(raw);

    expect([...m.keys()]).toEqual(['c.ts']);
    expect(m.get('c.ts')).toEqual({ createdAt: 100, updatedAt: 300, commitTimes: [300, 200, 100] });
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
