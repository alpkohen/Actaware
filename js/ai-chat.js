/**
 * ActAware AI Chat — floating panel (Professional & Agency).
 * API keys stay server-side; this module only calls /.netlify/functions/ai-chat.
 */

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Turn http(s) URLs in plain text into safe clickable links (rest stays escaped). */
function linkifyPlainText(s) {
  const str = String(s);
  const parts = str.split(/(https?:\/\/[^\s<]+)/gi);
  return parts
    .map((part) => {
      if (!part) return "";
      if (/^https?:\/\//i.test(part)) {
        try {
          const u = new URL(part);
          if (u.protocol !== "http:" && u.protocol !== "https:") return escapeHtml(part);
          const href = u.href;
          return `<a href="${escapeHtml(href)}" class="ai-chat-source-link" target="_blank" rel="noopener noreferrer">${escapeHtml(part)}</a>`;
        } catch {
          return escapeHtml(part);
        }
      }
      return escapeHtml(part);
    })
    .join("");
}

function canOpenChat(meta) {
  const plan = String(meta?.plan || "").toLowerCase();
  const status = String(meta?.subscriptionStatus || meta?.status || "").toLowerCase();
  if (status !== "active") return false;
  return plan === "professional" || plan === "agency";
}

/**
 * @param {object} opts
 * @param {() => string | null} opts.getAccessToken
 * @param {() => object} opts.getPlanMeta dashboard `meta` from dashboard-alerts (includes plan, subscriptionStatus)
 */
