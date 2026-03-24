const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");
const { ensureAuthUserWithPassword } = require("./lib/ensure-auth-user");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/** Must match Stripe Dashboard prices (live mode) */
const PLAN_PRICE_IDS = {
  starter: "price_1TECr11Xanrz03nulyrRqRNC",
  professional: "price_1TECrS1Xanrz03nucwVjBqTK",
  agency: "price_1TECrg1Xanrz03nuEkFymBFg",
};

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

/** Stripe checkout requires a Supabase session (email + password on register page). */
async function verifyBearerEmailMatches(event, emailNorm) {
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return {
      ok: false,
      status: 401,
      message:
        "Set a password on this form (same email) and click Continue again — or sign in at My alerts if you already have an account.",
    };
  }
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { ok: false, status: 503, message: "Server misconfigured." };
  const authClient = createClient(url, anon);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);
  if (error || !user?.email) {
    return { ok: false, status: 401, message: "Invalid or expired session. Sign in at My alerts and try again." };
  }
  const jwtEmail = String(user.email).trim().toLowerCase();
  if (jwtEmail !== emailNorm) {
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

  if (plan !== "agency") {
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

    const priceId = PLAN_PRICE_IDS[plan];
    if (!priceId || !process.env.STRIPE_SECRET_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Checkout is not configured." }),
      };
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const siteUrl = process.env.SITE_URL || "https://act-aware.netlify.app";

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
