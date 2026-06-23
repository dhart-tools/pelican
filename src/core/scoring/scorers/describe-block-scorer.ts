import path from 'path';

import { BaseScorer } from '@/core/scoring/scorers/base';
import { sharesFeatureDir } from '@/core/scoring/scorers/feature-dir';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

const SOURCE_EXT_RE = /\.(tsx?|jsx?|mts|cts|mjs|cjs|vue|svelte|astro)$/i;
const TEST_SUFFIX_RE = /\.(cy|spec|test|e2e|int|integration|unit|bench|stories)\.(ts|js)x?$/i;
const INDEX_BASENAMES = new Set(['index', 'main', 'default', 'entry']);
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
  'and',
  'or',
  'the',
  'a',
  'an',
  'of',
  'for',
  'with',
  'page',
  'pages',
  'component',
  'components',
  'view',
  'views',
  'e2e',
  'unit',
  'integration',
  'renders',
  'works',
  'shows',
  'displays',
  'handles',
  'cypress',
  // Layer/prefix tokens — structural, not features. `actions/post_actions.ts`
  // should tokenise as [post], not [post, actions]; otherwise the gate treats
  // `post` as a secondary token and demotes every legit post-related spec.
  // Same logic for `use` prefix on React hooks (`useBurnOnReadTimer` → [burn,
  // read, timer]) — `use` is a naming convention, not semantic content.
  'actions',
  'action',
  'reducers',
  'reducer',
  'selectors',
  'selector',
  'hooks',
  'hook',
  'use',
]);
const MIN_TOKEN_LEN = 3;

export class DescribeBlockScorer extends BaseScorer {
  /**
   * Per-token document frequency across all test files' describe/it blocks.
   * Built lazily on first evaluate() and cached for the lifetime of the
   * scorer instance. Rebuilding is cheap (O(tests × blocks) with tokeniser
   * cost) but we only need it once per registry.
   */
  private idf: { byToken: Map<string, number>; totalTests: number } | null = null;

  constructor() {
    super(getScorerConfig(EScorerType.DESCRIBE_BLOCK));
  }

