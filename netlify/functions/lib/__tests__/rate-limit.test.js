"use strict";

const { consumeRateLimit, envInt } = require("../rate-limit");

function makeSupabase(rpcResult) {
  return {
    rpc: jest.fn().mockResolvedValue(rpcResult),
  };
}

describe("consumeRateLimit", () => {
  test("izin verildiğinde allowed:true döner", async () => {
    const sb = makeSupabase({ data: [{ allowed: true, hit_count: 1 }], error: null });
    const result = await consumeRateLimit(sb, "test-bucket", 10, 60);
    expect(result.allowed).toBe(true);
    expect(result.hit_count).toBe(1);
    expect(result.degraded).toBe(false);
  });

  test("limit aşıldığında allowed:false döner", async () => {
    const sb = makeSupabase({ data: [{ allowed: false, hit_count: 11 }], error: null });
    const result = await consumeRateLimit(sb, "test-bucket", 10, 60);
    expect(result.allowed).toBe(false);
    expect(result.hit_count).toBe(11);
  });

  test("DB hatası → degraded:true ve allowed:true (fail-open)", async () => {
    const sb = makeSupabase({ data: null, error: { message: "connection refused" } });
    const result = await consumeRateLimit(sb, "test-bucket", 10, 60);
    expect(result.allowed).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.hit_count).toBeNull();
  });

  test("bucket key 256 karaktere truncate edilir", async () => {
    const sb = makeSupabase({ data: [{ allowed: true, hit_count: 1 }], error: null });
    const longKey = "x".repeat(300);
    await consumeRateLimit(sb, longKey, 10, 60);
    const calledWith = sb.rpc.mock.calls[0][1];
    expect(calledWith.p_bucket.length).toBe(256);
  });

  test("window saniyesi en az 10'a yuvarlanır", async () => {
    const sb = makeSupabase({ data: [{ allowed: true, hit_count: 1 }], error: null });
    await consumeRateLimit(sb, "k", 10, 1);
    const calledWith = sb.rpc.mock.calls[0][1];
    expect(calledWith.p_window_seconds).toBe(10);
  });

  test("window saniyesi en fazla 3600'e yuvarlanır", async () => {
    const sb = makeSupabase({ data: [{ allowed: true, hit_count: 1 }], error: null });
    await consumeRateLimit(sb, "k", 10, 99999);
    const calledWith = sb.rpc.mock.calls[0][1];
    expect(calledWith.p_window_seconds).toBe(3600);
  });

  test("max en az 1'e yuvarlanır", async () => {
    const sb = makeSupabase({ data: [{ allowed: true, hit_count: 1 }], error: null });
    await consumeRateLimit(sb, "k", 0, 60);
    const calledWith = sb.rpc.mock.calls[0][1];
    expect(calledWith.p_max).toBe(1);
  });
});

describe("envInt", () => {
  afterEach(() => {
    delete process.env.TEST_ENV_INT_VAR;
  });

  test("geçerli pozitif integer → döner", () => {
    process.env.TEST_ENV_INT_VAR = "42";
    expect(envInt("TEST_ENV_INT_VAR", 10)).toBe(42);
  });

  test("env var yoksa fallback döner", () => {
    expect(envInt("TEST_ENV_INT_VAR", 5)).toBe(5);
  });

  test("sıfır → fallback döner (pozitif değil)", () => {
    process.env.TEST_ENV_INT_VAR = "0";
    expect(envInt("TEST_ENV_INT_VAR", 7)).toBe(7);
  });

  test("negatif sayı → fallback döner", () => {
    process.env.TEST_ENV_INT_VAR = "-3";
    expect(envInt("TEST_ENV_INT_VAR", 7)).toBe(7);
  });

  test("string metin → fallback döner", () => {
    process.env.TEST_ENV_INT_VAR = "abc";
    expect(envInt("TEST_ENV_INT_VAR", 8)).toBe(8);
  });
});
