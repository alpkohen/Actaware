/**
 * test-ai-quality.js
 *
 * Isolated Claude quality test: runs 8 pre-defined scenarios against the
 * exact same prompt used in send-alerts-background, then auto-evaluates
 * each response for correctness, hallucination risk, and edge-case handling.
 *
 * Invoke: GET /.netlify/functions/test-ai-quality
 * Optional: ?scenario=1  (run a single scenario by number 1–8)
 * Optional: ?tier=professional  (test with professional digest tier)
 *
 * Cost: ~8 Claude Haiku calls (~$0.002 total). No emails sent, no DB writes.
 */

const TEST_SCENARIOS = [
  {
    id: 1,
    label: "HMRC NMW — rich content",
    description: "Zengin içerik: doğru rakam/tarih aktarımı + pratik aksiyon",
    source: "GOV.UK — National Minimum Wage Updates",
    items: [
      {
        title: "National Minimum Wage and National Living Wage rates increase from April 2026",
        published: "18 March 2026",
        summary:
          "The government has confirmed the new National Minimum Wage (NMW) and National Living Wage (NLW) rates effective from 1 April 2026. The NLW for workers aged 21 and over will increase from £12.21 to £12.85 per hour. The rate for 18-20 year olds rises to £10.40. Employers must ensure payroll systems are updated before the April pay run.",
        link: "https://www.gov.uk/government/news/minimum-wage-rates-april-2026",
      },
    ],
    expected: {
      importance: ["HIGH", "CRITICAL"],
      mustContain: ["12.85", "April"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 2,
    label: "HSE Prosecution — specific figures",
    description: "Spesifik rakamları (£1.2m, 8 metres) doğru aktarma",
    source: "HSE — Health & Safety at Work",
    items: [
      {
        title: "Company fined £1.2m after worker suffers fatal fall from height at warehouse",
        published: "17 March 2026",
        summary:
          "HSE investigation found the company failed to provide adequate edge protection and had no safe system of work for tasks at height. The worker fell 8 metres through a fragile roof panel. The company pleaded guilty to breaching the Work at Height Regulations 2005.",
        link: "https://press.hse.gov.uk/2026/03/17/company-fined-after-fatal-fall/",
      },
    ],
    expected: {
      importance: ["HIGH", "CRITICAL"],
      mustContain: ["1.2", "height"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 3,
    label: "ICO Data Breach Fine",
    description: "GDPR referansı + işveren odaklı aksiyon (DPIA, encryption)",
    source: "GOV.UK — Data Protection (ICO via GOV.UK)",
    items: [
      {
        title: "ICO fines recruitment agency £180,000 for failing to protect employee data",
        published: "15 March 2026",
        summary:
          "A recruitment agency has been fined after a data breach exposed personal data of over 12,000 job applicants including health information and criminal records checks. The ICO found the agency had no encryption, no access controls, and had not carried out a Data Protection Impact Assessment as required under UK GDPR Article 35.",
        link: "https://www.gov.uk/government/news/ico-fines-recruitment-agency",
      },
    ],
    expected: {
      importance: ["HIGH", "CRITICAL"],
      mustContain: ["180,000", "data"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 4,
    label: "Employment Tribunal — TITLE ONLY (no content)",
    description: "Edge case: boş içerik — halüsinasyon riski yüksek",
    source: "Employment Tribunal — ERA 2025 Case Decisions",
    items: [
      {
        title: "Ms A Singh v TechCorp Ltd: Unfair dismissal — Employment Rights Act 2025 s.108 qualifying period",
        published: "14 March 2026",
        summary: "",
        link: "https://www.gov.uk/employment-tribunal-decisions/ms-a-singh-v-techcorp-ltd",
      },
    ],
    expected: {
      importance: ["HIGH", "MEDIUM"],
      mustContain: [],
      mustNotContain: ["TechCorp", "Ms Singh", "Ms A Singh"],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 5,
    label: "ERA 2025 Zero Hours Factsheet",
    description: "Kritik mevzuat: CRITICAL/HIGH importance + tarih/deadline doğruluğu",
    source: "GOV.UK — Employment Rights Act 2025",
    items: [
      {
        title: "Employment Rights Act 2025: Zero hours contracts — guaranteed hours factsheet updated",
        published: "16 March 2026",
        summary:
          "This factsheet has been updated to reflect the final statutory instrument laying out commencement dates for the zero hours contracts provisions. From 6 April 2026, qualifying workers on zero hours or low hours contracts will have the right to request guaranteed hours based on a 12-week reference period. Employers who fail to offer guaranteed hours within one month of the reference period ending may face tribunal claims.",
        link: "https://www.gov.uk/government/publications/employment-rights-bill-factsheets",
      },
    ],
    expected: {
      importance: ["CRITICAL", "HIGH"],
      mustContain: ["6 April", "zero hours"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 6,
    label: "Legislation.gov.uk — Commencement SI (dry legal language)",
    description: "Kuru hukuk dilini sade işveren diline çevirme",
    source: "Legislation.gov.uk — New Statutory Instruments (ERA 2025)",
    items: [
      {
        title: "The Employment Rights Act 2025 (Commencement No. 2) Regulations 2026",
        published: "12 March 2026",
        summary:
          "These Regulations bring into force on 6th April 2026 the provisions of sections 1 to 4 (unfair dismissal qualifying period), sections 12 to 18 (zero hours contracts) and section 27 (fire and rehire) of the Employment Rights Act 2025.",
        link: "https://www.legislation.gov.uk/uksi/2026/245/contents/made",
      },
    ],
    expected: {
      importance: ["CRITICAL", "HIGH"],
      mustContain: ["6"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 7,
    label: "ACAS Flexible Working Guidance",
    description: "Düşük aciliyet: MEDIUM importance beklenir (rehber, yeni yasa değil)",
    source: "ACAS — Employment Relations & Guidance",
    items: [
      {
        title: "Acas updates guidance on handling flexible working requests",
        published: "13 March 2026",
        summary:
          "Acas has published updated guidance for employers on handling statutory flexible working requests. The guidance reflects changes under the Employment Rights Act 2025 which make flexible working a day-one right and require employers to respond within two months. The update includes template response letters and a decision flowchart.",
        link: "https://www.gov.uk/government/publications/acas-flexible-working-guidance",
      },
    ],
    expected: {
      importance: ["MEDIUM", "HIGH"],
      mustContain: ["flexible working"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 8,
    label: "NOISE TEST — irrelevant content",
    description: "İşveren için tamamen ilgisiz içerik — Claude 'No employer-relevant updates' demeli",
    source: "GOV.UK — DBT All News",
    items: [
      {
        title: "UK signs new trade agreement with Australia on agricultural tariffs",
        published: "17 March 2026",
        summary:
          "The Department for Business and Trade has announced a new bilateral agreement with Australia reducing tariffs on beef, lamb and dairy imports. The agreement is expected to benefit UK consumers with lower supermarket prices while providing new export opportunities for British whisky producers.",
        link: "https://www.gov.uk/government/news/uk-australia-trade-agreement-2026",
      },
      {
        title: "Minister visits Birmingham school to promote apprenticeship week",
        published: "16 March 2026",
        summary:
          "The Skills Minister visited a Birmingham secondary school as part of National Apprenticeship Week, encouraging students to consider vocational pathways alongside university.",
        link: "https://www.gov.uk/government/news/minister-visits-birmingham-school",
      },
    ],
    expected: {
      importance: [],
      mustContain: ["No employer-relevant"],
      mustNotContain: [],
      shouldNotBeSkipped: false, // Claude SHOULD skip/return no-content
    },
  },
];

function buildPrompt(items, sourceName, tier) {
  const proBlocks =
    tier === "professional"
      ? `
- This digest is for **Professional / Agency** subscribers. For each relevant update, AFTER "Risk if ignored" and BEFORE "Source:", add these exact headings and content:
**Severity rationale:** [1–2 sentences — why this importance level for a typical UK employer]
**Governance & ownership:** [which teams usually own remediation — HR, Payroll, H&S, Legal, etc.]
**Suggested timeline:** [concrete window, e.g. before next payroll, within 14 days, immediate for CRITICAL]
**Cross-checks:** [2–4 bullets — handbook, contracts, policies, or registers to review]
`
      : "";

  return `You are a UK employment law compliance expert writing employer alert emails for UK employers.

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
- For each relevant update use this exact format:

**[Title]** (Importance: CRITICAL/HIGH/MEDIUM)
Published: [date from source, formatted as e.g. 19 March 2026]
What changed: [1 sentence summarising what happened or changed]
What employers must do:
- [specific action]
- [specific action]
Risk if ignored: [consequence for employers]
Source: [URL]${proBlocks}`;
}

async function callClaude(prompt, tier) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: tier === "professional" ? 2600 : 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Anthropic HTTP ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data?.content?.[0]?.text || "";
}

function evaluateResponse(output, scenario) {
  const checks = [];
  let score = 0;
  let maxScore = 0;

  const wasSkipped =
    output.includes("No employer-relevant") ||
    output.includes("insufficient information") ||
    output.includes("cannot write") ||
    output.includes("titles and metadata");

  // 1. Skip/produce check (always runs)
  maxScore++;
  if (scenario.expected.shouldNotBeSkipped) {
    const ok = !wasSkipped;
    checks.push({ check: "Not skipped (content produced)", pass: ok });
    if (ok) score++;
  } else {
    const ok = wasSkipped;
    checks.push({ check: "Correctly skipped (noise test)", pass: ok });
    if (ok) score++;
  }

  // 2. Importance level (only if expected)
  if (scenario.expected.importance.length > 0) {
    maxScore++;
    const importanceMatch = scenario.expected.importance.some((lvl) =>
      output.includes(`Importance: ${lvl}`)
    );
    checks.push({
      check: `Importance is one of [${scenario.expected.importance.join("/")}]`,
      pass: importanceMatch,
    });
    if (importanceMatch) score++;
  }

  // 3. mustContain (only if expected)
  if (scenario.expected.mustContain.length > 0) {
    maxScore++;
    const allPresent = scenario.expected.mustContain.every((s) =>
      output.toLowerCase().includes(s.toLowerCase())
    );
    checks.push({
      check: `Required terms present: ${scenario.expected.mustContain.join(", ")}`,
      pass: allPresent,
    });
    if (allPresent) score++;
  }

  // 4. Hallucination check (only if expected)
  if (scenario.expected.mustNotContain.length > 0) {
    maxScore++;
    const nonePresent = scenario.expected.mustNotContain.every(
      (s) => !output.toLowerCase().includes(s.toLowerCase())
    );
    checks.push({
      check: `No hallucinated specifics: ${scenario.expected.mustNotContain.join(", ")}`,
      pass: nonePresent,
    });
    if (nonePresent) score++;
  }

  // 5. Format check (always runs)
  maxScore++;
  const hasFormat =
    wasSkipped ||
    (output.includes("What changed:") &&
      output.includes("What employers must do:") &&
      output.includes("Risk if ignored:") &&
      output.includes("Source:"));
  checks.push({ check: "Correct output format", pass: hasFormat });
  if (hasFormat) score++;

  const pct = maxScore > 0 ? score / maxScore : 0;
  const grade = pct >= 1.0 ? "PASS" : pct >= 0.6 ? "PARTIAL" : "FAIL";

  return { score, maxScore, grade, checks };
}

exports.handler = async function (event) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }),
    };
  }

  const params = event.queryStringParameters || {};
  const singleScenario = params.scenario ? parseInt(params.scenario, 10) : null;
  const tier = params.tier === "professional" ? "professional" : "standard";

  const scenarios = singleScenario
    ? TEST_SCENARIOS.filter((s) => s.id === singleScenario)
    : TEST_SCENARIOS;

  if (scenarios.length === 0) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: `Scenario ${singleScenario} not found. Valid IDs: 1–8` }),
    };
  }

  const results = [];
  let passCount = 0;
  let partialCount = 0;
  let failCount = 0;

  for (const scenario of scenarios) {
    console.log(`Running scenario ${scenario.id}: ${scenario.label}`);
    const startMs = Date.now();
    let output = "";
    let error = null;

    try {
      const prompt = buildPrompt(scenario.items, scenario.source, tier);
      output = await callClaude(prompt, tier);
    } catch (err) {
      error = err.message;
    }

    const evaluation = error ? null : evaluateResponse(output, scenario);
    if (evaluation) {
      if (evaluation.grade === "PASS") passCount++;
      else if (evaluation.grade === "PARTIAL") partialCount++;
      else failCount++;
    }

    results.push({
      id: scenario.id,
      label: scenario.label,
      description: scenario.description,
      tier,
      ms: Date.now() - startMs,
      error: error || null,
      grade: evaluation?.grade ?? "ERROR",
      score: evaluation ? `${evaluation.score}/${evaluation.maxScore}` : "N/A",
      checks: evaluation?.checks ?? [],
      output: error ? null : output,
    });
  }

  const total = scenarios.length;
  const summary = {
    total,
    pass: passCount,
    partial: partialCount,
    fail: failCount,
    error: results.filter((r) => r.error).length,
    overallGrade:
      failCount === 0 && passCount === total
        ? "ALL PASS"
        : failCount === 0
        ? "PASS WITH PARTIALS"
        : `${failCount} FAILURE(S)`,
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary, tier, results }, null, 2),
  };
};
