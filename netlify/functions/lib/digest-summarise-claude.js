/**
 * Digest summarisation via Claude — shared by send-alerts-background and eval-alerts.
 * @param {Array<{title: string, published?: string, summary: string, link: string}>} items
 * @param {string} sourceName
 * @param {"standard" | "professional"} digestTier
 */
async function summariseWithClaude(items, sourceName, digestTier = "standard") {
  const proBlocks =
    digestTier === "professional"
      ? `
- This digest is for **Professional / Agency** subscribers. For each relevant update, AFTER "Risk if ignored" and BEFORE "Source:", add these exact headings and content:
**Severity rationale:** [1–2 sentences — why this importance level for a typical UK employer]
**Governance & ownership:** [which teams usually own remediation — HR, Payroll, H&S, Legal, etc.]
**Suggested timeline:** [concrete window, e.g. before next payroll, within 14 days, immediate for CRITICAL]
**Cross-checks:** [2–4 bullets — handbook, contracts, policies, or registers to review]
`
      : "";

  const prompt = `You are a UK employer compliance expert (employment law, payroll/tax, health & safety, data protection, pensions, equality, and right-to-work / immigration duties) writing alert emails for UK employers.

Source: ${sourceName}
---
${items.map((i, idx) => `[${idx + 1}] Title: ${i.title}\nPublished: ${i.published || "recent"}\nContent: ${i.summary}\nURL: ${i.link}`).join("\n\n")}
---
RULES:
- Write clear, practical, plain-English guidance for UK employers.
- RELEVANCE FILTER — Only report items that create a direct legal obligation, compliance risk, financial penalty, or deadline for UK employers. The following are NOT employer-relevant and must be SKIPPED: trade agreements, ministerial visits, awareness campaigns, general policy announcements, international relations, educational outreach, and "nice to know" sector news with no compliance consequence. When in doubt, skip it.
- Use information from the source text. Where content is limited (e.g. only a title), use the title to infer the relevant employer lesson — for example, an HSE prosecution title tells you what safety failure occurred and what employers must do to avoid it.
- EMPTY CONTENT — If the source only provides a title with no body text: focus on the general topic and employer obligation it implies. Do NOT speculate on case outcomes, tribunal decisions, or ruling details. Do NOT repeat party names or company names from the title — refer to the case generically (e.g. "a recent tribunal decision on…").
- Never invent specific facts (dates, fines, company names not in the source). You may infer general employer obligations from the type of incident or change described.
- If genuinely nothing is employer-relevant for the items provided (typically the last ~36 hours), respond ONLY with: No employer-relevant updates from this source in this batch.
- SOURCE URL — Every alert MUST end with "Source: [full https URL from the item]". If the item has no URL, SKIP that item entirely. Never write "Source:" without a valid https URL on the same line.
- For each relevant update use this exact format:

**[Title]** (Importance: CRITICAL/HIGH/MEDIUM)
Published: [date from source, formatted as e.g. 19 March 2026]
What changed: [1 sentence summarising what happened or changed]
What employers must do:
- [specific action]
- [specific action]
Risk if ignored: [consequence for employers]
Source: [full https URL — REQUIRED, skip alert if missing]${proBlocks}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: digestTier === "professional" ? 2600 : 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const snippet = JSON.stringify(data).slice(0, 800);
    throw new Error(`Anthropic HTTP ${response.status}: ${snippet}`);
  }
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error(`Anthropic empty or invalid content: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return text;
}

module.exports = { summariseWithClaude };
