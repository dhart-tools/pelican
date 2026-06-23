import {
  ISuggestionExclusionRule,
  SUGGESTION_EXCLUSION_RULES,
  findSuggestionExclusion,
  isExcludedFromSuggestions,
  partitionSuggestableTests,
} from '@/core/registry/suggestion-exclusions';

describe('suggestion-exclusions', () => {
  describe('default rules (InterOps + dmSanity)', () => {
    it('excludes specs under an InterOps folder regardless of numeric prefix', () => {
      expect(
        isExcludedFromSuggestions('bic-unity-dm-tests/cypress/e2e/ims/05 InterOps/alerts.cy.ts'),
      ).toBe(true);
      expect(isExcludedFromSuggestions('cypress/e2e/InterOps/apr.cy.ts')).toBe(true);
    });

    it('matches InterOps case-insensitively', () => {
      expect(isExcludedFromSuggestions('e2e/05 interops/autodoc.cy.ts')).toBe(true);
    });

    it('excludes dmSanity.cy.ts by basename anywhere', () => {
      expect(isExcludedFromSuggestions('cypress/e2e/ims/dmSanity.cy.ts')).toBe(true);
      expect(isExcludedFromSuggestions('dmSanity.cy.ts')).toBe(true);
    });

    it('handles Windows-style separators', () => {
      expect(isExcludedFromSuggestions('cypress\\e2e\\05 InterOps\\alerts.cy.ts')).toBe(true);
    });

    it('does not exclude ordinary feature specs', () => {
      expect(isExcludedFromSuggestions('cypress/e2e/01 HomePage/homePage1.cy.ts')).toBe(false);
      expect(isExcludedFromSuggestions('cypress/e2e/03 Device Groups/moveDevice.cy.ts')).toBe(
        false,
      );
    });

    it('does not partial-match dmSanity against similarly named specs', () => {
      // basename rule is exact — a different file must not be caught.
      expect(isExcludedFromSuggestions('cypress/e2e/dmSanityHelpers.cy.ts')).toBe(false);
    });
  });

  describe('findSuggestionExclusion', () => {
    it('returns the matching rule so callers can log why', () => {
      const rule = findSuggestionExclusion('e2e/05 InterOps/apr.cy.ts');
      expect(rule?.id).toBe('interops-specs');
      expect(rule?.reason).toMatch(/separate cadence/i);
    });

    it('returns undefined for allowed specs', () => {
      expect(findSuggestionExclusion('e2e/homePage.cy.ts')).toBeUndefined();
    });
  });

  describe('partitionSuggestableTests', () => {
    it('splits kept vs excluded and preserves order of kept', () => {
      const input = [
        'e2e/01 HomePage/homePage1.cy.ts',
        'e2e/05 InterOps/alerts.cy.ts',
        'e2e/dmSanity.cy.ts',
        'e2e/03 Device Groups/moveDevice.cy.ts',
      ];
      const { kept, excluded } = partitionSuggestableTests(input);
      expect(kept).toEqual([
        'e2e/01 HomePage/homePage1.cy.ts',
        'e2e/03 Device Groups/moveDevice.cy.ts',
      ]);
      expect(excluded.map((e) => e.rule.id).sort()).toEqual(['dm-sanity', 'interops-specs']);
    });
  });

  describe('custom rules (future extensibility)', () => {
    it('accepts caller-supplied rules without touching the defaults', () => {
      const rules: ISuggestionExclusionRule[] = [
        { id: 'perf', reason: 'perf suite', pathSegment: 'performance' },
      ];
      expect(isExcludedFromSuggestions('e2e/performance/load.cy.ts', rules)).toBe(true);
      // Default InterOps rule is NOT in effect when custom rules are passed.
      expect(isExcludedFromSuggestions('e2e/05 InterOps/apr.cy.ts', rules)).toBe(false);
    });
  });

  it('every default rule is documented with an id and reason', () => {
    for (const rule of SUGGESTION_EXCLUSION_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.reason.length).toBeGreaterThan(10);
      expect(Boolean(rule.pathSegment) || Boolean(rule.fileName)).toBe(true);
    }
  });
});
