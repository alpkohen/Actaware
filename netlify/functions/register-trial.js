const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const { makeCorsHeaders, preflight } = require("./lib/cors");
const { getResendFrom } = require("./lib/resend-from");
const { ensureAuthUserWithPassword } = require("./lib/ensure-auth-user");
const { getSiteUrl } = require("./lib/site-url");
const { getClientIp } = require("./lib/client-ip");
const { consumeRateLimit, envInt } = require("./lib/rate-limit");
const { notifyAdminNewSignup } = require("./lib/admin-notify");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TRIAL_DAYS = Math.max(1, Math.min(90, parseInt(process.env.TRIAL_DAYS || "14", 10) || 14));

const COMPANY_SIZES = new Set([
  "1-9",
  "10-49",
  "50-249",
  "250-999",
  "1000+",
]);

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(s || "").trim());
}

function cleanStr(v, max) {
  const t = String(v ?? "").trim();
  if (t.length > max) return t.slice(0, max);
  return t;
}

/**
 * @returns {{ sent: boolean, reason?: string }}
 */
async function sendTrialWelcomeEmail({ to, firstName, trialDays, trialEndsAt }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("register-trial: RESEND_API_KEY missing, skipping welcome email");
    return { sent: false, reason: "missing_resend_key" };
  }
  const site = getSiteUrl();
  const name = firstName || "there";
  const endStr = trialEndsAt
    ? new Date(trialEndsAt).toLocaleString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/London",
        timeZoneName: "short",
      })
    : "";

  const text = [
    `Hi ${name},`,
    "",
    `Welcome to ActAware — your ${trialDays}-day free trial is live.`,
    "",
    "What happens next:",
    "- We’ll email you a daily UK employer compliance digest on the same schedule as paying customers (around 08:00 UK time).",
    "- Sign in to browse your alert history: " + site + "/dashboard.html (same email and password you chose).",
    "- When you’re ready to continue after the trial, upgrade from your Account page or the pricing section on our site.",
    "",
    endStr ? `Your trial access is scheduled until: ${endStr} (London).` : "",
    "",
    "This is information only — not legal advice. Always verify against primary sources.",
    "",
    "— ActAware",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <p style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#374151;">Hi ${escapeHtml(name)},</p>
    <p style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#374151;">
      Welcome to <strong>ActAware</strong> — your <strong>${trialDays}-day</strong> free trial is live.
    </p>
    <p style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#4b5563;">
      We’ll email you a daily UK employer compliance digest around <strong>08:00 UK time</strong>.
      View your alert history anytime: <a href="${site}/dashboard.html">My alerts</a> (sign in with your email and password).
    </p>
    ${
      endStr
        ? `<p style="font-family:system-ui,sans-serif;font-size:13px;color:#6b7280;">Trial until: ${escapeHtml(endStr)} (London)</p>`
        : ""
    }
    <p style="font-family:system-ui,sans-serif;font-size:12px;color:#9ca3af;margin-top:24px;">
      Information only — not legal advice.
    </p>
  `;

  const from = getResendFrom();
  if (!from.includes("@")) {
    console.error("register-trial: invalid RESEND_FROM / CONTACT_FORM_FROM (no @):", JSON.stringify(from));
    return { sent: false, reason: "invalid_from_address" };
  }

  try {
    const resend = new Resend(key);
    const result = await resend.emails.send({
      from,
      to,
      subject: "You’re in — ActAware free trial started",
      text,
      html,
    });
    const err = result?.error;
    if (err) {
      const msg =
        typeof err === "string"
          ? err
          : err.message || err.name || JSON.stringify(err);
      console.error("register-trial Resend:", msg, JSON.stringify(err));
      return { sent: false, reason: msg || "resend_rejected" };
    }
    const id = result?.data?.id;
    if (!id) {
      console.error("register-trial Resend: missing message id", JSON.stringify(result));
      return { sent: false, reason: "resend_no_message_id" };
    }
    console.log("register-trial: welcome email sent to", to, id);
    return { sent: true };
  } catch (e) {
    console.error("register-trial welcome email:", e?.message || e, e?.stack || "");
    return { sent: false, reason: e?.message || String(e) || "send_failed" };
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

exports.handler = async function (event) {
  const corsHeaders = (extra = {}) => makeCorsHeaders(event, { "Content-Type": "application/json", ...extra });

  if (event.httpMethod === "OPTIONS") return preflight(event);
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const ip = getClientIp(event);
  const rl = await consumeRateLimit(
    supabase,
    `register_trial:${ip}`,
    envInt("RATE_LIMIT_REGISTER_TRIAL_MAX", 5),
    envInt("RATE_LIMIT_WINDOW_SECONDS", 60)
  );
  if (!rl.allowed) {
    return {
      statusCode: 429,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Too many requests. Please wait a minute and try again." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  // Honeypot — bots often fill hidden fields
  if (body.website || body.url || body.company_website) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid request" }) };
  }

  if (!body.consent) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Please confirm you agree to receive ActAware emails (trial alerts)." }),
    };
  }

  const firstName = cleanStr(body.firstName, 80);
  const lastName = cleanStr(body.lastName, 80);
  const email = cleanStr(body.email, 254);
  const companyName = cleanStr(body.companyName, 200);
  const industry = cleanStr(body.industry, 120);
  const jobTitle = cleanStr(body.jobTitle, 120);
  const companySize = cleanStr(body.companySize, 32);
  const phone = cleanStr(body.phone, 40);
  const signupNotes = cleanStr(body.notes, 500);

  if (!firstName || !lastName || !email || !companyName || !industry || !jobTitle || !companySize) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Please complete all required fields." }),
    };
  }
  if (!isValidEmail(email)) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Please enter a valid email address." }),
    };
  }
  if (!COMPANY_SIZES.has(companySize)) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Please select a valid company size." }),
    };
  }

  const emailNorm = email.toLowerCase();
  const password = String(body.password ?? "");

  const authResult = await ensureAuthUserWithPassword(supabase, emailNorm, password, {
    first_name: firstName,
    last_name: lastName,
  });
  if (!authResult.ok) {
    return {
      statusCode: authResult.status,
      headers: corsHeaders(),
      body: JSON.stringify({ error: authResult.message }),
    };
  }

  const now = new Date();
  const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  try {
    const { data: existingUser, error: fetchErr } = await supabase
      .from("users")
      .select("id, trial_used_at")
      .eq("email", emailNorm)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    if (existingUser?.trial_used_at) {
      return {
        statusCode: 409,
        headers: corsHeaders(),
        body: JSON.stringify({
          error:
            "This email has already started a free trial. Choose a paid plan below to continue receiving alerts.",
        }),
      };
    }

    if (existingUser?.id) {
      const { data: subRow } = await supabase
        .from("subscriptions")
        .select("plan, trial_ends_at, status, stripe_subscription_id")
        .eq("user_id", existingUser.id)
        .maybeSingle();

      if (subRow?.status === "active" && subRow.plan && subRow.plan !== "trial") {
        return {
          statusCode: 409,
          headers: corsHeaders(),
          body: JSON.stringify({ error: "This email already has an active subscription." }),
        };
      }
      if (
        subRow?.plan === "trial" &&
        subRow.trial_ends_at &&
        new Date(subRow.trial_ends_at) > now &&
        subRow.status === "active"
      ) {
        return {
          statusCode: 409,
          headers: corsHeaders(),
          body: JSON.stringify({ error: "You already have an active free trial on this email." }),
        };
      }
    }

    const { data: userRow, error: uErr } = await supabase
      .from("users")
      .upsert(
        {
          email: emailNorm,
          first_name: firstName,
          last_name: lastName,
          company_name: companyName,
          industry,
          job_title: jobTitle,
          company_size: companySize,
          phone: phone || null,
          signup_notes: signupNotes || null,
          trial_used_at: now.toISOString(),
        },
        { onConflict: "email" }
      )
      .select("id")
      .single();

    if (uErr) throw uErr;
    const userId = userRow.id;

    const { data: existingSub } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    const subPayload = {
      user_id: userId,
      plan: "trial",
      status: "active",
      trial_ends_at: trialEnds.toISOString(),
      stripe_customer_id: null,
      stripe_subscription_id: null,
      seat_limit: 1,
    };

    if (existingSub) {
      const { error: sErr } = await supabase.from("subscriptions").update(subPayload).eq("user_id", userId);
      if (sErr) throw sErr;
    } else {
      const { error: sErr } = await supabase.from("subscriptions").insert(subPayload);
      if (sErr) throw sErr;
    }

    const emailResult = await sendTrialWelcomeEmail({
      to: emailNorm,
      firstName,
      trialDays: TRIAL_DAYS,
      trialEndsAt: trialEnds.toISOString(),
    });

    try {
      await notifyAdminNewSignup({
        kind: "trial",
        email: emailNorm,
        plan: "trial",
        firstName,
        lastName,
        companyName,
        trialEndsAt: trialEnds.toISOString(),
      });
    } catch (e) {
      console.error("register-trial admin notify:", e?.message || e);
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: true,
        trialDays: TRIAL_DAYS,
        trialEndsAt: trialEnds.toISOString(),
        welcomeEmailSent: emailResult.sent,
      }),
    };
  } catch (err) {
    console.error("register-trial:", err.message);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Something went wrong. Please try again." }),
    };
  }
};
