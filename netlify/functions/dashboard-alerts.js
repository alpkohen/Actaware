const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ARCHIVE_DAYS_LIMITED = 30;
const MAX_ALERTS_LIMITED = 100;
const MAX_ALERTS_FULL = 500;

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    ...extra,
  };
}

function fullArchiveEligible(plan, status) {
  if (status !== "active") return false;
  return plan === "professional" || plan === "agency";
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return {
      statusCode: 401,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Sign in required. Use the magic link on this page." }),
    };
  }

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return {
      statusCode: 503,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Server misconfigured (missing Supabase anon key)" }),
    };
  }

  const authClient = createClient(url, anon);
  const {
    data: { user: authUser },
    error: authErr,
  } = await authClient.auth.getUser(token);

  if (authErr || !authUser?.email) {
    return {
      statusCode: 401,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid or expired session. Request a new sign-in link." }),
    };
  }

  const emailNorm = String(authUser.email).trim().toLowerCase();

  try {
    const { search } = JSON.parse(event.body || "{}");

    const { data: dbUser, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", emailNorm)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!dbUser) {
      return {
        statusCode: 404,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          error:
            "No ActAware account found for this email. Subscribe or start a trial with the same address you use to sign in.",
        }),
      };
    }

    const { data: subRow, error: subErr } = await supabaseAdmin
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", dbUser.id)
      .maybeSingle();

    if (subErr) throw subErr;

    const plan = subRow?.plan || "starter";
    const status = subRow?.status || "inactive";
    const unlimited = fullArchiveEligible(plan, status);

    let query = supabaseAdmin
      .from("sent_alerts")
      .select("*")
      .eq("user_id", dbUser.id)
      .order("sent_at", { ascending: false })
      .limit(unlimited ? MAX_ALERTS_FULL : MAX_ALERTS_LIMITED);

    if (!unlimited) {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - ARCHIVE_DAYS_LIMITED);
      query = query.gte("sent_at", since.toISOString());
    }

    if (search && String(search).trim()) {
      query = query.ilike("alert_summary", `%${String(search).trim()}%`);
    }

    const { data: alerts, error: qErr } = await query;
    if (qErr) throw qErr;

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        alerts: alerts || [],
        meta: {
          plan,
          subscriptionStatus: status,
          archiveFullHistory: unlimited,
          archiveDays: unlimited ? null : ARCHIVE_DAYS_LIMITED,
        },
      }),
    };
  } catch (err) {
    console.error("dashboard-alerts:", err.message);
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Something went wrong" }),
    };
  }
};
