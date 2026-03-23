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
    #auth-status { display: flex; align-items: center; gap: 10px; flex-shrink: 0; margin-left: 16px; position: relative; z-index: 150; }
    #auth-status a { text-decoration: none; }
    .auth-link { color: rgba(255,255,255,0.7); font-size: 13px; font-weight: 500; }
    .auth-link:hover { color: #fff; }
    .auth-cta {
      background: #C9922A; color: #0B1829 !important; padding: 7px 14px; border-radius: 6px;
      font-size: 13px; font-weight: 600; white-space: nowrap;
    }
    .auth-cta:hover { opacity: 0.92; }
    .auth-user { display: flex; align-items: center; justify-content: flex-end; }
    .auth-with-menu { position: relative; }
    .auth-menu-trigger {
      display: flex; align-items: center; gap: 8px; max-width: min(280px, 52vw);
      background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.14); border-radius: 8px;
      padding: 6px 10px; cursor: pointer; font-family: inherit; color: inherit;
    }
    .auth-menu-trigger:hover { background: rgba(255,255,255,0.11); }
    .auth-name {
      color: rgba(255,255,255,0.92); font-size: 13px; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
    }
    .auth-plan {
      flex-shrink: 0;
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
      padding: 3px 8px; border-radius: 100px; background: rgba(201,146,42,0.25); color: #f5e6cc;
    }
    .auth-caret { flex-shrink: 0; font-size: 10px; color: rgba(255,255,255,0.5); margin-left: 2px; }
    .auth-menu-dropdown {
      position: absolute; right: 0; top: calc(100% + 6px); min-width: 200px;
      background: #162338; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
      padding: 6px 0; box-shadow: 0 12px 40px rgba(0,0,0,0.35);
    }
    .auth-menu-dropdown[hidden] { display: none !important; }
    .auth-menu-item {
      display: block; width: 100%; text-align: left; padding: 10px 16px; font-size: 14px;
      color: rgba(255,255,255,0.9); background: none; border: none; cursor: pointer;
      font-family: inherit; text-decoration: none; box-sizing: border-box;
    }
    a.auth-menu-item:hover, button.auth-menu-item:hover { background: rgba(255,255,255,0.06); }
    .auth-menu-signout {
      color: rgba(255,255,255,0.55); border-top: 1px solid rgba(255,255,255,0.08);
      margin-top: 4px; padding-top: 12px;
    }
    .auth-subtle { color: rgba(255,255,255,0.55); font-size: 12px; }
    @media (max-width: 900px) {
      #auth-status { margin-left: 8px; }
      .auth-menu-trigger { max-width: min(220px, 46vw); padding: 6px 8px; }
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

function loggedInHtml(profile, _accessToken, paths) {
  const name = escapeAttr(profile?.displayName || "Account");
  const plan = escapeAttr(profile?.planLabel || "Member");
  return `
    <div class="auth-user auth-with-menu">
      <button type="button" class="auth-menu-trigger" aria-expanded="false" aria-haspopup="true" data-auth-menu-trigger>
        <span class="auth-name">${name}</span>
        <span class="auth-plan">${plan}</span>
        <span class="auth-caret" aria-hidden="true">▾</span>
      </button>
      <div class="auth-menu-dropdown" hidden data-auth-menu>
        <a href="${paths.account}" class="auth-menu-item">Account</a>
        <a href="${paths.alerts}" class="auth-menu-item">My alerts</a>
        <button type="button" class="auth-menu-item auth-menu-signout" data-auth-signout>Sign out</button>
      </div>
    </div>
  `;
}

let authMenuCloserInstalled = false;
function installAuthMenuDocumentCloser() {
  if (authMenuCloserInstalled) return;
  authMenuCloserInstalled = true;
  document.addEventListener("click", () => {
    const status = document.getElementById("auth-status");
    if (!status) return;
    const menu = status.querySelector("[data-auth-menu]");
    const trig = status.querySelector("[data-auth-menu-trigger]");
    if (menu && !menu.hidden) {
      menu.hidden = true;
      trig?.setAttribute("aria-expanded", "false");
    }
  });
}

function wireAuthMenu(root) {
  const trigger = root.querySelector("[data-auth-menu-trigger]");
  const menu = root.querySelector("[data-auth-menu]");
  if (!trigger || !menu) return;
  installAuthMenuDocumentCloser();
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });
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
        <div class="auth-user auth-with-menu">
          <button type="button" class="auth-menu-trigger" aria-expanded="false" aria-haspopup="true" data-auth-menu-trigger>
            <span class="auth-name">${escapeAttr(emailFallback)}</span>
            <span class="auth-caret" aria-hidden="true">▾</span>
          </button>
          <div class="auth-menu-dropdown" hidden data-auth-menu>
            <a href="${paths.alerts}" class="auth-menu-item">My alerts</a>
            <button type="button" class="auth-menu-item auth-menu-signout" data-auth-signout>Sign out</button>
          </div>
        </div>
      `;
    } else {
      root.innerHTML = loggedInHtml(profile, session.access_token, paths);
    }

    wireAuthMenu(root);

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
