/** A bounded async runner: never more than `max` tasks in flight. */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Create a concurrency limiter. ONE limiter shared across every LLM call in a
 * run gives a single global in-flight cap — so processing files in parallel
 * never multiplies into (files × candidates) simultaneous requests and blows the
 * provider's rate limit. Set the cap to what the model's rate limit tolerates.
 */
export function createLimiter(max: number): Limiter {
  const ceiling = Math.max(1, max);
  let active = 0;
  const queue: Array<() => void> = [];

  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const attempt = () => {
        if (active >= ceiling) {
          queue.push(attempt);
          return;
        }
        active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            const nextFn = queue.shift();
            if (nextFn) nextFn();
          });
      };
      attempt();
    });
  };
}
