/* ---------------------------------------------------------------------------
   Netlify Function: scan-receipt
   ---------------------------------------------------------------------------
   Receives a base64 receipt image from the app, asks Google's Gemini Flash to
   read the total (plus merchant/date/currency), and returns structured JSON.

   The Gemini API key is read from the GEMINI_API_KEY environment variable set
   in the Netlify dashboard (Site settings -> Environment variables) — it is
   never shipped to the browser.

   Uses Node's built-in https module (not the global fetch) so it works on every
   Netlify Node runtime, old or new.

   Model selection is dynamic: we ask the key which models it actually supports
   (ListModels) and use a Flash model from that list. This avoids "404 model not
   found" when a hard-coded name isn't served to a particular key/region.

   Setup is documented in README.md -> "Auto-extraction setup".
--------------------------------------------------------------------------- */
const https = require('https');

const API = 'https://generativelanguage.googleapis.com/v1beta';

// Fallback list, only used if model discovery fails outright. "*-latest"
// aliases are safest because Google keeps them pointed at a current model.
const FALLBACK = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];

// Rank a discovered model name: prefer a current, non-lite Flash model that
// can do vision. Retired/experimental/non-text models score low or negative.
function scoreModel(n) {
  var s = 0;
  if (/flash/i.test(n)) s += 100;          // flash = fast, cheap, multimodal
  if (/latest/i.test(n)) s += 45;          // aliases never go stale
  if (/-2\.5/.test(n)) s += 30;
  else if (/-2\.0/.test(n)) s += 25;
  else if (/-1\.5/.test(n)) s += 3;        // 1.5 is being retired
  if (/lite/i.test(n)) s -= 12;
  if (/preview|exp|experimental|thinking/i.test(n)) s -= 40;
  if (/vision|tts|audio|image|imagen|embedding|aqa|learnlm|gemma/i.test(n)) s -= 500;
  if (/\d{3,}/.test(n)) s -= 8;            // dated snapshots (e.g. -001, -0514)
  return s;
}

const PROMPT = [
  'You are a receipt/payment-slip parser. Read the image and return the final',
  'amount the customer paid, the merchant/store name, the transaction date and',
  'the currency.',
  'The total is the grand total actually paid — look for TOTAL, RECEIPT TOTAL,',
  'AMOUNT PAID, CARD PAID, or, on a bank/card slip, the single large highlighted',
  'amount (e.g. "NGN70,000.00"). Ignore subtotals, tax lines, change and item prices.',
  'Return ONLY JSON with exactly these keys:',
  '{"total": number|null, "currency": "ISO 4217 code"|null, "merchant": string|null, "date": "YYYY-MM-DD"|null}',
  'Use a plain number for total (no thousands separators or symbols). Prefer',
  'NGN, USD, GBP, EUR, CAD or GHS when it applies. If a field is unreadable use null.'
].join(' ');

function json(statusCode, obj) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj)
  };
}

// HTTP via the built-in https module. Resolves { status, text }.
function request(method, url, bodyObj) {
  return new Promise(function (resolve, reject) {
    var u = new URL(url);
    var data = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
    var headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    var req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: method, headers: headers }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Pull Google's human-readable message out of an error body, if present.
function googleMsg(bodyText) {
  try { var b = JSON.parse(bodyText); if (b && b.error && b.error.message) return String(b.error.message); } catch (e) {}
  return (bodyText || '').slice(0, 200);
}

// Ask the key which models support generateContent, ordered by our preference.
async function discoverModels(key) {
  var res;
  try { res = await request('GET', API + '/models?pageSize=1000&key=' + encodeURIComponent(key)); }
  catch (e) { return { models: [], error: 'Could not list models: ' + String((e && e.message) || e).slice(0, 160) }; }
  if (res.status < 200 || res.status >= 300) {
    return { models: [], error: 'ListModels failed (' + res.status + '): ' + googleMsg(res.text).slice(0, 160) };
  }
  var data = {};
  try { data = JSON.parse(res.text); } catch (e) {}
  var all = (data.models || [])
    .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; })
    .map(function (m) { return String(m.name || '').replace(/^models\//, ''); })
    .filter(function (n) { return n && scoreModel(n) > 0; }); // drop non-text / negative-scored
  all.sort(function (a, b) { return scoreModel(b) - scoreModel(a); });
  return { models: all.slice(0, 6), error: null };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(500, { error: 'Server not configured: GEMINI_API_KEY is missing.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Invalid JSON body.' }); }
  const image = body.image;
  const mimeType = body.mimeType || 'image/jpeg';
  if (!image) return json(400, { error: 'No image provided.' });

  const payload = {
    contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: image } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' }
  };

  // Figure out which models this key can actually use. If discovery fails, fall
  // back to the preference list so we still try something.
  const disc = await discoverModels(key);
  const models = disc.models.length ? disc.models : FALLBACK;

  let last = null;
  const tried = [];
  for (let i = 0; i < models.length; i++) {
    const url = API + '/models/' + models[i] + ':generateContent?key=' + encodeURIComponent(key);
    let res;
    try {
      res = await request('POST', url, payload);
    } catch (e) {
      last = { code: 502, error: 'Could not reach Gemini.', detail: String((e && e.message) || e).slice(0, 200) };
      tried.push(models[i] + ':err');
      continue;
    }

    if (res.status >= 200 && res.status < 300) {
      let data = {};
      try { data = JSON.parse(res.text); } catch (e) {}
      let text = '{}';
      try { text = data.candidates[0].content.parts[0].text || '{}'; } catch (e) {}
      let parsed = {};
      try { parsed = JSON.parse(text); } catch (e) {}
      return json(200, {
        model: models[i],
        total: typeof parsed.total === 'number' ? parsed.total : (parseFloat(parsed.total) || null),
        currency: parsed.currency || null,
        merchant: parsed.merchant || null,
        date: parsed.date || null
      });
    }

    tried.push(models[i] + ':' + res.status);
    last = { code: 502, status: res.status, error: 'Gemini request failed (' + res.status + ').', detail: googleMsg(res.text) };
    if (res.status === 429) last.error = 'Free-tier quota reached (429). ' + googleMsg(res.text).slice(0, 140);
    if (res.status === 404) last.error = 'No usable model (404). ' + googleMsg(res.text).slice(0, 140);
  }

  if (!last) last = { code: 502, error: 'Gemini request failed.' };
  // Attach diagnostics so the client can show exactly what happened.
  last.tried = tried;
  if (disc.error) last.discovery = disc.error;
  return json(last.code || 502, last);
};
