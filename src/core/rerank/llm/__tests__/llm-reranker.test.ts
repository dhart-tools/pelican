import { LLMReranker, parseVerdict, IRerankCandidate } from '@/core/rerank/llm/llm-reranker';
import { ILLMProvider } from '@/core/rerank/llm/provider';
import { ISignal } from '@/types/analyzers';
import { IRerankConfig } from '@/types/config';

const cfg: IRerankConfig = {
  enabled: true,
  provider: 'openrouter',
  model: 'test/model',
  apiKeyEnv: 'X',
  baseUrl: 'http://localhost',
  candidateBand: { min: 0.4, max: 0.9 },
  protectAnchors: true,
  keepThreshold: 0.5,
  maxCandidates: 40,
  concurrency: 4,
  timeoutMs: 1000,
  maxRetries: 3,
  highPrecision: false,
};

const sig = (type: string, over: Partial<ISignal> = {}): ISignal => ({
  source: type,
  type,
  weight: 0.5,
  matched: true,
  ...over,
});

const cand = (testFile: string, score: number, signals: ISignal[] = []): IRerankCandidate => ({
  testFile,
  score,
  signals,
  testExcerpt: `// body of ${testFile}`,
});

/** Provider that returns a fixed verdict, and records how many calls it saw. */
class FakeProvider implements ILLMProvider {
  readonly id = 'fake';
  calls: string[] = [];
  constructor(private readonly reply: (prompt: string) => string) {}
  async complete(messages: { role: string; content: string }[]): Promise<string> {
    const user = messages.find((m) => m.role === 'user')!.content;
    this.calls.push(user);
    return this.reply(user);
  }
}

const input = {
  changedFile: 'src/dm/sagas/provisioning.ts',
  changeSummary: 'changed start/stop provisioning flow',
};

describe('parseVerdict', () => {
  it('parses plain JSON', () => {
    expect(parseVerdict('{"relevant": true, "confidence": 0.9}')).toEqual({
      relevant: true,
      confidence: 0.9,
    });
  });
  it('tolerates code fences and prose', () => {
    expect(parseVerdict('Sure:\n```json\n{"relevant": false, "confidence": 0.2}\n```')).toEqual({
      relevant: false,
      confidence: 0.2,
    });
  });
  it('clamps confidence and defaults when missing', () => {
    expect(parseVerdict('{"relevant": true, "confidence": 5}')).toEqual({
      relevant: true,
      confidence: 1,
    });
    expect(parseVerdict('{"relevant": true}')).toEqual({ relevant: true, confidence: 0.5 });
  });
  it('returns null on garbage', () => {
    expect(parseVerdict('no json here')).toBeNull();
    expect(parseVerdict('{"relevant": "yes"}')).toBeNull();
  });
});

describe('LLMReranker — recall-safe filtering', () => {
  it('auto-keeps candidates at/above band.max without calling the LLM', async () => {
    const p = new FakeProvider(() => '{"relevant": false, "confidence": 1}');
    const r = new LLMReranker(p, cfg);
    const out = await r.rerank(input, [cand('strong.cy.ts', 0.95)]);
    expect(out[0].kept).toBe(true);
    expect(out[0].judged).toBe(false);
    expect(p.calls).toHaveLength(0);
  });

  it('protects direct-import / colocation anchors (never judged)', async () => {
    const p = new FakeProvider(() => '{"relevant": false, "confidence": 1}');
    const r = new LLMReranker(p, cfg);
    const out = await r.rerank(input, [
      cand('imported.cy.ts', 0.6, [sig('direct-import')]),
      cand('colocated.test.tsx', 0.6, [sig('colocation')]),
    ]);
    expect(out.every((v) => v.kept && !v.judged)).toBe(true);
    expect(p.calls).toHaveLength(0);
  });

  it('does NOT protect a filename-match anchor — the LLM judges it', async () => {
    // The provisioning cluster is filename-anchored on a distinctive token, yet
    // must remain judgeable so the LLM can separate wanted from noise.
    const p = new FakeProvider(() => '{"relevant": false, "confidence": 0.9}');
    const r = new LLMReranker(p, cfg);
    const out = await r.rerank(input, [
      cand('provisioningStatusPopover.cy.ts', 0.6, [sig('filename-match')]),
    ]);
    expect(out[0].judged).toBe(true);
    expect(out[0].kept).toBe(false);
    expect(p.calls).toHaveLength(1);
  });

  it('drops an in-band, unanchored candidate the LLM rejects', async () => {
    const p = new FakeProvider(() => '{"relevant": false, "confidence": 0.9}');
    const r = new LLMReranker(p, cfg);
    const out = await r.rerank(input, [
      cand('provisioningStatusPopover.cy.ts', 0.6, [
        sig('filename-match', { anchorEligible: false }),
      ]),
    ]);
    expect(out[0].judged).toBe(true);
    expect(out[0].kept).toBe(false);
  });

  it('keeps an in-band filename-matched candidate the LLM accepts', async () => {
    const p = new FakeProvider(() => '{"relevant": true, "confidence": 0.8}');
    const r = new LLMReranker(p, cfg);
    const out = await r.rerank(input, [
      cand('startProvisioning.cy.ts', 0.6, [sig('filename-match')]),
    ]);
    expect(out[0].judged).toBe(true);
    expect(out[0].kept).toBe(true);
    expect(out[0].llmConfidence).toBe(0.8);
  });

  it('fails open (keeps) when the provider throws', async () => {
    const p: ILLMProvider = {
      id: 'boom',
      complete: async () => {
        throw new Error('network down');
      },
    };
    const r = new LLMReranker(p, cfg);
    const out = await r.rerank(input, [cand('x.cy.ts', 0.6)]);
    expect(out[0].kept).toBe(true);
    expect(out[0].reason).toMatch(/fail-open/);
  });

  it('fails open on an unparseable reply', async () => {
    const p = new FakeProvider(() => 'I think maybe?');
    const r = new LLMReranker(p, cfg);
    const out = await r.rerank(input, [cand('x.cy.ts', 0.6)]);
    expect(out[0].kept).toBe(true);
  });

  it('keeps in-band candidates over maxCandidates unjudged (no silent drop)', async () => {
    const p = new FakeProvider(() => '{"relevant": false, "confidence": 1}');
    const small = { ...cfg, maxCandidates: 1 };
    const r = new LLMReranker(p, small);
    const out = await r.rerank(input, [
      cand('a.cy.ts', 0.8),
      cand('b.cy.ts', 0.7),
      cand('c.cy.ts', 0.6),
    ]);
    // only 1 judged; the other two kept unjudged
    expect(out.filter((v) => v.judged)).toHaveLength(1);
    expect(out.filter((v) => !v.judged && v.kept)).toHaveLength(2);
    expect(p.calls).toHaveLength(1);
  });
});
