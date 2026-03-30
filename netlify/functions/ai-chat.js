const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");
const { verifyBearerAuth } = require("./lib/verify-token");
const { consumeRateLimit, envInt } = require("./lib/rate-limit");
const {
  extractKeywordTerms,
  sanitizeIlikeTerm,
  parseClaudeJsonResponse,
  normalizeChatPayload,
  DEFAULT_DISCLAIMER,
} = require("./lib/ai-chat-helpers");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const MAX_MESSAGE_CHARS = 4000;
const CHUNK_LIMIT = 5;
const RECENT_ALERT_DAYS = 30;

function cors(event, extra = {}) {
  return makeCorsHeaders(event, { "Content-Type": "application/json", ...extra });
}

function canUseAiChat(plan, status) {
  if (String(status || "").toLowerCase() !== "active") return false;
  const p = String(plan || "").toLowerCase();
  return p === "professional" || p === "agency";
}

function formatAlertDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/London",
    });
  } catch {
    return String(iso || "");
  }
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} sb
 * @param {string} message
 */
async function fetchRelevantChunks(sb, message) {
  const terms = extractKeywordTerms(message);
  let q = sb.from("compliance_chunks").select("id, source_name, source_url, content").limit(24);

  if (terms.length > 0) {
    const ors = terms.map((t) => `content.ilike.%${sanitizeIlikeTerm(t)}%`).join(",");
    q = q.or(ors);
  } else {
    q = q.order("created_at", { ascending: false });
  }

  const { data, error } = await q;
  if (error) {
    console.warn("ai-chat compliance_chunks:", error.message);
    return [];
  }
  const rows = data || [];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= CHUNK_LIMIT) break;
  }
  return out;
}

async function callClaudeJson({ system, user }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.AI_CHAT_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 2200,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const snippet = JSON.stringify(data).slice(0, 600);
    throw new Error(`Anthropic HTTP ${response.status}: ${snippet}`);
  }
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Anthropic empty response");
  }
  const parsed = parseClaudeJsonResponse(text);
  return normalizeChatPayload(parsed);
}

exports.handler = async function (event) {
  const corsHeaders = cors(event);

  if (event.httpMethod === "OPTIONS") return preflight(event);
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const auth = await verifyBearerAuth(event);
  if (!auth.ok) {
    return { statusCode: auth.status, headers: corsHeaders, body: JSON.stringify({ error: auth.message }) };
  }
  const emailNorm = auth.email;

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const message = String(body.message || "").trim();
  if (!message) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Message is required." }) };
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: `Message too long (max ${MAX_MESSAGE_CHARS} characters).` }),
    };
  }

  const rl = await consumeRateLimit(
    supabaseAdmin,
    `ai_chat:${emailNorm}`,
    envInt("AI_CHAT_RATE_MAX", 20),
    envInt("AI_CHAT_RATE_WINDOW", 60)
  );
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Too many requests. Please wait a minute and try again." }),
    };
  }

  try {
    const { data: userRow, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id, industry, company_size")
      .eq("email", emailNorm)
      .maybeSingle();

    if (uErr) throw uErr;
    if (!userRow) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "No account found for this session." }),
      };
    }

    const { data: subRow, error: sErr } = await supabaseAdmin
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", userRow.id)
      .maybeSingle();

    if (sErr) throw sErr;

    const plan = subRow?.plan || "starter";
    const status = subRow?.status || "inactive";

    if (!canUseAiChat(plan, status)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "AI Chat is available on the Professional plan.",
          code: "upgrade_required",
          plan,
        }),
      };
    }

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - RECENT_ALERT_DAYS);

    const { data: alertsRaw, error: aErr } = await supabaseAdmin
      .from("sent_alerts")
      .select("alert_title, sent_at")
      .eq("user_id", userRow.id)
      .gte("sent_at", since.toISOString())
      .order("sent_at", { ascending: false })
      .limit(80);

    if (aErr) throw aErr;

    const recentAlerts = (alertsRaw || []).map((a) => ({
      title: a.alert_title || "Alert",
      date: formatAlertDate(a.sent_at),
    }));

    const chunks = await fetchRelevantChunks(supabaseAdmin, message);

    const systemPrompt = `
You are ActAware's compliance assistant. You help UK employers understand their legal obligations.

USER CONTEXT:
- Sector: ${userRow.industry || "Not specified"}
- Company size: ${userRow.company_size || "Not specified"}
- Plan: ${plan}

RECENT ALERTS THIS USER RECEIVED:
${recentAlerts.length ? recentAlerts.map((a) => `- ${a.title} (${a.date})`).join("\n") : "- (none in the last ${RECENT_ALERT_DAYS} days)"}

RELEVANT COMPLIANCE KNOWLEDGE:
${chunks.length ? chunks.map((c) => `[${c.source_name}]: ${c.content}`).join("\n\n") : "- (no matching knowledge base chunks — answer from general UK employer compliance principles only, and say sources are limited)"}

RULES:
1. Only answer questions about UK employer compliance.
2. If asked anything outside this scope, say: "I can only help with UK employer compliance topics."
3. Always cite which source your answer is based on (use the [bracket] names from RELEVANT COMPLIANCE KNOWLEDGE when applicable).
4. If you don't know, say: "I don't have enough information on this — please check the official source directly."
5. Never give legal advice. End every answer with: "${DEFAULT_DISCLAIMER}"
6. Be specific to the user's sector and company size when context is available.
7. Do not hallucinate legislation, dates, or penalties. If uncertain, say so.

OUTPUT FORMAT — respond with ONLY valid JSON (no markdown fences), exactly one object:
{"answer":"your reply as plain text (must end with the exact disclaimer sentence in RULE 5)","sources":["short source labels you relied on, e.g. HMRC Employer"],"disclaimer":"${DEFAULT_DISCLAIMER}"}
`.trim();

    const userPrompt = `User question:\n${message}`;

    let payload;
    try {
      payload = await callClaudeJson({ system: systemPrompt, user: userPrompt });
    } catch (e) {
      console.error("ai-chat Claude:", e?.message || e);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Something went wrong. Please try again." }),
      };
    }

    if (!payload.answer) {
      payload.answer =
        "I couldn't generate a response. Please try again or check official guidance.";
    }
    if (!payload.disclaimer) payload.disclaimer = DEFAULT_DISCLAIMER;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        answer: payload.answer,
        sources: payload.sources || [],
        disclaimer: payload.disclaimer,
      }),
    };
  } catch (err) {
    console.error("ai-chat:", err?.message || err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Something went wrong. Please try again." }),
    };
  }
};
