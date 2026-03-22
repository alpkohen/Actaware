/**
 * Netlify event: runs when a verified form submission is created.
 * Sends you an email via Resend (same key as digest emails).
 *
 * Env: CONTACT_FORM_NOTIFY_EMAIL (default alpkohen67@gmail.com), RESEND_API_KEY (required)
 */
const Resend = require("resend").Resend;

const DEFAULT_NOTIFY = "alpkohen67@gmail.com";

function escapeText(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Normalize Netlify form data (keys vary: data vs human_fields, casing). */
function flattenFormFields(payload) {
  const out = {};
  const merge = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      if (v == null || v === "") continue;
      const key = String(k).toLowerCase().replace(/\s+/g, "-");
      if (!out[key]) out[key] = String(v);
    }
  };
  merge(payload.data);
  merge(payload.human_fields);
  if (Array.isArray(payload.ordered_human_fields)) {
    for (const row of payload.ordered_human_fields) {
      const n = (row.name || row.title || "").toLowerCase().replace(/\s+/g, "-");
      if (n && row.value != null && row.value !== "" && !out[n]) out[n] = String(row.value);
    }
  }
  return out;
}

exports.handler = async function (event) {
  let rawBody = event.body;
  if (!rawBody) {
    console.warn("submission-created: empty body");
    return { statusCode: 200, body: "ok" };
  }
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, "base64").toString("utf8");
  }

  let parsed;
  try {
    parsed = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  } catch (e) {
    console.error("submission-created: invalid JSON", e.message);
    return { statusCode: 200, body: "ok" };
  }

  const payload = parsed.payload || parsed;
  const flat = flattenFormFields(payload);

  const formName =
    flat["form-name"] ||
    payload.form_name ||
    payload.formName ||
    "";

  // Only skip if we clearly know it's a different form
  if (formName && String(formName).trim() !== "actaware-contact") {
    console.log("submission-created: ignored form", String(formName).trim());
    return { statusCode: 200, body: "ignored" };
  }

  const name = flat.name || flat["your-name"] || "";
  const email = flat.email || flat["work-email"] || "";
  const subject = flat.subject || "(no subject)";
  const message = flat.message || "";

  if (!email && !message && !name) {
    console.warn("submission-created: no usable fields", Object.keys(flat).join(","));
    return { statusCode: 200, body: "ok" };
  }

  const to = (process.env.CONTACT_FORM_NOTIFY_EMAIL || DEFAULT_NOTIFY).trim();
  const apiKeyFinal = process.env.RESEND_API_KEY;
  if (!apiKeyFinal) {
    console.error("submission-created: RESEND_API_KEY missing");
    return { statusCode: 200, body: "ok" };
  }

  const from =
    process.env.CONTACT_FORM_FROM ||
    process.env.RESEND_FROM ||
    "ActAware <onboarding@resend.dev>";

  const text = [
    "New message from actaware.co.uk contact form",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    `Subject: ${subject}`,
    "",
    "Message:",
    message,
    "",
    `Submitted at: ${payload.created_at || new Date().toISOString()}`,
  ].join("\n");

  const html = `
    <h2 style="font-family:sans-serif;">ActAware — contact form</h2>
    <p style="font-family:sans-serif;font-size:14px;line-height:1.5;">
      <strong>Name:</strong> ${escapeText(name)}<br>
      <strong>Email:</strong> <a href="mailto:${escapeText(email)}">${escapeText(email)}</a><br>
      <strong>Subject:</strong> ${escapeText(subject)}
    </p>
    <pre style="font-family:monospace;font-size:13px;white-space:pre-wrap;background:#f4f4f5;padding:16px;border-radius:8px;">${escapeText(
      message
    )}</pre>
  `;

  try {
    const resend = new Resend(apiKeyFinal);
    const payloadSend = {
      from,
      to: to,
      subject: `[ActAware Contact] ${subject}`,
      text,
      html,
    };
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(email).trim())) {
      payloadSend.replyTo = String(email).trim();
    }
    const { data, error } = await resend.emails.send(payloadSend);
    if (error) {
      console.error("submission-created: Resend error", JSON.stringify(error));
    } else {
      console.log("submission-created: Resend ok", data?.id || "sent");
    }
  } catch (err) {
    console.error("submission-created: exception", err.message, err.stack);
  }

  return { statusCode: 200, body: "ok" };
};
