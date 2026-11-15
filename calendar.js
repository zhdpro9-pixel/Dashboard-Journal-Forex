// Vercel Serverless Function: Proxy feed resmi Forex Factory (FairEconomy) bebas CORS
const FF_FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const CACHE_TTL_MS = 30 * 60 * 1000;

let memCache = { ts: 0, items: null };

// Snapshot cadangan jika FairEconomy melakukan rate-limit sementara (HTTP 429)
const FF_FALLBACK_RAW = [
  { title: 'CPI m/m', country: 'CAD', date: '2026-11-16T08:30:00-05:00', impact: 'High', forecast: '0.3%', previous: '0.1%' },
  { title: 'Median CPI y/y', country: 'CAD', date: '2026-11-16T08:30:00-05:00', impact: 'High', forecast: '2.0%', previous: '1.9%' },
  { title: 'Trimmed CPI y/y', country: 'CAD', date: '2026-11-16T08:30:00-05:00', impact: 'High', forecast: '1.9%', previous: '1.8%' },
  { title: 'Common CPI y/y', country: 'CAD', date: '2026-11-16T08:30:00-05:00', impact: 'Medium', forecast: '2.5%', previous: '2.4%' },
  { title: 'Fed Chairman Warsh Speaks', country: 'USD', date: '2026-11-16T12:00:00-05:00', impact: 'High', forecast: '', previous: '' },
  { title: 'RBA Gov Bullock Speaks', country: 'AUD', date: '2026-11-16T17:50:00-05:00', impact: 'High', forecast: '', previous: '' },
  { title: 'Inflation Expectations q/q', country: 'NZD', date: '2026-11-16T21:00:00-05:00', impact: 'High', forecast: '', previous: '2.34%' },
  { title: 'Average Earnings Index 3m/y', country: 'GBP', date: '2026-11-17T02:00:00-05:00', impact: 'Medium', forecast: '3.5%', previous: '3.7%' },
  { title: 'Core Retail Sales m/m', country: 'USD', date: '2026-11-17T08:30:00-05:00', impact: 'High', forecast: '0.4%', previous: '0.9%' },
  { title: 'Retail Sales m/m', country: 'USD', date: '2026-11-17T08:30:00-05:00', impact: 'High', forecast: '0.2%', previous: '0.8%' },
  { title: 'Wage Price Index q/q', country: 'AUD', date: '2026-11-17T19:30:00-05:00', impact: 'Medium', forecast: '0.9%', previous: '0.8%' },
  { title: 'CPI y/y', country: 'GBP', date: '2026-11-18T02:00:00-05:00', impact: 'High', forecast: '3.6%', previous: '3.5%' },
  { title: 'BOE Gov Bailey Speaks', country: 'GBP', date: '2026-11-18T02:30:00-05:00', impact: 'High', forecast: '', previous: '' },
  { title: 'ECB Financial Stability Review', country: 'EUR', date: '2026-11-18T04:00:00-05:00', impact: 'Medium', forecast: '', previous: '' },
  { title: 'ECB President Lagarde Speaks', country: 'EUR', date: '2026-11-18T09:25:00-05:00', impact: 'Medium', forecast: '', previous: '' },
  { title: 'BOE Gov Bailey Speaks', country: 'GBP', date: '2026-11-18T10:00:00-05:00', impact: 'High', forecast: '', previous: '' },
  { title: 'RBNZ Gov Breman Speaks', country: 'NZD', date: '2026-11-18T13:00:00-05:00', impact: 'Medium', forecast: '', previous: '' },
  { title: 'FOMC Meeting Minutes', country: 'USD', date: '2026-11-18T14:00:00-05:00', impact: 'High', forecast: '', previous: '' },
  { title: 'Employment Change', country: 'AUD', date: '2026-11-18T19:30:00-05:00', impact: 'High', forecast: '25.2K', previous: '-39.3K' },
  { title: 'Unemployment Rate', country: 'AUD', date: '2026-11-18T19:30:00-05:00', impact: 'High', forecast: '4.7%', previous: '4.7%' },
  { title: 'ECB President Lagarde Speaks', country: 'EUR', date: '2026-11-19T08:30:00-05:00', impact: 'Medium', forecast: '', previous: '' },
  { title: 'Philly Fed Manufacturing Index', country: 'USD', date: '2026-11-19T08:30:00-05:00', impact: 'Medium', forecast: '19.2', previous: '20.9' },
  { title: 'Unemployment Claims', country: 'USD', date: '2026-11-19T08:30:00-05:00', impact: 'Medium', forecast: '199K', previous: '200K' },
  { title: 'Retail Sales m/m', country: 'GBP', date: '2026-11-20T02:00:00-05:00', impact: 'Medium', forecast: '0.0%', previous: '-0.4%' },
  { title: 'ECB President Lagarde Speaks', country: 'EUR', date: '2026-11-20T03:15:00-05:00', impact: 'Medium', forecast: '', previous: '' },
  { title: 'FOMC Member Waller Speaks', country: 'USD', date: '2026-11-20T08:25:00-05:00', impact: 'Medium', forecast: '', previous: '' },
  { title: 'Revised UoM Consumer Sentiment', country: 'USD', date: '2026-11-20T10:00:00-05:00', impact: 'Medium', forecast: '52.1', previous: '51.0' },
  { title: 'Revised UoM Inflation Expectations', country: 'USD', date: '2026-11-20T10:00:00-05:00', impact: 'Medium', forecast: '', previous: '4.3%' }
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = Date.now();
  if (memCache.items && (now - memCache.ts) < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).json({
      ok: true,
      source: 'forexfactory',
      cached: true,
      fetchedAt: new Date(memCache.ts).toISOString(),
      events: memCache.items
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const upstream = await fetch(FF_FEED_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (upstream.ok) {
      const data = await upstream.json();
      if (Array.isArray(data) && data.length > 0) {
        memCache = { ts: now, items: data };
        res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
        return res.status(200).json({
          ok: true,
          source: 'forexfactory',
          cached: false,
          fetchedAt: new Date(now).toISOString(),
          events: data
        });
      }
    }
  } catch (_) {
    // Gunakan cache memori atau snapshot cadangan di bawah
  } finally {
    clearTimeout(timer);
  }

  const fallbackEvents = memCache.items || FF_FALLBACK_RAW;
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=3600');
  return res.status(200).json({
    ok: true,
    source: memCache.items ? 'forexfactory-stale' : 'forexfactory-snapshot',
    cached: true,
    fetchedAt: new Date(memCache.ts || now).toISOString(),
    events: fallbackEvents
  });
};

