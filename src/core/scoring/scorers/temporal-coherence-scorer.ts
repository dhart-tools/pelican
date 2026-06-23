import * as path from 'path';

import { ISignal } from '@/types/analyzers';
import { ITemporalConfig } from '@/types/config';
import { IFileGitHistory } from '@/types/git';
import { IScorer, IScorerContext } from '@/types/scorers';

const DAY = 86400; // seconds

/** Built-in defaults — used when config omits a knob (or for hand-built configs). */
export const TEMPORAL_DEFAULTS: ITemporalConfig = {
  creationWindowSoftDays: 14,
  creationWindowHardDays: 28,
  updateWindowDays: 14,
  maxCommitFiles: 30,
  maxWeight: 0.45,
};

/** One sub-signal's contribution plus a rich, loggable trace. */
interface ISubSignal {
  weight: number;
  reason: string;
  metadata: Record<string, unknown>;
}

/** noisy-or of two independent weights. */
const noisyOr = (a: number, b: number): number => 1 - (1 - a) * (1 - b);

/**
 * A. Creation proximity. Tests rarely change, so *when a spec was first
 * committed* relative to the changed source is the most reliable coupling
 * signal. Asymmetric: a spec created at/after the source (test backfill) is
 * expected; one created well *before* the source it supposedly tests is
 * implausible, so the "before" side is tightened to half the window.
 */
export function creationProximity(
  changed: IFileGitHistory,
  test: IFileGitHistory,
  cfg: ITemporalConfig,
): ISubSignal {
  const gapDays = (test.createdAt - changed.createdAt) / DAY; // + = test after source
  const after = gapDays >= 0;
  const absGap = Math.abs(gapDays);

  // After side uses the full window; before side is halved (less plausible).
  const soft = after ? cfg.creationWindowSoftDays : cfg.creationWindowSoftDays / 2;
  const hard = after ? cfg.creationWindowHardDays : cfg.creationWindowSoftDays;

  let weight: number;
  if (absGap <= soft) {
    weight = cfg.maxWeight;
  } else if (absGap >= hard || hard <= soft) {
    weight = 0;
  } else {
    weight = cfg.maxWeight * ((hard - absGap) / (hard - soft));
  }

  const metadata = {
    gapDays: round(gapDays),
    side: after ? 'test-after-source' : 'test-before-source',
    softDays: soft,
    hardDays: hard,
    weight: round(weight),
  };
  const reason =
    weight > 0
      ? `created ${round(absGap)}d ${after ? 'after' : 'before'} the changed file (w=${round(weight)})`
      : `creation ${round(absGap)}d ${after ? 'after' : 'before'} — outside ${hard}d window`;
  return { weight, reason, metadata };
}

/**
 * B. Update coupling, base-rate normalized. Bucket both files' commit
 * timestamps into windows; count windows where both changed; compare against
 * what chance would produce given each file's own update frequency over their
 * shared observable span. lift > 1 means coupling beyond coincidence. A file
 * that updates in *every* window (ubiquitous churn) lands at lift ≈ 1 and so
 * contributes nothing — exactly the base-rate normalization we want.
 *
 * Requires ≥2 shared windows so a single coincidental co-edit can't fire it.
 */
