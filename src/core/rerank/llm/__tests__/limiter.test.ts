import { createLimiter } from '@/core/rerank/llm/limiter';

describe('createLimiter', () => {
  it('never runs more than `max` tasks at once', async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const task = () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all(Array.from({ length: 20 }, task));
    expect(peak).toBeLessThanOrEqual(3);
    expect(active).toBe(0);
  });

  it('runs every task and preserves per-call results', async () => {
    const limit = createLimiter(2);
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(async () => n * 10)));
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('a rejecting task does not wedge the pool', async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // pool must free up so the next task still runs
    await expect(limit(async () => 'ok')).resolves.toBe('ok');
  });

  it('treats max<1 as 1', async () => {
    const limit = createLimiter(0);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 2));
          active--;
        }),
      ),
    );
    expect(peak).toBe(1);
  });
});