  evaluate(changedFile: string, testFile: string, context: IScorerContext): ISignal[] {
    const blocks = [
      ...(context.testFile.cypress?.describeBlocks ?? []),
      ...(context.testFile.cypress?.itBlocks ?? []),
    ];
    if (blocks.length === 0) {
      return [this.createSignal(false, 'No describe/it blocks')];
    }

    const sourceTokens = new Set(this.sourceBasenameTokens(changedFile));
    if (sourceTokens.size === 0) {
      return [this.createSignal(false, 'No source tokens')];
    }

    const blockTokens = new Set<string>();
    for (const b of blocks) for (const t of this.splitTokens(b)) blockTokens.add(t);

    const hits = [...sourceTokens].filter((t) => blockTokens.has(t));
    let matched = hits.length > 0;

    // IDF weighting: tokens that appear in many specs (`post`, `header`,
    // `card`, `modal`) carry less information than rare ones (`signup`,
    // `backstage`, `burn`). Scale each hit token's contribution by its IDF
    // so a single common-token collision can't fire at full weight.
    this.ensureIdf(context);
    const idfByToken = this.idf!.byToken;
    const idfFor = (t: string): number => idfByToken.get(t) ?? 1; // unseen = treat as rare

    const maxPossibleIdf = [...sourceTokens].reduce((a, t) => a + idfFor(t), 0);
    const hitIdf = hits.reduce((a, t) => a + idfFor(t), 0);
    const idfRatio = maxPossibleIdf > 0 ? hitIdf / maxPossibleIdf : 0;
    const maxHitIdf = hits.length > 0 ? Math.max(...hits.map(idfFor)) : 0;
    const avgHitIdf = hits.length > 0 ? hitIdf / hits.length : 0;

    // Noise cutoff. Each branch kills a distinct FP shape without touching
    // real matches:
    //   1) single hit on a very common token — always coincidence
    //   2) long source basename (4+ tokens) where only a small fraction of
    //      idf-mass was matched — e.g. `cloud_trial_ended_announcement_bar`
    //      hitting just `[cloud,trial]` on a site-config spec
    //   3) entire match is common tokens AND coverage is poor
    //   4) full-coverage match but the source basename itself is entirely
    //      generic — `post_list`, `thread_list`, `error_messages`. Any
    //      post/thread/error spec will hit both tokens by pure coincidence.
    const allHitsCommon = hits.length >= 2 && maxHitIdf < 0.55 && avgHitIdf < 0.5;
    const lowInformationHit =
      (hits.length === 1 && maxHitIdf < 0.35) ||
      (sourceTokens.size >= 4 && idfRatio < 0.4) ||
      (maxHitIdf < 0.45 && idfRatio < 0.5) ||
      (allHitsCommon && idfRatio >= 0.9 && sourceTokens.size <= 2);
    if (lowInformationHit) matched = false;

    // Cross-feature single-token collision guard: one short shared token
    // (`category`, `post`, `channel`…) across unrelated feature dirs
    // (backstage vs channel_sidebar) is almost always a false positive.
    const shareFeature = sharesFeatureDir(changedFile, testFile);
    // Demote only when the hit is a SECONDARY token (source basename has
    // other tokens the test ignored). A test referencing the source's only
    // token is the actual signal we want — e.g. `login.tsx` ↔ a spec whose
    // describe mentions `login`.
    const weakSingleTokenHit = hits.length === 1 && hits[0].length <= 10 && sourceTokens.size > 1;
    const demoted = matched && !shareFeature && weakSingleTokenHit;
    if (demoted) matched = false;

    const reason =
      hits.length === 0
        ? `describe/it blocks don't reference source tokens`
        : lowInformationHit
          ? `Low-information describe collision on [${hits.join(', ')}] (IDF=${maxHitIdf.toFixed(2)}) — dropped`
          : demoted
            ? `Cross-feature describe collision on [${hits.join(', ')}] — demoted`
            : `describe/it blocks mention source tokens [${hits.join(', ')}] (idfRatio=${idfRatio.toFixed(2)})`;

    const sig = this.createSignal(matched, reason, {
      changedFile,
      testFile,
      hits,
      sourceTokens: [...sourceTokens],
      shareFeature,
      demoted,
      idfRatio,
      maxHitIdf,
      lowInformationHit,
    });

    if (matched) {
      // Base 0.6 + up to +0.4 from idf-weighted coverage. A full match on
      // rare tokens keeps weight ≈ 1.0 × this.weight; a mid-information
      // partial (idfRatio ≈ 0.4) lands around 0.76 × this.weight.
      sig.weight = this.weight * Math.min(1, 0.6 + idfRatio * 0.4);
    }

    return [sig];
  }

  private ensureIdf(context: IScorerContext): void {
    if (this.idf) return;
    const registry = context.registry;
    const tests = registry.getFilesByType('test');
    const df = new Map<string, number>();
    for (const t of tests) {
      const blocks = [...(t.cypress?.describeBlocks ?? []), ...(t.cypress?.itBlocks ?? [])];
      if (blocks.length === 0) continue;
      const uniq = new Set<string>();
      for (const b of blocks) for (const tok of this.splitTokens(b)) uniq.add(tok);
      for (const tok of uniq) df.set(tok, (df.get(tok) ?? 0) + 1);
    }

    const N = tests.length || 1;
    const logN = Math.log(N + 1);
    const byToken = new Map<string, number>();
    for (const [tok, freq] of df) {
      // idf ∈ (0, 1]: rare tokens (df=1) ≈ 1.0, token in all tests ≈ 0.
      // Clamp to 0.1 so even ubiquitous tokens retain a sliver of signal
      // (helps recall when nothing else fires).
      const idf = Math.max(0.1, 1 - Math.log(freq) / logN);
      byToken.set(tok, idf);
    }
    this.idf = { byToken, totalTests: N };
  }

  private sourceBasenameTokens(filePath: string): string[] {
    let base = path.basename(filePath).replace(SOURCE_EXT_RE, '').replace(TEST_SUFFIX_RE, '');
    if (INDEX_BASENAMES.has(base.toLowerCase())) {
      base = path.basename(path.dirname(filePath));
    }
    return this.splitTokens(base);
  }

  private splitTokens(raw: string): string[] {
    return raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[^a-zA-Z0-9]+/)
      .map((t) => t.toLowerCase())
      .filter((t) => t.length >= MIN_TOKEN_LEN && !STOPWORDS.has(t));
  }
}