export function updateCoupling(
  changed: IFileGitHistory,
  test: IFileGitHistory,
  cfg: ITemporalConfig,
): ISubSignal {
  const w = cfg.updateWindowDays * DAY;
  const bucket = (ts: number) => Math.floor(ts / w);

  // Drop bulk/refactor commits — they aren't logical co-changes and otherwise
  // inflate both files' update rates, compressing every lift toward 1.
  const usable = (h: IFileGitHistory) =>
    h.commits.filter((c) => c.size <= cfg.maxCommitFiles).map((c) => c.ts);
  const changedTs = usable(changed);
  const testTs = usable(test);
  const droppedChanged = changed.commits.length - changedTs.length;
  const droppedTest = test.commits.length - testTs.length;

  const cBuckets = new Set(changedTs.map(bucket));
  const tBuckets = new Set(testTs.map(bucket));
  let co = 0;
  for (const b of cBuckets) if (tBuckets.has(b)) co++;

  const minTs = Math.min(changed.createdAt, test.createdAt);
  const maxTs = Math.max(changed.updatedAt, test.updatedAt);
  const totalWindows = Math.max(1, Math.floor((maxTs - minTs) / w) + 1);

  const expected = (cBuckets.size * tBuckets.size) / totalWindows;
  const lift = expected > 0 ? co / expected : 0;

  // Saturating map: lift 1→0, 2→0.5·max, 4→0.75·max, →max as lift→∞.
  const weight = co >= 2 && lift > 1 ? cfg.maxWeight * (1 - 1 / lift) : 0;

  const metadata = {
    coWindows: co,
    changedWindows: cBuckets.size,
    testWindows: tBuckets.size,
    totalWindows,
    expected: round(expected),
    lift: round(lift),
    weight: round(weight),
    bulkExcluded: { changed: droppedChanged, test: droppedTest, threshold: cfg.maxCommitFiles },
  };
  const reason =
    weight > 0
      ? `co-updated in ${co} window(s), lift=${round(lift)} vs chance (w=${round(weight)})`
      : co > 0
        ? `co-updated in ${co} window(s) but lift=${round(lift)} ≤ 1 (within chance)`
        : 'no shared update windows';
  return { weight, reason, metadata };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Temporal-coherence scorer — bumps a candidate whose git timing tracks the
 * changed file. Two-repo safe (correlates by timestamp, not commit SHA).
 *
 * Strictly additive and corroborating:
 *  - NOT an anchor → it cannot admit a candidate on its own; it only lifts the
 *    score of candidates that already pass the anchor gate.
 *  - Weight is capped (`maxWeight`) so it never dominates a real anchor.
 *  - No-ops (matched:false, weight 0) whenever the data isn't there — missing
 *    histories, shallow clone, or a file not yet committed — so it can never
 *    lower a score or harm recall.
 *
 * Emits a signal on every pair (matched true or false) carrying the full
 * computation in `metadata`, so `--debug` shows exactly why it fired or didn't.
 */
export class TemporalCoherenceScorer implements IScorer {
  name = 'temporal-coherence';
  version = '1.0.0';
  description =
    'Corroborates candidates whose git creation/update timing tracks the changed file (cross-repo safe, bump-only).';
  type = 'temporal-coherence';
  weight = 0.45;

  evaluate(_changedFile: string, _testFile: string, context: IScorerContext): ISignal[] {
    const cfg: ITemporalConfig = { ...TEMPORAL_DEFAULTS, ...context.config.scoring.temporal };
    const { changedFile, testFile, gitHistories } = context;

    const miss = (reason: string): ISignal[] => [
      { source: this.name, type: this.type, weight: 0, matched: false, reason },
    ];

    if (!gitHistories || gitHistories.size === 0) return miss('no git histories in context');
    if (!changedFile.repoRoot || !testFile.repoRoot) {
      return miss('repoRoot missing on a file entry (registry built before two-repo support?)');
    }

    const changedHist = gitHistories.get(path.resolve(changedFile.repoRoot));
    const testHist = gitHistories.get(path.resolve(testFile.repoRoot));
    if (!changedHist?.available)
      return miss(`source repo history unavailable (${changedFile.repoRoot})`);
    if (!testHist?.available) return miss(`test repo history unavailable (${testFile.repoRoot})`);

    const changed = changedHist.files.get(changedFile.path);
    const test = testHist.files.get(testFile.path);
    if (!changed) return miss(`changed file not in git history yet: ${changedFile.path}`);
    if (!test) return miss(`test file not in git history yet: ${testFile.path}`);

    const creation = creationProximity(changed, test, cfg);
    const update = updateCoupling(changed, test, cfg);
    const weight = Math.min(cfg.maxWeight, noisyOr(creation.weight, update.weight));
    const matched = weight > 0;

    const reason = matched
      ? `temporal coherence w=${round(weight)} — ${creation.reason}; ${update.reason}`
      : `no temporal coupling — ${creation.reason}; ${update.reason}`;

    return [
      {
        source: this.name,
        type: this.type,
        weight,
        matched,
        reason,
        metadata: {
          changedFile: changedFile.path,
          testFile: testFile.path,
          changedRepo: changedHist.repoRoot,
          testRepo: testHist.repoRoot,
          creation: creation.metadata,
          update: update.metadata,
          combinedWeight: round(weight),
          cap: cfg.maxWeight,
        },
      },
    ];
  }
}
