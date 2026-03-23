const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");

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

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: true,
        trialDays: TRIAL_DAYS,
        trialEndsAt: trialEnds.toISOString(),
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
