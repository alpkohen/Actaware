const { createClient } = require("@supabase/supabase-js");
const Resend = require("resend").Resend;
const https = require("https");
const http = require("http");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

// ── ALL VERIFIED RSS/ATOM SOURCES ──────────────────────────────────────────
const RSS_FEEDS = [
  // ── CATEGORY 1: GOV.UK Core Employer Feeds ──
  {
    name: "GOV.UK — Employment Rights Act 2025",
    url: "https://www.gov.uk/search/all.atom?keywords=employment+rights+act&organisations%5B%5D=department-for-business-and-trade",
    priority: "critical",
  },
  {
    name: "GOV.UK — Employment Consultations (Make Work Pay)",
    url: "https://www.gov.uk/search/policy-papers-and-consultations.atom?topics%5B%5D=employment",
    priority: "high",
  },
  {
    name: "GOV.UK — HMRC Employer Guidance",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=hm-revenue-customs&keywords=employer",
    priority: "high",
  },
  {
    name: "GOV.UK — National Minimum Wage Updates",
    url: "https://www.gov.uk/search/all.atom?keywords=national+minimum+wage&organisations%5B%5D=department-for-business-and-trade",
    priority: "high",
  },
  {
    name: "GOV.UK — Fair Work Agency",
    url: "https://www.gov.uk/search/all.atom?keywords=fair+work+agency",
    priority: "high",
  },
  {
    name: "GOV.UK — Statutory Pay (SSP/SMP/SPP)",
    url: "https://www.gov.uk/search/all.atom?keywords=statutory+sick+pay+statutory+maternity+pay",
    priority: "medium",
  },
  {
    name: "GOV.UK — DBT Employer News",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=department-for-business-and-trade",
    priority: "medium",
  },
  {
    name: "GOV.UK — Data Protection (ICO via GOV.UK)",
    url: "https://www.gov.uk/search/all.atom?keywords=data+protection+employer&organisations%5B%5D=information-commissioner-s-office",
    priority: "medium",
  },
  // ── CATEGORY 2: Legislation.gov.uk — ERA 2025 Statutory Instruments ──
  {
    name: "Legislation.gov.uk — New Statutory Instruments (ERA 2025)",
    // /new/uksi/data.feed returns 404 from some servers; canonical feed is uksi + sort=published
    url: "https://www.legislation.gov.uk/uksi/data.feed?sort=published",
    priority: "critical",
    // Any SI matching one of these (title/summary) is kept; avoids missing employer-relevant law that omits the word "employment"
    filterKeywords: [
      "employment",
      "employer",
      "employee",
      "wage",
      "pension",
      "statutory",
      "redundan",
      "dismiss",
      "tribunal",
      "maternity",
      "paternity",
      "holiday",
      "leave",
      "discrimina",
      "worker",
      "national insurance",
      "minimum wage",
      "agency worker",
      "fixed-term",
      "whistleblow",
      "transfer of undertakings",
      "tupe",
    ],
  },
  // ── CATEGORY 2: Employment Tribunal Decisions ──
  // Feed returns titles only — we send to Claude regardless; AI decides relevance.
  {
    name: "Employment Tribunal — ERA 2025 Case Decisions",
    url: "https://www.gov.uk/employment-tribunal-decisions.atom?keywords=Employment+Rights+Act+2025",
    priority: "high",
  },
  // ── CATEGORY 3: Pensions Regulator ──
  {
    name: "Pensions Regulator — Employer Auto-Enrolment",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=the-pensions-regulator&keywords=employer+auto-enrolment",
    priority: "medium",
  },
  // ── CATEGORY 3: HSE ──
  {
    name: "HSE — Health & Safety at Work",
    url: "https://press.hse.gov.uk/feed/",
    priority: "medium",
  },
];

