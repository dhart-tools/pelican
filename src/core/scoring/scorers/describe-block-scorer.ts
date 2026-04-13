import path from 'path';

import { BaseScorer } from '@/core/scoring/scorers/base';
import { getScorerConfig } from '@/core/scoring/scoring-config';
import { IScorerContext, ISignal } from '@/types';
import { EScorerType } from '@/utils/enums';

const SOURCE_EXT_RE = /\.(tsx?|jsx?|mts|cts|mjs|cjs|vue|svelte|astro)$/i;
const TEST_SUFFIX_RE = /\.(cy|spec|test|e2e|int|integration|unit|bench|stories)\.(ts|js)x?$/i;
const INDEX_BASENAMES = new Set(['index', 'main', 'default', 'entry']);
const STOPWORDS = new Set([
  'test','tests','spec','specs','it','should','describe','when','given','and','or','the',
  'a','an','of','for','with','page','pages','component','components','view','views',
  'e2e','unit','integration','renders','works','shows','displays','handles','cypress',
]);
const MIN_TOKEN_LEN = 3;

export class DescribeBlockScorer extends BaseScorer {
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
    const matched = hits.length > 0;

    const sig = this.createSignal(
      matched,
      matched
        ? `describe/it blocks mention source tokens [${hits.join(', ')}] (${testFile})`
        : `describe/it blocks don't reference source tokens`,
      { changedFile, testFile, hits, sourceTokens: [...sourceTokens] },
    );

    if (matched) {
      const ratio = hits.length / sourceTokens.size;
      sig.weight = this.weight * Math.min(1, 0.6 + ratio * 0.4);
    }

    return [sig];
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
