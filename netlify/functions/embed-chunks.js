const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");
const { timingSafeEqualStrings } = require("./lib/test-function-guard");
const { splitIntoChunks } = require("./lib/ai-chat-helpers");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function getLondonDateString(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function getEmbedSecret() {
  return (process.env.EMBED_CHUNKS_SECRET || process.env.TEST_FUNCTIONS_SECRET || "").trim();
}

function getProvidedSecret(event) {
  const h = event?.headers || {};
  const bearer = (h.authorization || h.Authorization || "").startsWith("Bearer ")
    ? String(h.authorization || h.Authorization).slice(7).trim()
    : "";
  const header =
    h["x-actaware-embed-secret"] ||
    h["X-Actaware-Embed-Secret"] ||
    "";
  return String(header || bearer || "").trim();
}

function assertEmbedAllowed(event) {
  const configured = getEmbedSecret();
  const isProduction = process.env.CONTEXT === "production";

  if (!configured) {
    if (isProduction) {
      return {
        ok: false,
        response: {
          statusCode: 503,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "embed-chunks is not configured. Set EMBED_CHUNKS_SECRET in Netlify.",
          }),
        },
      };
    }
    return { ok: true };
  }

  const provided = getProvidedSecret(event);
  if (!timingSafeEqualStrings(provided, configured)) {
    return {
      ok: false,
      response: {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Forbidden" }),
      },
    };
  }
  return { ok: true };
}

/**
 * Extract first https URL from text for citation.
 * @param {string} text
 */
function extractUrl(text) {
  const m = String(text || "").match(/https:\/\/[^\s\])"'<>]+/i);
  return m ? m[0].replace(/[.,;]+$/, "") : null;
}

async function fetchEmbedding1536(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const input = String(text || "").slice(0, 8000);
  if (!input.trim()) return null;

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.warn("embed-chunks OpenAI:", res.status, errText.slice(0, 400));
    return null;
  }
  const data = await res.json();
  const emb = data?.data?.[0]?.embedding;
  return Array.isArray(emb) && emb.length === 1536 ? emb : null;
}

function cors(event) {
  return makeCorsHeaders(event, { "Content-Type": "application/json" });
}

exports.handler = async function (event) {
  const h = cors(event);
  if (event.httpMethod === "OPTIONS") return preflight(event);
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: h(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const gate = assertEmbedAllowed(event);
  if (!gate.ok) {
    const r = gate.response;
    return { statusCode: r.statusCode, headers: { ...cors(event), ...r.headers }, body: r.body };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }

  const lookbackDays = Math.min(120, Math.max(7, parseInt(body.lookbackDays || "90", 10) || 90));
  const wipePrefix = body.wipeDigestPrefix !== false;

  try {
    if (wipePrefix) {
      const { error: delErr } = await supabaseAdmin
        .from("compliance_chunks")
        .delete()
        .like("source_name", "ActAware digest%");
      if (delErr) console.warn("embed-chunks delete:", delErr.message);
    }

    const end = new Date();
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - lookbackDays);
    const sinceStr = getLondonDateString(start);
    const untilStr = getLondonDateString(end);

    const { data: snaps, error: qErr } = await supabaseAdmin
      .from("digest_snapshots")
      .select("digest_date, alert_title, alert_summary, alert_source")
      .gte("digest_date", sinceStr)
      .lte("digest_date", untilStr)
      .order("digest_date", { ascending: false });

    if (qErr) throw qErr;

    const rows = snaps || [];
    const toInsert = [];

    for (const snap of rows) {
      const summary = String(snap.alert_summary || "").trim();
      if (!summary) continue;
      const parts = splitIntoChunks(summary, 2000);
      const digestDate = snap.digest_date || "";
      const title = String(snap.alert_title || "").slice(0, 300);

      let idx = 0;
      for (const chunk of parts) {
        idx += 1;
        const sourceUrl = extractUrl(chunk) || extractUrl(summary);
        const sourceName =
          parts.length > 1
            ? `ActAware digest · ${digestDate} · ${title} (${idx}/${parts.length})`
            : `ActAware digest · ${digestDate} · ${title}`;

        toInsert.push({
          source_name: sourceName.slice(0, 900),
          source_url: sourceUrl,
          content: chunk,
          embedding: null,
        });
      }
    }

    let inserted = 0;
    const batchSize = 40;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const batch = toInsert.slice(i, i + batchSize);
      const withEmb = await Promise.all(
        batch.map(async (row) => {
          const emb = await fetchEmbedding1536(row.content);
          if (!emb) return row;
          return { ...row, embedding: emb };
        })
      );

      const { error: insErr } = await supabaseAdmin.from("compliance_chunks").insert(withEmb);
      if (insErr) {
        const fallback = withEmb.map(({ embedding, ...rest }) => rest);
        const { error: insErr2 } = await supabaseAdmin.from("compliance_chunks").insert(fallback);
        if (insErr2) throw insErr2;
      }
      inserted += batch.length;
    }

    console.log(
      `embed-chunks: digest rows=${rows.length}, chunks=${toInsert.length}, inserted=${inserted}, openai=${!!process.env.OPENAI_API_KEY}`
    );

    return {
      statusCode: 200,
      headers: h(),
      body: JSON.stringify({
        ok: true,
        digestRows: rows.length,
        chunks: toInsert.length,
        inserted,
        lookbackDays,
        embeddingModel: process.env.OPENAI_API_KEY ? "text-embedding-3-small" : null,
      }),
    };
  } catch (err) {
    console.error("embed-chunks:", err?.message || err);
    return {
      statusCode: 500,
      headers: h(),
      body: JSON.stringify({ error: err?.message || "Embed failed" }),
    };
  }
};
