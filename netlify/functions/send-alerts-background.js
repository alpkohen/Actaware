const { createClient } = require("@supabase/supabase-js");
const Resend = require("resend").Resend;
const { getResendFrom } = require("./lib/resend-from");
const { getSiteUrl } = require("./lib/site-url");
const { escapeHtml, safeHttpUrl, textToEmailHtml, formatSectorNoteForEmail } = require("./lib/html-escape");
const {
  RSS_FEEDS,
  MONITORED_FEED_COUNT,
  fetchRSS,
  parseRSSItems,
  selectItemsInWindow,
} = require("./lib/employer-feeds");
const { tryAcquireDigestLock } = require("./lib/digest-run-lock");
const { runWithConcurrency } = require("./lib/run-with-concurrency");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * @param {"standard" | "professional"} digestTier - Professional adds governance, timeline, cross-checks (matches pricing page).
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
- For each relevant update use this exact format:

**[Title]** (Importance: CRITICAL/HIGH/MEDIUM)
Published: [date from source, formatted as e.g. 19 March 2026]
What changed: [1 sentence summarising what happened or changed]
What employers must do:
- [specific action]
- [specific action]
Risk if ignored: [consequence for employers]
Source: [URL]${proBlocks}`;
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

function escapeHtmlAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

/**
 * Professional/Agency: short sector-specific angle on today's digest (one Haiku call per subscriber).
 */
async function buildSectorNoteForSubscriber(alertSections, industry, companyName) {
  const ind = String(industry || "").trim();
  if (!ind || !process.env.ANTHROPIC_API_KEY) return "";

  const excerpt = (alertSections || [])
    .map((s) => `[${s.source}]\n${String(s.content || "").slice(0, 2500)}`)
    .join("\n\n---\n\n")
    .slice(0, 14000);
  if (!excerpt.trim()) return "";

  const prompt = `The employer receives a UK employer compliance digest. Their sector/industry is: "${ind}".
Company (may be empty): "${String(companyName || "").trim()}".

Digest excerpts (from official UK sources, as summarised):
---
${excerpt}
---