async function fetchRSS(url, useHttp = false) {
  return new Promise((resolve, reject) => {
    const client = (useHttp || url.startsWith("http://")) ? http : https;
    const req = client.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchRSS(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

/** @param {string|string[]|null} filterSpec - string, or array (match if ANY substring matches title+summary) */
function matchesFeedFilter(textLc, filterSpec) {
  if (!filterSpec) return true;
  const keys = Array.isArray(filterSpec) ? filterSpec : [filterSpec];
  return keys.some((k) => textLc.includes(String(k).toLowerCase()));
}

// Returns all matching items from the feed XML — caller filters by date window.
function parseRSSItems(xml, filterSpec = null) {
  const items = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>|<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1] || match[2];
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
    const summary = (block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "";
    const link = (block.match(/<link[^>]*href="([^"]*)"/) || block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const published = (block.match(/<published>([\s\S]*?)<\/published>/) || block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || block.match(/<updated>([\s\S]*?)<\/updated>/) || [])[1] || "";
    const cleanTitle = title.replace(/<[^>]+>/g, "").trim();
    if (!cleanTitle) continue;
    const lc = cleanTitle.toLowerCase() + summary.toLowerCase();
    if (!matchesFeedFilter(lc, filterSpec)) continue;
    items.push({
      title: cleanTitle,
      summary: summary.replace(/<[^>]+>/g, "").trim().substring(0, 600),
      link: link.trim(),
      published: published.trim(),
    });
  }
  // No slice — return every item that passes the keyword filter.
  return items;
}

async function summariseWithClaude(items, sourceName) {
  const prompt = `You are a UK employment law compliance expert writing employer alert emails for UK employers.

Source: ${sourceName}
---
${items.map((i, idx) => `[${idx + 1}] Title: ${i.title}\nPublished: ${i.published || 'recent'}\nContent: ${i.summary}\nURL: ${i.link}`).join("\n\n")}
---
RULES:
- Write clear, practical, plain-English guidance for UK employers.
- Use information from the source text. Where content is limited (e.g. only a title), use the title to infer the relevant employer lesson — for example, an HSE prosecution title tells you what safety failure occurred and what employers must do to avoid it.
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
Source: [URL]`;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
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

async function getActiveUsers() {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("user_id, plan, users(email, company_name)")
    .eq("status", "active");
  if (error) throw error;
  return data || [];
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

  // Alert email — only if ALERT_EMAIL env var is set, so it's opt-in.
  if (process.env.ALERT_EMAIL) {
    await resend.emails.send({
      from: "ActAware System <onboarding@resend.dev>",
      to: process.env.ALERT_EMAIL,
      subject: `[ActAware] Feed error: ${feed.name}`,
      html: `<p>Feed <strong>${feed.name}</strong> failed during run <code>${runId}</code>.</p>
             <p><strong>Error:</strong> ${err.message}</p>
             <p><strong>URL:</strong> <a href="${feed.url}">${feed.url}</a></p>`,
    }).catch((mailErr) => {
      console.error(`Alert email failed: ${mailErr.message}`);
    });
  }
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
      ? actionsMatch[1].split("\n").map(l => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean)
      : [];
    const publishedMatch = trimmed.match(/Published:\s*([^\n]+)/i);
    const published = publishedMatch ? publishedMatch[1].trim() : "";
    const riskMatch = trimmed.match(/Risk if ignored:\s*([^\n]+)/i);
    const risk = riskMatch ? riskMatch[1].trim() : "";
    const sourceMatch = trimmed.match(/Source:\s*(https?:\/\/[^\s]+)/i);
    const sourceUrl = sourceMatch ? sourceMatch[1].trim() : "";
    if (title || whatChanged) {
      alertBlocks.push({ importance, title, published, whatChanged, actions, risk, sourceUrl, sourceName });
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
  const style = map[importance] || map.MEDIUM;
  return `<span style="${style}font-size:10px;font-weight:700;padding:3px 9px;border-radius:4px;text-transform:uppercase;letter-spacing:0.5px;">${importance}</span>`;
}

function buildAlertCardHTML(alert) {
  const actionsHTML = alert.actions.length > 0
    ? `<ul style="margin:6px 0 0 18px;color:#4b5563;line-height:1.8;padding:0 0 0 4px;">${alert.actions.map(a => `<li style="margin-bottom:4px;font-size:14px;">${a}</li>`).join("")}</ul>`
    : "";
  return `
    <div style="background:#f8f9fa;border:1px solid #e5e7eb;border-radius:8px;padding:18px 20px;margin-bottom:14px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6366f1;margin-bottom:8px;">${alert.sourceName}</div>
      ${importanceBadgeHTML(alert.importance)}
      ${alert.published ? `<span style="font-size:11px;color:#9ca3af;margin-left:8px;">${alert.published}</span>` : ""}
      ${alert.title ? `<p style="margin:10px 0 6px;font-size:15px;font-weight:700;color:#111827;line-height:1.4;">${alert.title}</p>` : ""}
      ${alert.whatChanged ? `<p style="margin:0 0 10px;font-size:14px;color:#4b5563;line-height:1.6;"><strong style="color:#111827;">What changed:</strong> ${alert.whatChanged}</p>` : ""}
      ${alert.actions.length > 0 ? `<p style="margin:0 0 4px;font-size:14px;font-weight:600;color:#111827;">What employers must do:</p>${actionsHTML}` : ""}
      ${alert.risk ? `<p style="margin:10px 0 8px;font-size:14px;color:#4b5563;"><strong style="color:#111827;">Risk if ignored:</strong> ${alert.risk}</p>` : ""}
      ${alert.sourceUrl ? `<p style="margin:0;font-size:12px;color:#9ca3af;">Source: <a href="${alert.sourceUrl}" style="color:#6366f1;text-decoration:none;">${alert.sourceUrl}</a></p>` : ""}
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

function buildEmailHTML(companyName, alertSections, dateLabel) {
  const allCards = alertSections.flatMap(section =>
    parseAlertsFromText(section.content, section.source)
  );
  const sectionsHTML = allCards.length > 0
    ? allCards.map(buildAlertCardHTML).join("")
    : alertSections.map(s => `
        <div style="background:#f8f9fa;border:1px solid #e5e7eb;border-radius:8px;padding:18px 20px;margin-bottom:14px;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6366f1;margin-bottom:8px;">${s.source}</div>
          <p style="font-size:14px;color:#4b5563;line-height:1.7;margin:0;">${s.content.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>")}</p>
        </div>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ActAware — ${dateLabel}</title>
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
                <div style="font-size:14px;font-weight:700;color:#ffffff;line-height:1.3;max-width:140px;text-align:right;">${dateLabel}</div>
              </div>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="background:#ffffff;padding:24px 32px 8px;">
        <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
          Hi ${companyName ? `<strong>${companyName}</strong>` : "there"},
        </p>
        <p style="margin:12px 0 0;font-size:15px;color:#374151;line-height:1.6;">
          Here are today's UK employment law updates from our monitored official sources:
        </p>
      </td></tr>
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
              <a href="${process.env.SITE_URL}" style="color:#6366f1;text-decoration:none;">Manage subscription</a>
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
          Hi ${companyName ? `<strong>${companyName}</strong>` : "there"},
        </p>
        <p style="margin:16px 0 0;font-size:15px;color:#374151;line-height:1.65;">
          We scanned our <strong>12 monitored official UK sources</strong> for items published in the last ~36 hours (covering “yesterday” across time zones). <strong>Nothing new surfaced that required an employer-facing compliance alert today.</strong>
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
        <span style="float:right;font-size:12px;"><a href="${process.env.SITE_URL || "#"}" style="color:#6366f1;text-decoration:none;">Manage subscription</a></span>
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

  // ~36 hours: “yesterday” plus timezone / feed-delay slack. Daily run avoids re-sending stale undated items.
  const cutoff = Date.now() - 36 * 60 * 60 * 1000;

  const alertSections = [];
  /** Per-feed outcome for Netlify logs + API response — proves all 12 sources were attempted */
  const feedOutcomes = [];

  for (const feed of RSS_FEEDS) {
    const filterSpec = feed.filterKeywords || feed.filterKeyword || null;
    const outcome = {
      feed: feed.name,
      itemsInWindow: 0,
      inDigest: false,
      status: "pending",
      detail: null,
    };

    try {
      const xml = await fetchRSS(feed.url, feed.useHttp || false);
      const allItems = parseRSSItems(xml, filterSpec);
      const items = allItems.filter(item => {
        if (!item.published) return false;
        const d = new Date(item.published);
        return !isNaN(d) && d.getTime() >= cutoff;
      });

      outcome.itemsInWindow = items.length;
      console.log(`Feed "${feed.name}": ${items.length} items (36h window)`);

      await logRawFeed(runId, feed, items);

      if (items.length === 0) {
        outcome.status = "no_items_in_window";
        feedOutcomes.push(outcome);
        continue;
      }

      let content;
      try {
        content = await summariseWithClaude(items, feed.name);
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

  let users = await getActiveUsers();
  const testEmailOnly = process.env.TEST_EMAIL_ONLY?.trim();
  if (testEmailOnly) {
    const match = users.find(
      (u) => u.users?.email?.toLowerCase() === testEmailOnly.toLowerCase()
    );
    users = match
      ? [match]
      : [{ user_id: null, plan: "test", users: { email: testEmailOnly, company_name: "" } }];
  }

  let sentCount = 0;
  const isQuietDay = alertSections.length === 0;

  for (const sub of users) {
    try {
      if (isQuietDay) {
        const html = buildQuietDayEmailHTML(sub.users.company_name, dateLabel);
        await resend.emails.send({
          from: "ActAware <onboarding@resend.dev>",
          to: sub.users.email,
          subject: testRun
            ? `[TEST] ActAware: All quiet — UK employer sources (${shortDate})`
            : `ActAware: All quiet — UK employer sources (${shortDate})`,
          html,
          click_tracking: false,
          open_tracking: false,
        });
        if (sub.user_id) {
          await supabase.from("sent_alerts").insert({
            user_id: sub.user_id,
            alert_title: `Daily check-in — no new updates (${shortDate})`,
            alert_summary:
              "No employer-relevant changes detected across monitored official UK sources in the last ~36 hours.",
            alert_source: "system — quiet day",
            importance: "medium",
          });
        }
      } else {
        const html = buildEmailHTML(sub.users.company_name, alertSections, dateLabel);
        await resend.emails.send({
          from: "ActAware <onboarding@resend.dev>",
          to: sub.users.email,
          subject: testRun
            ? `[TEST] UK Employer Compliance — ${shortDate}`
            : `UK Employer Compliance — ${shortDate}`,
          html,
          click_tracking: false,
          open_tracking: false,
        });
        if (sub.user_id) {
          await supabase.from("sent_alerts").insert({
            user_id: sub.user_id,
            alert_title: `Daily UK Employer Compliance — ${shortDate}`,
            alert_summary: alertSections.map(s => `[${s.source}] ${s.content}`).join("\n\n").substring(0, 500),
            alert_source: alertSections.map(s => s.source).join(", "),
            importance: alertSections.some(s => s.priority === "critical") ? "critical" : "high",
          });
        }
      }
      sentCount++;
    } catch (err) {
      console.error(`Email error for user ${sub.user_id ?? sub.users?.email}: ${err.message}`);
    }
  }

  return {
    statusCode: 202,
    body: JSON.stringify({
      testRun,
      testEmailOnly: testEmailOnly || null,
      message: isQuietDay
        ? `Sent ${sentCount} quiet-day check-ins`
        : `Sent ${sentCount} digest emails`,
      runId,
      mode: isQuietDay ? "quiet_day" : "digest",
      sections: alertSections.length,
      feedsInDigest: alertSections.map(s => s.source),
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