export function initActAwareAIChat(opts) {
  const { getAccessToken, getPlanMeta } = opts;

  const root = document.createElement("div");
  root.id = "actaware-ai-chat-root";
  root.setAttribute("aria-live", "polite");
  document.body.appendChild(root);

  root.innerHTML = `
    <button type="button" id="ai-chat-fab" class="ai-chat-fab" aria-label="Open compliance assistant (BETA)" hidden>
      <span class="ai-chat-fab-icon" aria-hidden="true">💬</span>
      <span class="ai-chat-fab-text">Ask ActAware</span>
    </button>
    <div id="ai-chat-panel" class="ai-chat-panel" hidden role="dialog" aria-modal="true" aria-labelledby="ai-chat-heading">
      <div class="ai-chat-panel-header">
        <h2 id="ai-chat-heading" class="ai-chat-title">Compliance assistant <span class="ai-chat-beta" translate="no">BETA</span></h2>
        <button type="button" class="ai-chat-close" id="ai-chat-close" aria-label="Close">×</button>
      </div>
      <div id="ai-chat-messages" class="ai-chat-messages"></div>
      <form id="ai-chat-form" class="ai-chat-form">
        <textarea id="ai-chat-input" rows="2" maxlength="4000" placeholder="Ask about UK employer compliance…" autocomplete="off"></textarea>
        <button type="submit" class="ai-chat-send" id="ai-chat-send">Send</button>
      </form>
      <p class="ai-chat-footnote">Professional feature · Drag the corner to resize · Information only</p>
    </div>
    <div id="ai-chat-upgrade-modal" class="dash-modal" hidden>
      <div class="dash-modal-backdrop" data-ai-close-upgrade></div>
      <div class="dash-modal-card" role="dialog" aria-labelledby="ai-upgrade-title">
        <h4 id="ai-upgrade-title">AI Chat is available on the Professional plan</h4>
        <p style="font-size:14px;color:#4b5563;line-height:1.55;margin:0;">
          Upgrade for <strong>£79/month</strong> to unlock the compliance assistant and other Professional tools.
        </p>
        <div class="dash-modal-actions" style="margin-top:18px;">
          <button type="button" id="ai-upgrade-dismiss" style="background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Not now</button>
          <a href="register.html?plan=professional" id="ai-upgrade-cta" style="background:#0f172a;color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;display:inline-block;">Upgrade to Professional</a>
        </div>
      </div>
    </div>
  `;

  const fab = root.querySelector("#ai-chat-fab");
  const panel = root.querySelector("#ai-chat-panel");
  const messagesEl = root.querySelector("#ai-chat-messages");
  const form = root.querySelector("#ai-chat-form");
  const input = root.querySelector("#ai-chat-input");
  const sendBtn = root.querySelector("#ai-chat-send");
  const upgradeModal = root.querySelector("#ai-chat-upgrade-modal");

  function sync() {
    const token = getAccessToken();
    const dash = document.getElementById("dashboard-section");
    const onDash = dash && dash.style.display === "block";
    fab.hidden = !(token && onDash);
    if (!token || !onDash) {
      panel.hidden = true;
      upgradeModal.hidden = true;
    }
  }

  function appendUserBubble(text) {
    const div = document.createElement("div");
    div.className = "ai-chat-bubble ai-chat-bubble-user";
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendAssistantBubble(answer, sources, disclaimer) {
    const wrap = document.createElement("div");
    wrap.className = "ai-chat-bubble ai-chat-bubble-assistant";
    const body = document.createElement("div");
    body.className = "ai-chat-answer";
    body.innerHTML = answer
      .split("\n")
      .map((line) => linkifyPlainText(line))
      .join("<br>");
    wrap.appendChild(body);
    if (sources?.length) {
      const src = document.createElement("p");
      src.className = "ai-chat-sources";
      src.innerHTML =
        '<span class="ai-chat-sources-label">Sources:</span> ' +
        sources.map((s) => linkifyPlainText(s)).join(' <span class="ai-chat-src-sep" aria-hidden="true">·</span> ');
      wrap.appendChild(src);
    }
    if (disclaimer) {
      const disc = document.createElement("p");
      disc.className = "ai-chat-disclaimer";
      disc.textContent = disclaimer;
      wrap.appendChild(disc);
    }
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendTyping() {
    const id = `typing-${Date.now()}`;
    const div = document.createElement("div");
    div.id = id;
    div.className = "ai-chat-bubble ai-chat-bubble-assistant ai-chat-typing";
    div.innerHTML = `<span></span><span></span><span></span>`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return id;
  }

  function removeTyping(id) {
    document.getElementById(id)?.remove();
  }

  function showError(msg) {
    const div = document.createElement("div");
    div.className = "ai-chat-bubble ai-chat-bubble-assistant ai-chat-error";
    div.textContent = msg || "Something went wrong. Please try again.";
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  fab.addEventListener("click", () => {
    const meta = getPlanMeta() || {};
    if (!canOpenChat(meta)) {
      upgradeModal.hidden = false;
      return;
    }
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      input?.focus();
      if (!messagesEl.querySelector(".ai-chat-bubble")) {
        const hint = document.createElement("div");
        hint.className = "ai-chat-bubble ai-chat-bubble-assistant ai-chat-hint";
        hint.innerHTML =
          "<p>Ask about UK employment law obligations, payroll, right-to-work, health &amp; safety, or your recent alerts. This is not legal advice.</p>";
        messagesEl.appendChild(hint);
      }
    }
  });

  function closeChatPanel() {
    panel.hidden = true;
  }

  root.querySelector("#ai-chat-close")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeChatPanel();
  });

  root.querySelector("[data-ai-close-upgrade]")?.addEventListener("click", () => {
    upgradeModal.hidden = true;
  });
  root.querySelector("#ai-upgrade-dismiss")?.addEventListener("click", () => {
    upgradeModal.hidden = true;
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!upgradeModal.hidden) {
      upgradeModal.hidden = true;
      return;
    }
    if (!panel.hidden) closeChatPanel();
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = (input.value || "").trim();
    if (!text) return;
    const token = getAccessToken();
    if (!token) return;

    const meta = getPlanMeta() || {};
    if (!canOpenChat(meta)) {
      upgradeModal.hidden = false;
      return;
    }

    appendUserBubble(text);
    input.value = "";
    sendBtn.disabled = true;
    const tid = appendTyping();

    try {
      const res = await fetch("/.netlify/functions/ai-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      removeTyping(tid);

      if (res.status === 403 && data.code === "upgrade_required") {
        upgradeModal.hidden = false;
        return;
      }
      if (!res.ok) {
        showError(data.error || "Something went wrong. Please try again.");
        return;
      }

      appendAssistantBubble(data.answer || "", data.sources || [], data.disclaimer || "");

      if (typeof console !== "undefined" && console.log) {
        console.log("[ActAware AI Chat] reply ok", { sources: data.sources });
      }
    } catch (_) {
      removeTyping(tid);
      showError("Something went wrong. Please try again.");
    } finally {
      sendBtn.disabled = false;
    }
  });

  sync();

  return { sync };
}
