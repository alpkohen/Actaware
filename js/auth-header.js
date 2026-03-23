/**
 * Site-wide auth UI in #auth-status. Call initAuthStatus() after DOM ready.
 * Requires: <div id="auth-status"></div> inside header, and public-config + account-profile functions deployed.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const STYLE_ID = "actaware-auth-header-styles";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    #auth-status { display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-left: 16px; }
    #auth-status a { text-decoration: none; }
    .auth-link { color: rgba(255,255,255,0.7); font-size: 13px; font-weight: 500; }
    .auth-link:hover { color: #fff; }
    .auth-cta {
      background: #C9922A; color: #0B1829 !important; padding: 7px 14px; border-radius: 6px;
      font-size: 13px; font-weight: 600; white-space: nowrap;
    }
    .auth-cta:hover { opacity: 0.92; }
    .auth-user { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; max-width: 280px; }
    .auth-name { color: rgba(255,255,255,0.92); font-size: 13px; font-weight: 600; }
    .auth-plan {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
      padding: 3px 8px; border-radius: 100px; background: rgba(201,146,42,0.25); color: #f5e6cc;
    }
    .auth-subtle { color: rgba(255,255,255,0.55); font-size: 12px; }
    .auth-out {
      background: transparent; border: 1px solid rgba(255,255,255,0.25); color: rgba(255,255,255,0.8);
      padding: 5px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit;
    }
    .auth-out:hover { border-color: rgba(255,255,255,0.45); color: #fff; }
    @media (max-width: 900px) {
      #auth-status { margin-left: 8px; }
      .auth-user { max-width: 200px; flex-direction: column; align-items: flex-end; gap: 4px; }
    }
  `;
  document.head.appendChild(el);
}

function loggedOutHtml(signInPath, trialPath) {
  return `
    <a href="${signInPath}" class="auth-link">Sign in</a>
    <a href="${trialPath}" class="auth-cta">Free trial</a>
  `;
}

function loggedInHtml(profile, accessToken, paths) {
  const name = escapeAttr(profile?.displayName || "Account");
  const plan = escapeAttr(profile?.planLabel || "Member");
  return `
    <div class="auth-user">
      <span class="auth-name">${name}</span>
      <span class="auth-plan">${plan}</span>
      <a href="${paths.account}" class="auth-link">Account</a>
      <a href="${paths.alerts}" class="auth-link">My alerts</a>
      <button type="button" class="auth-out" data-auth-signout>Sign out</button>
    </div>
  `;
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {object} [opts]
 * @param {string} [opts.signInPath] default dashboard.html
 * @param {string} [opts.trialPath] default trial.html
 * @param {string} [opts.accountPath] default account.html
 * @param {string} [opts.alertsPath] default dashboard.html
 */
export async function initAuthStatus(opts = {}) {
  injectStyles();
  const root = document.getElementById("auth-status");
  if (!root) return null;

  const paths = {
    signIn: opts.signInPath || "dashboard.html",
    trial: opts.trialPath || "trial.html",
    account: opts.accountPath || "account.html",
    alerts: opts.alertsPath || "dashboard.html",
  };

  const cfgRes = await fetch("/.netlify/functions/public-config");
  const cfg = await cfgRes.json().catch(() => ({}));
  if (!cfgRes.ok || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    root.innerHTML = loggedOutHtml(paths.signIn, paths.trial);
    return null;
  }

  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  async function render() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      root.innerHTML = loggedOutHtml(paths.signIn, paths.trial);
      return;
    }

    let profile = null;
    try {
      const pr = await fetch("/.netlify/functions/account-profile", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (pr.ok) profile = await pr.json();
    } catch (_) {}

    const emailFallback = session.user?.email?.split("@")[0] || "You";
    if (!profile) {
      root.innerHTML = `
        <div class="auth-user">
          <span class="auth-name">${escapeAttr(emailFallback)}</span>
          <span class="auth-subtle">Set up account</span>
          <a href="${paths.signIn}" class="auth-link">My alerts</a>
          <button type="button" class="auth-out" data-auth-signout>Sign out</button>
        </div>
      `;
    } else {
      root.innerHTML = loggedInHtml(profile, session.access_token, paths);
    }

    const btn = root.querySelector("[data-auth-signout]");
    if (btn) {
      btn.addEventListener("click", async () => {
        await supabase.auth.signOut();
        root.innerHTML = loggedOutHtml(paths.signIn, paths.trial);
      });
    }
  }

  await render();
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      root.innerHTML = loggedOutHtml(paths.signIn, paths.trial);
    } else {
      render();
    }
  });

  return supabase;
}
