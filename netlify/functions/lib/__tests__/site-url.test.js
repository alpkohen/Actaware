const { getSiteUrl } = require("../site-url");

describe("getSiteUrl", () => {
  const orig = {
    SITE_URL: process.env.SITE_URL,
    URL: process.env.URL,
    DEPLOY_PRIME_URL: process.env.DEPLOY_PRIME_URL,
  };

  afterEach(() => {
    process.env.SITE_URL = orig.SITE_URL;
    process.env.URL = orig.URL;
    process.env.DEPLOY_PRIME_URL = orig.DEPLOY_PRIME_URL;
  });

  it("defaults to production when all env empty", () => {
    delete process.env.SITE_URL;
    delete process.env.URL;
    delete process.env.DEPLOY_PRIME_URL;
    expect(getSiteUrl()).toBe("https://actaware.co.uk");
  });

  it("uses custom SITE_URL when not netlify.app", () => {
    delete process.env.URL;
    delete process.env.DEPLOY_PRIME_URL;
    process.env.SITE_URL = "https://example.com/";
    expect(getSiteUrl()).toBe("https://example.com");
  });

  it("ignores netlify SITE_URL and falls back to production when URL also netlify", () => {
    process.env.SITE_URL = "https://act-aware.netlify.app";
    process.env.URL = "https://act-aware.netlify.app";
    delete process.env.DEPLOY_PRIME_URL;
    expect(getSiteUrl()).toBe("https://actaware.co.uk");
  });

  it("skips netlify SITE_URL and uses URL when URL is custom domain", () => {
    process.env.SITE_URL = "https://act-aware.netlify.app";
    process.env.URL = "https://actaware.co.uk";
    delete process.env.DEPLOY_PRIME_URL;
    expect(getSiteUrl()).toBe("https://actaware.co.uk");
  });
});
