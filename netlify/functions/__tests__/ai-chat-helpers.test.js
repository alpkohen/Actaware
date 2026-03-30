const {
  extractKeywordTerms,
  sanitizeIlikeTerm,
  splitIntoChunks,
  parseClaudeJsonResponse,
  normalizeChatPayload,
} = require("../lib/ai-chat-helpers");

describe("ai-chat-helpers", () => {
  test("extractKeywordTerms drops stopwords and caps count", () => {
    const t = extractKeywordTerms("What do I need before April 6 for ERA 2025 compliance?");
    expect(t).toContain("era");
    expect(t).toContain("2025");
    expect(t.length).toBeLessThanOrEqual(8);
  });

  test("sanitizeIlikeTerm escapes wildcards", () => {
    expect(sanitizeIlikeTerm("a%b_c")).toBe("a\\%b\\_c");
  });

  test("splitIntoChunks splits long text", () => {
    const long = "x".repeat(2500);
    const parts = splitIntoChunks(long, 2000);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.every((p) => p.length <= 2000)).toBe(true);
  });

  test("parseClaudeJsonResponse strips fences", () => {
    const raw = '```json\n{"answer":"Hi","sources":["HMRC"],"disclaimer":"x"}\n```';
    const p = parseClaudeJsonResponse(raw);
    expect(p.answer).toBe("Hi");
    expect(p.sources).toEqual(["HMRC"]);
  });

  test("normalizeChatPayload fills disclaimer", () => {
    const n = normalizeChatPayload({ answer: "A" });
    expect(n.disclaimer.length).toBeGreaterThan(10);
  });
});

/** Manual QA (Professional user on dashboard): log these in browser devtools or run against deployed ai-chat. */
describe("AI Chat manual scenarios (documentation)", () => {
  test("logs checklist to console", () => {
    console.log(`
[ActAware AI Chat — manual checks]
1) Signed in as Professional: ask "What do I need to do before April 6 for ERA 2025?" — answer should cite knowledge-base sources when chunks exist.
2) Ask "Write me a marketing email" — expect scope refusal (UK employer compliance only).
3) Signed in as Starter/trial: click Ask ActAware — upgrade modal with £79/month CTA.
`);
    expect(true).toBe(true);
  });
});
