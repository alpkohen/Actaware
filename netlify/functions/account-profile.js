const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const COMPANY_SIZES = new Set([
  "1-9",
  "10-49",
  "50-249",
  "250-999",
  "1000+",
]);

function planLabel(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "trial") return "Trial";
  if (p === "starter") return "Starter";
  if (p === "professional") return "Professional";
  if (p === "agency") return "Agency";
  return "Member";
}

function cors(event) {
  return (extra = {}) => makeCorsHeaders(event, { "Content-Type": "application/json", ...extra });
}

async function getAuthEmail(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { error: "unauthorized", token: null };

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { error: "misconfigured", token: null };

  const authClient = createClient(url, anon);
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token);
  if (error || !user?.email) return { error: "invalid_session", token: null };
  return { error: null, token, email: String(user.email).trim().toLowerCase() };
}

exports.handler = async function (event) {
  const h = cors(event);
  if (event.httpMethod === "OPTIONS") return preflight(event);

  const method = event.httpMethod;
  if (method !== "GET" && method !== "PATCH") {
    return { statusCode: 405, headers: h(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const auth = await getAuthEmail(event);
  if (auth.error === "unauthorized") {
    return { statusCode: 401, headers: h(), body: JSON.stringify({ error: "Sign in required." }) };
  }
  if (auth.error === "misconfigured") {
    return { statusCode: 503, headers: h(), body: JSON.stringify({ error: "Server misconfigured." }) };
  }
  if (auth.error === "invalid_session") {
    return { statusCode: 401, headers: h(), body: JSON.stringify({ error: "Invalid or expired session." }) };
  }

  const emailNorm = auth.email;

  try {
    if (method === "GET") {
      const { data: userRow, error: uErr } = await supabaseAdmin
        .from("users")
        .select(
          "id, email, first_name, last_name, company_name, industry, job_title, company_size, phone, signup_notes"
        )
        .eq("email", emailNorm)
        .maybeSingle();

      if (uErr) throw uErr;
      if (!userRow) {
        return {
          statusCode: 404,
          headers: h(),
          body: JSON.stringify({
            error: "No ActAware account for this email. Use the same address as your trial or subscription.",
          }),
        };
      }

      const { data: subRow, error: sErr } = await supabaseAdmin
        .from("subscriptions")
        .select("plan, status, trial_ends_at, stripe_customer_id, stripe_subscription_id")
        .eq("user_id", userRow.id)
        .maybeSingle();

      if (sErr) throw sErr;

      const plan = subRow?.plan || "starter";
      const displayName = [userRow.first_name, userRow.last_name].filter(Boolean).join(" ").trim() || emailNorm;

      const stripeCustomerId = subRow?.stripe_customer_id || null;
      const canBillingPortal = !!(stripeCustomerId && process.env.STRIPE_SECRET_KEY);

      return {
        statusCode: 200,
        headers: h(),
        body: JSON.stringify({
          email: userRow.email,
          firstName: userRow.first_name || "",
          lastName: userRow.last_name || "",
          displayName,
          companyName: userRow.company_name || "",
          industry: userRow.industry || "",
          jobTitle: userRow.job_title || "",
          companySize: userRow.company_size || "",
          phone: userRow.phone || "",
          notes: userRow.signup_notes || "",
          plan,
          planLabel: planLabel(plan),
          subscriptionStatus: subRow?.status || "inactive",
          trialEndsAt: subRow?.trial_ends_at || null,
          stripeCustomerId,
          stripeSubscriptionId: subRow?.stripe_subscription_id || null,
          canBillingPortal,
        }),
      };
    }

    /* PATCH */
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, headers: h(), body: JSON.stringify({ error: "Invalid JSON" }) };
    }

    const { data: userRow, error: fetchErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", emailNorm)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!userRow) {
      return { statusCode: 404, headers: h(), body: JSON.stringify({ error: "Account not found." }) };
    }

    function cleanStr(v, max) {
      const t = String(v ?? "").trim();
      if (t.length > max) return t.slice(0, max);
      return t;
    }

    const updates = {};
    if (body.firstName !== undefined) updates.first_name = cleanStr(body.firstName, 80);
    if (body.lastName !== undefined) updates.last_name = cleanStr(body.lastName, 80);
    if (body.companyName !== undefined) updates.company_name = cleanStr(body.companyName, 200);
    if (body.industry !== undefined) updates.industry = cleanStr(body.industry, 120);
    if (body.jobTitle !== undefined) updates.job_title = cleanStr(body.jobTitle, 120);
    if (body.companySize !== undefined) updates.company_size = cleanStr(body.companySize, 32);
    if (body.phone !== undefined) {
      const p = String(body.phone ?? "").trim();
      updates.phone = p ? cleanStr(p, 40) : null;
    }
    if (body.notes !== undefined) {
      const n = String(body.notes ?? "").trim();
      updates.signup_notes = n ? cleanStr(n, 500) : null;
    }

    if (updates.company_size !== undefined && !COMPANY_SIZES.has(updates.company_size)) {
      return { statusCode: 400, headers: h(), body: JSON.stringify({ error: "Invalid company size." }) };
    }

    if (Object.keys(updates).length === 0) {
      return { statusCode: 400, headers: h(), body: JSON.stringify({ error: "No valid fields to update." }) };
    }

    const { error: upErr } = await supabaseAdmin.from("users").update(updates).eq("id", userRow.id);
    if (upErr) throw upErr;

    return { statusCode: 200, headers: h(), body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("account-profile:", err.message);
    return { statusCode: 500, headers: h(), body: JSON.stringify({ error: "Something went wrong." }) };
  }
};
