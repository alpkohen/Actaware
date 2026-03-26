/**
 * GET: last weekly compliance recaps stored for Professional / Agency (for dashboard + print/PDF).
 */
const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");
const { getAuthEmailFromEvent } = require("./lib/verify-token");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function proPlan(plan, status) {
  if (status !== "active") return false;
  return plan === "professional" || plan === "agency";
}

exports.handler = async function (event) {
  const h = (extra = {}) => makeCorsHeaders(event, { "Content-Type": "application/json", ...extra });

  if (event.httpMethod === "OPTIONS") return preflight(event);
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: h(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const auth = await getAuthEmailFromEvent(event);
  if (auth.error === "unauthorized") {
    return { statusCode: 401, headers: h(), body: JSON.stringify({ error: "Sign in required." }) };
  }
  if (auth.error === "misconfigured") {
    return { statusCode: 503, headers: h(), body: JSON.stringify({ error: "Server misconfigured." }) };
  }
  if (auth.error === "invalid_session") {
    return { statusCode: 401, headers: h(), body: JSON.stringify({ error: "Invalid or expired session." }) };
  }

  try {
    const { data: userRow, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", auth.email)
      .maybeSingle();
    if (uErr) throw uErr;
    if (!userRow) {
      return { statusCode: 404, headers: h(), body: JSON.stringify({ error: "No account found." }) };
    }

    const { data: subRow, error: sErr } = await supabaseAdmin
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", userRow.id)
      .maybeSingle();
    if (sErr) throw sErr;

    if (!proPlan(subRow?.plan, subRow?.status)) {
      return {
        statusCode: 403,
        headers: h(),
        body: JSON.stringify({ error: "Weekly recap archive is available on Professional and Agency plans." }),
      };
    }

    const { data: rows, error: qErr } = await supabaseAdmin
      .from("weekly_summary_log")
      .select("period_ending, sent_at, summary_text, summary_html")
      .eq("user_id", userRow.id)
      .order("period_ending", { ascending: false })
      .limit(16);

    if (qErr) throw qErr;

    const recaps = (rows || []).map((r) => ({
      periodEnding: r.period_ending,
      sentAt: r.sent_at,
      summaryText: r.summary_text || "",
      summaryHtml: r.summary_html || "",
    }));

    return {
      statusCode: 200,
      headers: h(),
      body: JSON.stringify({ recaps }),
    };
  } catch (err) {
    console.error("dashboard-weekly-recaps:", err.message);
    return {
      statusCode: 500,
      headers: h(),
      body: JSON.stringify({ error: "Something went wrong" }),
    };
  }
};
