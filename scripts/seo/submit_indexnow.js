const https = require('https');

const host = 'porchandparty901.com';
const key = '5f1f13a4-3d84-4d13-8ed9-9c2d90c3b7d2';
const keyLocation = `https://${host}/5f1f13a4-3d84-4d13-8ed9-9c2d90c3b7d2.txt`;
const sitemapUrl = `https://${host}/sitemap.xml`;

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Request failed for ${url} with status ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: data });
        } else {
          reject(new Error(`IndexNow submit failed with status ${res.statusCode}: ${data}`));
        }
      });
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

(async () => {
  const sitemapXml = await fetchText(sitemapUrl);
  const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(Boolean);
  if (!urls.length) throw new Error('No URLs found in sitemap.xml');
  const payload = { host, key, keyLocation, urlList: urls };
  const result = await postJson('https://api.indexnow.org/indexnow', payload);
  console.log(`Submitted ${urls.length} URLs to IndexNow. Status: ${result.statusCode}`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
