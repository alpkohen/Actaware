const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { makeCorsHeaders, preflight } = require("./lib/cors");
const { getSiteUrl } = require("./lib/site-url");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async function (event) {
  const h = (extra = {}) => makeCorsHeaders(event, { "Content-Type": "application/json", ...extra });
  if (event.httpMethod === "OPTIONS") return preflight(event);
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: h(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return { statusCode: 401, headers: h(), body: JSON.stringify({ error: "Sign in required." }) };
  }

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return { statusCode: 503, headers: h(), body: JSON.stringify({ error: "Server misconfigured." }) };
  }

  const authClient = createClient(url, anon);
  const {
    data: { user },
    error: authErr,
  } = await authClient.auth.getUser(token);
  if (authErr || !user?.email) {
    return { statusCode: 401, headers: h(), body: JSON.stringify({ error: "Invalid session." }) };
  }

  const emailNorm = String(user.email).trim().toLowerCase();

  try {
    const { data: dbUser, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", emailNorm)
      .maybeSingle();
    if (uErr) throw uErr;
    if (!dbUser) {
      return { statusCode: 404, headers: h(), body: JSON.stringify({ error: "Account not found." }) };
    }

    const { data: sub, error: sErr } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", dbUser.id)
      .maybeSingle();
    if (sErr) throw sErr;
    const customerId = sub?.stripe_customer_id;
    if (!customerId) {
      return {
        statusCode: 400,
        headers: h(),
        body: JSON.stringify({ error: "No billing account on file. Subscribe with card first." }),
      };
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return { statusCode: 503, headers: h(), body: JSON.stringify({ error: "Billing not configured." }) };
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const siteUrl = getSiteUrl();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${siteUrl}/account.html`,
    });

    return { statusCode: 200, headers: h(), body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error("create-billing-portal:", err.message);
    return { statusCode: 500, headers: h(), body: JSON.stringify({ error: "Could not open billing portal." }) };
  }
};
