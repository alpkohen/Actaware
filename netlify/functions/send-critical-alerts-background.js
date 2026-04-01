/**
 * Professional / Agency: supplemental emails when Claude flags CRITICAL employer updates
 * within ~24h of publication (between daily 08:00 digests). Scheduled every 2 hours.
 *
 * Set CRITICAL_ALERTS_DISABLED=true to turn off (saves Resend + Anthropic).
 */
const { createClient } = require("@supabase/supabase-js");
const Resend = require("resend").Resend;
const { getResendFrom } = require("./lib/resend-from");
const { escapeHtml, safeHttpUrl, textToEmailHtml } = require("./lib/html-escape");
const { RSS_FEEDS, fetchRSS, parseRSSItems, selectItemsInWindow } = require("./lib/employer-feeds");
const { MAX_ALERT_SUMMARY_CHARS } = require("./lib/sent-alert-limits");
const { tryAcquireDigestLock } = require("./lib/digest-run-lock");
const { runWithConcurrency } = require("./lib/run-with-concurrency");
const { digestGreetingDisplayName } = require("./lib/digest-greeting-name");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const { hasProTierFeatures } = require("./lib/subscription-access");

const PLAN_RANK = { agency: 4, professional: 3, starter: 2, trial: 1 };

async function getProAgencyUsers() {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "user_id, plan, trial_ends_at, stripe_subscription_id, users(email, company_name, first_name, last_name)"
    )
    .eq("status", "active")
    .in("plan", ["professional", "agency"]);
  if (error) throw error;
  const rows = data || [];
  const byUser = new Map();
  for (const row of rows) {
    const prev = byUser.get(row.user_id);
    const r = PLAN_RANK[row.plan] || 0;
    const pr = prev ? PLAN_RANK[prev.plan] || 0 : -1;
    if (!prev || r > pr) byUser.set(row.user_id, row);
  }
  return [...byUser.values()].filter((r) => hasProTierFeatures(r));
}

async function summariseCriticalOnly(items, sourceName) {
  const prompt = `You are a UK employer compliance expert (employment law, payroll/tax, health & safety, data protection, pensions, equality, right-to-work). Source: ${sourceName}

Items (last ~24 hours):
---
${items.map((i, idx) => `[${idx + 1}] Title: ${i.title}\nPublished: ${i.published || "recent"}\nContent: ${i.summary}\nURL: ${i.link}`).join("\n\n")}
---

TASK: Respond ONLY if at least one item is **CRITICAL** for UK employers (e.g. imminent legal deadline, NLW breach risk, immediate H&S enforcement, statutory change in force within days). Routine consultations or LOW/MEDIUM items must be ignored here.

If NOTHING is CRITICAL, respond with exactly this single line:
NO_CRITICAL_EMPLOYER_UPDATES

If there ARE critical items, use the SAME format as daily digests for EACH critical item only:

**[Title]** (Importance: CRITICAL)
Published: [date]
What changed: [1 sentence]
What employers must do:
- [action]
- [action]
Risk if ignored: [consequence]
**Severity rationale:** [1 sentence]
**Governance & ownership:** [teams]
**Suggested timeline:** [immediate / before next payroll / within 7 days]
**Cross-checks:** [2 bullets]
Source: [full https URL — REQUIRED; if the item has no URL, skip that item]

No HIGH or MEDIUM items. CRITICAL only. Never write "Source:" without a valid https URL.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Anthropic HTTP ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Anthropic empty content");
  }
  return text;
}

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
    const importance = impMatch ? impMatch[1].toUpperCase() : "";
    if (importance !== "CRITICAL") continue;
    const titleMatch = trimmed.match(/\*\*([^\*]+)\*\*/);
    const title = titleMatch ? titleMatch[1].trim() : "";
    const changedMatch = trimmed.match(/What changed:\s*([^\n]+)/i);
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
    if (title && sourceUrl) {
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
    } else if (title) {
      console.warn(`[critical-parse] Alert skipped — no verifiable source URL: "${title.slice(0, 80)}" (${sourceName})`);
    }
  }
  return alertBlocks;
}

function importanceBadgeHTML() {
  return `<span style="background:#fee2e2;color:#991b1b;font-size:10px;font-weight:700;padding:3px 9px;border-radius:4px;text-transform:uppercase;">CRITICAL</span>`;
}

function buildAlertCardHTML(alert) {
  const actionsHTML =
    alert.actions.length > 0
      ? `<ul style="margin:6px 0 0 18px;color:#4b5563;line-height:1.8;">${alert.actions.map((a) => `<li style="font-size:14px;">${escapeHtml(a)}</li>`).join("")}</ul>`
      : "";
  const cc = alert.crossChecks ? textToEmailHtml(alert.crossChecks) : "";
  const proBits = [
    alert.severityRationale &&
      `<p style="margin:10px 0 6px;font-size:13px;color:#374151;"><strong>Severity rationale:</strong> ${escapeHtml(alert.severityRationale)}</p>`,
    alert.governanceOwnership &&
      `<p style="margin:0 0 6px;font-size:13px;"><strong>Governance & ownership:</strong> ${escapeHtml(alert.governanceOwnership)}</p>`,
    alert.suggestedTimeline &&
      `<p style="margin:0 0 6px;font-size:13px;"><strong>Suggested timeline:</strong> ${escapeHtml(alert.suggestedTimeline)}</p>`,
    alert.crossChecks &&
      `<p style="margin:0 0 6px;font-size:13px;"><strong>Cross-checks:</strong><br>${cc}</p>`,
  ].filter(Boolean);
  const proHTML =
    proBits.length > 0
      ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1;">${proBits.join("")}</div>`
      : "";
  const href = safeHttpUrl(alert.sourceUrl);
  const sourceLink = href
    ? `<p style="margin:8px 0 0;font-size:12px;"><a href="${escapeHtml(href)}" style="color:#2563eb;">${escapeHtml(href)}</a></p>`
    : "";
  return `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 18px;margin-bottom:12px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#c2410c;margin-bottom:6px;">${escapeHtml(alert.sourceName)}</div>
      ${importanceBadgeHTML()}
      ${alert.published ? `<span style="font-size:11px;color:#9ca3af;margin-left:8px;">${escapeHtml(alert.published)}</span>` : ""}
      <p style="margin:8px 0 4px;font-size:15px;font-weight:700;color:#111827;">${escapeHtml(alert.title)}</p>
      ${alert.whatChanged ? `<p style="margin:0 0 8px;font-size:14px;color:#4b5563;"><strong>What changed:</strong> ${escapeHtml(alert.whatChanged)}</p>` : ""}
      ${alert.actions.length ? `<p style="margin:0;font-size:14px;font-weight:600;">What employers must do:</p>${actionsHTML}` : ""}
      ${alert.risk ? `<p style="margin:8px 0;font-size:14px;"><strong>Risk if ignored:</strong> ${escapeHtml(alert.risk)}</p>` : ""}
      ${proHTML}
      ${sourceLink}
    </div>`;
}

