/**
 * Eval: golden_dataset.json → same digest Claude prompt as production → judge call → console + eval_results.
 *
 * Invoke: GET/POST /.netlify/functions/eval-alerts?tier=standard|professional
 * Requires ANTHROPIC_API_KEY, SUPABASE_*, and (production) TEST_FUNCTIONS_SECRET + header.
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { summariseWithClaude } = require("./lib/digest-summarise-claude");
const { assertTestFunctionAllowed } = require("./lib/test-function-guard");

const MODEL = "claude-haiku-4-5-20251001";

function loadGoldenDataset() {
  const candidates = [
    path.join(__dirname, "data", "golden_dataset.json"),
    path.join(__dirname, "..", "..", "data", "golden_dataset.json"),
  ];
  let lastErr = null;
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, "utf8");
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) throw new Error("golden_dataset.json must be a JSON array");
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error(
    "golden_dataset.json not found. Ensure data/golden_dataset.json exists and netlify.toml includes it for eval-alerts."
  );
}

function goldenCaseToItems(c) {
  const link = typeof c.url === "string" && /^https?:\/\//i.test(c.url.trim())
    ? c.url.trim()
    : "https://www.gov.uk/";
  return [
    {
      title: String(c.title || `Eval case ${c.case_id}`).slice(0, 500),
      published: c.published || "recent",
      summary: String(c.input || ""),
      link,
    },
  ];
}

/**
 * First `{...}` object with string-aware brace matching (avoids broken lastIndexOf('}')).
 */
