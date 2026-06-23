import { applyAnchorGate, hasAnchor } from '@/core/scoring/anchor-gate';
import { ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

function sig(type: string, matched = true, weight = 0.7): ISignal {
  return { source: 'test', type, weight, matched, reason: `${type} reason` };
}

describe('anchor-gate', () => {
  describe('hasAnchor', () => {
    it('true when a narrow anchor (filename/colocation/direct-import) matched', () => {
      expect(hasAnchor([sig(EScorerType.FILENAME_MATCH)], { changedIsHub: false })).toBe(true);
      expect(hasAnchor([sig(EScorerType.COLOCATION)], { changedIsHub: true })).toBe(true);
      expect(hasAnchor([sig(EScorerType.DIRECT_IMPORT)], { changedIsHub: true })).toBe(true);
    });

    it('false when only weak/domain signals matched', () => {
      const signals = [
        sig(EScorerType.REDUX_CHAIN),
        sig(EScorerType.DESCRIBE_BLOCK),
        sig(EScorerType.ACTION_TYPE),
      ];
      expect(hasAnchor(signals, { changedIsHub: false })).toBe(false);
    });

    it('counts a medium anchor only when the changed file is NOT a hub', () => {
      const routeOnly = [sig(EScorerType.ROUTE_MATCH)];
      expect(hasAnchor(routeOnly, { changedIsHub: false })).toBe(true);
      expect(hasAnchor(routeOnly, { changedIsHub: true })).toBe(false);
    });

    it('ignores unmatched signals', () => {
      expect(hasAnchor([sig(EScorerType.FILENAME_MATCH, false)], { changedIsHub: false })).toBe(
        false,
      );
    });
  });

  describe('applyAnchorGate', () => {
    it('returns signals unchanged when an anchor is present', () => {
      const signals = [sig(EScorerType.FILENAME_MATCH), sig(EScorerType.REDUX_CHAIN)];
      const gated = applyAnchorGate(signals, { changedIsHub: false });
      expect(gated).toBe(signals); // same reference — untouched
    });

    it('suppresses all matched signals when no anchor is present', () => {
      const signals = [sig(EScorerType.REDUX_CHAIN), sig(EScorerType.DESCRIBE_BLOCK)];
      const gated = applyAnchorGate(signals, { changedIsHub: false });
      expect(gated.every((s) => !s.matched)).toBe(true);
      expect(gated[0].reason).toMatch(/no anchor signal/);
      // input not mutated
      expect(signals.every((s) => s.matched)).toBe(true);
    });

    it('suppresses a hub route-only match (the Router-flood case)', () => {
      const signals = [sig(EScorerType.ROUTE_MATCH), sig(EScorerType.DESCRIBE_BLOCK)];
      const gated = applyAnchorGate(signals, { changedIsHub: true });
      expect(gated.every((s) => !s.matched)).toBe(true);
    });

    it('keeps a hub match that also has a narrow anchor (barrel own unit test)', () => {
      const signals = [sig(EScorerType.COLOCATION), sig(EScorerType.TRANSITIVE_IMPORT)];
      const gated = applyAnchorGate(signals, { changedIsHub: true });
      expect(gated).toBe(signals);
    });
  });
});
