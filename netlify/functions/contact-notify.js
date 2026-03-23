/**
 * Called from contact.html after Netlify Forms accepts the submission.
 * (submission-created event often does not run — empty function logs.)
 *
 * Env: RESEND_API_KEY, CONTACT_FORM_NOTIFY_EMAIL (default alpkohen67@gmail.com),
 *      URL or SITE_URL (optional, for Referer allowlist)
 */
const Resend = require("resend").Resend;
const { makeCorsHeaders, preflight } = require("./lib/cors");
const { getResendFrom } = require("./lib/resend-from");
const { getSiteUrl } = require("./lib/site-url");

const DEFAULT_NOTIFY = "alpkohen67@gmail.com";

function escapeText(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isAllowedRequest(event) {
  const secFetch = String(event.headers["sec-fetch-site"] || event.headers["Sec-Fetch-Site"] || "").toLowerCase();
  if (secFetch === "same-origin") return true;

  const origin = String(event.headers.origin || event.headers.Origin || "").toLowerCase();
  const referer = String(event.headers.referer || event.headers.Referer || "").toLowerCase();
  const blob = `${origin} ${referer}`;
  if (blob.includes("localhost") || blob.includes("127.0.0.1")) return true;
  if (blob.includes(".netlify.app")) return true;
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.SITE_URL || "";
  try {
    if (siteUrl) {
      const u = siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`;
      const host = new URL(u).hostname.toLowerCase();
      if (host && blob.includes(host)) return true;
    }
    const prodHost = new URL(getSiteUrl()).hostname.toLowerCase();
    if (prodHost && blob.includes(prodHost)) return true;
  } catch (_) {}
  return false;
}

exports.handler = async function (event) {
  const corsHeaders = (extra = {}) => makeCorsHeaders(event, { "Content-Type": "application/json", ...extra });

  if (event.httpMethod === "OPTIONS") return preflight(event);
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!isAllowedRequest(event)) {
    console.warn("contact-notify: blocked request (origin/referer)", {
      origin: event.headers.origin,
      referer: event.headers.referer,
    });
    return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ error: "Forbidden" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  if (body.botField && String(body.botField).trim() !== "") {
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const subject = String(body.subject || "").trim() || "(no subject)";
  const message = String(body.message || "").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Valid email required" }) };
  }
  if (!message || message.length < 2) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Message required" }) };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("contact-notify: RESEND_API_KEY missing");
    return { statusCode: 503, headers: corsHeaders(), body: JSON.stringify({ error: "Email not configured" }) };
  }

  const to = (process.env.CONTACT_FORM_NOTIFY_EMAIL || DEFAULT_NOTIFY).trim();
  const from = getResendFrom();

  const text = [
    "New message from actaware.co.uk contact form (contact-notify)",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    `Subject: ${subject}`,
    "",
    "Message:",
    message,
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
    const resend = new Resend(apiKey);
    const payloadSend = {
      from,
      to,
      subject: `[ActAware Contact] ${subject}`,
      text,
      html,
      replyTo: email,
    };
    const { data, error } = await resend.emails.send(payloadSend);
    if (error) {
      console.error("contact-notify: Resend error", JSON.stringify(error));
      return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: "Send failed" }) };
    }
    console.log("contact-notify: sent", data?.id || "");
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("contact-notify:", err.message);
    return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: "Send failed" }) };
  }
};
