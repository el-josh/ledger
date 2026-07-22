/* ===========================================================================
   Ledger — personal finance tracker
   Ported from the Ledger.dc.html design mockup and extended with:
     • Live currency conversion via the Wise exchange-rate API
     • Expense categories + recurring-item memory (no re-entering every month)
     • Spreadsheet (.xls/.xlsx/.csv) import via SheetJS
   Pure vanilla JS, persisted to localStorage. No build step.
=========================================================================== */
(function () {
  'use strict';

  // ---- constants ----------------------------------------------------------
  // Currencies the picker offers (the supported, reliably-converting set).
  var PINNED = ['NGN', 'USD', 'GBP', 'EUR', 'CAD'];
  var CURRENCY_CODES = ['NGN', 'USD', 'GBP', 'EUR', 'CAD'];
  var _curNames = (function () { try { return new Intl.DisplayNames(['en'], { type: 'currency' }); } catch (e) { return null; } })();
  var _nameCache = {}, _symCache = {};
  function curName(c) {
    if (_nameCache[c] != null) return _nameCache[c];
    var v = c; try { v = (_curNames && _curNames.of(c)) || c; } catch (e) {}
    return (_nameCache[c] = v);
  }
  function curSymbol(c) {
    if (_symCache[c] != null) return _symCache[c];
    var v = c;
    try {
      var parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === 'currency') { v = parts[i].value; break; }
    } catch (e) {}
    return (_symCache[c] = v);
  }
  function curLabel(c) { return curSymbol(c) + ' ' + c; }           // e.g. "₦ NGN"
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var SECTIONS = { income: 'income', expenses: 'expense', savings: 'saving' };
  var KEY = 'pft-ledger-v3';

  // Category options per section.
  var CATEGORIES_BY_SECTION = {
    income: ['Salary', 'Freelance', 'Sales', 'Gift'],
    expenses: ['Groceries', 'Housing', 'Utilities', 'Transport', 'Health', 'Family', 'Education', 'Entertainment', 'Shopping', 'Miscellaneous', 'Other'],
    savings: ['Savings', 'Investment']
  };
  function categoriesFor(section, current) {
    var list = (CATEGORIES_BY_SECTION[section] || CATEGORIES_BY_SECTION.expenses).slice();
    if (current && list.indexOf(current) < 0) list.unshift(current); // keep an existing custom value
    return list;
  }
  // Keyword hints, evaluated in order — first match wins.
  var CAT_HINTS = [
    ['Salary',        ['salary','wage','payroll','stipend','balance','caldera','perchfit','dividend','interest','refund']],
    ['Housing',       ['rent','mortgage','facility','wall','fixing','accommodation','lease','service charge']],
    ['Education',     ['school','fees','tuition','course','book','class','lesson']],
    ['Health',        ['hospital','health','medic','drug','pharmacy','clinic','doctor','dental']],
    ['Transport',     ['car ','uber','bolt','taxi','flight','fare','parking','toll','alarm','vehicle']],
    ['Utilities',     ['light','bill','gen ','generator','fuel','diesel','internet','data','electric','water','airtime','subscription']],
    ['Groceries',     ['grocer','food','market','supermarket','provision']],
    ['Family',        ['dad','mum','mom','gift','security','family','allowance','child']],
    ['Shopping',      ['diffuser','laundry','cloth','shoe','furniture','amazon','store']],
    ['Entertainment', ['netflix','spotify','movie','game','party','dining','restaurant','bar']],
    ['Savings',       ['invest','saving','stock','crypto','mutual','bond','pension']]
  ];

  // Fallback rates (Naira per unit) so the pinned currencies always convert,
  // even before a live fetch. RATES_V marks a map as multi-currency (v2); older
  // saved maps lack it and trigger a one-time refresh.
  var DEFAULT_RATES = { NGN: 1, USD: 1600, GBP: 2000, EUR: 1750, CAD: 1150 };
  var RATES_V = 2;
  function mergeRates(saved) { return Object.assign({}, DEFAULT_RATES, saved || {}); }

  // ---- state --------------------------------------------------------------
  var state = load() || seed();

  // Fresh, empty ledger. Nothing shows until the user adds entries or imports.
  function seed() {
    return {
      data: {},
      rates: mergeRates(),
      ratesMeta: { updated: null, source: 'default' },
      wiseToken: '',
      displayCurrency: 'NGN',
      year: new Date().getFullYear(),
      hidden: false,
      recurring: [],
      // transient view state
      view: 'dashboard', activeMonth: null, modal: null,
      settingsOpen: false, ratesMsg: null, recurringOpen: false,
      importData: null, toast: null, accountOpen: false, exportOpen: false
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return {
        data: o.data || {},
        rates: mergeRates(o.rates),
        ratesMeta: o.ratesMeta || { updated: null, source: 'default' },
        wiseToken: o.wiseToken || '',
        displayCurrency: o.displayCurrency || 'NGN',
        year: o.year || new Date().getFullYear(),
        hidden: !!o.hidden,
        recurring: o.recurring || [],
        view: 'dashboard', activeMonth: null, modal: null,
        settingsOpen: false, ratesMsg: null, recurringOpen: false,
        importData: null, toast: null, accountOpen: false, exportOpen: false
      };
    } catch (e) { return null; }
  }

  // The persisted slice of state — shared by localStorage and cloud sync.
  function persistedPayload() {
    return {
      data: state.data, rates: state.rates, ratesMeta: state.ratesMeta,
      displayCurrency: state.displayCurrency, year: state.year,
      hidden: state.hidden, recurring: state.recurring
    };
  }
  function assignPersisted(o) {
    if (!o) return;
    state.data = o.data || {};
    state.rates = mergeRates(o.rates);
    state.ratesMeta = o.ratesMeta || { updated: null, source: 'default' };
    state.displayCurrency = o.displayCurrency || 'NGN';
    state.year = o.year || new Date().getFullYear();
    state.hidden = !!o.hidden;
    state.recurring = o.recurring || [];
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(persistedPayload())); } catch (e) {}
    if (cloud.signedIn && !cloud.applyingRemote && !cloud.hydrating) scheduleCloudSave(false);
  }

  function genId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---- money helpers ------------------------------------------------------
  function conv(a, from, to) { var r = state.rates; return a * (r[from] || 1) / (r[to] || 1); }
  var _fmtCache = {};
  function fmt(a, cur) {
    var f = _fmtCache[cur];
    if (f === undefined) {
      try { f = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
      catch (e) { f = null; }
      _fmtCache[cur] = f;
    }
    if (f) return f.format(a);
    return cur + ' ' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(a);
  }
  function fmtSigned(a, cur) { var s = a < -0.005 ? '−' : ''; return s + fmt(Math.abs(a), cur); }
  // Group an amount string's integer part with thousands commas as it's typed.
  function groupThousands(raw) {
    var s = String(raw == null ? '' : raw).replace(/[^0-9.]/g, '');
    if (s === '') return '';
    var firstDot = s.indexOf('.');
    if (firstDot !== -1) s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
    var parts = s.split('.');
    var intPart = parts[0].replace(/^0+(?=\d)/, '');
    if (intPart === '') intPart = '0';
    var grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.length > 1 ? grouped + '.' + parts[1].slice(0, 2) : grouped;
  }
  function unformatAmount(raw) { return parseFloat(String(raw == null ? '' : raw).replace(/,/g, '')); }
  // Reformat the amount field in place, keeping the caret near where it was.
  function onAmountInput(el) {
    var before = el.value.slice(0, el.selectionStart);
    var digitsBefore = (before.match(/[0-9]/g) || []).length;
    var formatted = groupThousands(el.value);
    el.value = formatted;
    var pos = 0, seen = 0;
    while (pos < formatted.length && seen < digitsBefore) { if (/[0-9]/.test(formatted[pos])) seen++; pos++; }
    if (formatted[pos] === '.') pos++;
    try { el.setSelectionRange(pos, pos); } catch (e) {}
  }
  function sumConv(list, to) { return (list || []).reduce(function (s, e) { return s + conv(e.amount, e.currency, to); }, 0); }
  function addNative(o, list) { (list || []).forEach(function (e) { o[e.currency] = (o[e.currency] || 0) + e.amount; }); }
  function natKeys(o) { return Object.keys(o).filter(function (c) { return o[c] > 0; }).sort(); }
  function showNat(o, disp) { var ks = natKeys(o); return ks.length > 1 || (ks.length === 1 && ks[0] !== disp); }
  function natStr(o) { return natKeys(o).map(function (c) { return fmt(o[c], c); }).join('   +   '); }
  // "The rest goes to savings": whatever income leaves after expenses is saved.
  function savedOf(md, to) { return sumConv(md.income, to) - sumConv(md.expenses, to); }
  function pct(n, d) { return Math.max(0, Math.min(100, Math.round((n / (d || 1)) * 100))) + '%'; }

  function autoCategory(name, section) {
    if (section === 'income') return 'Salary';
    if (section === 'savings') return 'Savings';
    var allowed = CATEGORIES_BY_SECTION.expenses;
    var n = ' ' + String(name || '').toLowerCase() + ' ';
    for (var i = 0; i < CAT_HINTS.length; i++) {
      var cat = CAT_HINTS[i][0], words = CAT_HINTS[i][1];
      if (allowed.indexOf(cat) < 0) continue; // skip categories not valid for expenses
      for (var j = 0; j < words.length; j++) { if (n.indexOf(words[j]) !== -1) return cat; }
    }
    return 'Other';
  }

  function ensure(data, y, mo) {
    if (!data[y]) data[y] = {};
    if (!data[y][mo]) data[y][mo] = { income: [], expenses: [], savings: [] };
    var b = data[y][mo];
    if (!b.income) b.income = []; if (!b.expenses) b.expenses = []; if (!b.savings) b.savings = [];
    return b;
  }

  // ---- escaping -----------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function attr(s) { return esc(s); }

  // ---- recurring ----------------------------------------------------------
  // How many recurring templates are not yet present in the given month.
  function missingRecurring(y, mo) {
    var yd = state.data[y] || {}; var md = yd[mo] || {};
    return state.recurring.filter(function (t) {
      var list = md[t.section] || [];
      return !list.some(function (e) { return e.name.toLowerCase() === t.name.toLowerCase(); });
    });
  }
  function applyRecurring(y, mo) {
    var data = clone(state.data);
    var b = ensure(data, y, mo);
    var missing = missingRecurring(y, mo);
    missing.forEach(function (t) {
      b[t.section].push({ id: genId(), name: t.name, amount: t.amount, currency: t.currency, category: t.category, recurring: true });
    });
    state.data = data;
    persist();
    toast(missing.length + ' recurring item' + (missing.length === 1 ? '' : 's') + ' added');
    render();
  }
  function upsertRecurring(section, name, amount, currency, category) {
    var k = name.toLowerCase();
    var found = state.recurring.find(function (t) { return t.section === section && t.name.toLowerCase() === k; });
    if (found) { found.amount = amount; found.currency = currency; found.category = category; }
    else { state.recurring.push({ id: genId(), section: section, name: name, amount: amount, currency: currency, category: category }); }
  }
  function removeRecurring(id) {
    state.recurring = state.recurring.filter(function (t) { return t.id !== id; });
    persist(); render();
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---- live exchange rates (keyless) -------------------------------------
  // Rates are stored as "Naira per 1 unit" for every currency the source
  // returns. Two free, no-key, CORS-enabled sources are tried in turn:
  //   1. ExchangeRate-API open endpoint  https://open.er-api.com/v6/latest/NGN
  //   2. @fawazahmed0 currency-api (jsDelivr CDN) as a fallback
  // Both return how much of each currency 1 NGN buys, so we invert each one.
  function invertMap(units) {
    var map = { NGN: 1 };
    Object.keys(units || {}).forEach(function (c) {
      var code = c.toUpperCase();
      var v = units[c];
      if (v > 0) map[code] = 1 / v;
    });
    map.NGN = 1;
    return map;
  }
  function fetchErApi() {
    return fetch('https://open.er-api.com/v6/latest/NGN').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    }).then(function (j) {
      if (j.result && j.result !== 'success') throw new Error('provider error');
      var rt = j.rates || {};
      if (!(rt.USD > 0)) throw new Error('missing rates');
      return { rates: invertMap(rt), provider: 'ExchangeRate-API' };
    });
  }
  function fetchFawaz() {
    var urls = [
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/ngn.min.json',
      'https://latest.currency-api.pages.dev/v1/currencies/ngn.min.json'
    ];
    return fetch(urls[0]).catch(function () { return fetch(urls[1]); }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    }).then(function (j) {
      var n = j.ngn || {};
      if (!(n.usd > 0)) throw new Error('missing rates');
      return { rates: invertMap(n), provider: 'Currency-API' };
    });
  }

  function fetchRates(opts) {
    opts = opts || {};
    if (!opts.silent) { state.ratesMsg = { type: 'info', text: 'Fetching latest rates…' }; if (state.settingsOpen) render(); }
    fetchErApi().catch(function () { return fetchFawaz(); }).then(function (res) {
      state.rates = mergeRates(res.rates);
      state.ratesMeta = { updated: new Date().toISOString(), source: 'live', provider: res.provider, v: RATES_V };
      state.ratesMsg = { type: 'ok', text: 'Updated from ' + res.provider + '.' };
      persist();
      render();
    }).catch(function (err) {
      if (!opts.silent) {
        state.ratesMsg = { type: 'err', text: 'Could not fetch live rates (' + esc(err.message || 'offline') + '). Showing the last saved rates.' };
        if (state.settingsOpen) render();
      }
    });
  }

  function autoFetchRates() {
    var m = state.ratesMeta || {};
    var last = m.updated ? Date.parse(m.updated) : 0;
    // Fresh only if it's a live, multi-currency (v2) map from the last 12h.
    // Older maps (no v, or v<2 from the USD/EUR-only era) always refetch.
    var fresh = m.source === 'live' && m.v === RATES_V && (Date.now() - last) < 12 * 3600 * 1000;
    if (fresh) return;
    fetchRates({ silent: true });
  }

  // =========================================================================
  //  CLOUD SYNC  (Firebase Auth + Firestore, local-first, optional)
  // =========================================================================
  var cloud = {
    configured: false, ready: false, signedIn: false, user: null,
    status: '', error: '', authMod: null, fs: null, auth: null, db: null,
    docRef: null, unsub: null, saveTimer: null, applyingRemote: false,
    // True between sign-in and the first cloud snapshot: never push local up
    // during this window, or an empty/stale local state could clobber the cloud.
    hydrating: false
  };

  function initCloud() {
    var cfg = window.LEDGER_CONFIG && window.LEDGER_CONFIG.firebase;
    if (!cfg || !cfg.apiKey || /YOUR_|paste|xxxx/i.test(cfg.apiKey) || !cfg.projectId || /YOUR_/i.test(cfg.projectId)) {
      cloud.configured = false; return; // no config yet -> stay fully local
    }
    cloud.configured = true;
    render(); // reveal the Sign in button right away
    var base = 'https://www.gstatic.com/firebasejs/10.12.5/';
    Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-auth.js'),
      import(base + 'firebase-firestore.js')
    ]).then(function (mods) {
      var appMod = mods[0]; cloud.authMod = mods[1]; cloud.fs = mods[2];
      var appI = appMod.initializeApp(cfg);
      cloud.auth = cloud.authMod.getAuth(appI);
      cloud.db = cloud.fs.getFirestore(appI);
      cloud.ready = true;
      cloud.authMod.onAuthStateChanged(cloud.auth, onAuthChanged);
      if (cloud.authMod.getRedirectResult) cloud.authMod.getRedirectResult(cloud.auth).catch(function () {});
    }).catch(function (e) {
      cloud.error = 'Sign-in unavailable: ' + (e && e.message || e);
      render();
    });
  }

  function cloudSignIn() {
    if (!cloud.configured) return;
    if (!cloud.ready) { cloud.status = 'Loading sign-in…'; render(); return; }
    cloud.error = '';
    var provider = new cloud.authMod.GoogleAuthProvider();
    cloud.authMod.signInWithPopup(cloud.auth, provider).catch(function (e) {
      var code = (e && e.code) || '';
      if (code.indexOf('popup') >= 0) {
        cloud.authMod.signInWithRedirect(cloud.auth, provider).catch(function (e2) {
          cloud.error = 'Sign-in failed: ' + (e2.message || e2.code); render();
        });
      } else { cloud.error = 'Sign-in failed: ' + (e.message || code); render(); }
    });
  }

  function cloudSignOut() {
    if (cloud.authMod && cloud.auth) cloud.authMod.signOut(cloud.auth).catch(function () {});
    state.accountOpen = false;
  }

  function onAuthChanged(user) {
    var wasSignedIn = cloud.signedIn;
    if (cloud.unsub) { cloud.unsub(); cloud.unsub = null; }
    if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
    if (user) {
      cloud.signedIn = true;
      cloud.hydrating = true; // wait for the first snapshot before pushing anything
      cloud.user = { name: user.displayName, email: user.email, photo: user.photoURL, uid: user.uid };
      cloud.status = 'Connecting…'; cloud.error = '';
      subscribeDoc(user.uid);
    } else {
      cloud.signedIn = false; cloud.hydrating = false; cloud.user = null; cloud.docRef = null; cloud.status = '';
      // On an actual sign-out (not the initial "no session" on load), clear the
      // signed-out account's data from this device. It stays safe in the cloud
      // and returns on next sign-in. This runs AFTER signedIn=false so the empty
      // state is never pushed back up to Firestore.
      if (wasSignedIn) {
        assignPersisted({});
        state.view = 'dashboard'; state.activeMonth = null;
        state.modal = null; state.importData = null;
        state.settingsOpen = false; state.recurringOpen = false;
      }
    }
    render();
  }

  function subscribeDoc(uid) {
    var fs = cloud.fs;
    cloud.docRef = fs.doc(cloud.db, 'ledgers', uid);
    cloud.unsub = fs.onSnapshot(cloud.docRef, function (snap) {
      if (snap.metadata.hasPendingWrites) return; // ignore our own local echo
      var d = snap.exists() ? snap.data() : null;
      cloud.status = 'Synced';
      if (d && d.payload) {
        // Cloud has data -> adopt it (this is the sign-in restore path).
        cloud.hydrating = false;
        applyRemote(d.payload);
      } else {
        // Account has no data yet. Only seed it from this device if the device
        // actually has something — never overwrite with an empty state.
        cloud.hydrating = false;
        if (hasLocalData()) scheduleCloudSave(true);
        if (state.accountOpen) render();
      }
      // The restored rate map may predate multi-currency (only USD/EUR). Upgrade
      // it once now that we're hydrated; the fetch persists the full map back up.
      autoFetchRates();
    }, function (err) {
      cloud.hydrating = false;
      cloud.error = 'Sync error: ' + err.message;
      if (state.accountOpen) render();
    });
  }

  function hasLocalData() {
    var data = state.data || {};
    for (var y in data) {
      var months = data[y] || {};
      for (var m in months) {
        var b = months[m] || {};
        if ((b.income && b.income.length) || (b.expenses && b.expenses.length) || (b.savings && b.savings.length)) return true;
      }
    }
    return !!(state.recurring && state.recurring.length);
  }

  function applyRemote(payload) {
    cloud.applyingRemote = true;
    assignPersisted(payload);
    render();                 // render()->persist() sees applyingRemote and skips cloud push
    cloud.applyingRemote = false;
  }

  function scheduleCloudSave(immediate) {
    if (!cloud.signedIn || !cloud.docRef) return;
    if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
    var doSave = function () {
      cloud.saveTimer = null;
      cloud.status = 'Saving…'; if (state.accountOpen) render();
      cloud.fs.setDoc(cloud.docRef, { v: 3, updatedAt: cloud.fs.serverTimestamp(), payload: persistedPayload() })
        .then(function () { cloud.status = 'Synced'; if (state.accountOpen) render(); })
        .catch(function (e) { cloud.error = 'Save failed: ' + e.message; if (state.accountOpen) render(); });
    };
    if (immediate) doSave(); else cloud.saveTimer = setTimeout(doSave, 900);
  }

  function firstNameOf(u) { var n = (u.name || '').trim(); if (n) return n.split(/\s+/)[0]; return ((u.email || '').split('@')[0]) || 'Account'; }
  function initialOf(u) { return (((u.name || u.email || '?').trim())[0] || '?').toUpperCase(); }

  // =========================================================================
  //  RENDER
  // =========================================================================
  var app = document.getElementById('app');

  function render() {
    var html = '<div class="wrap">' + renderHeader();
    html += state.view === 'month' ? renderMonth() : renderDashboard();
    html += '</div>';
    // overlays
    if (state.modal) html += renderModal();
    if (state.settingsOpen) html += renderSettingsHtml();
    if (state.recurringOpen) html += renderRecurringHtml();
    if (state.importData) html += renderImportHtml();
    if (state.accountOpen) html += renderAccountHtml();
    if (state.exportOpen) html += renderExportHtml();
    if (state.toast) html += '<div class="toast">' + esc(state.toast) + '</div>';
    app.innerHTML = html;
    persist();
  }

  // Currency <option>s for the supported set.
  function currencyOptions(selected, withNames) {
    return CURRENCY_CODES.map(function (c) {
      var label = withNames ? (curLabel(c) + ' — ' + curName(c)) : curLabel(c);
      return '<option value="' + c + '"' + (c === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
  }

  function renderHeader() {
    var disp = state.displayCurrency;
    return '' +
      '<header class="header">' +
        '<div class="brand"><span class="logo">L</span><span class="name">Ledger</span></div>' +
        '<div class="account">' + authControl() + '</div>' +
        '<div class="grp grp-currency">' +
          '<div class="cur-wrap"><select id="disp-cur" class="cur-select" title="Display currency">' + currencyOptions(disp, false) + '</select></div>' +
          '<div class="yearnav">' +
            '<button data-act="year" data-d="-1">‹</button>' +
            '<span class="label">' + state.year + '</span>' +
            '<button data-act="year" data-d="1">›</button>' +
          '</div>' +
        '</div>' +
        '<div class="grp grp-actions">' +
          '<button class="pill" data-act="openExport" title="Export a statement">' + icoDownload() + 'Export Statement</button>' +
          '<button class="pill" data-act="openRecurring" title="Recurring items">' + icoRepeat() + 'Recurring</button>' +
          '<button class="pill" data-act="openImport" title="Import a spreadsheet">' + icoUpload() + 'Import .xlsx</button>' +
          '<button class="pill" data-act="openSettings">' + icoRate() + 'Rates</button>' +
        '</div>' +
      '</header>';
  }

  function authControl() {
    if (!cloud.configured) return '';
    if (cloud.signedIn && cloud.user) {
      var u = cloud.user;
      var av = u.photo
        ? '<img class="avatar" src="' + attr(u.photo) + '" alt="" referrerpolicy="no-referrer">'
        : '<span class="avatar avatar-fallback">' + esc(initialOf(u)) + '</span>';
      return '<button class="pill account-btn" data-act="openAccount" title="Account & sync">' + av + '<span class="account-name">' + esc(firstNameOf(u)) + '</span></button>';
    }
    return '<button class="pill account-btn" data-act="signIn" title="Sign in to sync across devices">' + icoGoogle() + '<span class="account-name">Sign in</span></button>';
  }

  function renderAccountHtml() {
    var u = cloud.user || {};
    var av = u.photo
      ? '<img class="avatar lg" src="' + attr(u.photo) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="avatar lg avatar-fallback">' + esc(initialOf(u)) + '</span>';
    var statusText = cloud.error || cloud.status || 'Synced';
    var statusCls = cloud.error ? 'err' : 'ok';
    return '<div class="overlay" data-act="closeAccount"><div class="modal" data-stop="1">' +
      '<div style="display:flex;align-items:center;gap:14px;">' + av +
        '<div style="min-width:0;"><div style="font-weight:800;font-size:17px;letter-spacing:-0.01em;">' + esc(u.name || 'Signed in') + '</div>' +
        '<div style="color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;">' + esc(u.email || '') + '</div></div>' +
      '</div>' +
      '<div class="desc" style="margin-top:16px;">Your ledger syncs to your Google account in real time. Open Ledger and sign in with the same account on any device to pick up right where you left off.</div>' +
      '<div class="' + statusCls + '">' + esc(statusText) + '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn danger-text" data-act="signOut">Sign out</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn primary" data-act="closeAccount">Done</button>' +
      '</div></div></div>';
  }

  // ---- dashboard ----------------------------------------------------------
  function renderDashboard() {
    var disp = state.displayCurrency, year = state.year;
    var h = hide;
    var yearData = state.data[year] || {};

    var months = MONTHS.map(function (name, i) {
      var mo = i + 1;
      var md = yearData[mo] || { income: [], expenses: [], savings: [] };
      var inc = sumConv(md.income, disp), exp = sumConv(md.expenses, disp);
      var has = ((md.income || []).length + (md.expenses || []).length + (md.savings || []).length) > 0;
      return { mo: mo, name: name, has: has, inc: inc, exp: exp, sav: inc - exp, net: inc - exp };
    });

    var inc = 0, exp = 0;
    var incN = {}, expN = {};
    Object.keys(yearData).forEach(function (k) {
      var md = yearData[k];
      inc += sumConv(md.income, disp); exp += sumConv(md.expenses, disp);
      addNative(incN, md.income); addNative(expN, md.expenses);
    });
    var sav = inc - exp; // total saved = the leftover
    var maxT = Math.max(inc, exp, Math.abs(sav), 1);

    var withData = months.filter(function (m) { return m.has; });
    var maxAbs = Math.max.apply(null, [1].concat(withData.map(function (m) { return Math.abs(m.net); })));
    var lastNum = withData.length ? withData[withData.length - 1].mo : 0;
    var bars = withData.map(function (m) {
      return { height: Math.max(10, Math.round(Math.abs(m.net) / maxAbs * 100)) + '%',
               color: m.net < 0 ? '#b4b8af' : (m.mo === lastNum ? '#0e0f0c' : '#dfe3dc'),
               label: m.name.slice(0, 3) };
    });

    // hero
    var html = '<section class="section"><div class="hero-top"><div style="min-width:0">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<span class="eyebrow">Net cash flow · ' + year + '</span>' +
        '<button class="iconbtn" data-act="hide" title="Hide balance">' + eyeIcon() + '</button>' +
      '</div>' +
      '<div class="hero-value">' + h(fmtSigned(inc - exp, disp)) + '</div>' +
      '<div class="hero-sub">Income minus expenses · displayed in ' + esc(curLabel(disp)) + '</div>' +
      '</div>';
    if (bars.length) {
      html += '<div class="bars">' + bars.map(function (b) {
        return '<div class="bar-col"><div class="bar-track"><div class="bar" style="height:' + b.height + ';background:' + b.color + '"></div></div><span class="bar-label">' + b.label + '</span></div>';
      }).join('') + '</div>';
    }
    html += '</div></section>';

    // year at a glance
    function glance(ico, label, val, w, natShow, nat) {
      return '<div class="glance-row"><span class="glance-ico">' + ico + '</span><div class="glance-body">' +
        '<div class="glance-head"><span class="k">' + label + '</span><span class="v">' + h(val) + '</span></div>' +
        '<div class="meter"><span style="width:' + w + '"></span></div>' +
        (natShow ? '<div class="native">' + h(nat) + '</div>' : '') + '</div></div>';
    }
    html += '<section class="section tight">' +
      '<div class="eyebrow" style="margin-bottom:6px">Year at a glance</div>' +
      glance(icoDown(), 'Income', fmt(inc, disp), pct(inc, maxT), showNat(incN, disp), natStr(incN)) +
      glance(icoUp(), 'Expenses', fmt(exp, disp), pct(exp, maxT), showNat(expN, disp), natStr(expN)) +
      glance(icoTrend(), 'Savings / Investments', fmtSigned(sav, disp), pct(sav, maxT), false, '') +
      '</section>';

    // month table
    html += '<div class="section-title-row"><h2>Month by month</h2><span class="hint">Tap a month to edit</span></div>';
    html += '<section class="table-wrap"><div class="table-scroll"><table class="months"><thead><tr>' +
      '<th class="l">Month</th><th>Income</th><th>Expenses</th><th>Saved</th></tr></thead><tbody>';
    months.forEach(function (m) {
      html += '<tr class="' + (m.has ? '' : 'empty') + '" data-act="openMonth" data-mo="' + m.mo + '">' +
        '<td class="name">' + m.name + '</td>' +
        '<td>' + (m.has ? h(fmt(m.inc, disp)) : '—') + '</td>' +
        '<td>' + (m.has ? h(fmt(m.exp, disp)) : '—') + '</td>' +
        '<td class="net">' + (m.has ? h(fmtSigned(m.sav, disp)) : '—') + '</td></tr>';
    });
    html += '</tbody><tfoot><tr>' +
      '<td class="name">' + year + ' total</td>' +
      '<td>' + h(fmt(inc, disp)) + '</td><td>' + h(fmt(exp, disp)) + '</td>' +
      '<td class="net">' + h(fmtSigned(sav, disp)) + '</td></tr></tfoot></table></div></section>';

    return html;
  }

  // ---- month view ---------------------------------------------------------
  function renderMonth() {
    var disp = state.displayCurrency, year = state.year, mo = state.activeMonth;
    var h = hide;
    var yd = state.data[year] || {};
    var md = yd[mo] || { income: [], expenses: [], savings: [] };

    var incT = sumConv(md.income, disp), expT = sumConv(md.expenses, disp), savT = incT - expT;

    var html = '<section class="section">' +
      '<div class="backrow"><button class="roundbtn" data-act="back">←</button><span class="eyebrow">All months</span></div>' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<span class="eyebrow">Net · ' + MONTHS[mo - 1] + ' ' + year + '</span>' +
        '<button class="iconbtn" data-act="hide" title="Hide balance">' + eyeIcon() + '</button>' +
      '</div>' +
      '<div class="month-net">' + h(fmtSigned(incT - expT, disp)) + '</div>' +
      '<div class="legend">' +
        '<div class="item"><span class="dot"></span><span class="lbl">Income</span><span class="amt">' + h(fmt(incT, disp)) + '</span></div>' +
        '<div class="item"><span class="dot"></span><span class="lbl">Expenses</span><span class="amt">' + h(fmt(expT, disp)) + '</span></div>' +
        '<div class="item"><span class="dot"></span><span class="lbl">Saved</span><span class="amt">' + h(fmtSigned(savT, disp)) + '</span></div>' +
      '</div></section>';

    var missing = missingRecurring(year, mo);
    if (missing.length) {
      html += '<div class="recur-banner"><span class="txt">' + missing.length + ' recurring item' + (missing.length === 1 ? '' : 's') +
        ' not added to ' + MONTHS[mo - 1] + ' yet.</span>' +
        '<button data-act="applyRecurring">Add recurring items</button></div>';
    }

    html += '<section class="buckets">' +
      bucket('income', 'Income', md.income, incT, disp) +
      bucket('expenses', 'Expenses', md.expenses, expT, disp) +
      savingsBucket(md, savT, disp) +
      '</section>';
    return html;
  }

  // Savings bucket: the total is the month's leftover (income − expenses).
  // Any explicit allocations are listed; the remainder is auto-saved.
  function savingsBucket(md, savT, disp) {
    var h = hide;
    var list = md.savings || [];
    var committed = sumConv(list, disp);
    var unalloc = savT - committed;
    var anyActivity = (md.income || []).length + (md.expenses || []).length + list.length > 0;

    var html = '<div class="bucket"><div class="bucket-head">' +
      '<span class="k"><span class="dot"></span>Savings / Invest</span>' +
      '<span class="v">' + h(fmtSigned(savT, disp)) + '</span></div>';

    list.forEach(function (e) {
      var isConv = e.currency !== disp;
      html += '<div class="entry">' +
        '<button class="main" data-act="edit" data-section="savings" data-id="' + attr(e.id) + '">' +
          '<div class="nm">' + esc(e.name) +
            (e.category ? '<span class="tag cat">' + esc(e.category) + '</span>' : '') +
            (e.recurring ? '<span class="tag recur">' + icoRepeatSm() + 'Monthly</span>' : '') +
          '</div>' +
          (isConv ? '<div class="conv">≈ ' + h(fmt(conv(e.amount, e.currency, disp), disp)) + '</div>' : '') +
        '</button>' +
        '<div class="right"><span class="amt">' + h(fmt(e.amount, e.currency)) + '</span>' +
          '<span class="tag">' + e.currency + '</span>' +
          '<button class="del" data-act="delDirect" data-section="savings" data-id="' + attr(e.id) + '">×</button>' +
        '</div></div>';
    });

    if (anyActivity) {
      html += '<div class="entry auto">' +
        '<div class="main" style="cursor:default">' +
          '<div class="nm">' + (list.length ? 'Unallocated' : 'Left over') +
            '<span class="tag auto">auto-saved</span></div>' +
          '<div class="conv">Income − expenses' + (list.length ? ' − allocations' : '') + '</div>' +
        '</div>' +
        '<div class="right"><span class="amt">' + h(fmtSigned(unalloc, disp)) + '</span>' +
          '<span class="tag">' + disp + '</span></div></div>';
    } else {
      html += '<div class="empty-note">Add income and expenses — whatever is left shows up here as savings.</div>';
    }

    html += '<button class="addbtn" data-act="add" data-section="savings">+ Allocate savings</button></div>';
    return html;
  }

  function bucket(section, label, list, total, disp) {
    var h = hide;
    var html = '<div class="bucket"><div class="bucket-head">' +
      '<span class="k"><span class="dot"></span>' + label + '</span>' +
      '<span class="v">' + h(fmt(total, disp)) + '</span></div>';
    (list || []).forEach(function (e) {
      var isConv = e.currency !== disp;
      html += '<div class="entry">' +
        '<button class="main" data-act="edit" data-section="' + section + '" data-id="' + attr(e.id) + '">' +
          '<div class="nm">' + esc(e.name) +
            (e.category ? '<span class="tag cat">' + esc(e.category) + '</span>' : '') +
            (e.recurring ? '<span class="tag recur">' + icoRepeatSm() + 'Monthly</span>' : '') +
          '</div>' +
          (isConv ? '<div class="conv">≈ ' + h(fmt(conv(e.amount, e.currency, disp), disp)) + '</div>' : '') +
        '</button>' +
        '<div class="right">' +
          '<span class="amt">' + h(fmt(e.amount, e.currency)) + '</span>' +
          '<span class="tag">' + e.currency + '</span>' +
          '<button class="del" data-act="delDirect" data-section="' + section + '" data-id="' + attr(e.id) + '">×</button>' +
        '</div></div>';
    });
    if (!(list || []).length) html += '<div class="empty-note">No ' + SECTIONS[section] + ' entries yet.</div>';
    html += '<button class="addbtn" data-act="add" data-section="' + section + '">+ Add ' + SECTIONS[section] + '</button></div>';
    return html;
  }

  // ---- entry modal --------------------------------------------------------
  function renderModal() {
    var m = state.modal;
    var title = (m.mode === 'edit' ? 'Edit ' : 'Add ') + SECTIONS[m.section];
    var catOpts = categoriesFor(m.section, m.category).map(function (c) { return '<option value="' + attr(c) + '"' + (m.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    return '<div class="overlay" data-act="closeModal"><div class="modal" data-stop="1">' +
      '<div class="title">' + esc(title) + '</div>' +
      '<label class="field"><span class="lbl">Name</span>' +
        '<input id="m-name" value="' + attr(m.name) + '" placeholder="e.g. NW Salary" autocomplete="off"></label>' +
      '<label class="field"><span class="lbl">Amount</span>' +
        '<input id="m-amount" type="text" inputmode="decimal" autocomplete="off" value="' + attr(groupThousands(m.amount)) + '" placeholder="0"></label>' +
      '<label class="field"><span class="lbl">Category</span><select id="m-category">' + catOpts + '</select></label>' +
      '<label class="field"><span class="lbl">Currency</span><select id="m-currency">' + currencyOptions(m.currency, true) + '</select></label>' +
      '<label class="checkrow"><input id="m-recur" type="checkbox"' + (m.recurring ? ' checked' : '') + '>' +
        '<span><span class="txt">Repeat every month</span><div class="sub">Remember this so you don’t re-enter it next month.</div></span></label>' +
      (m.error ? '<div class="err">Enter a name and an amount greater than zero.</div>' : '') +
      '<div class="modal-actions">' +
        (m.mode === 'edit' ? '<button class="btn danger-text" data-act="deleteEntry">Delete</button>' : '') +
        '<div class="spacer"></div>' +
        '<button class="btn ghost" data-act="closeModal">Cancel</button>' +
        '<button class="btn primary" data-act="saveModal">Save</button>' +
      '</div></div></div>';
  }

  // ---- settings (rates) modal --------------------------------------------
  function renderSettingsHtml() {
    var r = state.rates, meta = state.ratesMeta || {};
    var updated = meta.updated ? new Date(meta.updated).toLocaleString() : 'never';
    var srcLabel = meta.source === 'live' ? ('Live · ' + (meta.provider || 'auto')) : 'Default';
    var msg = state.ratesMsg;
    var rateRows = PINNED.filter(function (c) { return c !== 'NGN' && r[c] > 0; }).map(function (c) {
      return '<div class="rate-row"><span>' + esc(curLabel(c)) + '</span><strong>' + fmt(r[c], 'NGN') + '</strong></div>';
    }).join('');
    return '<div class="overlay" data-act="closeSettings"><div class="modal" data-stop="1">' +
      '<div class="title">Exchange rates</div>' +
      '<div class="desc">Live mid-market rates, fetched automatically — no API key or sign-up needed. Rates below are shown as Naira per 1 unit. Entries keep their original currency; this only affects converted totals.</div>' +

      '<div class="rate-status">' +
        '<div class="rate-row"><span>Source</span><strong>' + esc(srcLabel) + '</strong></div>' +
        '<div class="rate-row"><span>Last updated</span><strong>' + esc(updated) + '</strong></div>' +
        rateRows +
      '</div>' +
      (msg ? '<div class="' + (msg.type === 'ok' ? 'ok' : (msg.type === 'err' ? 'err' : 'rate-status')) + '">' + msg.text + '</div>' : '') +

      '<div class="modal-actions" style="margin-top:20px">' +
        '<button class="btn ghost" data-act="closeSettings">Close</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn primary" data-act="refreshRates">' + icoRate() + ' Refresh rates</button>' +
      '</div></div></div>';
  }

  // ---- recurring manager modal -------------------------------------------
  function renderRecurringHtml() {
    var html = '<div class="overlay" data-act="closeRecurring"><div class="modal" data-stop="1">' +
      '<div class="title">Recurring items</div>' +
      '<div class="desc">These are remembered and can be added to any month in one tap. Mark an entry “Repeat every month” to add it here.</div>';
    if (!state.recurring.length) {
      html += '<div class="empty-note" style="border:none">No recurring items yet.</div>';
    } else {
      var order = { income: 0, expenses: 1, savings: 2 };
      var sorted = state.recurring.slice().sort(function (a, b) { return (order[a.section] - order[b.section]) || a.name.localeCompare(b.name); });
      html += '<div style="margin-top:16px">';
      sorted.forEach(function (t) {
        html += '<div class="entry">' +
          '<div class="main" style="cursor:default">' +
            '<div class="nm">' + esc(t.name) +
              '<span class="tag cat">' + esc(t.category || SECTIONS[t.section]) + '</span>' +
              '<span class="tag">' + SECTIONS[t.section] + '</span>' +
            '</div></div>' +
          '<div class="right"><span class="amt">' + fmt(t.amount, t.currency) + '</span><span class="tag">' + t.currency + '</span>' +
            '<button class="del" data-act="delRecurring" data-id="' + attr(t.id) + '">×</button></div></div>';
      });
      html += '</div>';
    }
    html += '<div class="modal-actions"><div class="spacer"></div>' +
      '<button class="btn primary" data-act="closeRecurring">Done</button></div>' +
      '</div></div>';
    return html;
  }

  // =========================================================================
  //  SPREADSHEET IMPORT
  // =========================================================================
  var IMPORT_TARGETS = [
    { key: 'name', label: 'Name / description' },
    { key: 'amount', label: 'Amount' },
    { key: 'currency', label: 'Currency' },
    { key: 'date', label: 'Date / month' },
    { key: 'type', label: 'Type (income/expense/saving)' },
    { key: 'category', label: 'Category' }
  ];

  function openImport() { document.getElementById('fileInput').click(); }

  function handleFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true });

        // First try the sectioned "monthly ledger" layout (Income / Expenditure
        // / Savings blocks, one sheet per month). Fall back to a flat table.
        var ledger = parseLedgerWorkbook(wb, file.name);
        if (ledger.entries.length) {
          state.importData = {
            mode: 'ledger', fileName: file.name, year: ledger.year,
            entries: ledger.entries, counts: ledger.counts, perMonth: ledger.perMonth,
            sheetsUsed: ledger.sheetsUsed, skippedSheets: ledger.skippedSheets,
            error: null, msg: null
          };
          render();
          return;
        }

        var sheetName = wb.SheetNames[0];
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', blankrows: false });
        // find first non-empty row as header
        var hi = 0;
        while (hi < rows.length && rows[hi].every(function (c) { return c === '' || c == null; })) hi++;
        var headers = (rows[hi] || []).map(function (c, i) { return String(c || '').trim() || ('Column ' + (i + 1)); });
        var body = rows.slice(hi + 1).filter(function (r) { return r.some(function (c) { return c !== '' && c != null; }); });
        state.importData = {
          mode: 'table', sheetName: sheetName, headers: headers, rows: body,
          mapping: autoMap(headers),
          defaultType: 'expenses', defaultCurrency: state.displayCurrency,
          error: null, msg: null
        };
        render();
      } catch (e) {
        state.importData = { mode: 'table', error: 'Could not read that file: ' + e.message, headers: [], rows: [], mapping: {} };
        render();
      }
    };
    reader.onerror = function () { state.importData = { error: 'Failed to read the file.', headers: [], rows: [], mapping: {} }; render(); };
    reader.readAsArrayBuffer(file);
  }

  function autoMap(headers) {
    var map = {};
    var patterns = {
      name: /desc|name|item|narration|detail|memo|payee|particular/i,
      amount: /amount|amt|value|total|debit|credit|price|sum|cost|naira|ngn|usd/i,
      currency: /currency|ccy|cur\b/i,
      date: /date|month|period|when|day/i,
      type: /type|category type|direction|kind|in\/out/i,
      category: /categ|group|class|bucket|tag/i
    };
    IMPORT_TARGETS.forEach(function (t) {
      for (var i = 0; i < headers.length; i++) {
        if (patterns[t.key] && patterns[t.key].test(headers[i])) { map[t.key] = i; return; }
      }
      map[t.key] = -1;
    });
    // Avoid category & type colliding on the same column
    if (map.category === map.type && map.category !== -1) map.category = -1;
    return map;
  }

  // ---- sectioned "monthly ledger" workbook parser ------------------------
  // Handles workbooks laid out like the Google Sheets original: each tab is a
  // month, with an Income block, an Expenditure block and a Savings/Invest
  // block side by side, each a (name, amount) column pair, and "(NGN)"/"(USD)"
  // sub-headers switching the currency partway down a block.
  var SECKEYS = { income: 'income', expense: 'expenses', savings: 'savings' };

  function monthFromName(name) {
    var s = String(name || '').trim().toLowerCase();
    for (var i = 0; i < MONTHS.length; i++) { if (s.indexOf(MONTHS[i].slice(0, 3).toLowerCase()) === 0) return i + 1; }
    var n = parseInt(s, 10); if (n >= 1 && n <= 12) return n;
    return null;
  }
  function currencyMarker(v) {
    var s = String(v == null ? '' : v).trim();
    var m = s.match(/^\(?\s*(₦|\$|€|£|[A-Za-z]{3}|naira|dollars?|euros?|pounds?)\s*\)?$/);
    return m ? normCur(m[1]) : null;
  }
  function currencyInText(v) { var m = String(v == null ? '' : v).match(/\(\s*([A-Za-z]{3}|₦|\$|€|£)\s*\)/); return m ? normCur(m[1]) : null; }
  function symbolCurrency(v) {
    var s = String(v == null ? '' : v);
    if (s.indexOf('₦') >= 0) return 'NGN'; if (s.indexOf('€') >= 0) return 'EUR';
    if (s.indexOf('£') >= 0) return 'GBP'; if (s.indexOf('$') >= 0) return 'USD';
    return null;
  }
  function normCur(t) {
    t = String(t).trim().toUpperCase();
    if (t === '₦' || t === 'NAIRA') return 'NGN';
    if (t === '$' || t === 'DOLLAR' || t === 'DOLLARS') return 'USD';
    if (t === '€' || t === 'EURO' || t === 'EUROS') return 'EUR';
    if (t === '£' || t === 'POUND' || t === 'POUNDS') return 'GBP';
    if (CURRENCY_CODES.indexOf(t) >= 0) return t;
    return null;
  }
  // Detect an ISO currency from a cell value (code, symbol, or name); else fallback.
  function detectCurrency(str, fallback) {
    var sym = symbolCurrency(str); if (sym) return sym;
    var code = String(str || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (CURRENCY_CODES.indexOf(code) >= 0) return code;
    var three = code.slice(0, 3); if (CURRENCY_CODES.indexOf(three) >= 0) return three;
    return fallback;
  }

  function detectLedgerAnchors(aoa) {
    var found = {};
    for (var r = 0; r < aoa.length; r++) {
      var row = aoa[r] || [];
      for (var c = 0; c < row.length; c++) {
        var v = String(row[c] == null ? '' : row[c]).trim().toLowerCase();
        if (!v) continue;
        if (!found.income && /^income\b/.test(v)) found.income = { r: r, c: c };
        else if (!found.expense && /^(expenditure|expenses|expense)\b/.test(v)) found.expense = { r: r, c: c };
        else if (!found.savings && /(saving|invest)/.test(v)) found.savings = { r: r, c: c };
      }
    }
    return found;
  }

  function parseLedgerWorkbook(wb, fileName) {
    var entries = [], counts = { income: 0, expenses: 0, savings: 0 }, perMonth = {};
    var sheetsUsed = [], skippedSheets = [];
    var ym = String(fileName || '').match(/(19|20)\d{2}/);
    var year = ym ? parseInt(ym[0], 10) : state.year;

    wb.SheetNames.forEach(function (sn) {
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', blankrows: true });
      var anchors = detectLedgerAnchors(aoa);
      var mo = monthFromName(sn);
      if (!(anchors.income && anchors.expense) || !mo) { skippedSheets.push(sn); return; }
      sheetsUsed.push(sn);
      perMonth[mo] = perMonth[mo] || { income: 0, expenses: 0, savings: 0 };

      ['income', 'expense', 'savings'].forEach(function (secKey) {
        var anchor = anchors[secKey]; if (!anchor) return;
        var section = SECKEYS[secKey];
        var nameCol = anchor.c, amtCol = anchor.c + 1;
        var cur = currencyInText(aoa[anchor.r] && aoa[anchor.r][anchor.c]) || 'NGN';
        for (var r = anchor.r + 1; r < aoa.length; r++) {
          var row = aoa[r] || [];
          var nameRaw = row[nameCol], amtRaw = row[amtCol];
          var mk = currencyMarker(nameRaw) || currencyMarker(amtRaw);
          if (mk) { cur = mk; continue; }
          var amt = parseAmount(amtRaw);
          if (isNaN(amt) || amt === 0) continue;
          var nameStr = cellStr(nameRaw).trim();
          // Income/expense: a number with no name is a subtotal — skip it.
          if (section !== 'savings' && !nameStr) continue;
          var currency = symbolCurrency(amtRaw) || symbolCurrency(nameRaw) || cur;
          var nm = nameStr || (section === 'savings' ? 'Investment' : SECTIONS[section]);
          entries.push({ m: mo, section: section, name: nm, amount: Math.abs(amt), currency: currency, category: autoCategory(nm, section) });
          counts[section]++; perMonth[mo][section]++;
        }
      });
    });
    return { entries: entries, year: year, counts: counts, perMonth: perMonth, sheetsUsed: sheetsUsed, skippedSheets: skippedSheets };
  }

  function renderLedgerImportHtml() {
    var d = state.importData;
    var monthsList = Object.keys(d.perMonth).map(Number).sort(function (a, b) { return a - b; });
    var rowsHtml = monthsList.map(function (mo) {
      var p = d.perMonth[mo];
      return '<tr><td style="text-align:left">' + MONTHS[mo - 1] + '</td><td>' + p.income + '</td><td>' + p.expenses + '</td><td>' + p.savings + '</td></tr>';
    }).join('');
    var skipped = (d.skippedSheets || []).length
      ? '<div class="rate-status">Skipped sheet' + (d.skippedSheets.length === 1 ? '' : 's') + ': ' + esc(d.skippedSheets.join(', ')) + '</div>' : '';

    return '<div class="overlay" data-act="closeImport"><div class="modal wide" data-stop="1">' +
      '<div class="title">Import monthly ledger</div>' +
      '<div class="desc">Detected a sectioned monthly workbook (Income / Expenditure / Savings blocks). Found <strong>' +
        d.sheetsUsed.length + ' month tab' + (d.sheetsUsed.length === 1 ? '' : 's') + '</strong> with <strong>' +
        d.counts.income + '</strong> income, <strong>' + d.counts.expenses + '</strong> expense and <strong>' +
        d.counts.savings + '</strong> savings entries. Savings figures import as allocations.</div>' +
      '<label class="field"><span class="lbl">Import into year</span>' +
        '<input id="ledger-year" type="number" inputmode="numeric" value="' + attr(d.year) + '"></label>' +
      '<div class="preview"><div class="preview-scroll"><table><thead><tr>' +
        '<th style="text-align:left">Month</th><th style="text-align:left">Income</th><th style="text-align:left">Expenses</th><th style="text-align:left">Savings</th></tr></thead><tbody>' +
        rowsHtml + '</tbody></table></div></div>' +
      skipped +
      '<div class="modal-actions">' +
        '<button class="btn link" data-act="pickFile">Choose another file</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn ghost" data-act="closeImport">Cancel</button>' +
        '<button class="btn primary" data-act="runLedgerImport">Import ' + d.entries.length + ' entries</button>' +
      '</div></div></div>';
  }

  function runLedgerImport() {
    var d = state.importData;
    var yEl = document.getElementById('ledger-year');
    var year = parseInt(yEl && yEl.value, 10);
    if (!(year >= 1900 && year <= 3000)) year = d.year;
    var data = clone(state.data);
    d.entries.forEach(function (e) {
      var b = ensure(data, year, e.m);
      b[e.section].push({ id: genId(), name: e.name, amount: e.amount, currency: e.currency, category: e.category, recurring: false });
    });
    state.data = data;
    state.year = year;
    state.importData = null;
    persist();
    toast('Imported ' + d.entries.length + ' entries across ' + d.sheetsUsed.length + ' month' + (d.sheetsUsed.length === 1 ? '' : 's'));
    render();
  }

  function renderImportHtml() {
    var d = state.importData;
    if (d.mode === 'ledger') return renderLedgerImportHtml();
    if (d.error) {
      return '<div class="overlay" data-act="closeImport"><div class="modal" data-stop="1">' +
        '<div class="title">Import spreadsheet</div><div class="err">' + esc(d.error) + '</div>' +
        '<div class="modal-actions"><div class="spacer"></div><button class="btn ghost" data-act="closeImport">Close</button>' +
        '<button class="btn primary" data-act="pickFile">Choose file…</button></div></div></div>';
    }
    var colOpts = function (sel) {
      var o = '<option value="-1">— none —</option>';
      d.headers.forEach(function (hName, i) { o += '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(hName) + '</option>'; });
      return o;
    };
    var map = '<div class="map-grid">' + IMPORT_TARGETS.map(function (t) {
      return '<div><div class="lbl">' + esc(t.label) + '</div><select data-map="' + t.key + '">' + colOpts(d.mapping[t.key]) + '</select></div>';
    }).join('') + '</div>';

    var defType = '<div><div class="lbl">Default type</div><select data-def="type">' +
      ['expenses', 'income', 'savings'].map(function (s) { return '<option value="' + s + '"' + (d.defaultType === s ? ' selected' : '') + '>' + SECTIONS[s] + '</option>'; }).join('') + '</select></div>';
    var defCur = '<div><div class="lbl">Default currency</div><select data-def="currency">' +
      currencyOptions(d.defaultCurrency, true) + '</select></div>';

    // preview first 6 rows
    var prevHead = '<tr>' + d.headers.map(function (hName) { return '<th>' + esc(hName) + '</th>'; }).join('') + '</tr>';
    var prevBody = d.rows.slice(0, 6).map(function (r) {
      return '<tr>' + d.headers.map(function (_, i) { return '<td>' + esc(cellStr(r[i])) + '</td>'; }).join('') + '</tr>';
    }).join('');

    return '<div class="overlay" data-act="closeImport"><div class="modal wide" data-stop="1">' +
      '<div class="title">Import spreadsheet</div>' +
      '<div class="desc">Sheet “' + esc(d.sheetName) + '” · ' + d.rows.length + ' rows. Match your columns below, then import. Rows with no matching month land in ' + (state.activeMonth ? MONTHS[state.activeMonth - 1] : 'the current view') + ' ' + state.year + '.</div>' +
      map +
      '<div class="map-grid" style="margin-top:12px">' + defType + defCur + '</div>' +
      '<div class="preview"><div class="preview-scroll"><table><thead>' + prevHead + '</thead><tbody>' + prevBody + '</tbody></table></div></div>' +
      (d.msg ? '<div class="ok">' + esc(d.msg) + '</div>' : '') +
      '<div class="modal-actions">' +
        '<button class="btn link" data-act="pickFile">Choose another file</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn ghost" data-act="closeImport">Cancel</button>' +
        '<button class="btn primary" data-act="runImport">Import ' + d.rows.length + ' rows</button>' +
      '</div></div></div>';
  }

  function cellStr(v) {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return v == null ? '' : String(v);
  }

  function readImportControls() {
    var d = state.importData;
    document.querySelectorAll('[data-map]').forEach(function (sel) { d.mapping[sel.getAttribute('data-map')] = parseInt(sel.value, 10); });
    var dt = document.querySelector('[data-def="type"]'); if (dt) d.defaultType = dt.value;
    var dc = document.querySelector('[data-def="currency"]'); if (dc) d.defaultCurrency = dc.value;
  }

  function parseAmount(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    var s = String(v).replace(/[^0-9.\-()]/g, '');
    var neg = /\(.*\)/.test(String(v));
    s = s.replace(/[()]/g, '');
    var n = parseFloat(s);
    return isNaN(n) ? NaN : (neg ? -n : n);
  }

  function parsePeriod(v, fallbackY, fallbackM) {
    if (v instanceof Date && !isNaN(v)) return { y: v.getFullYear(), m: v.getMonth() + 1 };
    if (typeof v === 'number') {
      if (v >= 1 && v <= 12 && Number.isInteger(v)) return { y: fallbackY, m: v };
      if (v > 59) { // excel serial date
        var d = new Date(Math.round((v - 25569) * 86400 * 1000));
        if (!isNaN(d)) return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
      }
      return { y: fallbackY, m: fallbackM };
    }
    var s = String(v || '').trim();
    if (!s) return { y: fallbackY, m: fallbackM };
    // month name
    var low = s.toLowerCase();
    for (var i = 0; i < MONTHS.length; i++) {
      if (low.indexOf(MONTHS[i].toLowerCase().slice(0, 3)) === 0) {
        var ym = s.match(/(\d{4})/); return { y: ym ? parseInt(ym[1], 10) : fallbackY, m: i + 1 };
      }
    }
    var d2 = new Date(s);
    if (!isNaN(d2)) return { y: d2.getFullYear(), m: d2.getMonth() + 1 };
    var mn = parseInt(s, 10);
    if (mn >= 1 && mn <= 12) return { y: fallbackY, m: mn };
    return { y: fallbackY, m: fallbackM };
  }

  function parseType(v, def) {
    var s = String(v || '').toLowerCase();
    if (/(sav|invest)/.test(s)) return 'savings';
    if (/(inc|salary|credit|earn|in\b)/.test(s)) return 'income';
    if (/(exp|debit|spend|out\b|bill|cost)/.test(s)) return 'expenses';
    return def;
  }

  function runImport() {
    readImportControls();
    var d = state.importData;
    if (d.mapping.name < 0 && d.mapping.amount < 0) {
      d.error = 'Map at least a Name and an Amount column.'; render(); return;
    }
    var fY = state.year, fM = state.activeMonth || 1;
    var data = clone(state.data);
    var added = 0, skipped = 0;
    d.rows.forEach(function (r) {
      var name = d.mapping.name >= 0 ? cellStr(r[d.mapping.name]).trim() : '';
      var rawAmt = d.mapping.amount >= 0 ? r[d.mapping.amount] : '';
      var amt = parseAmount(rawAmt);
      if (!name && !(amt > 0 || amt < 0)) { skipped++; return; }
      if (isNaN(amt) || amt === 0) { skipped++; return; }

      var section = d.mapping.type >= 0 ? parseType(r[d.mapping.type], d.defaultType) : d.defaultType;
      // negative amounts with a generic default lean toward expenses
      if (d.mapping.type < 0 && amt < 0 && d.defaultType !== 'income') section = 'expenses';

      var currency = d.mapping.currency >= 0 ? detectCurrency(cellStr(r[d.mapping.currency]), d.defaultCurrency) : d.defaultCurrency;

      var period = d.mapping.date >= 0 ? parsePeriod(r[d.mapping.date], fY, fM) : { y: fY, m: fM };
      var category = d.mapping.category >= 0 ? (cellStr(r[d.mapping.category]).trim() || autoCategory(name, section)) : autoCategory(name, section);

      var b = ensure(data, period.y, period.m);
      b[section].push({ id: genId(), name: name || SECTIONS[section], amount: Math.abs(amt), currency: currency, category: category, recurring: false });
      added++;
    });
    state.data = data;
    state.importData = null;
    persist();
    toast('Imported ' + added + ' row' + (added === 1 ? '' : 's') + (skipped ? ' · ' + skipped + ' skipped' : ''));
    render();
  }

  // =========================================================================
  //  EXPORT  (statement of account: Excel via SheetJS, PDF via print)
  // =========================================================================
  function r2(n) { return Math.round(n * 100) / 100; }

  // Gather a full statement for the selected year in the display currency.
  function statementData() {
    var year = state.year, disp = state.displayCurrency;
    var yd = state.data[year] || {};
    var rows = [], summary = [], totals = { income: 0, expense: 0 };
    var secs = [['income', 'Income'], ['expenses', 'Expense'], ['savings', 'Saving']];
    for (var m = 1; m <= 12; m++) {
      var md = yd[m];
      if (!md) continue;
      var has = (md.income || []).length + (md.expenses || []).length + (md.savings || []).length;
      if (!has) continue;
      secs.forEach(function (s) {
        (md[s[0]] || []).forEach(function (e) {
          rows.push({ month: MONTHS[m - 1], type: s[1], name: e.name, category: e.category || '', amount: e.amount, currency: e.currency, conv: conv(e.amount, e.currency, disp) });
        });
      });
      var inc = sumConv(md.income, disp), exp = sumConv(md.expenses, disp);
      summary.push({ month: MONTHS[m - 1], income: inc, expense: exp, saved: inc - exp });
      totals.income += inc; totals.expense += exp;
    }
    return { year: year, disp: disp, rows: rows, summary: summary, totals: totals };
  }

  function exportExcel() {
    var d = statementData();
    if (!d.rows.length) { toast('Nothing to export for ' + d.year); return; }
    var wb = XLSX.utils.book_new();
    var head = ['Month', 'Type', 'Name', 'Category', 'Amount', 'Currency', 'Amount (' + d.disp + ')'];
    var aoa = [head].concat(d.rows.map(function (r) {
      return [r.month, r.type, r.name, r.category, r2(r.amount), r.currency, r2(r.conv)];
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Statement');
    var shead = ['Month', 'Income (' + d.disp + ')', 'Expenses (' + d.disp + ')', 'Saved (' + d.disp + ')'];
    var saoa = [shead].concat(d.summary.map(function (s) { return [s.month, r2(s.income), r2(s.expense), r2(s.saved)]; }));
    saoa.push(['Total', r2(d.totals.income), r2(d.totals.expense), r2(d.totals.income - d.totals.expense)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(saoa), 'Summary');
    XLSX.writeFile(wb, 'Ledger-Statement-' + d.year + '.xlsx');
    state.exportOpen = false; toast('Excel statement downloaded'); render();
  }

  function buildStatementHtml() {
    var d = statementData();
    var h = fmt, disp = d.disp;
    var who = (cloud.signedIn && cloud.user && cloud.user.email) ? esc(cloud.user.email) : '';
    var generated = new Date().toLocaleString();
    var css = 'body{font-family:-apple-system,Helvetica,Arial,sans-serif;color:#0e0f0c;margin:0;padding:40px;}'
      + 'h1{font-size:22px;margin:0;letter-spacing:-0.02em;}'
      + '.meta{color:#6f756e;font-size:12px;margin-top:6px;line-height:1.6;}'
      + '.brand{display:flex;align-items:center;gap:10px;margin-bottom:18px;}'
      + '.logo{width:30px;height:30px;border-radius:9px;background:#0e0f0c;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;}'
      + 'h2{font-size:14px;margin:28px 0 8px;text-transform:uppercase;letter-spacing:0.08em;color:#8f9490;}'
      + 'table{width:100%;border-collapse:collapse;font-size:12px;}'
      + 'th{text-align:left;color:#8f9490;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;padding:7px 8px;border-bottom:1px solid #e6e9e2;}'
      + 'td{padding:7px 8px;border-bottom:1px solid #f0f2ee;}'
      + 'td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}'
      + 'tfoot td{font-weight:800;border-top:2px solid #e6e9e2;border-bottom:none;}'
      + '.tot{font-weight:800;}'
      + '@media print{body{padding:0;} @page{margin:16mm;}}';
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ledger Statement ' + d.year + '</title><style>' + css + '</style></head><body>';
    html += '<div class="brand"><span class="logo">L</span><h1>Ledger — Statement of Account</h1></div>';
    html += '<div class="meta"><strong>Period:</strong> ' + d.year + ' &nbsp;·&nbsp; <strong>Currency:</strong> ' + esc(curLabel(disp)) + (who ? ' &nbsp;·&nbsp; <strong>Account:</strong> ' + who : '') + '<br><strong>Generated:</strong> ' + esc(generated) + '</div>';

    // Summary
    html += '<h2>Summary</h2><table><thead><tr><th>Month</th><th class="n">Income</th><th class="n">Expenses</th><th class="n">Saved</th></tr></thead><tbody>';
    d.summary.forEach(function (s) {
      html += '<tr><td>' + s.month + '</td><td class="n">' + h(s.income, disp) + '</td><td class="n">' + h(s.expense, disp) + '</td><td class="n">' + fmtSigned(s.saved, disp) + '</td></tr>';
    });
    html += '</tbody><tfoot><tr><td>' + d.year + ' total</td><td class="n">' + h(d.totals.income, disp) + '</td><td class="n">' + h(d.totals.expense, disp) + '</td><td class="n">' + fmtSigned(d.totals.income - d.totals.expense, disp) + '</td></tr></tfoot></table>';

    // Detailed entries grouped by month
    html += '<h2>Detailed entries</h2><table><thead><tr><th>Month</th><th>Type</th><th>Name</th><th>Category</th><th class="n">Amount</th><th class="n">In ' + esc(disp) + '</th></tr></thead><tbody>';
    d.rows.forEach(function (r) {
      html += '<tr><td>' + esc(r.month) + '</td><td>' + esc(r.type) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.category) + '</td><td class="n">' + h(r.amount, r.currency) + '</td><td class="n">' + h(r.conv, disp) + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<div class="meta" style="margin-top:24px">Generated by Ledger · Savings shown as income − expenses.</div>';
    html += '</body></html>';
    return html;
  }

  function exportPdf() {
    var d = statementData();
    if (!d.rows.length) { toast('Nothing to export for ' + d.year); return; }
    var iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    var doc = iframe.contentWindow.document;
    doc.open(); doc.write(buildStatementHtml()); doc.close();
    var done = false;
    var go = function () {
      if (done) return; done = true;
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) {}
      setTimeout(function () { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 1500);
    };
    iframe.onload = go;
    setTimeout(go, 500); // fallback if onload doesn't fire after document.write
    state.exportOpen = false; render();
  }

  function renderExportHtml() {
    var d = statementData();
    var n = d.rows.length;
    return '<div class="overlay" data-act="closeExport"><div class="modal" data-stop="1">' +
      '<div class="title">Export ' + d.year + ' statement</div>' +
      '<div class="desc">A detailed statement of account for <strong>' + d.year + '</strong> — every income, expense and saving entry, plus monthly and yearly totals, in ' + esc(curLabel(d.disp)) + '. ' +
        (n ? n + ' entries.' : 'No entries for this year yet.') + '</div>' +
      '<div class="modal-actions" style="margin-top:22px;gap:12px;">' +
        '<button class="btn ghost" data-act="closeExport">Cancel</button>' +
        '<div class="spacer"></div>' +
        '<button class="btn ghost" data-act="exportPdf"' + (n ? '' : ' disabled') + '>' + icoDownload() + ' PDF</button>' +
        '<button class="btn primary" data-act="exportExcel"' + (n ? '' : ' disabled') + '>' + icoDownload() + ' Excel</button>' +
      '</div></div></div>';
  }

  // =========================================================================
  //  ACTIONS
  // =========================================================================
  function hide(v) { return state.hidden ? '••••••' : v; }

  function snapshotModalInputs() {
    var m = state.modal; if (!m) return;
    var n = document.getElementById('m-name'); if (n) m.name = n.value;
    var a = document.getElementById('m-amount'); if (a) m.amount = a.value;
    var c = document.getElementById('m-category'); if (c) m.category = c.value;
    var r = document.getElementById('m-recur'); if (r) m.recurring = r.checked;
  }

  function openModal(section, entry) {
    state.modal = {
      section: section, id: entry ? entry.id : null,
      name: entry ? entry.name : '', amount: entry ? String(entry.amount) : '',
      currency: entry ? entry.currency : (section === 'income' ? state.displayCurrency : 'NGN'),
      category: entry ? (entry.category || autoCategory(entry.name, section)) : autoCategory('', section),
      recurring: entry ? !!entry.recurring : false,
      mode: entry ? 'edit' : 'add', error: false, categoryTouched: !!entry
    };
    render();
  }

  function saveModal() {
    snapshotModalInputs();
    var m = state.modal; if (!m) return;
    var name = (m.name || '').trim();
    var amt = unformatAmount(m.amount);
    if (!name || !(amt > 0)) { m.error = true; render(); return; }
    // If the user never manually chose a category, derive it from the name.
    var category = m.categoryTouched ? (m.category || autoCategory(name, m.section)) : autoCategory(name, m.section);
    var data = clone(state.data);
    var b = ensure(data, state.year, state.activeMonth);
    var list = b[m.section];
    if (m.mode === 'edit') {
      var i = list.findIndex(function (e) { return e.id === m.id; });
      if (i >= 0) list[i] = { id: m.id, name: name, amount: amt, currency: m.currency, category: category, recurring: m.recurring };
    } else {
      list.push({ id: genId(), name: name, amount: amt, currency: m.currency, category: category, recurring: m.recurring });
    }
    if (m.recurring) upsertRecurring(m.section, name, amt, m.currency, category);
    state.data = data; state.modal = null;
    persist(); render();
  }

  function deleteFromModal() {
    var m = state.modal; if (!m || !m.id) return;
    var data = clone(state.data);
    var b = ensure(data, state.year, state.activeMonth);
    b[m.section] = b[m.section].filter(function (e) { return e.id !== m.id; });
    state.data = data; state.modal = null;
    persist(); render();
  }

  function delDirect(section, id) {
    var data = clone(state.data);
    var b = ensure(data, state.year, state.activeMonth);
    b[section] = b[section].filter(function (e) { return e.id !== id; });
    state.data = data; persist(); render();
  }

  var toastTimer = null;
  function toast(msg) {
    state.toast = msg; render();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { state.toast = null; render(); }, 2600);
  }

  // =========================================================================
  //  EVENT DELEGATION
  // =========================================================================
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');

    switch (act) {
      case 'year': changeYear(parseInt(t.getAttribute('data-d'), 10)); break;
      case 'hide': state.hidden = !state.hidden; persist(); render(); break;
      case 'openMonth': state.view = 'month'; state.activeMonth = parseInt(t.getAttribute('data-mo'), 10); render(); break;
      case 'back': state.view = 'dashboard'; state.activeMonth = null; render(); break;

      case 'add': openModal(t.getAttribute('data-section'), null); break;
      case 'edit': { var e = findEntry(t.getAttribute('data-section'), t.getAttribute('data-id')); if (e) openModal(t.getAttribute('data-section'), e); break; }
      case 'delDirect': delDirect(t.getAttribute('data-section'), t.getAttribute('data-id')); break;
      case 'saveModal': saveModal(); break;
      case 'deleteEntry': deleteFromModal(); break;
      case 'closeModal': if (isBackdrop(ev, t)) { state.modal = null; render(); } break;

      case 'applyRecurring': applyRecurring(state.year, state.activeMonth); break;
      case 'openRecurring': state.recurringOpen = true; render(); break;
      case 'closeRecurring': if (t.tagName === 'BUTTON' || isBackdrop(ev, t)) { state.recurringOpen = false; render(); } break;
      case 'delRecurring': removeRecurring(t.getAttribute('data-id')); break;

      case 'openSettings': state.settingsOpen = true; state.ratesMsg = null; render(); break;
      case 'closeSettings': if (t.tagName === 'BUTTON' || isBackdrop(ev, t)) { state.settingsOpen = false; state.ratesMsg = null; render(); } break;
      case 'refreshRates': fetchRates({}); break;

      case 'openExport': state.exportOpen = true; render(); break;
      case 'closeExport': if (t.tagName === 'BUTTON' || isBackdrop(ev, t)) { state.exportOpen = false; render(); } break;
      case 'exportExcel': exportExcel(); break;
      case 'exportPdf': exportPdf(); break;

      case 'openImport': openImport(); break;
      case 'pickFile': openImport(); break;
      case 'runImport': runImport(); break;
      case 'runLedgerImport': runLedgerImport(); break;
      case 'closeImport': if (t.tagName === 'BUTTON' || isBackdrop(ev, t)) { state.importData = null; render(); } break;

      case 'signIn': cloudSignIn(); break;
      case 'openAccount': state.accountOpen = true; render(); break;
      case 'closeAccount': if (t.tagName === 'BUTTON' || isBackdrop(ev, t)) { state.accountOpen = false; render(); } break;
      case 'signOut': cloudSignOut(); render(); break;
    }
  });

  // treat Enter/Escape inside the entry modal
  document.addEventListener('keydown', function (ev) {
    if (state.modal) {
      if (ev.key === 'Enter' && (ev.target.id === 'm-name' || ev.target.id === 'm-amount')) { ev.preventDefault(); saveModal(); }
      else if (ev.key === 'Escape') { state.modal = null; render(); }
    } else if (ev.key === 'Escape') {
      if (state.settingsOpen) { state.settingsOpen = false; render(); }
      else if (state.recurringOpen) { state.recurringOpen = false; render(); }
      else if (state.importData) { state.importData = null; render(); }
      else if (state.accountOpen) { state.accountOpen = false; render(); }
      else if (state.exportOpen) { state.exportOpen = false; render(); }
    }
  });

  // Keep open-form inputs mirrored into state so a background re-render (cloud
  // sync, rate refresh) can't wipe what the user has half-typed/picked.
  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'disp-cur') { state.displayCurrency = ev.target.value; persist(); render(); return; }
    if (state.modal) {
      if (ev.target.id === 'm-currency') { state.modal.currency = ev.target.value; return; }
      if (ev.target.id === 'm-category') { state.modal.category = ev.target.value; state.modal.categoryTouched = true; }
      else if (ev.target.id === 'm-recur') state.modal.recurring = ev.target.checked;
    }
    if (state.importData && state.importData.mode === 'table' &&
        (ev.target.matches('[data-map]') || ev.target.matches('[data-def]'))) {
      readImportControls();
    }
  });

  document.addEventListener('input', function (ev) {
    if (!ev.target) return;
    if (ev.target.id === 'm-amount') { onAmountInput(ev.target); if (state.modal) state.modal.amount = ev.target.value; }
    else if (ev.target.id === 'm-name' && state.modal) state.modal.name = ev.target.value;
    else if (ev.target.id === 'ledger-year' && state.importData) state.importData.year = ev.target.value;
  });

  document.getElementById('fileInput').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    handleFile(f);
    ev.target.value = ''; // allow re-choosing same file
  });

  // A click landed on an overlay backdrop (not on the inner modal card).
  function isBackdrop(ev, t) { return ev.target === t; }

  function changeYear(d) { state.year += d; state.view = 'dashboard'; state.activeMonth = null; persist(); render(); }
  function findEntry(section, id) {
    var b = (state.data[state.year] || {})[state.activeMonth] || {};
    return (b[section] || []).find(function (e) { return e.id === id; });
  }

  // =========================================================================
  //  ICONS
  // =========================================================================
  function eyeIcon() {
    return state.hidden
      ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>'
      : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  }
  function icoDown() { return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 20h14"/></svg>'; }
  function icoUp() { return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V9"/><path d="M7.5 13.5 12 9l4.5 4.5"/><path d="M5 4h14"/></svg>'; }
  function icoTrend() { return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 15 9.5 9.5 13 13 20 6"/><polyline points="15 6 20 6 20 11"/></svg>'; }
  function icoRepeat() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>'; }
  function icoRepeatSm() { return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>'; }
  function icoUpload() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'; }
  function icoRate() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h13l-3-3"/><path d="M21 17H8l3 3"/></svg>'; }
  function icoDownload() { return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'; }
  function icoGoogle() { return '<svg width="15" height="15" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'; }

  // =========================================================================
  //  BOOT
  // =========================================================================
  render();
  autoFetchRates();
  initCloud();
})();
