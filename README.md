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

### Multi-currency with live Wise rates
Toggle the display currency (₦ NGN / $ USD / € EUR) in the header. Each entry
keeps its own original currency; totals are converted on the fly.

Open **Rates** to manage conversion rates:

- **Live rates from Wise** — paste a Wise API token and press *Fetch live
  rates*. The app calls the Wise rate endpoint
  (`GET https://api.wise.com/v1/rates?source=USD&target=NGN`, with
  `Authorization: Bearer <token>`) for USD→NGN and EUR→NGN. If a token is
  present, rates auto-refresh on load when they're more than 12 hours old.
- **Manual override** — set the Naira value of $1 and €1 by hand. Used as a
  fallback whenever a live fetch isn't available.

> Get a token from your Wise account (Settings → API tokens). Because Ledger is
> a purely client-side app, a browser may block the cross-origin Wise request
> (CORS); if that happens the app tells you and manual rates keep working.

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

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell |
| `styles.css` | Styles (design tokens from the mockup) |
| `app.js` | All application logic |
| `vendor/xlsx.full.min.js` | SheetJS, for spreadsheet parsing |

## Data & privacy
Everything stays in your browser's `localStorage` under the key
`pft-ledger-v3`. Nothing is sent anywhere except the optional, token-authorized
call to Wise for exchange rates.
