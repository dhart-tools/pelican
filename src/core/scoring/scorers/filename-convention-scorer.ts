import path from 'path';

import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

const TEST_SUFFIX_RE = /\.(cy|spec|test|e2e|int|integration|unit|bench|stories)\.(ts|js)x?$/i;
const SOURCE_EXT_RE = /\.(tsx?|jsx?|mts|cts|mjs|cjs|vue|svelte|astro)$/i;
const INDEX_BASENAMES = new Set(['index', 'main', 'default', 'entry']);

// Generic basenames that appear all over the codebase (utils.ts, types.ts, etc.)
// An identical match on these is nearly meaningless — every dir has its own.
// Require the colocation scorer or import-graph to carry the signal instead.
const GENERIC_BASENAMES = new Set([
  'utils', 'util', 'helpers', 'helper', 'types', 'type', 'constants', 'const',
  'config', 'configs', 'defaults', 'common', 'shared', 'hooks', 'styles',
  'style', 'theme', 'misc', 'errors', 'validation', 'validators', 'fixtures',
  'mocks', 'queries', 'mutations', 'selectors', 'actions', 'reducers',
  'handlers', 'data', 'api', 'model', 'models', 'service', 'services',
]);

const STOPWORDS = new Set([
  'test',
  'tests',
  'spec',
  'specs',
  'it',
  'should',
  'describe',
  'when',
  'given',
  'e2e',
  'unit',
  'integration',
  'int',
  'bench',
  'stories',
  'story',
  'fixture',
  'fixtures',
  'mock',
  'mocks',
  'cy',
  'cypress',
  'page',
  'pages',
  'component',
  'components',
  'container',
  'containers',
  'the',
]);

const MIN_TOKEN_LEN = 2;
const MATCH_THRESHOLD = 0.5;

export class FilenameConventionScorer extends BaseScorer {
  constructor() {
    super(getScorerConfig(EScorerType.FILENAME_MATCH));
  }

  evaluate(changedFile: string, testFile: string, _context: IScorerContext): ISignal[] {
    const changedBase = this.basenameTokens(changedFile, false);
    const testBase = this.basenameTokens(testFile, true);

    const changedParent = this.parentDirTokens(changedFile, false);
    const testParent = this.parentDirTokens(testFile, true);

    // Fast path: exact normalized basename equality (high-confidence match).
    const normalizedChanged = changedBase.join('');
    const normalizedTest = testBase.join('');
    if (normalizedChanged.length > 0 && normalizedChanged === normalizedTest) {
      const isGeneric =
        GENERIC_BASENAMES.has(normalizedChanged) ||
        (changedBase.length === 1 && GENERIC_BASENAMES.has(changedBase[0]));
      const sig = this.createSignal(
        true,
        isGeneric
          ? `Identical generic basename (weak): ${changedBase.join('-')}`
          : `Identical basename: ${changedBase.join('-')} ↔ ${testBase.join('-')}`,
        { changedFile, testFile, jaccard: 1, identical: true, generic: isGeneric },
      );
      // Non-generic basenames are a strong signal; generic ones (`utils`, `index`,
      // `types`) are near-useless because every directory has its own — let
      // colocation or imports carry the decision instead.
      sig.weight = isGeneric ? this.weight * 0.2 : Math.max(this.weight, 0.95);
      return [sig];
    }

    // Ancestor-dir match: test path contains changed-file basename as a directory
    // segment (e.g. `cypress/e2e/FileManager/basic.cy.ts` ↔ `FileManager.tsx`).
    if (normalizedChanged.length >= 3 && this.pathContainsSegment(testFile, changedBase)) {
      const sig = this.createSignal(
        true,
        `Test path contains source basename as ancestor dir: ${changedBase.join('-')}`,
        { changedFile, testFile, ancestorDirMatch: true },
      );
      sig.weight = this.weight * 0.85;
      return [sig];
    }

    if (changedBase.length === 0 || testBase.length === 0) {
      return [this.createSignal(false, 'No tokens extracted from filename')];
    }

    // Strong-match gate: use BASENAME tokens only. Parent-dir tokens are
    // weaker context and cannot trigger a match on their own — otherwise
    // `src/auth/PasswordInput.tsx` would "match" `cypress/e2e/auth/login.cy.ts`
    // just because both live under `auth/`.
    const exactBaseIntersection = changedBase.filter((t) => testBase.includes(t));

    // Containment fallback: human-written test names often fail to honor
    // camelCase boundaries (e.g. `addFacilityandDeviceGroup…`). Without caps
    // between `y` and `a`, the tokenizer sees `facilityand` as one token, so
    // exact intersection with source token `facility` fails. When one token
    // fully contains the other (both ≥5 chars), it's a compound-word collision
    // — semantically the same identifier — so count it as a (near-)exact match.
    const fuzzyMatches: string[] = [];
    for (const src of changedBase) {
      if (src.length < 5) continue;
      if (exactBaseIntersection.includes(src)) continue;
      for (const test of testBase) {
        if (test === src) continue;
        if (test.length < 5) continue;
        if (test.includes(src) || src.includes(test)) {
          fuzzyMatches.push(src);
          break;
        }
      }
    }

    // Containment counts 0.9× of exact (tiny hedge for ambiguity like
    // `user` inside `userprofile`) rather than the old 0.6× which buried
    // legit compound-word matches behind cleaner-tokenized competitors.
    const baseIntersection = [...exactBaseIntersection, ...fuzzyMatches];
    const effectiveIntersectionCount = exactBaseIntersection.length + fuzzyMatches.length * 0.9;
    const baseOverlapRatio =
      effectiveIntersectionCount /
      Math.min(new Set(changedBase).size, new Set(testBase).size);
    const hasStrongBaseMatch =
      exactBaseIntersection.some((t) => t.length >= 3) ||
      fuzzyMatches.some((t) => t.length >= 5);

    // Combined set includes parent-dir tokens as weak boosters of the ratio,
    // only counted when a base-token match already exists.
    const changedAll = Array.from(new Set([...changedBase, ...changedParent]));
    const testAll = Array.from(new Set([...testBase, ...testParent]));
    const allIntersection = changedAll.filter((t) => testAll.includes(t));
    const allOverlapRatio =
      allIntersection.length / Math.min(changedAll.length, testAll.length);

    const matched = hasStrongBaseMatch && baseOverlapRatio >= MATCH_THRESHOLD;

    const signal = this.createSignal(
      matched,
      matched
        ? `Filename tokens overlap ${(baseOverlapRatio * 100).toFixed(0)}% on basename [${baseIntersection.join(', ')}] (${changedBase.join('-')} ↔ ${testBase.join('-')})`
        : `Weak filename overlap (base ${baseIntersection.length}, all ${allIntersection.length}): ${changedBase.join('-')} vs ${testBase.join('-')}`,
      {
        changedFile,
        testFile,
        changedBase,
        testBase,
        changedParent,
        testParent,
        baseIntersection,
        baseOverlapRatio,
        allOverlapRatio,
      },
    );

    if (matched) {
      // Graded: start from base overlap, add up to +0.2 bonus if parent-dir
      // tokens also agree (cart/CartSummary ↔ cart/summary).
      const parentBoost = allOverlapRatio > baseOverlapRatio ? 0.2 : 0;
      signal.weight = this.weight * Math.min(1, baseOverlapRatio + parentBoost);
    }

    return [signal];
  }

