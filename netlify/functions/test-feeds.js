const { RSS_FEEDS, fetchRSS } = require("./lib/employer-feeds");

exports.handler = async function () {
  const results = [];

  for (const feed of RSS_FEEDS) {
    console.log(`Testing: ${feed.name}`);
    const start = Date.now();
    try {
      const xml = await fetchRSS(feed.url);
      const hasItems = xml.includes("<entry>") || xml.includes("<item>");
      results.push({
        name: feed.name,
        url: feed.url,
        priority: feed.priority,
        status: 200,
        length: xml.length,
        hasItems,
        ms: Date.now() - start,
      });
    } catch (err) {
      results.push({
        name: feed.name,
        url: feed.url,
        priority: feed.priority,
        status: err.message,
        hasItems: false,
        ms: Date.now() - start,
      });
    }
  }

  const ok = results.filter((r) => r.status === 200 && r.hasItems).length;
  const broken = results.filter((r) => r.status !== 200 || !r.hasItems);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total: results.length, ok, broken: broken.length, results }, null, 2),
  };
};
