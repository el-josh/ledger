/* ---------------------------------------------------------------------------
   Netlify Function: scan-receipt
   ---------------------------------------------------------------------------
   Receives a base64 receipt image from the app, asks Google's Gemini Flash to
   read the total (plus merchant/date/currency), and returns structured JSON.

   The Gemini API key is read from the GEMINI_API_KEY environment variable set
   in the Netlify dashboard (Site settings -> Environment variables) — it is
   never shipped to the browser. Free-tier Gemini is plenty for low volume.

   Setup is documented in README.md -> "Scan a receipt (auto-extract)".
--------------------------------------------------------------------------- */
const MODEL = 'gemini-2.0-flash';

const PROMPT = [
  'You are a receipt/payment-slip parser. Read the image and return the final',
  'amount the customer paid, the merchant/store name, the transaction date and',
  'the currency.',
  'The total is the grand total actually paid — look for TOTAL, RECEIPT TOTAL,',
  'AMOUNT PAID, or, on a bank/card slip, the single large highlighted amount',
  '(e.g. "NGN70,000.00"). Ignore subtotals, tax lines, change and item prices.',
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
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + encodeURIComponent(key);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return json(502, { error: 'Gemini request failed (' + res.status + ').', detail: detail });
    }
    const data = await res.json();
    let text = '{}';
    try { text = data.candidates[0].content.parts[0].text || '{}'; } catch (e) {}
    let parsed = {};
    try { parsed = JSON.parse(text); } catch (e) {}
    return json(200, {
      total: typeof parsed.total === 'number' ? parsed.total : (parseFloat(parsed.total) || null),
      currency: parsed.currency || null,
      merchant: parsed.merchant || null,
      date: parsed.date || null
    });
  } catch (e) {
    return json(502, { error: 'Could not reach Gemini.', detail: String(e && e.message || e).slice(0, 200) });
  }
};