  private basenameTokens(filePath: string, isTest: boolean): string[] {
    let base: string;
    if (isTest) {
      base = path.basename(filePath).replace(TEST_SUFFIX_RE, '');
    } else {
      base = path.basename(filePath).replace(SOURCE_EXT_RE, '');
    }

    // `fileManager/index.ts` → use parent dir as the effective basename.
    if (INDEX_BASENAMES.has(base.toLowerCase())) {
      base = path.basename(path.dirname(filePath));
    }

    return this.splitTokens(base).filter((t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
  }

  private parentDirTokens(filePath: string, isTest: boolean): string[] {
    // When basename is `index`, parent dir already became the basename.
    const baseLower = path.basename(filePath).replace(isTest ? TEST_SUFFIX_RE : SOURCE_EXT_RE, '').toLowerCase();
    const dir = INDEX_BASENAMES.has(baseLower)
      ? path.dirname(path.dirname(filePath))
      : path.dirname(filePath);
    const name = path.basename(dir);
    if (!name || name === '.' || name === '/') return [];
    return this.splitTokens(name).filter((t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
  }

  private pathContainsSegment(filePath: string, sourceTokens: string[]): boolean {
    if (sourceTokens.length === 0) return false;
    const target = sourceTokens.join('');
    const segments = filePath.split(/[\\/]/).slice(0, -1);
    for (const seg of segments) {
      const segTokens = this.splitTokens(seg).filter(
        (t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t),
      );
      if (segTokens.length === 0) continue;
      if (segTokens.join('') === target) return true;
      // Partial segment match: a directory like `AddAndEditFacility` tokenises
      // to [add, edit, facility]; if the source basename `facility` appears as
      // one of those tokens, the test still lives under a facility-themed
      // ancestor and should count as an ancestor-dir match.
      if (sourceTokens.length === 1 && sourceTokens[0].length >= 5) {
        if (segTokens.includes(sourceTokens[0])) return true;
      }
    }
    return false;
  }

  private splitTokens(raw: string): string[] {
    return raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase → camel Case
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTTPServer → HTTP Server
      .split(/[^a-zA-Z0-9]+/)
      .map((t) => t.toLowerCase())
      .filter(Boolean);
  }
}
