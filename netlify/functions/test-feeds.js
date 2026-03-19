const https = require("https");
const http = require("http");
async function fetchURL(url) {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, { timeout: 8000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        length: data.length,
        preview: data.substring(0, 300),
        hasItems: data.includes("<entry>") || data.includes("<item>")
      }));
    });
    req.on("error", (err) => resolve({ status: "ERROR", error: err.message }));
    req.on("timeout", () => resolve({ status: "TIMEOUT" }));
  });
}
const FEEDS = [
  { name: "GOV.UK — DBT Employment Rights", url: "https://www.gov.uk/search/all.atom?keywords=employment+rights+act&organisations%5B%5D=department-for-business-and-trade" },
  { name: "GOV.UK — ERA 2025 Factsheets", url: "https://www.gov.uk/government/publications/employment-rights-bill-factsheets.atom" },
  { name: "GOV.UK — HMRC Employer", url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=hm-revenue-customs&keywords=employer" },
  { name: "GOV.UK — Employment Consultations", url: "https://www.gov.uk/search/policy-papers-and-consultations.atom?topics%5B%5D=employment" },
  { name: "ACAS — News", url: "https://www.acas.org.uk/feed" },
  { name: "ICO — News", url: "https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/feed/" },
  { name: "Legislation — New SI", url: "https://www.legislation.gov.uk/new/uksi.atom" },
  { name: "GOV.UK — DBT All News", url: "https://www.gov.uk/search/all.atom?organisations%5B%5D=department-for-business-and-trade" },
  { name: "GOV.UK — NMW Updates", url: "https://www.gov.uk/search/all.atom?keywords=national+minimum+wage&organisations%5B%5D=department-for-business-and-trade" },
  { name: "HSE — News", url: "https://press.hse.gov.uk/feed/" },
];
exports.handler = async function () {
  const results = [];

  for (const feed of FEEDS) {
    console.log(`Testing: ${feed.name}`);
    const result = await fetchURL(feed.url);
    results.push({
      name: feed.name,
      url: feed.url,
      ...result,
    });
  }
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(results, null, 2),
  };
};
