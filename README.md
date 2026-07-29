# Ledger

A minimal personal-finance tracker. Track income, expenses and savings month by
month, in Naira, US Dollars or Euros, with live exchange rates, expense
categories, remembered recurring items and spreadsheet import.

Implemented from the `Ledger.dc.html` design. Pure HTML/CSS/vanilla JS with no
build step — open `index.html` in a browser and everything runs client-side.
All data is stored in the browser's `localStorage`.

The app **starts empty** — nothing is shown until you add income and expenses
(or import a spreadsheet).

## Running

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Features

### Multi-currency with automatic live rates
Pick your display currency from the header dropdown — **any** ISO currency is
available, with NGN, USD, GBP, EUR and CAD pinned at the top. Entries can be
recorded in any currency too; each keeps its original currency and totals are
converted on the fly (symbols and formatting come from the browser's `Intl`).

Rates are fetched **automatically — no API key, token or sign-up required.** On
load (and whenever you press **Rates → Refresh rates**) the app pulls live
mid-market rates for all currencies from a keyless, CORS-enabled source:

1. [ExchangeRate-API open endpoint](https://open.er-api.com) —
   `GET https://open.er-api.com/v6/latest/NGN` (primary)
2. [@fawazahmed0 currency-api](https://github.com/fawazahmed0/exchange-api) on
   the jsDelivr CDN (automatic fallback if the first is unreachable)

Rates refresh silently on load when the saved ones are more than 12 hours old.
If you're offline, the last saved rates are kept.

### Quick add & receipt capture
A floating **+** button (bottom-right) lets you add an expense from anywhere:
- **Add expense** — a quick form (amount, name, category, currency, date).
- **Scan receipt** — snap a photo, frame it with a draggable crop box, optionally
  apply a black-&-white "scan" look. The app then **reads the total, merchant,
  date and currency automatically** and pre-fills the confirm sheet — check the
  values and save. If auto-extraction is unavailable (or can't read the photo),
  you just type the total in yourself; nothing breaks.

#### Auto-extraction setup (optional, ~3 minutes)
Auto-extraction sends the cropped photo to Google's **Gemini Flash** model to
read the numbers. The API key is kept **server-side** in a tiny
[Netlify Function](netlify/functions/scan-receipt.js) so it's never shipped to
the browser. It's **off until you configure it** — until then, Scan still works
and simply opens a blank confirm sheet for you to fill in.

To turn it on (the app already deploys the function; you only add a key):

**1. Get a free Gemini API key**
- Go to <https://aistudio.google.com/apikey> → *Create API key*. The free tier
  is plenty for low volume (well under Gemini's free daily limits).

**2. Add the key to your host (Netlify)**
- Netlify dashboard → your site → *Site settings → Environment variables →
  Add a variable*.
- Key: `GEMINI_API_KEY`  ·  Value: the key from step 1.
- **Never commit this key to the repo** — it lives only in the host's env vars.
- Trigger a redeploy (*Deploys → Trigger deploy*) so the function picks it up.

That's it — scan a receipt and the total fills in automatically.

> **Not on Netlify?** The client posts the image to
> `/.netlify/functions/scan-receipt` by default. To point it elsewhere, set
> `window.LEDGER_CONFIG.scanEndpoint = 'https://…'` in `config.js`, or set it to
> `''`/`null` to disable auto-extraction entirely (Scan then opens a blank
> confirm sheet).

### Export a statement of account
Press **Export** to download a detailed statement for the selected year:

- **Excel (.xlsx)** — a *Statement* sheet with every income, expense and saving
  entry (month, type, name, category, original amount + currency, and the amount
  converted to your display currency), plus a *Summary* sheet of monthly and
  yearly totals.
- **PDF** — a printable statement (via your browser's Print → *Save as PDF*)
  with the same summary and detailed breakdown.

### Automatic savings
Savings is the money you don't spend. For each month, **Saved = Income −
Expenses** — the leftover is calculated for you and shown in the *Savings /
Invest* card as an auto-saved amount. You don't have to enter it.

If you want to earmark part of that leftover (e.g. moved to an investment),
use **+ Allocate savings**; the card then shows your allocation plus the
remaining *Unallocated* amount, which always add up to the month's leftover.

### Categories & recurring memory
Every entry has a **category** (Groceries, Housing, Utilities, Transport,
Health, Family, Education, Salary, Savings, …). The category is auto-detected
from the entry name and can be overridden in the add/edit dialog.

Tick **“Repeat every month”** on an entry to remember it. Remembered items live
in the **Recurring** panel (header) and can be added to any month in one tap:

- When you open a month that's missing some of your recurring items, a banner
  offers to **Add recurring items** — so you never re-key rent, salary, school
  fees or subscriptions again.
- Manage or remove remembered items from the **Recurring** panel.

### Spreadsheet import (.xls / .xlsx / .csv)
Press **Import** and choose a spreadsheet. Ledger (via
[SheetJS](https://sheetjs.com), vendored in `vendor/`) reads the first sheet,
auto-maps common columns (Date/Month, Description, Amount, Currency, Type,
Category) and shows a preview. Adjust the column mapping if needed and import.

- Amounts may include currency symbols, thousands separators or `(parentheses)`
  for negatives.
- The period column accepts real dates, Excel date serials, `January`/`Jan`, or
  a month number; rows without a recognizable period land in the current month.
- Type can come from a column (income/expense/saving) or a chosen default;
  negative amounts default to expenses.
- Missing categories are auto-detected from the description.

### Cross-device sync (optional, via Google sign-in)
Sign in with Google and your ledger syncs to your account in real time, so you
see the same data on your phone, laptop and anywhere else. It's **local-first**:
the app keeps working offline against `localStorage` and syncs when online.

Sync is **off until you add a Firebase config** — until then there's no sign-in
button and nothing changes. To turn it on (one-time, ~5 minutes):

**1. Create a Firebase project**
- Go to <https://console.firebase.google.com> → *Add project* (free "Spark"
  plan is enough). Skip Google Analytics if you like.

**2. Enable Google sign-in**
- Build → *Authentication* → *Get started* → *Sign-in method* → enable
  **Google** → Save.

**3. Create the database and lock it down**
- Build → *Firestore Database* → *Create database* → Production mode.
- Open the *Rules* tab, paste the contents of [`firestore.rules`](firestore.rules),
  and *Publish*. (Each user can read/write only their own document.)

**4. Get your web config**
- Project settings (gear icon) → *Your apps* → add a **Web** app (`</>`).
- Copy the `firebaseConfig` values into [`config.js`](config.js), replacing the
  `YOUR_…` placeholders. These keys are safe to commit — Firebase web API keys
  are public by design; the security rules above are what protect your data.

**5. Host it (so sign-in works)**
- Google sign-in needs a real `https://` origin — it won't run from a `file://`
  path. The easiest host for this repo is **GitHub Pages**: repository
  *Settings → Pages → Build and deployment → Deploy from a branch*, pick your
  branch and `/ (root)`, Save. Your app appears at
  `https://<user>.github.io/<repo>/`. (Netlify, Vercel or Cloudflare Pages work
  too.)
- Back in Firebase → *Authentication → Settings → Authorized domains*, add your
  Pages domain (e.g. `your-user.github.io`).

That's it — open the hosted URL, click **Sign in**, and use the same Google
account on every device. First sign-in uploads whatever is already on that
device; afterwards all devices share one synced ledger.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell |
| `styles.css` | Styles (design tokens from the mockup) |
| `app.js` | All application logic |
| `config.js` | Optional Firebase config for cross-device sync |
| `firestore.rules` | Firestore security rules (per-user access) |
| `netlify/functions/scan-receipt.js` | Serverless receipt reader (hides the Gemini key) |
| `netlify.toml` | Netlify config (declares the functions directory) |
| `vendor/xlsx.full.min.js` | SheetJS, for spreadsheet parsing |

## Data & privacy
By default everything stays in your browser's `localStorage` under the key
`pft-ledger-v3`, and the only outbound request is an anonymous, keyless call to
a public exchange-rate service. If you enable sync (above), your ledger is also
stored in your own Firestore document, readable and writable only by your
signed-in account.
