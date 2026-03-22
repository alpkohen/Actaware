const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
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
      const subPayload = {
        user_id: user.id,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        plan,
        status: "active",
        trial_ends_at: null,
      };
      const { data: existingSub } = await supabase.from("subscriptions").select("id").eq("user_id", user.id).maybeSingle();
      const { error: sErr } = existingSub
        ? await supabase.from("subscriptions").update(subPayload).eq("user_id", user.id)
        : await supabase.from("subscriptions").insert(subPayload);
      if (sErr) throw sErr;
      console.log("User saved:", email, plan);
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
