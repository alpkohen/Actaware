"use strict";

const { assertTestFunctionAllowed, timingSafeEqualStrings } = require("../test-function-guard");

describe("assertTestFunctionAllowed", () => {
  const origContext = process.env.CONTEXT;
  const origSecret = process.env.TEST_FUNCTIONS_SECRET;

  afterEach(() => {
    if (origContext === undefined) delete process.env.CONTEXT;
    else process.env.CONTEXT = origContext;
    if (origSecret === undefined) delete process.env.TEST_FUNCTIONS_SECRET;
    else process.env.TEST_FUNCTIONS_SECRET = origSecret;
  });

  test("production + secret yok → 403", () => {
    process.env.CONTEXT = "production";
    delete process.env.TEST_FUNCTIONS_SECRET;
    const r = assertTestFunctionAllowed({ headers: {} });
    expect(r.ok).toBe(false);
    expect(r.response.statusCode).toBe(403);
    expect(JSON.parse(r.response.body).error).toContain("disabled");
  });

  test("production + doğru secret header → izin", () => {
    process.env.CONTEXT = "production";
    process.env.TEST_FUNCTIONS_SECRET = "my-test-secret-xyz";
    const r = assertTestFunctionAllowed({
      headers: { "x-actaware-test-secret": "my-test-secret-xyz" },
    });
    expect(r.ok).toBe(true);
  });

  test("production + yanlış header → 403", () => {
    process.env.CONTEXT = "production";
    process.env.TEST_FUNCTIONS_SECRET = "correct";
    const r = assertTestFunctionAllowed({
      headers: { "X-Actaware-Test-Secret": "wrong" },
    });
    expect(r.ok).toBe(false);
    expect(r.response.statusCode).toBe(403);
  });

  test("deploy-preview + secret yok → izin", () => {
    process.env.CONTEXT = "deploy-preview";
    delete process.env.TEST_FUNCTIONS_SECRET;
    const r = assertTestFunctionAllowed({ headers: {} });
    expect(r.ok).toBe(true);
  });

  test("deploy-preview + secret set + header yok → 403", () => {
    process.env.CONTEXT = "deploy-preview";
    process.env.TEST_FUNCTIONS_SECRET = "s";
    const r = assertTestFunctionAllowed({ headers: {} });
    expect(r.ok).toBe(false);
  });

  test("CONTEXT yok (local) + secret yok → izin", () => {
    delete process.env.CONTEXT;
    delete process.env.TEST_FUNCTIONS_SECRET;
    const r = assertTestFunctionAllowed({ headers: {} });
    expect(r.ok).toBe(true);
  });
});

describe("timingSafeEqualStrings", () => {
  test("eşleşen stringler", () => {
    expect(timingSafeEqualStrings("a", "a")).toBe(true);
  });

  test("farklı uzunluk", () => {
    expect(timingSafeEqualStrings("ab", "a")).toBe(false);
  });
});