Write exactly 3 bullet points in plain text only. Each line must start with "- " (dash then space). Say which themes above matter most for employers in this sector and any sector-specific watch-outs. Do not invent legal facts not hinted in the excerpts; if thin, say what to monitor generally. Never use HTML tags (<ul>, <li>, <p>, etc.) — only plain lines starting with "- ".`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    console.warn("sector note Anthropic:", response.status, JSON.stringify(data).slice(0, 200));
    return "";
  }
  const raw = data?.content?.[0]?.text;
  if (typeof raw !== "string" || !raw.trim()) return "";

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-"));
  if (!lines.length) return "";
  const items = lines
    .map((l) => {
      const t = escapeHtmlAttr(l.replace(/^-\s*/, ""));
      return `<li style="margin:6px 0;line-height:1.5;">${t}</li>`;
    })
    .join("");
  return `<ul style="margin:0;padding-left:20px;">${items}</ul>`;
}

const PLAN_RANK = { agency: 4, professional: 3, starter: 2, trial: 1 };

async function getActiveUsers() {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "user_id, plan, trial_ends_at, stripe_subscription_id, users(email, company_name, industry, first_name, last_name)"
    )
    .eq("status", "active");
  if (error) throw error;
  const rows = data || [];
  const now = Date.now();
  const eligible = rows.filter((row) => {
    if (row.plan === "trial") {
      return row.trial_ends_at && new Date(row.trial_ends_at).getTime() > now;
    }
    return true;
  });
  // One row per user — prefer paid plan over trial if duplicates ever exist
  const byUser = new Map();
  for (const row of eligible) {
    const prev = byUser.get(row.user_id);
    const r = PLAN_RANK[row.plan] || 0;
    const pr = prev ? PLAN_RANK[prev.plan] || 0 : -1;
    if (!prev || r > pr) byUser.set(row.user_id, row);
  }
  return [...byUser.values()];
}

function usesProfessionalDigest(plan) {
  return plan === "professional" || plan === "agency";
}

/**
 * Fetch all feeds, run Claude per feed for one digest tier. Returns sections + outcomes for logging.
 */
async function buildDigestSections(runId, cutoff, digestTier, forceQuietDayPreview) {
  const alertSections = [];
  const feedOutcomes = [];

  if (forceQuietDayPreview) {
    feedOutcomes.push({
      feed: "(preview — feeds skipped)",
      itemsInWindow: 0,
      inDigest: false,
      status: "force_quiet_day_preview",
      detail: null,
      digestTier,
    });
    return { alertSections, feedOutcomes };
  }

  for (const feed of RSS_FEEDS) {
    const filterSpec = feed.filterKeywords || feed.filterKeyword || null;
    const outcome = {
      feed: feed.name,
      itemsInWindow: 0,
      inDigest: false,
      status: "pending",
      detail: null,
      digestTier,
    };

    try {
      const xml = await fetchRSS(feed.url);
      const allItems = parseRSSItems(xml, filterSpec);
      const items = selectItemsInWindow(allItems, cutoff, feed);

      outcome.itemsInWindow = items.length;
      console.log(`[${digestTier}] Feed "${feed.name}": ${items.length} items (36h window)`);

      await logRawFeed(runId, feed, items);

      if (items.length === 0) {
        outcome.status = "no_items_in_window";
        feedOutcomes.push(outcome);
        continue;
      }

      let content;
      try {
        content = await summariseWithClaude(items, feed.name, digestTier);
      } catch (aiErr) {
        outcome.status = "claude_error";
        outcome.detail = aiErr.message;
        feedOutcomes.push(outcome);
        await logFeedError(runId, feed, new Error(`Anthropic: ${aiErr.message}`));
        continue;
      }

      const skipDigest =
        content.includes("No employer-relevant updates") ||
        content.includes("insufficient information") ||
        content.includes("cannot write") ||
        content.includes("titles and metadata");

      if (skipDigest) {
        outcome.status = "claude_no_employer_relevant";
        feedOutcomes.push(outcome);
        continue;
      }

      alertSections.push({ source: feed.name, content, priority: feed.priority || "medium" });
      outcome.inDigest = true;
      outcome.status = "in_digest";
      feedOutcomes.push(outcome);
    } catch (err) {
      outcome.status = "fetch_or_parse_error";
      outcome.detail = err.message;
      feedOutcomes.push(outcome);
      await logFeedError(runId, feed, err);
    }
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2 };
  alertSections.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

  return { alertSections, feedOutcomes };
}

// ── Audit: log raw parsed items to Supabase before Claude sees them ──────────
async function logRawFeed(runId, feed, items) {
  const { error } = await supabase.from("raw_feed_logs").insert({
    run_id: runId,
    feed_name: feed.name,
    feed_url: feed.url,
    item_count: items.length,
    items_json: items,
  });
  if (error) console.error(`raw_feed_logs insert failed [${feed.name}]: ${error.message}`);
}

// ── Error logging: persists feed failures to Supabase + sends alert email ────
async function logFeedError(runId, feed, err) {
  console.error(`Feed error [${feed.name}]: ${err.message}`);

  await supabase.from("feed_fetch_errors").insert({
    run_id: runId,
    feed_name: feed.name,
    feed_url: feed.url,
    error_message: err.message,
  });

  if (!process.env.ALERT_EMAIL) return;

  const isCritical = feed.priority === "critical";

  if (isCritical) {
    // Critical feeds: immediate email — every failure
    const feedHref = safeHttpUrl(feed.url) || "#";
    await resend.emails.send({
      from: getResendFrom(),
      to: process.env.ALERT_EMAIL,
      subject: `🚨 [ActAware] CRITICAL feed error: ${feed.name}`,
      html: `<p style="font-family:sans-serif;">
               <strong style="color:#dc2626;">CRITICAL feed failure</strong> — this feed is priority:critical and affects all user alerts.<br><br>
               <strong>Feed:</strong> ${escapeHtml(feed.name)}<br>
               <strong>Error:</strong> ${escapeHtml(err.message)}<br>
               <strong>URL:</strong> <a href="${escapeHtml(feedHref)}">${escapeHtml(feed.url)}</a><br>
               <strong>Run:</strong> <code>${escapeHtml(runId)}</code>
             </p>`,
    }).catch((mailErr) => console.error(`Alert email failed: ${mailErr.message}`));
  } else {
    // Non-critical: only alert after 3+ errors in the last 3 days
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("feed_fetch_errors")
      .select("id")
      .eq("feed_name", feed.name)
      .gte("occurred_at", since);
    const errorCount = (data || []).length;

    if (errorCount >= 3) {
      const feedHref2 = safeHttpUrl(feed.url) || "#";
      await resend.emails.send({
        from: getResendFrom(),
        to: process.env.ALERT_EMAIL,
        subject: `⚠️ [ActAware] Feed failing ${errorCount}x in 3 days: ${feed.name}`,
        html: `<p style="font-family:sans-serif;">
                 Feed <strong>${escapeHtml(feed.name)}</strong> has failed <strong>${errorCount} times in the last 3 days</strong>.<br><br>
                 <strong>Latest error:</strong> ${escapeHtml(err.message)}<br>
                 <strong>URL:</strong> <a href="${escapeHtml(feedHref2)}">${escapeHtml(feed.url)}</a><br>
                 <strong>Run:</strong> <code>${escapeHtml(runId)}</code>
               </p>`,
      }).catch((mailErr) => console.error(`Alert email failed: ${mailErr.message}`));
    }
  }
}

// ── Daily feed health report ──────────────────────────────────────────────────
async function sendDailyHealthReport(feedOutcomes, runId, dateLabel) {
  if (!process.env.ALERT_EMAIL) return;
  if (!feedOutcomes || feedOutcomes.length === 0) return;

  // Deduplicate by feed name (standard + professional tiers run same feeds);
  // keep the "worst" status for each feed.
  const STATUS_RANK = { fetch_or_parse_error: 3, claude_error: 2 };
  const rank = (s) => STATUS_RANK[s] || 1;
  const byFeed = new Map();
  for (const o of feedOutcomes) {
    if (!o.feed || o.feed.startsWith("(")) continue; // skip force-preview placeholder
    const prev = byFeed.get(o.feed);
    if (!prev || rank(o.status) > rank(prev.status)) byFeed.set(o.feed, o);
  }
  const outcomes = [...byFeed.values()];
  if (outcomes.length === 0) return;

  const brokenFetch = outcomes.filter((o) => o.status === "fetch_or_parse_error");
  const brokenClaude = outcomes.filter((o) => o.status === "claude_error");
  const totalFeeds = RSS_FEEDS.length;
  const fetchOk = totalFeeds - brokenFetch.length;
  const allOk = brokenFetch.length === 0 && brokenClaude.length === 0;

  const rowStyle = "padding:9px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;";
  const feedRows = outcomes.map((o) => {
    const isFetchErr = o.status === "fetch_or_parse_error";
    const isClaudeErr = o.status === "claude_error";
    const statusCell = isFetchErr
      ? `<span style="color:#dc2626;font-weight:700;">✗ Fetch failed</span>${o.detail ? `<br><span style="color:#9ca3af;font-size:11px;">${escapeHtml(o.detail)}</span>` : ""}`
      : isClaudeErr
      ? `<span style="color:#d97706;font-weight:700;">⚠ AI error</span>`
      : `<span style="color:#16a34a;">✓ OK</span>`;
    return `<tr style="${isFetchErr ? "background:#fef2f2;" : ""}">
      <td style="${rowStyle}color:#111827;">${escapeHtml(o.feed)}</td>
      <td style="${rowStyle}text-align:right;">${statusCell}</td>
    </tr>`;
  }).join("");

  const bannerBg = allOk ? "#f0fdf4" : "#fef9c3";
  const bannerColor = allOk ? "#16a34a" : "#92400e";
  const statusIcon = allOk ? "✅" : "⚠️";
  const subjectStatus = allOk
    ? `${fetchOk}/${totalFeeds} feeds OK`
    : `${brokenFetch.length} broken — ${fetchOk}/${totalFeeds} OK`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:24px 16px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden;">
  <tr><td style="background:#0f172a;padding:20px 24px;">
    <div style="font-size:16px;font-weight:700;color:#fff;">ActAware — Feed Health Report</div>
    <div style="font-size:12px;color:#94a3b8;margin-top:2px;">${escapeHtml(dateLabel)} &middot; <code style="font-size:11px;">${escapeHtml(runId)}</code></div>
  </td></tr>
  <tr><td style="padding:16px 24px;background:${bannerBg};border-bottom:1px solid #e5e7eb;">
    <div style="font-size:22px;font-weight:700;color:${bannerColor};">${statusIcon} ${fetchOk} / ${totalFeeds} feeds healthy</div>
    ${brokenFetch.length > 0 ? `<div style="font-size:13px;color:#92400e;margin-top:6px;">${brokenFetch.length} feed(s) failed to fetch — users may have missed updates from these sources.</div>` : ""}
    ${brokenClaude.length > 0 ? `<div style="font-size:13px;color:#b45309;margin-top:4px;">${brokenClaude.length} feed(s) fetched OK but AI summarisation failed.</div>` : ""}
  </td></tr>
  <tr><td style="padding:0 24px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <tr style="background:#f8fafc;">
        <th style="padding:9px 14px;font-size:11px;text-align:left;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Feed</th>
        <th style="padding:9px 14px;font-size:11px;text-align:right;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Status</th>
      </tr>
      ${feedRows}
    </table>
  </td></tr>
</table>
</body></html>`;

  await resend.emails.send({
    from: getResendFrom(),
    to: process.env.ALERT_EMAIL,
    subject: `[ActAware] ${statusIcon} Feed Health: ${subjectStatus} — ${dateLabel}`,
    html,
  }).catch((mailErr) => console.error(`Health report email failed: ${mailErr.message}`));
}

