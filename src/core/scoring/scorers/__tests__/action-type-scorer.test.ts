import { ActionTypeScorer } from '@/core/scoring/scorers/action-type-scorer';
import { IScorerContext } from '@/types';

describe('ActionTypeScorer', () => {
  let scorer: ActionTypeScorer;

  beforeEach(() => {
    scorer = new ActionTypeScorer();
  });

  function buildContext(args: {
    changedActions: string[];
    testActions: string[];
    actionTypeIndex?: Map<string, Set<string>>;
  }): IScorerContext {
    const changedFile = 'src/reducers/channels.ts';
    const testFile = 'src/reducers/channels.test.ts';
    const files = new Map([
      [changedFile, { actionTypeStrings: args.changedActions } as any],
      [testFile, { actionTypeStrings: args.testActions } as any],
    ]);
    const registry = {
      getFile: (p: string) => files.get(p),
      getActionTypeIndex: () => args.actionTypeIndex ?? new Map<string, Set<string>>(),
    };
    return { registry, changedFile, testFile } as any as IScorerContext;
  }

  test('fires when both sides share an action type', () => {
    const ctx = buildContext({
      changedActions: ['RECEIVED_CHANNEL', 'LEAVE_CHANNEL'],
      testActions: ['RECEIVED_CHANNEL'],
    });
    const [signal] = scorer.evaluate('src/reducers/channels.ts', 'src/reducers/channels.test.ts', ctx);
    expect(signal.matched).toBe(true);
    expect(signal.reason).toContain('RECEIVED_CHANNEL');
  });

  test('does not fire when no overlap', () => {
    const ctx = buildContext({
      changedActions: ['RECEIVED_CHANNEL'],
      testActions: ['LOGIN_SUCCESS'],
    });
    const [signal] = scorer.evaluate('src/reducers/channels.ts', 'src/reducers/channels.test.ts', ctx);
    expect(signal.matched).toBe(false);
  });

  test('skips action types that appear in too many files (generic noise)', () => {
    const owners = new Set<string>();
    for (let i = 0; i < 50; i++) owners.add(`file${i}.ts`);
    const ctx = buildContext({
      changedActions: ['LOGOUT_SUCCESS'],
      testActions: ['LOGOUT_SUCCESS'],
      actionTypeIndex: new Map([['LOGOUT_SUCCESS', owners]]),
    });
    const [signal] = scorer.evaluate('src/reducers/channels.ts', 'src/reducers/channels.test.ts', ctx);
    expect(signal.matched).toBe(false);
  });

  test('returns no-match when one side has no action types at all', () => {
    const ctx = buildContext({ changedActions: [], testActions: ['RECEIVED_CHANNEL'] });
    const [signal] = scorer.evaluate('src/reducers/channels.ts', 'src/reducers/channels.test.ts', ctx);
    expect(signal.matched).toBe(false);
    expect(signal.reason).toContain('No action-type strings');
  });
});
