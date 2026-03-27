const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");
const { getSiteUrl } = require("./lib/site-url");
const { getPlanPriceIds } = require("./lib/stripe-plan-prices");
const { ensureAuthUserWithPassword } = require("./lib/ensure-auth-user");
const { getClientIp } = require("./lib/client-ip");
const { consumeRateLimit, envInt } = require("./lib/rate-limit");
const { verifyBearerAuth } = require("./lib/verify-token");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PAID_PLANS = new Set(["starter", "professional", "agency"]);

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

async function saveUserProfile(emailNorm, fields) {
  const { data: existing, error: fetchErr } = await supabase
    .from("users")
    .select("id")
    .eq("email", emailNorm)
    .maybeSingle();

  if (fetchErr) throw fetchErr;

  const payload = {
    first_name: fields.firstName,
    last_name: fields.lastName,
    company_name: fields.companyName,
    industry: fields.industry,
    job_title: fields.jobTitle,
    company_size: fields.companySize,
    phone: fields.phone || null,
    signup_notes: fields.signupNotes || null,
  };

  if (existing) {
    const { error } = await supabase.from("users").update(payload).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data: inserted, error: insErr } = await supabase
    .from("users")
    .insert({ email: emailNorm, ...payload })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return inserted.id;
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
    `register_checkout:${ip}`,
    envInt("RATE_LIMIT_REGISTER_CHECKOUT_MAX", 10),
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

  const isUpgrade = body.upgrade === true || body.upgrade === "true";

  if (body.website || body.url || body.company_website) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid request" }) };
  }

  if (!body.consent) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Please confirm the agreement checkbox." }),
    };
  }

  const plan = cleanStr(body.plan, 32).toLowerCase();
  if (!PAID_PLANS.has(plan)) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Invalid plan selected." }),
    };
  }

  let firstName = cleanStr(body.firstName, 80);
  let lastName = cleanStr(body.lastName, 80);
  const emailRaw = cleanStr(body.email, 254);
  let companyName = cleanStr(body.companyName, 200);
  let industry = cleanStr(body.industry, 120);
  let jobTitle = cleanStr(body.jobTitle, 120);
  let companySize = cleanStr(body.companySize, 32);
  let phone = cleanStr(body.phone, 40);
  let signupNotes = cleanStr(body.notes, 500);

  let emailNorm;

  /** Trial / existing user upgrading: fill empty form fields from public.users (same row as JWT email). */
  if (isUpgrade) {
    const v = await verifyBearerAuth(event, {
      unauthorized:
        "Sign in at My alerts first (same browser), then use Upgrade again — or complete every field below.",
      misconfigured: "Server misconfigured.",
      invalid_session: "Invalid or expired session. Sign in at My alerts and try again.",
    });
    if (!v.ok) {
      return {
        statusCode: v.status,
        headers: corsHeaders(),
        body: JSON.stringify({ error: v.message }),
      };
    }
    const formEmail = emailRaw.toLowerCase();
    if (formEmail && formEmail !== v.email) {
      return {
        statusCode: 403,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Email must match your signed-in account." }),
      };
    }
    emailNorm = formEmail || v.email;
    if (!isValidEmail(emailNorm)) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Please enter a valid email address." }),
      };
    }

    const { data: profileRow, error: profErr } = await supabase
      .from("users")
      .select("first_name, last_name, company_name, industry, job_title, company_size, phone, signup_notes")
      .eq("email", emailNorm)
      .maybeSingle();
    if (profErr) {
      console.error("register-and-checkout upgrade profile fetch:", profErr.message);
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Could not load your saved profile. Try again shortly." }),
      };
    }
    if (!firstName && profileRow?.first_name) firstName = cleanStr(profileRow.first_name, 80);
    if (!lastName && profileRow?.last_name) lastName = cleanStr(profileRow.last_name, 80);
    if (!companyName && profileRow?.company_name) companyName = cleanStr(profileRow.company_name, 200);
    if (!industry && profileRow?.industry) industry = cleanStr(profileRow.industry, 120);
    if (!jobTitle && profileRow?.job_title) jobTitle = cleanStr(profileRow.job_title, 120);
    if (!companySize && profileRow?.company_size) companySize = cleanStr(profileRow.company_size, 32);
    if (!phone && profileRow?.phone) phone = cleanStr(profileRow.phone, 40);
    if (!signupNotes && profileRow?.signup_notes) signupNotes = cleanStr(profileRow.signup_notes, 500);
  } else {
    if (!firstName || !lastName || !emailRaw || !companyName || !industry || !jobTitle || !companySize) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Please complete all required fields." }),
      };
    }
    if (!isValidEmail(emailRaw)) {
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
    emailNorm = emailRaw.toLowerCase();
  }

  if (!firstName || !lastName || !companyName || !industry || !jobTitle || !companySize) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({
        error:
          "Please complete all required organisation details. If you are upgrading from a trial, sign in at My alerts in this browser first so we can load your saved profile.",
      }),
    };
  }
  if (!COMPANY_SIZES.has(companySize)) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Please select a valid company size." }),
    };
  }

  // Agency enquiries: return a mailto link immediately — no auth required, no DB writes.
  // This must happen BEFORE saveUserProfile so unauthenticated requests cannot write PII.
  if (plan === "agency") {
    const mailBody = [
      "Please contact me about the Agency plan.",
      "",
      `Name: ${firstName} ${lastName}`,
      `Email: ${emailNorm}`,
      `Company: ${companyName}`,
      `Role: ${jobTitle}`,
      `Sector: ${industry}`,
      `Company size: ${companySize}`,
      phone ? `Phone: ${phone}` : null,
      signupNotes ? `Notes: ${signupNotes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const mailto =
      "mailto:hello@actaware.co.uk?subject=" +
      encodeURIComponent("Agency plan enquiry") +
      "&body=" +
      encodeURIComponent(mailBody);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, flow: "mailto", mailto }),
    };
  }

  // Starter / Professional: new signups create auth user; upgrades already verified above.
  if (!isUpgrade) {
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
  }

  try {
    const userId = await saveUserProfile(emailNorm, {
      firstName,
      lastName,
      companyName,
      industry,
      jobTitle,
      companySize,
      phone,
      signupNotes,
    });

    const { data: subRow } = await supabase
      .from("subscriptions")
      .select("plan, status, stripe_subscription_id")
      .eq("user_id", userId)
      .maybeSingle();

    const hasActivePaid =
      subRow &&
      subRow.status === "active" &&
      subRow.stripe_subscription_id &&
      ["starter", "professional", "agency"].includes(subRow.plan);

    if (hasActivePaid) {
      return {
        statusCode: 409,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "This email already has an active paid subscription." }),
      };
    }

    const priceId = getPlanPriceIds()[plan];
    if (!priceId || !process.env.STRIPE_SECRET_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Checkout is not configured." }),
      };
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const siteUrl = getSiteUrl();

    const cancelQs = new URLSearchParams({ plan });
    if (isUpgrade) cancelQs.set("upgrade", "1");

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: emailNorm,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/register.html?${cancelQs.toString()}`,
      metadata: { plan, user_id: String(userId), upgrade: isUpgrade ? "1" : "0" },
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, flow: "stripe", url: session.url }),
    };
  } catch (err) {
    console.error("register-and-checkout:", err.message);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Something went wrong. Please try again." }),
    };
  }
};