/** Pull **Field name:** value until next **Heading or Source: */
function extractMarkdownField(block, fieldName) {
  const marker = `**${fieldName}:**`;
  const idx = block.indexOf(marker);
  if (idx === -1) return "";
  let pos = idx + marker.length;
  while (pos < block.length && /[\s\n\r]/.test(block[pos])) pos++;
  const rest = block.slice(pos);
  const stopBold = rest.search(/\n\*\*[A-Za-z]/);
  const src = rest.search(/\nSource:\s*/i);
  let cut = rest.length;
  if (stopBold >= 0) cut = Math.min(cut, stopBold);
  if (src >= 0) cut = Math.min(cut, src);
  return rest.slice(0, cut).trim();
}

function parseAlertsFromText(text, sourceName) {
  const alertBlocks = [];
  const parts = text.split(/(?=\*\*[^\n]+\*\*\s*\(Importance:)/i);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed.length < 20) continue;
    const impMatch = trimmed.match(/\(Importance:\s*(CRITICAL|HIGH|MEDIUM|LOW)\)/i);
    const importance = impMatch ? impMatch[1].toUpperCase() : "MEDIUM";
    const titleMatch = trimmed.match(/\*\*([^\*]+)\*\*/);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const changedMatch = trimmed.match(/What changed:\s*([^\n]+(?:\n(?!What employers|Risk if|Source:)[^\n]+)*)/i);
    const whatChanged = changedMatch ? changedMatch[1].trim() : "";
    const actionsMatch = trimmed.match(/What employers must do:\s*\n((?:\s*-[^\n]+\n?)+)/i);
    const actions = actionsMatch
      ? actionsMatch[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean)
      : [];
    const publishedMatch = trimmed.match(/Published:\s*([^\n]+)/i);
    const published = publishedMatch ? publishedMatch[1].trim() : "";
    const riskMatch = trimmed.match(/Risk if ignored:\s*([^\n]+)/i);
    const risk = riskMatch ? riskMatch[1].trim() : "";
    const sourceMatch = trimmed.match(/Source:\s*(https?:\/\/[^\s]+)/i);
    const sourceUrl = sourceMatch ? sourceMatch[1].trim() : "";
    const severityRationale = extractMarkdownField(trimmed, "Severity rationale");
    const governanceOwnership = extractMarkdownField(trimmed, "Governance & ownership");
    const suggestedTimeline = extractMarkdownField(trimmed, "Suggested timeline");
    const crossChecks = extractMarkdownField(trimmed, "Cross-checks");
    if (title || whatChanged) {
      alertBlocks.push({
        importance,
        title,
        published,
        whatChanged,
        actions,
        risk,
        sourceUrl,
        sourceName,
        severityRationale,
        governanceOwnership,
        suggestedTimeline,
        crossChecks,
      });
    }
  }
  return alertBlocks;
}

