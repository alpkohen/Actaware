/**
 * S-2: run async tasks with a fixed concurrency cap (avoids sequential Netlify timeouts).
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<void>} fn
 */
async function runWithConcurrency(items, concurrency, fn) {
  const n = items.length;
  if (n === 0) return;
  const limit = Math.max(1, Math.min(concurrency, n));
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= n) break;
      await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
}

module.exports = { runWithConcurrency };
