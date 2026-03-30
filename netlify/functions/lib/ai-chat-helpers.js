/** @type {Set<string>} */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "her",
  "was",
  "one",
  "our",
  "out",
  "day",
  "get",
  "has",
  "him",
  "his",
  "how",
  "its",
  "may",
  "new",
  "now",
  "old",
  "see",
  "two",
  "way",
  "who",
  "did",
  "let",
  "put",
  "say",
  "she",
  "too",
  "use",
  "what",
  "when",
  "with",
  "have",
  "this",
  "that",
  "from",
  "they",
  "been",
  "into",
  "only",
  "your",
  "some",
  "than",
  "then",
  "them",
  "will",
  "just",
  "also",
]);

/**
 * Terms for ILIKE OR query (MVP keyword RAG).
 * @param {string} message
 * @returns {string[]}
 */
function extractKeywordTerms(message) {
  const raw = String(message || "")
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g);
  if (!raw?.length) return [];
  const uniq = [];
  const seen = new Set();
  for (const w of raw) {
    if (STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    uniq.push(w);
    if (uniq.length >= 8) break;
  }
  return uniq;
}

/** Escape % and _ for PostgREST ilike. */
function sanitizeIlikeTerm(term) {
  return String(term).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Split long digest text into stored chunks.
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string[]}
 */
function splitIntoChunks(text, maxLen = 2000) {
  const t = String(text || "").trim();
  if (!t) return [];
  const paras = t.split(/\n\n+/);
  const merged = [];
  let buf = "";
  for (const p of paras) {
    const next = buf ? `${buf}\n\n${p}` : p;
    if (next.length > maxLen && buf) {
      merged.push(buf.trim());
      buf = p;
    } else {
      buf = next;
    }
  }
  if (buf.trim()) merged.push(buf.trim());
  const out = [];
  for (const c of merged) {
    if (c.length <= maxLen) {
      out.push(c);
      continue;
    }
    for (let i = 0; i < c.length; i += maxLen) {
      out.push(c.slice(i, i + maxLen));
    }
  }
  return out;
}

/**
 * Strip markdown code fences; parse JSON from Claude output.
 * @param {string} text
 * @returns {{ answer?: string, sources?: string[], disclaimer?: string }}
 */
function parseClaudeJsonResponse(text) {
  let t = String(text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-z0-9]*\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  const parsed = JSON.parse(t);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON shape");
  return parsed;
}

const DEFAULT_DISCLAIMER =
  "This is not legal advice. Consult a solicitor for your specific situation.";

function normalizeChatPayload(parsed) {
  const answer = typeof parsed.answer === "string" ? parsed.answer : "";
  const sources = Array.isArray(parsed.sources)
    ? parsed.sources.map((s) => String(s)).filter(Boolean)
    : [];
  let disclaimer = typeof parsed.disclaimer === "string" ? parsed.disclaimer.trim() : "";
  if (!disclaimer) disclaimer = DEFAULT_DISCLAIMER;
  return { answer, sources, disclaimer };
}

module.exports = {
  extractKeywordTerms,
  sanitizeIlikeTerm,
  splitIntoChunks,
  parseClaudeJsonResponse,
  normalizeChatPayload,
  DEFAULT_DISCLAIMER,
  STOPWORDS,
};