function importanceBadgeHTML(importance) {
  const map = {
    CRITICAL: "background:#fee2e2;color:#991b1b;",
    HIGH: "background:#fef3c7;color:#92400e;",
    MEDIUM: "background:#dbeafe;color:#1e40af;",
    LOW: "background:#f3f4f6;color:#6b7280;",
  };
  const label = map[importance] ? importance : "MEDIUM";
  const style = map[label];
  return `<span style="${style}font-size:10px;font-weight:700;padding:3px 9px;border-radius:4px;text-transform:uppercase;letter-spacing:0.5px;">${label}</span>`;
}

function buildAlertCardHTML(alert) {
  const actionsHTML =
    alert.actions.length > 0
      ? `<ul style="margin:6px 0 0 18px;color:#4b5563;line-height:1.8;padding:0 0 0 4px;">${alert.actions.map((a) => `<li style="margin-bottom:4px;font-size:14px;">${escapeHtml(a)}</li>`).join("")}</ul>`
      : "";
  const cc = alert.crossChecks ? textToEmailHtml(alert.crossChecks) : "";
  const proBits = [
    alert.severityRationale &&
      `<p style="margin:10px 0 6px;font-size:13px;color:#374151;line-height:1.55;"><strong style="color:#111827;">Severity rationale:</strong> ${escapeHtml(alert.severityRationale)}</p>`,
    alert.governanceOwnership &&
      `<p style="margin:0 0 6px;font-size:13px;color:#374151;line-height:1.55;"><strong style="color:#111827;">Governance & ownership:</strong> ${escapeHtml(alert.governanceOwnership)}</p>`,
    alert.suggestedTimeline &&
      `<p style="margin:0 0 6px;font-size:13px;color:#374151;line-height:1.55;"><strong style="color:#111827;">Suggested timeline:</strong> ${escapeHtml(alert.suggestedTimeline)}</p>`,
    alert.crossChecks &&
      `<p style="margin:0 0 6px;font-size:13px;color:#374151;line-height:1.55;"><strong style="color:#111827;">Cross-checks:</strong><br>${cc}</p>`,
  ].filter(Boolean);
  const proHTML =
    proBits.length > 0
      ? `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed #cbd5e1;">${proBits.join("")}</div>`
      : "";
  const href = safeHttpUrl(alert.sourceUrl);
  const sourceLink = href
    ? `<p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">Source: <a href="${escapeHtml(href)}" style="color:#6366f1;text-decoration:none;">${escapeHtml(href)}</a></p>`
    : "";
  return `
    <div style="background:#f8f9fa;border:1px solid #e5e7eb;border-radius:8px;padding:18px 20px;margin-bottom:14px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6366f1;margin-bottom:8px;">${escapeHtml(alert.sourceName)}</div>
      ${importanceBadgeHTML(alert.importance)}
      ${alert.published ? `<span style="font-size:11px;color:#9ca3af;margin-left:8px;">${escapeHtml(alert.published)}</span>` : ""}
      ${alert.title ? `<p style="margin:10px 0 6px;font-size:15px;font-weight:700;color:#111827;line-height:1.4;">${escapeHtml(alert.title)}</p>` : ""}
      ${alert.whatChanged ? `<p style="margin:0 0 10px;font-size:14px;color:#4b5563;line-height:1.6;"><strong style="color:#111827;">What changed:</strong> ${escapeHtml(alert.whatChanged)}</p>` : ""}
      ${alert.actions.length > 0 ? `<p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#111827;">What employers must do:</p>${actionsHTML}` : ""}
      ${alert.risk ? `<p style="margin:10px 0 8px;font-size:14px;color:#4b5563;"><strong style="color:#111827;">Risk if ignored:</strong> ${escapeHtml(alert.risk)}</p>` : ""}
      ${proHTML}
      ${sourceLink}
    </div>
  `;
}

function formatUKDate(d) {
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function buildEmailHTML(companyName, alertSections, dateLabel, sectorNoteHtml = "") {
  const siteBase = getSiteUrl();
  const sectorSafe = sectorNoteHtml ? formatSectorNoteForEmail(sectorNoteHtml) : "";
  const greeting = companyName
    ? `Hi <strong>${escapeHtml(companyName)}</strong>`
    : "Hi there";
  const allCards = alertSections.flatMap(section =>
    parseAlertsFromText(section.content, section.source)
  );
  const sectionsHTML = allCards.length > 0
    ? allCards.map(buildAlertCardHTML).join("")
    : alertSections.map(s => `
        <div style="background:#f8f9fa;border:1px solid #e5e7eb;border-radius:8px;padding:18px 20px;margin-bottom:14px;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6366f1;margin-bottom:8px;">${escapeHtml(s.source)}</div>
          <p style="font-size:14px;color:#4b5563;line-height:1.7;margin:0;">${textToEmailHtml(s.content)}</p>
        </div>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ActAware — ${escapeHtml(dateLabel)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:28px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">ActAware</div>
              <div style="font-size:13px;color:#94a3b8;margin-top:2px;">UK Employer Compliance Alerts</div>
            </td>
            <td align="right">
              <div style="background:#1e293b;border-radius:6px;padding:6px 12px;display:inline-block;">
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Daily</div>
                <div style="font-size:14px;font-weight:700;color:#ffffff;line-height:1.3;max-width:140px;text-align:right;">${escapeHtml(dateLabel)}</div>
              </div>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="background:#ffffff;padding:24px 32px 8px;">
        <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
          ${greeting},
        </p>
        <p style="margin:12px 0 0;font-size:15px;color:#374151;line-height:1.6;">
          Here are today's UK employer compliance updates from our monitored official sources:
        </p>
      </td></tr>
      ${
        sectorSafe
          ? `<tr><td style="background:#fffbeb;border-left:4px solid #f59e0b;padding:16px 32px;">
        <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.5px;">Tailored to your sector</p>
        <div style="font-size:14px;color:#451a03;">${sectorSafe}</div>
      </td></tr>`
          : ""
      }
      <tr><td style="background:#ffffff;padding:16px 32px;">
        ${sectionsHTML}
      </td></tr>
      <tr><td style="background:#eff6ff;border-top:1px solid #bfdbfe;border-bottom:1px solid #bfdbfe;padding:16px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:12px;font-weight:600;color:#1d4ed8;text-transform:uppercase;letter-spacing:1px;">Key deadline</td>
          </tr>
          <tr>
            <td style="font-size:14px;color:#1e40af;padding-top:4px;">6 April 2026 — Employment Rights Act 2025 Phase 1 comes into force</td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="background:#f8fafc;border-radius:0 0 12px 12px;padding:20px 32px;border-top:1px solid #e2e8f0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:12px;color:#9ca3af;line-height:1.6;">
              You're receiving this because you subscribed to ActAware.<br>
              All information is sourced directly from official UK government sources.<br>
              <a href="${escapeHtml(siteBase)}" style="color:#6366f1;text-decoration:none;">Manage subscription</a>
            </td>
            <td align="right" style="font-size:11px;color:#d1d5db;white-space:nowrap;">
              actaware.co.uk
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Short “all quiet” email when no employer-relevant items made the digest. */
function buildQuietDayEmailHTML(companyName, dateLabel) {
  const siteBase = getSiteUrl();
  const greeting = companyName
    ? `Hi <strong>${escapeHtml(companyName)}</strong>`
    : "Hi there";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ActAware — Quiet day</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:28px 32px;">
        <div style="font-size:20px;font-weight:700;color:#ffffff;">ActAware</div>
        <div style="font-size:13px;color:#94a3b8;margin-top:2px;">UK Employer Compliance — daily check-in</div>
      </td></tr>
      <tr><td style="background:#ffffff;padding:28px 32px;">
        <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
          ${greeting},
        </p>
        <p style="margin:16px 0 0;font-size:15px;color:#374151;line-height:1.65;">
          We scanned our <strong>${MONITORED_FEED_COUNT} monitored official UK sources</strong> for items published in the last ~36 hours (covering “yesterday” across time zones). <strong>Nothing new surfaced that required an employer-facing compliance alert today.</strong>
        </p>
        <p style="margin:16px 0 0;font-size:14px;color:#6b7280;line-height:1.65;">
          That does not mean nothing happened in the wider world — only that, within the official feeds we track, there was no material employer-relevant change worth a full briefing. We’ll be back tomorrow at the usual time if anything moves.
        </p>
        <p style="margin:20px 0 0;padding:14px 16px;background:#f8fafc;border-radius:8px;font-size:12px;color:#9ca3af;line-height:1.6;border:1px solid #e2e8f0;">
          <strong style="color:#64748b;">Disclaimer:</strong> ActAware summarises official UK government and regulator sources for information only. This is not legal advice — verify against primary sources and consult a solicitor for your situation.
        </p>
      </td></tr>
      <tr><td style="background:#f8fafc;border-radius:0 0 12px 12px;padding:20px 32px;border-top:1px solid #e2e8f0;">
        <span style="font-size:12px;color:#9ca3af;">${dateLabel}</span>
        <span style="float:right;font-size:12px;"><a href="${escapeHtml(siteBase)}" style="color:#6366f1;text-decoration:none;">Manage subscription</a></span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/** Netlify cron is UTC-only; we schedule hourly and only run the job during the 08:00 hour in Europe/London (GMT/BST). */
function getLondonHour() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  return parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
}

/** YYYY-MM-DD in Europe/London (for digest_snapshots.unique digest_date). */
function getLondonDateString(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Persists the standard-tier digest so dashboard can show last-30-days history
 * when a user has no sent_alerts rows yet (e.g. new signup same day).
 */
async function upsertDigestSnapshot({
  runId,
  shortDate,
  sectionsStandard,
  testRun,
  forceQuietDayPreview,
}) {
  if (testRun || forceQuietDayPreview) return;
  const isQuiet = !sectionsStandard || sectionsStandard.length === 0;
  const title = isQuiet
    ? `Daily check-in — no new updates (${shortDate})`
    : `Daily UK Employer Compliance — ${shortDate}`;
  const summary = isQuiet
    ? "No employer-relevant changes detected across monitored official UK sources in the last ~36 hours."
    : sectionsStandard.map((s) => `[${s.source}] ${s.content}`).join("\n\n");
  const sources = isQuiet ? "system — quiet day" : sectionsStandard.map((s) => s.source).join(", ");
  const importance = isQuiet
    ? "medium"
    : sectionsStandard.some((s) => s.priority === "critical")
      ? "critical"
      : "high";
  const digestDate = getLondonDateString();

  const { error } = await supabase.from("digest_snapshots").upsert(
    {
      digest_date: digestDate,
      run_id: runId,
      kind: isQuiet ? "quiet_day" : "digest",
      alert_title: title,
      alert_summary: summary.slice(0, 120000),
      alert_source: sources,
      importance,
    },
    { onConflict: "digest_date" }
  );
  if (error) console.error(`digest_snapshots upsert failed: ${error.message}`);
}

exports.handler = async function () {
  const testRun = process.env.SEND_ALERTS_TEST_RUN === "true";

  if (!testRun) {
    const londonHour = getLondonHour();
    if (londonHour !== 8) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          skipped: true,
          reason: "Not 08:00 Europe/London",
          londonHour,
        }),
      };
    }
  }

  const runId = `run_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDate = new Date();
  const dateLabel = formatUKDate(runDate);
  const shortDate = runDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const testEmailOnly = process.env.TEST_EMAIL_ONLY?.trim();
  const forceQuietDayPreview = process.env.FORCE_QUIET_DAY_EMAIL === "true";
  if (forceQuietDayPreview && !testEmailOnly) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "FORCE_QUIET_DAY_EMAIL requires TEST_EMAIL_ONLY (only sends to that address).",
      }),
    };
  }

  // S-5: one production digest per London calendar day (duplicate cron / warm starts).
  if (!testRun && !forceQuietDayPreview) {
    const lockKey = `daily_digest:${getLondonDateString()}`;
    const lock = await tryAcquireDigestLock(supabase, lockKey, runId);
    if (lock.duplicate) {
      return {
        statusCode: 200,
        body: JSON.stringify({ skipped: true, reason: "duplicate_run", lockKey }),
      };
    }
    if (lock.error) {
      console.error("digest_run_lock insert failed:", lock.error.message || lock.error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Could not acquire digest lock" }),
      };
    }
  }

  // ~36 hours: “yesterday” plus timezone / feed-delay slack. Daily run avoids re-sending stale undated items.
  const cutoff = Date.now() - 36 * 60 * 60 * 1000;

  let baseUsers;
  try {
    baseUsers = await getActiveUsers();
  } catch (err) {
    console.error("FATAL: getActiveUsers failed — aborting digest run:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "User fetch failed", detail: err.message }),
    };
  }
  if (baseUsers.length === 0 && !testRun && !forceQuietDayPreview && !testEmailOnly) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: "No active subscribers" }),
    };
  }

  const needProfessionalDigest =
    baseUsers.some((u) => usesProfessionalDigest(u.plan)) || testRun || forceQuietDayPreview;
  const needStandardDigest =
    baseUsers.some((u) => !usesProfessionalDigest(u.plan)) || testRun || forceQuietDayPreview;

  let sectionsStandard = [];
  let sectionsProfessional = [];
  /** Per-feed outcomes (may include both standard + professional tier runs) */
  const feedOutcomes = [];

  if (needStandardDigest) {
    const r = await buildDigestSections(runId, cutoff, "standard", forceQuietDayPreview);
    sectionsStandard = r.alertSections;
    feedOutcomes.push(...r.feedOutcomes);
  }
  if (needProfessionalDigest) {
    const r = await buildDigestSections(runId, cutoff, "professional", forceQuietDayPreview);
    sectionsProfessional = r.alertSections;
    feedOutcomes.push(...r.feedOutcomes);
  }

  if (needStandardDigest) {
    await upsertDigestSnapshot({
      runId,
      shortDate,
      sectionsStandard,
      testRun,
      forceQuietDayPreview,
    });
  }

  if (forceQuietDayPreview) {
    console.log("FORCE_QUIET_DAY_EMAIL: skipping RSS/Claude; sending quiet-day template only");
  }

  const mailTestPrefix = testRun || forceQuietDayPreview ? "[TEST] " : "";

  let users = baseUsers;
  if (testEmailOnly) {
    const match = users.find(
      (u) => u.users?.email?.toLowerCase() === testEmailOnly.toLowerCase()
    );
    users = match
      ? [match]
      : [{ user_id: null, plan: "test", users: { email: testEmailOnly, company_name: "" } }];
  }

  let sentCount = 0;
  const emailConcurrency = Math.max(
    1,
    Math.min(20, parseInt(process.env.EMAIL_SEND_CONCURRENCY || "8", 10) || 8)
  );

  await runWithConcurrency(users, emailConcurrency, async (sub) => {
    try {
      const pro = usesProfessionalDigest(sub.plan);
      const alertSections = pro ? sectionsProfessional : sectionsStandard;
      const digestLabel = pro ? "professional" : "standard";
      const isQuietDay = alertSections.length === 0;

      if (isQuietDay) {
        if (sub.user_id) {
          const { error: dbErr } = await supabase.from("sent_alerts").insert({
            user_id: sub.user_id,
            alert_title: `Daily check-in — no new updates (${shortDate})`,
            alert_summary:
              "No employer-relevant changes detected across monitored official UK sources in the last ~36 hours.",
            alert_source: "system — quiet day",
            importance: "medium",
          });
          if (dbErr) {
            console.error(`sent_alerts insert failed for ${sub.users?.email} (quiet-day): ${dbErr.message}`);
            return;
          }
        }
        const html = buildQuietDayEmailHTML(sub.users.company_name, dateLabel);
        await resend.emails.send({
          from: getResendFrom(),
          to: sub.users.email,
          subject: `${mailTestPrefix}ActAware: All quiet — UK employer sources (${shortDate})`,
          html,
          click_tracking: false,
          open_tracking: false,
        });
      } else {
        let sectorNoteHtml = "";
        if (pro && sub.users?.industry) {
          try {
            sectorNoteHtml = await buildSectorNoteForSubscriber(
              alertSections,
              sub.users.industry,
              sub.users.company_name
            );
          } catch (secErr) {
            console.warn(`Sector note skipped for ${sub.users?.email}: ${secErr.message}`);
          }
        }
        if (sub.user_id) {
          const { error: dbErr } = await supabase.from("sent_alerts").insert({
            user_id: sub.user_id,
            alert_title: `Daily UK Employer Compliance (${digestLabel}) — ${shortDate}`,
            alert_summary: alertSections.map((s) => `[${s.source}] ${s.content}`).join("\n\n").substring(0, 500),
            alert_source: alertSections.map((s) => s.source).join(", "),
            importance: alertSections.some((s) => s.priority === "critical") ? "critical" : "high",
          });
          if (dbErr) {
            console.error(`sent_alerts insert failed for ${sub.users?.email} (digest): ${dbErr.message}`);
            return;
          }
        }
        const html = buildEmailHTML(sub.users.company_name, alertSections, dateLabel, sectorNoteHtml);
        const subjPro = pro ? " [Professional]" : "";
        await resend.emails.send({
          from: getResendFrom(),
          to: sub.users.email,
          subject: `${mailTestPrefix}UK Employer Compliance${subjPro} — ${shortDate}`,
          html,
          click_tracking: false,
          open_tracking: false,
        });
      }
      sentCount++;
    } catch (err) {
      const isRateLimit =
        err?.statusCode === 429 ||
        err?.status === 429 ||
        String(err?.message || "").toLowerCase().includes("rate limit") ||
        String(err?.message || "").toLowerCase().includes("too many");
      console.error(
        `Email error [${isRateLimit ? "RATE_LIMIT — Resend 429" : "ERROR"}] for user ${sub.user_id ?? sub.users?.email}: ${err.message}`
      );
    }
  });

  const globalQuiet =
    sectionsStandard.length === 0 && sectionsProfessional.length === 0;

  if (!forceQuietDayPreview) {
    await sendDailyHealthReport(feedOutcomes, runId, dateLabel);
  }

  return {
    statusCode: 202,
    body: JSON.stringify({
      testRun,
      forceQuietDayPreview,
      testEmailOnly: testEmailOnly || null,
      message: globalQuiet
        ? `Sent ${sentCount} quiet-day check-ins`
        : `Sent ${sentCount} digest emails`,
      runId,
      mode: globalQuiet ? "quiet_day" : "digest",
      digestSections: {
        standard: sectionsStandard.length,
        professional: sectionsProfessional.length,
      },
      feedsInDigestStandard: sectionsStandard.map((s) => s.source),
      feedsInDigestProfessional: sectionsProfessional.map((s) => s.source),
      feedOutcomes,
      summary: {
        attempted: feedOutcomes.length,
        inDigest: feedOutcomes.filter((o) => o.inDigest).length,
        errors: feedOutcomes.filter((o) => o.status === "fetch_or_parse_error" || o.status === "claude_error").length,
        noItemsInWindow: feedOutcomes.filter((o) => o.status === "no_items_in_window").length,
        claudeSkipped: feedOutcomes.filter((o) => o.status === "claude_no_employer_relevant").length,
      },
    }),
  };
};