function buildCriticalEmailHTML(greetingName, cards, shortDate) {
  const inner = cards.map(buildAlertCardHTML).join("");
  const greeting = greetingName
    ? `Hi <strong>${escapeHtml(greetingName)}</strong>`
    : "Hi there";
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;"><tr><td align="center">
<table width="600" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="background:#7f1d1d;padding:20px 24px;">
<div style="font-size:18px;font-weight:700;color:#fff;">ActAware — Critical alert</div>
<div style="font-size:12px;color:#fecaca;margin-top:4px;">Professional / Agency · ${escapeHtml(shortDate)}</div>
</td></tr>
<tr><td style="padding:24px;">
<p style="margin:0 0 16px;font-size:15px;color:#374151;">${greeting},</p>
<p style="margin:0 0 16px;font-size:14px;color:#4b5563;line-height:1.55;">The following was flagged as <strong>CRITICAL</strong> from our official UK sources in the last ~24 hours. This is separate from your morning digest.</p>
${inner}
<p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Not legal advice. Verify with primary sources and your solicitor.</p>
</td></tr>
</table>
</td></tr></table></body></html>`;
}

function dedupeTitle(url, title) {
  const u = (url || "").slice(0, 180);
  const t = (title || "").slice(0, 120);
  return `CRITICAL-PULSE|${u}|${t}`;
}

/** Full text for My alerts (was truncated to 500 chars + title was machine key only). */
function criticalCardToPlainSummary(card) {
  const lines = [
    `[critical-pulse — ${card.sourceName}]`,
    "",
    `Title: ${card.title || ""}`,
  ];
  if (card.published) lines.push("", `Published: ${card.published}`);
  if (card.whatChanged) lines.push("", "What changed:", card.whatChanged);
  if (card.actions?.length) {
    lines.push("", "What employers must do:");
    for (const a of card.actions) lines.push(`- ${a}`);
  }
  if (card.risk) lines.push("", `Risk if ignored: ${card.risk}`);
  if (card.severityRationale) lines.push("", `Severity rationale: ${card.severityRationale}`);
  if (card.governanceOwnership) lines.push("", `Governance & ownership: ${card.governanceOwnership}`);
  if (card.suggestedTimeline) lines.push("", `Suggested timeline: ${card.suggestedTimeline}`);
  if (card.crossChecks) lines.push("", `Cross-checks: ${card.crossChecks}`);
  if (card.sourceUrl) lines.push("", `Source: ${card.sourceUrl}`);
  return lines.join("\n");
}

exports.handler = async function () {
  if (process.env.CRITICAL_ALERTS_DISABLED === "true") {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: "CRITICAL_ALERTS_DISABLED" }),
    };
  }

  const testRun = process.env.SEND_ALERTS_TEST_RUN === "true";
  const testEmailOnly = process.env.TEST_EMAIL_ONLY?.trim();

  let users = await getProAgencyUsers();
  if (users.length === 0 && !testEmailOnly) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: "No professional or agency subscribers" }),
    };
  }

  if (testEmailOnly) {
    const match = users.find((u) => u.users?.email?.toLowerCase() === testEmailOnly.toLowerCase());
    users = match
      ? [match]
      : [
          {
            user_id: null,
            plan: "professional",
            users: { email: testEmailOnly, company_name: "Test org", first_name: "Test" },
          },
        ];
  }

  const runId = `crit_${new Date().toISOString().replace(/[:.]/g, "-")}`;

  if (!testRun && !testEmailOnly) {
    const hourBucket = new Date();
    hourBucket.setUTCMinutes(0, 0, 0);
    const lockKey = `critical_pulse:${hourBucket.toISOString()}`;
    const lock = await tryAcquireDigestLock(supabase, lockKey, runId);
    if (lock.duplicate) {
      return {
        statusCode: 200,
        body: JSON.stringify({ skipped: true, reason: "duplicate_critical_run", lockKey }),
      };
    }
    if (lock.error) {
      console.error("critical digest lock failed:", lock.error.message || lock.error);
      return { statusCode: 500, body: JSON.stringify({ error: "Lock failed" }) };
    }
  }

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const allCriticalSections = [];

  for (const feed of RSS_FEEDS) {
    const filterSpec = feed.filterKeywords || feed.filterKeyword || null;
    try {
      const xml = await fetchRSS(feed.url);
      const allItems = parseRSSItems(xml, filterSpec);
      const items = selectItemsInWindow(allItems, cutoff, feed);
      if (items.length === 0) continue;

      const content = await summariseCriticalOnly(items, feed.name);
      if (
        content.includes("NO_CRITICAL_EMPLOYER_UPDATES") ||
        content.includes("No employer-relevant") ||
        content.trim().length < 30
      ) {
        continue;
      }

      const blocks = parseAlertsFromText(content, feed.name);
      if (blocks.length > 0) {
        allCriticalSections.push({ source: feed.name, content, blocks });
      }
    } catch (e) {
      console.error(`[critical] ${feed.name}: ${e.message}`);
    }
  }

  const flatCards = allCriticalSections.flatMap((s) => s.blocks);
  if (flatCards.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        runId,
        message: "No CRITICAL items in 24h window",
        feedsChecked: RSS_FEEDS.length,
      }),
    };
  }

  const shortDate = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const mailTestPrefix = testRun ? "[TEST] " : "";

  // HIGH-5: Pre-fetch all recently-sent critical alert titles for all users in ONE query
  // instead of N×M individual queries inside the loop.
  const allUserIds = users.map((u) => u.user_id).filter(Boolean);
  const dedupeSince = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  let sentSet = new Set();
  if (allUserIds.length > 0) {
    const { data: recentlySent, error: rsErr } = await supabase
      .from("sent_alerts")
      .select("user_id, alert_title")
      .in("user_id", allUserIds)
      .gte("sent_at", dedupeSince);
    if (rsErr) {
      console.warn("Critical alerts: dedup pre-fetch failed (continuing without dedup):", rsErr.message);
    } else {
      sentSet = new Set((recentlySent || []).map((r) => `${r.user_id}|${r.alert_title}`));
    }
  }

  let sent = 0;
  const emailConcurrency = Math.max(
    1,
    Math.min(20, parseInt(process.env.EMAIL_SEND_CONCURRENCY || "8", 10) || 8)
  );

  await runWithConcurrency(users, emailConcurrency, async (sub) => {
    try {
      const toSend = flatCards.filter((card) => {
        const dt = dedupeTitle(card.sourceUrl, card.title);
        return !sub.user_id || !sentSet.has(`${sub.user_id}|${dt}`);
      });

      if (toSend.length === 0) return;

      if (sub.user_id) {
        const insertRows = toSend.map((card) => {
          const dedupeKey = dedupeTitle(card.sourceUrl, card.title);
          return {
            user_id: sub.user_id,
            alert_title: (card.title || "ActAware CRITICAL alert").slice(0, 500),
            alert_summary: criticalCardToPlainSummary(card).slice(0, MAX_ALERT_SUMMARY_CHARS),
            alert_source: `critical-pulse — ${card.sourceName}`,
            importance: "critical",
            __dedupeKey: dedupeKey,
          };
        });
        const payload = insertRows.map(({ __dedupeKey, ...row }) => row);
        const { error: dbErr } = await supabase.from("sent_alerts").insert(payload);
        if (dbErr) {
          console.error(`Critical: sent_alerts insert failed for ${sub.users?.email}: ${dbErr.message}`);
          return;
        }
        for (const row of insertRows) {
          sentSet.add(`${sub.user_id}|${row.__dedupeKey}`);
        }
      }

      const html = buildCriticalEmailHTML(digestGreetingDisplayName(sub.users), toSend, shortDate);
      await resend.emails.send({
        from: getResendFrom(),
        to: sub.users.email,
        subject: `${mailTestPrefix}ActAware CRITICAL — UK employer compliance`,
        html,
        click_tracking: false,
        open_tracking: false,
      });

      sent++;
    } catch (err) {
      console.error(`Critical mail error ${sub.users?.email}: ${err.message}`);
    }
  });

  return {
    statusCode: 202,
    body: JSON.stringify({
      runId,
      criticalCards: flatCards.length,
      recipients: sent,
      testRun: !!testRun,
    }),
  };
};
