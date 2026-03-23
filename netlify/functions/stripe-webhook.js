const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");
const { getResendFrom } = require("./lib/resend-from");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function planTitle(plan) {
  const p = String(plan || "starter").toLowerCase();
  if (p === "professional") return "Professional";
  if (p === "agency") return "Agency";
  return "Starter";
}

async function sendSubscriptionConfirmedEmail(to, plan) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("stripe-webhook: RESEND_API_KEY missing, skip confirmation email");
    return;
  }
  const site = (process.env.SITE_URL || "https://act-aware.netlify.app").replace(/\/$/, "");
  const title = planTitle(plan);
  const text = [
    "Your ActAware subscription is confirmed.",
    "",
    `Plan: ${title}`,
    "",
    `View your compliance alerts: ${site}/dashboard.html`,
    `Manage your account: ${site}/account.html`,
    "",
    "You’ll receive your daily UK employer digest around 08:00 UK time.",
    "",
    "Information only — not legal advice.",
    "",
    "— ActAware",
  ].join("\n");

  const html = `
    <p style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#374151;">
      Your <strong>ActAware</strong> subscription is confirmed.
    </p>
    <p style="font-family:system-ui,sans-serif;font-size:15px;color:#1e293b;"><strong>Plan:</strong> ${title}</p>
    <p style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;color:#4b5563;">
      <a href="${site}/dashboard.html">My alerts</a> ·
      <a href="${site}/account.html">Account</a>
    </p>
    <p style="font-family:system-ui,sans-serif;font-size:13px;color:#6b7280;">
      Daily digest around 08:00 UK time. Manage billing from your Account page when available.
    </p>
    <p style="font-family:system-ui,sans-serif;font-size:12px;color:#9ca3af;">Information only — not legal advice.</p>
  `;

  try {
    const resend = new Resend(key);
    const { error } = await resend.emails.send({
      from: getResendFrom(),
      to,
      subject: `ActAware — ${title} subscription confirmed`,
      text,
      html,
    });
    if (error) console.error("stripe-webhook Resend:", JSON.stringify(error));
    else console.log("stripe-webhook: confirmation email sent to", to);
  } catch (e) {
    console.error("stripe-webhook confirmation email:", e.message);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, event.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook sig error:", err.message);
    return { statusCode: 400, body: "Webhook Error: " + err.message };
  }
  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const email = session.customer_email || session.customer_details?.email;
    const plan = session.metadata?.plan || "starter";
    if (!email) return { statusCode: 200, body: "OK" };
    try {
      const { data: user, error: uErr } = await supabase.from("users").upsert({ email }, { onConflict: "email", ignoreDuplicates: false }).select("id").single();
      if (uErr) throw uErr;
      const seatLimit = plan === "professional" ? 3 : plan === "agency" ? 15 : 1;
      const subPayload = {
        user_id: user.id,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        plan,
        status: "active",
        trial_ends_at: null,
        seat_limit: seatLimit,
      };
      const { data: existingSub } = await supabase.from("subscriptions").select("id").eq("user_id", user.id).maybeSingle();
      const { error: sErr } = existingSub
        ? await supabase.from("subscriptions").update(subPayload).eq("user_id", user.id)
        : await supabase.from("subscriptions").insert(subPayload);
      if (sErr) throw sErr;
      console.log("User saved:", email, plan);
      await sendSubscriptionConfirmedEmail(String(email).trim().toLowerCase(), plan);
    } catch (err) {
      console.error("DB error:", err.message);
      return { statusCode: 500, body: "Database error" };
    }
  }
  if (stripeEvent.type === "customer.subscription.deleted" || stripeEvent.type === "customer.subscription.updated") {
    const sub = stripeEvent.data.object;
    await supabase.from("subscriptions").update({ status: sub.status }).eq("stripe_subscription_id", sub.id);
  }
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
