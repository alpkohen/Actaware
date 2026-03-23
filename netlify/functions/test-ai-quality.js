/**
 * test-ai-quality.js
 *
 * Isolated Claude quality test: runs 8 pre-defined scenarios against the
 * exact same prompt used in send-alerts-background, then auto-evaluates
 * each response for correctness, hallucination risk, and edge-case handling.
 *
 * Invoke: GET /.netlify/functions/test-ai-quality
 * Optional: ?scenario=1  (run a single scenario by number 1–23)
 * Optional: ?tier=professional  (test with professional digest tier)
 *
 * Cost: ~23 Claude Haiku calls (~$0.006 total). No emails sent, no DB writes.
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
      shouldNotBeSkipped: false,
    },
  },
  {
    id: 9,
    label: "Fire & Rehire — ERA 2025 s.27 tribunal",
    description: "Yeni mevzuat kovuşturması: rakamlar (£85k, 42 workers) doğru aktarılmalı",
    source: "Employment Tribunal — ERA 2025 Case Decisions",
    items: [
      {
        title: "Employer ordered to pay £85,000 after dismissing and re-engaging staff on lower terms",
        published: "19 March 2026",
        summary:
          "An Employment Tribunal ruled against a logistics company that dismissed 42 warehouse workers and re-engaged them on contracts with reduced overtime rates and removed shift premiums. The Tribunal found the employer failed to follow the new statutory requirements under ERA 2025 s.27.",
        link: "https://www.gov.uk/employment-tribunal-decisions/logistics-co-fire-rehire",
      },
    ],
    expected: {
      importance: ["HIGH", "CRITICAL"],
      mustContain: ["85,000", "fire and rehire"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 10,
    label: "Paternity Leave — day-one right in force",
    description: "Yeni hak: day-one ve 26-week removed doğru aktarılmalı",
    source: "GOV.UK — Employment Rights Act 2025",
    items: [
      {
        title: "Paternity leave and pay: day-one right now in force",
        published: "18 March 2026",
        summary:
          "From today, all eligible employees have the right to statutory paternity leave and pay from their first day of employment. The previous 26-week qualifying period has been removed under the Employment Rights Act 2025.",
        link: "https://www.gov.uk/government/news/paternity-leave-day-one",
      },
    ],
    expected: {
      importance: ["HIGH", "CRITICAL"],
      mustContain: ["day one", "paternity"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 11,
    label: "Collective Redundancy — protective award",
    description: "Yasal eşikler doğru (150, 45 gün, 90 gün) aktarılmalı",
    source: "Employment Tribunal — ERA 2025 Case Decisions",
    items: [
      {
        title: "Retailer faces protective award after failing to consult on 150 redundancies",
        published: "17 March 2026",
        summary:
          "A high street retailer has been ordered to pay a protective award of 90 days' pay per affected employee after it failed to notify the Secretary of State and begin collective consultation at least 45 days before the first dismissal, as required when proposing 100 or more redundancies at one establishment.",
        link: "https://www.gov.uk/employment-tribunal-decisions/retailer-redundancy",
      },
    ],
    expected: {
      importance: ["HIGH", "CRITICAL"],
      mustContain: ["90 days", "45"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 12,
    label: "Pension Auto-Enrolment Thresholds — dry HMRC",
    description: "Rakamlar (£10,000, £6,240, £50,270) bire bir doğru aktarılmalı",
    source: "GOV.UK — HMRC Employer Guidance",
    items: [
      {
        title: "Automatic enrolment earnings trigger and qualifying earnings band updated for 2026/27",
        published: "15 March 2026",
        summary:
          "The earnings trigger for automatic enrolment remains at £10,000 per annum for 2026/27. The qualifying earnings band is £6,240 to £50,270. Employers must continue to assess and re-enrol eligible jobholders.",
        link: "https://www.gov.uk/government/publications/auto-enrolment-thresholds",
      },
    ],
    expected: {
      importance: ["MEDIUM", "HIGH"],
      mustContain: ["10,000", "50,270"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 13,
    label: "TUPE Amendment — small transfer exemption",
    description: "Eşik rakamları (50, 10) doğru, kuru dil sade çevrilmiş olmalı",
    source: "Legislation.gov.uk — New Statutory Instruments (ERA 2025)",
    items: [
      {
        title: "The Transfer of Undertakings (Protection of Employment) (Amendment) Regulations 2026",
        published: "14 March 2026",
        summary:
          "These regulations amend TUPE 2006 to clarify the information and consultation requirements where the transferee has fewer than 50 employees and the transfer involves fewer than 10 employees. Direct consultation with affected employees is now permitted without requiring election of employee representatives.",
        link: "https://www.legislation.gov.uk/uksi/2026/301/contents/made",
      },
    ],
    expected: {
      importance: ["HIGH", "MEDIUM"],
      mustContain: ["TUPE", "50"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 14,
    label: "Whistleblower Protection — EMPTY CONTENT",
    description: "Boş content: genel bilgi verebilir ama speculation + isim uydurmamalı",
    source: "GOV.UK — Employment Rights Act 2025",
    items: [
      {
        title: "Employment Rights Act 2025 strengthens protection for whistleblowers making protected disclosures",
        published: "13 March 2026",
        summary: "",
        link: "https://www.gov.uk/government/news/whistleblower-protection-era-2025",
      },
    ],
    expected: {
      importance: ["HIGH", "MEDIUM"],
      mustContain: ["whistleblow"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 15,
    label: "Mixed Feed — 2 relevant + 1 noise",
    description: "SSP ve SMP alınmalı, seasonal workers NI campaign atlanmalı",
    source: "GOV.UK — Statutory Pay (SSP/SMP/SPP)",
    items: [
      {
        title: "SSP rate increases to £118.75 per week from 6 April 2026",
        published: "17 March 2026",
        summary:
          "The weekly rate of Statutory Sick Pay increases from £116.75 to £118.75 from 6 April 2026. Employers must update payroll systems accordingly.",
        link: "https://www.gov.uk/government/news/ssp-rate-2026",
      },
      {
        title: "Government launches campaign encouraging seasonal workers to register for NI",
        published: "16 March 2026",
        summary:
          "A new awareness campaign encourages seasonal workers arriving in the UK to register for a National Insurance number before starting work.",
        link: "https://www.gov.uk/government/news/seasonal-workers-ni",
      },
      {
        title: "SMP weekly rate rises to £187.18 from April 2026",
        published: "17 March 2026",
        summary:
          "Statutory Maternity Pay standard rate will increase from £184.03 to £187.18 per week from 6 April 2026.",
        link: "https://www.gov.uk/government/news/smp-rate-2026",
      },
    ],
    expected: {
      importance: ["HIGH", "MEDIUM"],
      mustContain: ["118.75", "187.18"],
      mustNotContain: ["seasonal worker"],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 16,
    label: "Stale Content — 6 months old",
    description: "Eski tarihli haber: Claude tarih doğru aktarmalı, normal alert üretmeli",
    source: "GOV.UK — HMRC Employer Guidance",
    items: [
      {
        title: "Holiday pay calculation guidance updated",
        published: "15 September 2025",
        summary:
          "HMRC has updated guidance on calculating holiday pay for irregular hours and part-year workers following the Working Time (Amendment) Regulations 2023.",
        link: "https://www.gov.uk/guidance/holiday-pay-calculation",
      },
    ],
    expected: {
      importance: ["MEDIUM", "HIGH"],
      mustContain: ["holiday pay", "September 2025"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 17,
    label: "Agency Worker Rights — ERA 2025 day-one equal pay",
    description: "Day-one ve 12-week removed doğru, deadline 6 April aktarılmalı",
    source: "GOV.UK — Employment Rights Act 2025",
    items: [
      {
        title: "New rights for agency workers under Employment Rights Act 2025",
        published: "16 March 2026",
        summary:
          "Agency workers will now be entitled to the same pay as permanent employees from their first day of assignment, replacing the previous 12-week qualifying period under the Agency Workers Regulations 2010. The change takes effect on 6 April 2026.",
        link: "https://www.gov.uk/government/news/agency-worker-rights-2026",
      },
    ],
    expected: {
      importance: ["HIGH", "CRITICAL"],
      mustContain: ["agency", "6 April"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 18,
    label: "Bereavement Leave — new statutory right",
    description: "one week, unpaid, day one, 6 April doğru aktarılmalı",
    source: "GOV.UK — Employment Rights Act 2025",
    items: [
      {
        title: "Unpaid bereavement leave: new right from April 2026",
        published: "15 March 2026",
        summary:
          "A new statutory right to one week of unpaid bereavement leave comes into force on 6 April 2026 for all employees from day one of employment. The right applies regardless of the relationship to the deceased.",
        link: "https://www.gov.uk/government/news/bereavement-leave-2026",
      },
    ],
    expected: {
      importance: ["HIGH", "MEDIUM"],
      mustContain: ["bereavement", "one week"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 19,
    label: "PURE NOISE — 3 completely irrelevant items",
    description: "Hydrogen plant, space grant, diplomacy — hepsi atlanmalı",
    source: "GOV.UK — DBT Employer News",
    items: [
      {
        title: "Prime Minister visits new hydrogen plant in Wales",
        published: "18 March 2026",
        summary:
          "The PM toured a new green hydrogen facility as part of the government's net zero strategy, calling it \"a beacon for British innovation.\"",
        link: "https://www.gov.uk/government/news/pm-hydrogen-plant",
      },
      {
        title: "UK space agency awards £5m grant for satellite monitoring",
        published: "17 March 2026",
        summary:
          "The UK Space Agency has announced new funding for satellite-based environmental monitoring projects.",
        link: "https://www.gov.uk/government/news/space-agency-grant",
      },
      {
        title: "Foreign Secretary meets Japanese counterpart in Tokyo",
        published: "16 March 2026",
        summary:
          "Bilateral discussions focused on trade, security cooperation, and cultural exchange.",
        link: "https://www.gov.uk/government/news/foreign-secretary-tokyo",
      },
    ],
    expected: {
      importance: [],
      mustContain: ["No employer-relevant"],
      mustNotContain: [],
      shouldNotBeSkipped: false,
    },
  },
  {
    id: 20,
    label: "Equal Pay Audit — discrimination tribunal",
    description: "£320,000 doğru, equal pay audit aksiyonu pratik olmalı",
    source: "Employment Tribunal — ERA 2025 Case Decisions",
    items: [
      {
        title: "Company ordered to conduct equal pay audit after losing discrimination claim",
        published: "14 March 2026",
        summary:
          "An Employment Tribunal has ordered a financial services firm to carry out a full equal pay audit covering all roles after finding systemic pay disparities between male and female employees performing equivalent work. The employer was also ordered to pay compensation totalling £320,000.",
        link: "https://www.gov.uk/employment-tribunal-decisions/equal-pay-audit",
      },
    ],
    expected: {
      importance: ["HIGH", "CRITICAL"],
      mustContain: ["320,000", "equal pay"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 21,
    label: "Duplicate-Adjacent — same topic from 2 sources",
    description: "2 NMW haberi: çelişki olmamalı, rakamlar tutarlı",
    source: "GOV.UK — National Minimum Wage Updates",
    items: [
      {
        title: "National Minimum Wage rates from April 2026 confirmed",
        published: "18 March 2026",
        summary: "NLW for 21+ rises to £12.85/hour from 1 April 2026.",
        link: "https://www.gov.uk/government/news/nmw-confirmed-2026",
      },
      {
        title: "Employers reminded to update pay rates ahead of April 2026 changes",
        published: "18 March 2026",
        summary:
          "HMRC is reminding employers that the National Living Wage and NMW rates change from 1 April 2026 and payroll must be updated before the first April pay date.",
        link: "https://www.gov.uk/government/news/hmrc-pay-rates-reminder",
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
    id: 22,
    label: "Right to Disconnect — consultation (not law yet)",
    description: "Henüz yasa değil: consultation olduğu belirtilmeli, 'yürürlükte' DENMEMELİ",
    source: "GOV.UK — Employment Consultations (Make Work Pay)",
    items: [
      {
        title: "Government publishes consultation on right to disconnect for employees",
        published: "12 March 2026",
        summary:
          "The Department for Business and Trade has launched a 12-week public consultation on proposals to introduce a statutory right to disconnect outside working hours. The consultation closes on 4 June 2026. No legislation has been introduced yet.",
        link: "https://www.gov.uk/government/consultations/right-to-disconnect",
      },
    ],
    expected: {
      importance: ["MEDIUM", "HIGH"],
      mustContain: ["consultation"],
      mustNotContain: ["now in force", "comes into force", "must comply"],
      shouldNotBeSkipped: true,
    },
  },
  {
    id: 23,
    label: "Extremely Short — single sentence + title",
    description: "Çok kısa kaynak: makul H&S aksiyonu üretmeli, uydurma detay eklememeli",
    source: "HSE — Health & Safety at Work",
    items: [
      {
        title: "HSE issues safety alert on lithium-ion battery storage in workplaces",
        published: "19 March 2026",
        summary: "Employers are advised to review storage arrangements.",
        link: "https://press.hse.gov.uk/2026/03/19/lithium-battery-alert/",
      },
    ],
    expected: {
      importance: ["MEDIUM", "HIGH"],
      mustContain: ["lithium", "battery"],
      mustNotContain: [],
      shouldNotBeSkipped: true,
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
      body: JSON.stringify({ error: `Scenario ${singleScenario} not found. Valid IDs: 1–23` }),
    };
  }

  // Run all scenarios in parallel — max wall time = slowest single call (~5s)
  const rawResults = await Promise.allSettled(
    scenarios.map(async (scenario) => {
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
      return {
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
        _evaluation: evaluation,
      };
    })
  );

  // Unwrap settled promises; sort by scenario id for consistent order
  const results = rawResults
    .map((r) => (r.status === "fulfilled" ? r.value : { error: r.reason?.message, grade: "ERROR" }))
    .sort((a, b) => (a.id || 0) - (b.id || 0));

  let passCount = 0;
  let partialCount = 0;
  let failCount = 0;
  for (const r of results) {
    if (r._evaluation?.grade === "PASS") passCount++;
    else if (r._evaluation?.grade === "PARTIAL") partialCount++;
    else if (r._evaluation?.grade === "FAIL") failCount++;
    delete r._evaluation; // strip internal field from output
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
