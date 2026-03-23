/**
 * Shared RSS feed list + fetch/parse helpers for send-alerts-background and send-critical-alerts-background.
 */

const https = require("https");
const http = require("http");

const RSS_FEEDS = [
  {
    name: "GOV.UK — Employment Rights Act 2025",
    url: "https://www.gov.uk/search/all.atom?keywords=employment+rights+act&organisations%5B%5D=department-for-business-and-trade",
    priority: "critical",
  },
  {
    name: "GOV.UK — Employment Consultations (Make Work Pay)",
    url: "https://www.gov.uk/search/policy-papers-and-consultations.atom?topics%5B%5D=employment",
    priority: "high",
  },
  {
    name: "GOV.UK — HMRC Employer Guidance",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=hm-revenue-customs&keywords=employer",
    priority: "high",
  },
  {
    name: "GOV.UK — National Minimum Wage Updates",
    url: "https://www.gov.uk/search/all.atom?keywords=national+minimum+wage&organisations%5B%5D=department-for-business-and-trade",
    priority: "high",
  },
  {
    name: "GOV.UK — Fair Work Agency",
    url: "https://www.gov.uk/search/all.atom?keywords=fair+work+agency",
    priority: "high",
  },
  {
    name: "GOV.UK — Statutory Pay (SSP/SMP/SPP)",
    url: "https://www.gov.uk/search/all.atom?keywords=statutory+sick+pay+statutory+maternity+pay",
    priority: "medium",
  },
  {
    name: "GOV.UK — DBT Employer News",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=department-for-business-and-trade",
    priority: "medium",
  },
  {
    name: "GOV.UK — Information Commissioner's Office",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=information-commissioner-s-office",
    priority: "medium",
    maxItemsPerDigest: 18,
  },
  {
    name: "Legislation.gov.uk — New Statutory Instruments (ERA 2025)",
    url: "https://www.legislation.gov.uk/new/uksi/data.feed",
    priority: "critical",
    filterKeywords: [
      "employment",
      "employer",
      "employee",
      "wage",
      "pension",
      "statutory",
      "redundan",
      "dismiss",
      "tribunal",
      "maternity",
      "paternity",
      "holiday",
      "leave",
      "discrimina",
      "worker",
      "national insurance",
      "minimum wage",
      "agency worker",
      "fixed-term",
      "whistleblow",
      "transfer of undertakings",
      "tupe",
    ],
  },
  {
    name: "Employment Tribunal — Recent Decisions",
    url: "https://www.gov.uk/employment-tribunal-decisions.atom",
    priority: "high",
    maxItemsPerDigest: 15,
  },
  {
    name: "Pensions Regulator — Employer Auto-Enrolment",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=the-pensions-regulator&keywords=employer+auto-enrolment",
    priority: "medium",
  },
  {
    name: "ACAS — Employment Relations & Guidance",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=acas",
    priority: "high",
  },
  {
    name: "HSE — Health & Safety at Work",
    url: "https://press.hse.gov.uk/feed/",
    priority: "medium",
  },
  {
    name: "GOV.UK — Equality and Human Rights Commission",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=equality-and-human-rights-commission",
    priority: "high",
    maxItemsPerDigest: 18,
  },
  {
    name: "GOV.UK — Home Office (Right to Work)",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=home-office&keywords=right+to+work+employer",
    priority: "high",
  },
  {
    name: "GOV.UK — Home Office (Employer Immigration)",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=home-office&keywords=employer+immigration",
    priority: "high",
  },
  {
    name: "GOV.UK — DWP (Employer)",
    url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=department-for-work-pensions&keywords=employer",
    priority: "medium",
  },
];

/** Matches marketing copy on the site; update index.html if you change RSS_FEEDS length. */
const MONITORED_FEED_COUNT = RSS_FEEDS.length;

function fetchRSS(urlString) {
  return new Promise((resolve, reject) => {
    function doRequest(currentUrl) {
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch {
        reject(new Error(`Invalid URL: ${currentUrl}`));
        return;
      }
      const isHttp = parsed.protocol === "http:";
      const client = isHttp ? http : https;
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttp ? 80 : 443),
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        timeout: 20000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ActAware/1.0; UK employer alerts; +https://actaware.co.uk)",
          Accept: "application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
        },
      };

      const req = client.request(options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location.trim();
          const next = /^https?:\/\//i.test(loc) ? loc : new URL(loc, currentUrl).href;
          doRequest(next);
          return;
        }
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Timeout"));
      });
      req.end();
    }
    doRequest(urlString);
  });
}

function matchesFeedFilter(textLc, filterSpec) {
  if (!filterSpec) return true;
  const keys = Array.isArray(filterSpec) ? filterSpec : [filterSpec];
  return keys.some((k) => textLc.includes(String(k).toLowerCase()));
}

function parseRSSItems(xml, filterSpec = null) {
  const items = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>|<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1] || match[2];
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
    const summary =
      (block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) ||
        block.match(/<description>([\s\S]*?)<\/description>/) ||
        [])[1] || "";
    const link = (block.match(/<link[^>]*href="([^"]*)"/) || block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const published =
      (block.match(/<published>([\s\S]*?)<\/published>/) ||
        block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ||
        block.match(/<updated>([\s\S]*?)<\/updated>/) ||
        [])[1] || "";
    const cleanTitle = title.replace(/<[^>]+>/g, "").trim();
    if (!cleanTitle) continue;
    const lc = cleanTitle.toLowerCase() + summary.toLowerCase();
    if (!matchesFeedFilter(lc, filterSpec)) continue;
    items.push({
      title: cleanTitle,
      summary: summary.replace(/<[^>]+>/g, "").trim().substring(0, 600),
      link: link.trim(),
      published: published.trim(),
    });
  }
  return items;
}

/**
 * Items published on/after cutoff, newest first; optional per-feed cap (tribunal / high-volume feeds).
 */
function selectItemsInWindow(allItems, cutoffMs, feed) {
  let items = allItems.filter((item) => {
    if (!item.published) return false;
    const d = new Date(item.published);
    return !isNaN(d) && d.getTime() >= cutoffMs;
  });
  items.sort((a, b) => new Date(b.published) - new Date(a.published));
  const cap = feed?.maxItemsPerDigest;
  if (typeof cap === "number" && cap > 0 && items.length > cap) {
    items = items.slice(0, cap);
  }
  return items;
}

module.exports = {
  RSS_FEEDS,
  MONITORED_FEED_COUNT,
  fetchRSS,
  parseRSSItems,
  selectItemsInWindow,
};
