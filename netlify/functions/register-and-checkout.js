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

/** Stripe checkout upgrade flow: JWT email must match form email. */
async function verifyBearerEmailMatches(event, emailNorm) {
  const v = await verifyBearerAuth(event, {
    unauthorized:
      "Set a password on this form (same email) and click Continue again — or sign in at My alerts if you already have an account.",
    misconfigured: "Server misconfigured.",
    invalid_session: "Invalid or expired session. Sign in at My alerts and try again.",
  });
  if (!v.ok) return { ok: false, status: v.status, message: v.message };
  if (v.email !== emailNorm) {
    return { ok: false, status: 403, message: "Email must match your signed-in account." };
  }
  return { ok: true };
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

  // Starter / Professional: require authentication before touching the database.
  if (isUpgrade) {
    const v = await verifyBearerEmailMatches(event, emailNorm);
    if (!v.ok) {
      return {
        statusCode: v.status,
        headers: corsHeaders(),
        body: JSON.stringify({ error: v.message }),
      };
    }
  } else {
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