function extractFirstJsonObject(s) {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function normalizeJudgeTextForParse(text) {
  let t = String(text || "").trim();
  // Strip one leading ```json / ``` fence (no need to match whole string)
  t = t.replace(/^```(?:json)?\s*/i, "");
  t = t.replace(/\s*```\s*$/i, "").trim();
  // Smart quotes → ASCII (breaks JSON.parse)
  t = t.replace(/[\u201C\u201D\u2018\u2019]/g, '"');
  return t;
}

function parseJudgeJson(text) {
  const t = normalizeJudgeTextForParse(text);
  const candidate = extractFirstJsonObject(t) || (t.indexOf("{") >= 0 ? t.slice(t.indexOf("{")) : t);
  let fixed = candidate.trim();
  fixed = fixed.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(fixed);
}

function extractAnthropicText(data) {
  const blocks = data?.content;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** Judge JSON uses accuracy/completeness/…; DB columns are *_score (PostgREST needs flat keys). */
function scoresToIntColumns(scores) {
  const empty = {
    accuracy_score: null,
    completeness_score: null,
    actionability_score: null,
    clarity_score: null,
  };
  if (!scores || typeof scores !== "object") return empty;
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.round(x) : null;
  };
  return {
    accuracy_score: n(scores.accuracy),
    completeness_score: n(scores.completeness),
    actionability_score: n(scores.actionability),
    clarity_score: n(scores.clarity),
  };
}

function logEvalInsertError(caseId, insErr) {
  if (!insErr) return;
  console.error(`[eval-alerts] eval_results insert failed (${caseId}):`, insErr.message);
  console.error(
    "[eval-alerts] insert error detail:",
    JSON.stringify(
      {
        message: insErr.message,
        code: insErr.code,
        details: insErr.details,
        hint: insErr.hint,
        status: insErr.status,
      },
      null,
      2
    )
  );
}

async function judgeWithClaude({ sourceLabel, inputText, claudeOutput, expected }) {
  const ref = {
    expected_summary: expected?.expected_summary,
    expected_actions: expected?.expected_actions,
    expected_priority: expected?.expected_priority,
  };

  const prompt = `You are an evaluator for UK employer compliance digest summaries.

SOURCE INPUT (excerpt the summariser saw):
---
Source: ${sourceLabel}
${inputText}
---

MODEL OUTPUT (the summariser's alert text):
---
${claudeOutput}
---

REFERENCE EXPECTATIONS (may be in any language; use to judge whether the model captured the right facts and employer actions — the model output should be English alert format):
${JSON.stringify(ref, null, 2)}

Bu özet doğru ve işveren için kullanılabilir mi? Aşağıdaki kriterleri 1–5 arası TAM SAYI ile puanla (1=zayıf, 5=mükemmel):
- accuracy: facts match the source; no dangerous hallucinations
- completeness: covers main obligation / change for employers
- actionability: concrete "what employers must do" style guidance where appropriate
- clarity: plain English, scannable structure

Return ONLY a single JSON object, no markdown fences, no explanation outside JSON.
Use plain ASCII double quotes and integer scores 1–5 only. Example shape (replace numbers as appropriate):
{"accuracy":4,"completeness":5,"actionability":4,"clarity":5,"brief_rationale":"One short sentence."}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Judge Anthropic HTTP ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  const rawText = extractAnthropicText(data);
  if (!rawText) {
    throw new Error("Judge empty content");
  }
  try {
    const scores = parseJudgeJson(rawText);
    return { rawText, scores, parseError: null };
  } catch (e) {
    return {
      rawText,
      scores: null,
      parseError: e.message || String(e),
    };
  }
}

exports.handler = async function (event) {
  const gate = assertTestFunctionAllowed(event || {});
  if (!gate.ok) return gate.response;

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }),
    };
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return {
      statusCode: 503,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Supabase env not configured" }),
    };
  }

  const params = event.queryStringParameters || {};
  const digestTier = params.tier === "professional" ? "professional" : "standard";

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  let cases;
  try {
    cases = loadGoldenDataset();
  } catch (e) {
    console.error("[eval-alerts] load golden:", e.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: e.message }),
    };
  }

  const summary = { tier: digestTier, cases: cases.length, rows: [], errors: [] };

  for (const c of cases) {
    const caseId = String(c.case_id || "unknown");
    const sourceName = String(c.source || "GOV.UK");
    const items = goldenCaseToItems(c);
    const goldenSnapshot = {
      case_id: c.case_id,
      source: c.source,
      input: c.input,
      expected_summary: c.expected_summary,
      expected_actions: c.expected_actions,
      expected_priority: c.expected_priority,
    };

    let claudeOutput = "";
    let summariserError = null;
    try {
      claudeOutput = await summariseWithClaude(items, sourceName, digestTier);
      console.log(`[eval-alerts] case ${caseId} summariser OK, chars=${claudeOutput.length}`);
      console.log(`[eval-alerts] case ${caseId} output preview:\n${claudeOutput.slice(0, 600)}${claudeOutput.length > 600 ? "…" : ""}`);
    } catch (err) {
      summariserError = err.message;
      console.error(`[eval-alerts] case ${caseId} summariser ERROR:`, summariserError);
      const { error: insErr } = await supabase.from("eval_results").insert({
        case_id: caseId,
        source: sourceName,
        digest_tier: digestTier,
        model: MODEL,
        claude_output: null,
        judge_raw: null,
        scores: null,
        accuracy_score: null,
        completeness_score: null,
        actionability_score: null,
        clarity_score: null,
        judge_error: null,
        summariser_error: summariserError,
        golden_snapshot: goldenSnapshot,
      });
      if (insErr) {
        logEvalInsertError(caseId, insErr);
        summary.errors.push({ case_id: caseId, step: "db", message: insErr.message });
      }
      summary.rows.push({ case_id: caseId, summariser_error: summariserError });
      continue;
    }

    let judgeRaw = "";
    let scores = null;
    let judgeError = null;
    try {
      const j = await judgeWithClaude({
        sourceLabel: sourceName,
        inputText: String(c.input || ""),
        claudeOutput,
        expected: c,
      });
      judgeRaw = j.rawText;
      scores = j.scores;
      if (j.parseError) {
        judgeError = j.parseError;
        console.error(`[eval-alerts] case ${caseId} judge JSON parse failed:`, j.parseError);
      }

      // Judge API'den gelen tam metin (parse öncesi)
      console.log(
        `[eval-alerts] case ${caseId} judge ham yanıt (${String(judgeRaw).length} chars):\n${judgeRaw}`
      );
      // Supabase insert öncesi scores — NULL ise sebep genelde parse hatası veya API hatası
      console.log(
        `[eval-alerts] case ${caseId} scores (Supabase öncesi):`,
        scores === null || scores === undefined ? "NULL" : JSON.stringify(scores)
      );
      if (scores == null) {
        console.log(
          `[eval-alerts] case ${caseId} scores NULL nedeni:`,
          judgeError ||
            "(beklenmeyen: judgeWithClaude parseError döndürmeden scores null — API yanıtını kontrol et)"
        );
      }
    } catch (err) {
      judgeError = err.message;
      console.error(`[eval-alerts] case ${caseId} judge ERROR:`, judgeError);
      console.log(`[eval-alerts] case ${caseId} scores (Supabase öncesi): NULL (judge API/catch)`);
    }

    const scoreCols = scoresToIntColumns(scores);
    console.log(`[eval-alerts] case ${caseId} score columns (Supabase öncesi):`, JSON.stringify(scoreCols));

    const { error: insErr } = await supabase.from("eval_results").insert({
      case_id: caseId,
      source: sourceName,
      digest_tier: digestTier,
      model: MODEL,
      claude_output: claudeOutput,
      judge_raw: judgeRaw || null,
      scores: scoreCols,
      judge_error: judgeError,
      summariser_error: null,
      golden_snapshot: goldenSnapshot,
    });
    if (insErr) {
      logEvalInsertError(caseId, insErr);
      summary.errors.push({ case_id: caseId, step: "db", message: insErr.message });
    }

    summary.rows.push({
      case_id: caseId,
      scores,
      ...scoreCols,
      judge_error: judgeError,
    });
  }

  console.log("[eval-alerts] run complete:", JSON.stringify(summary, null, 2));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, summary }),
  };
};
