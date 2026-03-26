/**
 * Professional / Agency: Friday ~16:00 Europe/London weekly recap email.
 * Hourly Netlify cron; function exits unless local time is Fri 16:00.
 */
const { createClient } = require("@supabase/supabase-js");
const Resend = require("resend").Resend;
const { getResendFrom } = require("./lib/resend-from");
const { getSiteUrl } = require("./lib/site-url");
const { escapeHtml } = require("./lib/html-escape");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

function getLondonWeekdayAndHour() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const wd = parts.find((p) => p.type === "weekday")?.value;
  const hr = parseInt(parts.find((p) => p.type === "hour")?.value, 10);
  return { weekday: wd, hour: Number.isNaN(hr) ? -1 : hr };
}

function londonDateString(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function formatUkRange(start, end) {
  const opts = { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" };
  return `${start.toLocaleDateString("en-GB", opts)} – ${end.toLocaleDateString("en-GB", opts)}`;
}

async function summariseWeekWithClaude(lines, industry) {
  const body = lines.join("\n").slice(0, 24000);
  const sector = String(industry || "").trim();
  const prompt = `You write a concise weekly UK employer compliance recap email.

The week's alert log lines (title + short summary + source):
---
${body}
---

${sector ? `Subscriber sector: "${sector}" — briefly highlight what mattered most for this sector if clear from the log; otherwise stay general.` : ""}

Rules:
- Plain English for HR / people leaders.
- If the log is empty or only "quiet day" check-ins, say it was a quiet week on official feeds and remind them to check Monday's digest.
- Otherwise: short intro (2 sentences), then 4-8 bullet points of the most important themes (merge duplicates). Mention upcoming known UK employer deadlines if relevant (e.g. ERA 2025 Phase 1 April 2026).
- No HTML. No invented fines or case outcomes. 400 words max.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Anthropic ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Anthropic empty weekly summary");
  }
  return text.trim();
}

function textToEmailHtml(text) {
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const paras = text.split(/\n\n+/).map((p) => `<p style="margin:0 0 14px;font-size:15px;color:#374151;line-height:1.65;">${esc(p).replace(/\n/g, "<br>")}</p>`);
  return paras.join("");
}

exports.handler = async function () {
  if (process.env.WEEKLY_SUMMARY_DISABLED === "true") {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: "disabled" }) };
  }

  const testRun = process.env.WEEKLY_SUMMARY_TEST_RUN === "true";
  const { weekday, hour } = getLondonWeekdayAndHour();
  if (!testRun && (weekday !== "Fri" || hour !== 16)) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: "Not Fri 16:00 Europe/London", weekday, hour }),
    };
  }

  const now = new Date();
  const periodEnding = londonDateString(now);
  const weekEnd = now;
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rangeLabel = formatUkRange(weekStart, weekEnd);

  const { data: subs, error: subErr } = await supabase
    .from("subscriptions")
    .select("user_id, plan, users(email, company_name, industry, first_name, last_name)")
    .eq("status", "active")
    .in("plan", ["professional", "agency"]);
  if (subErr) {
    console.error("FATAL: weekly-summary subscriber fetch failed:", subErr.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Subscriber fetch failed", detail: subErr.message }),
    };
  }

  const rows = subs || [];
  const testEmailOnly = process.env.TEST_EMAIL_ONLY?.trim();
  let targets = rows;
  if (testEmailOnly) {
    targets = rows.filter((r) => r.users?.email?.toLowerCase() === testEmailOnly.toLowerCase());
    if (targets.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: "TEST_EMAIL_ONLY not in pro/agency list" }) };
    }
  }

  let sent = 0;
  const errors = [];

  for (const row of targets) {
    const userId = row.user_id;
    const email = row.users?.email;
    if (!userId || !email) continue;

    if (!testRun) {
      const { data: existing } = await supabase
        .from("weekly_summary_log")
        .select("user_id")
        .eq("user_id", userId)
        .eq("period_ending", periodEnding)
        .maybeSingle();
      if (existing?.user_id) continue;
    }

    const { data: alerts, error: aErr } = await supabase
      .from("sent_alerts")
      .select("alert_title, alert_summary, sent_at, importance, alert_source")
      .eq("user_id", userId)
      .gte("sent_at", weekStart.toISOString())
      .lte("sent_at", weekEnd.toISOString())
      .order("sent_at", { ascending: false })
      .limit(100);
    if (aErr) {
      errors.push({ email, err: aErr.message });
      continue;
    }

    const list = alerts || [];
    const lines = list.map((a) => {
      const d = new Date(a.sent_at).toLocaleDateString("en-GB", { timeZone: "Europe/London" });
      return `[${d}] ${a.importance || ""} | ${a.alert_title || ""} | ${(a.alert_summary || "").slice(0, 400)} | ${a.alert_source || ""}`;
    });

    let summaryText;
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        summaryText =
          lines.length === 0
            ? "It was a quiet week on the official feeds we monitor. Your next daily digest arrives Monday morning around 08:00 UK time."
            : `This week you received ${lines.length} stored alert(s). Open My alerts on actaware.co.uk for full text and search.`;
      } else {
        summaryText = await summariseWeekWithClaude(
          lines.length ? lines : ["(no rows in sent_alerts this week)"],
          row.users?.industry
        );
      }
    } catch (e) {
      console.warn(`Claude weekly summary failed for ${email}: ${e.message} — using fallback text`);
      errors.push({ email, err: e.message });
      summaryText =
        lines.length === 0
          ? "It was a quiet week on the official feeds we monitor. Your next daily digest arrives Monday morning around 08:00 UK time."
          : `This week you received ${lines.length} stored alert(s). Open My alerts on actaware.co.uk for full text and search.`;
    }

    const company = row.users?.company_name || "";
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="background:#0f172a;border-radius:12px 12px 0 0;padding:24px 28px;">
<div style="font-size:20px;font-weight:700;color:#fff;">ActAware</div>
<div style="font-size:13px;color:#94a3b8;margin-top:4px;">Weekly compliance recap · Professional</div>
</td></tr>
<tr><td style="background:#fff;padding:24px 28px;">
<p style="margin:0 0 8px;font-size:15px;color:#374151;">Hi ${company ? `<strong>${escapeHtml(company)}</strong>` : "there"},</p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Week of ${escapeHtml(rangeLabel)} (UK)</p>
${textToEmailHtml(summaryText)}
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;"><a href="${escapeHtml(`${getSiteUrl()}/dashboard.html`)}" style="color:#6366f1;">Open My alerts</a> for your full archive and filters.</p>
</td></tr>
<tr><td style="background:#f8fafc;padding:16px 28px;border-radius:0 0 12px 12px;border-top:1px solid #e2e8f0;font-size:11px;color:#9ca3af;">Information only — not legal advice. Verify with official sources.</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    try {
      await resend.emails.send({
        from: getResendFrom(),
        to: email,
        subject: `${testRun ? "[TEST] " : ""}ActAware: Your weekly UK compliance recap`,
        html,
        click_tracking: false,
        open_tracking: false,
      });
      if (!testRun) {
        const summaryHtml = textToEmailHtml(summaryText);
        const { error: logErr } = await supabase.from("weekly_summary_log").upsert(
          {
            user_id: userId,
            period_ending: periodEnding,
            sent_at: new Date().toISOString(),
            summary_text: summaryText,
            summary_html: summaryHtml,
          },
          { onConflict: "user_id,period_ending" }
        );
        if (logErr) {
          console.warn("weekly_summary_log upsert:", logErr.message);
        }
      }
      sent++;
    } catch (mailErr) {
      errors.push({ email, err: mailErr.message });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      periodEnding,
      sent,
      targets: targets.length,
      errors: errors.length ? errors : undefined,
      testRun,
    }),
  };
};
