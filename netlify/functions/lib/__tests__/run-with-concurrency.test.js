"use strict";

const { runWithConcurrency } = require("../run-with-concurrency");

describe("runWithConcurrency", () => {
  test("boş liste → fn hiç çağrılmaz", async () => {
    const fn = jest.fn();
    await runWithConcurrency([], 5, fn);
    expect(fn).not.toHaveBeenCalled();
  });

  test("tüm öğeler işlenir", async () => {
    const results = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      results.push(item);
    });
    expect(results.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test("index parametresi doğru geçirilir", async () => {
    const indices = [];
    await runWithConcurrency(["a", "b", "c"], 3, async (item, idx) => {
      indices.push(idx);
    });
    expect(indices.sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  test("concurrency=1 → sıralı çalışır", async () => {
    const order = [];
    await runWithConcurrency([10, 20, 30], 1, async (item) => {
      order.push(item);
    });
    expect(order).toEqual([10, 20, 30]);
  });

  test("concurrency liste boyutundan büyükse sorun olmaz", async () => {
    const results = [];
    await runWithConcurrency([1, 2], 100, async (item) => {
      results.push(item);
    });
    expect(results.sort()).toEqual([1, 2]);
  });

  test("bir öğe hata fırlatırsa Promise reject olur", async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("test hatası");
      })
    ).rejects.toThrow("test hatası");
  });

  test("async işler paralel çalışır — toplam süre seri süreden az", async () => {
    const delay = (ms) => new Promise((res) => setTimeout(res, ms));
    const start = Date.now();
    await runWithConcurrency([50, 50, 50, 50], 4, async (ms) => {
      await delay(ms);
    });
    const elapsed = Date.now() - start;
    // 4 işlem 50ms, seri olsaydı 200ms. Paralelde ~50-100ms olmalı.
    expect(elapsed).toBeLessThan(180);
  });
});
