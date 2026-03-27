/**
 * Collapsible nav for small screens. Appends a toggle to each header that has
 * nav.site-nav or nav.dash-nav. Requires /css/site-mobile.css.
 */
(function () {
  function closeAllExcept(keepHeader) {
    document.querySelectorAll("header.actaware-nav-open").forEach((h) => {
      if (h !== keepHeader) {
        h.classList.remove("actaware-nav-open");
        const t = h.querySelector(".actaware-nav-toggle");
        if (t) {
          t.setAttribute("aria-expanded", "false");
          t.setAttribute("aria-label", "Open menu");
        }
      }
    });
  }

  function wireHeader(header) {
    const nav = header.querySelector("nav.site-nav, nav.dash-nav");
    if (!nav || header.querySelector(".actaware-nav-toggle")) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "actaware-nav-toggle";
    toggle.setAttribute("aria-label", "Open menu");
    toggle.setAttribute("aria-expanded", "false");
    const rid = "actaware-site-nav-" + Math.random().toString(36).slice(2, 11);
    if (!nav.id) nav.id = rid;
    toggle.setAttribute("aria-controls", nav.id);
    toggle.innerHTML = '<span class="actaware-nav-toggle-bars" aria-hidden="true"></span>';

    header.appendChild(toggle);

    function setOpen(open) {
      closeAllExcept(open ? header : null);
      header.classList.toggle("actaware-nav-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    }

    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      setOpen(!header.classList.contains("actaware-nav-open"));
    });

    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        setOpen(false);
      });
    });

    document.addEventListener("click", function (e) {
      if (!header.contains(e.target)) setOpen(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && header.classList.contains("actaware-nav-open")) {
        setOpen(false);
      }
    });
  }

  function init() {
    document.querySelectorAll("header").forEach(wireHeader);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
