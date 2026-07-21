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
  var SYM  = { NGN: '₦', USD: '$', EUR: '€' };
  var NAME = { NGN: '₦ NGN', USD: '$ USD', EUR: '€ EUR' };
  var CURS = ['NGN', 'USD', 'EUR'];
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var SECTIONS = { income: 'income', expenses: 'expense', savings: 'saving' };
  var KEY = 'pft-ledger-v2';

  var CATEGORIES = ['Salary','Groceries','Housing','Utilities','Transport','Health','Family','Education','Entertainment','Shopping','Savings','Other'];
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

  // ---- state --------------------------------------------------------------
  var state = load() || seed();

  function seed() {
    var c = 0;
    var mk = function (name, amount, currency, category, recurring) {
      return { id: 's' + (c++), name: name, amount: amount, currency: currency,
               category: category || autoCategory(name, 'expenses'), recurring: !!recurring };
    };
    var data = { 2026: {
      1: {
        income: [mk('NW Salary',350000,'NGN','Salary',true), mk('PerchFit Balance',125,'USD','Salary'), mk('SAC Caldera 50%',1750,'USD','Salary')],
        expenses: [mk('Groceries',80000,'NGN','Groceries',true), mk('Laundry',9700,'NGN','Shopping',true), mk('Car Fuel',40000,'NGN','Transport',true), mk('Car Alarm',40000,'NGN','Transport'), mk('Gen Fuel',35000,'NGN','Utilities',true), mk('Gen Repair',4000,'NGN','Utilities'), mk('Dad Car Fix',150000,'NGN','Family'), mk('Diffusers',16000,'NGN','Shopping'), mk('Light Bill',25000,'NGN','Utilities',true), mk('Wall Fixing',55000,'NGN','Housing'), mk('Dad Hospital',80000,'NGN','Health'), mk('Eunice School Fees',100000,'NGN','Education',true), mk('Mum Groceries',50000,'NGN','Family',true), mk('Peter Security',30000,'NGN','Family',true), mk('Caleb Gift',20000,'NGN','Family'), mk('Josh IKJ Gift',5000,'NGN','Family'), mk('Facility Fee Part',100000,'NGN','Housing')],
        savings: [mk('Investment',1000000,'NGN','Savings')]
      },
      2: {
        income: [mk('NW Salary',350000,'NGN','Salary',true), mk('SAC Caldera 50%',500,'USD','Salary')],
        expenses: [mk('Rent',600000,'NGN','Housing'), mk('Groceries',85000,'NGN','Groceries',true), mk('Car Fuel',45000,'NGN','Transport',true), mk('Gen Fuel',38000,'NGN','Utilities',true), mk('Light Bill',27000,'NGN','Utilities',true), mk('Internet',25000,'NGN','Utilities'), mk('Mum Groceries',50000,'NGN','Family',true), mk('Eunice School Fees',100000,'NGN','Education',true), mk('Miscellaneous',91613,'NGN','Other')],
        savings: []
      },
      3: {
        income: [mk('NW Salary',350000,'NGN','Salary',true), mk('SAC Caldera 50%',2750,'USD','Salary')],
        expenses: [mk('Groceries',90000,'NGN','Groceries',true), mk('Car Fuel',42000,'NGN','Transport',true), mk('Gen Fuel',36000,'NGN','Utilities',true), mk('Light Bill',28000,'NGN','Utilities',true), mk('Dad Hospital',120000,'NGN','Health'), mk('Eunice School Fees',100000,'NGN','Education',true), mk('Mum Groceries',50000,'NGN','Family',true), mk('Car Service',80000,'NGN','Transport'), mk('Facility Fee',100000,'NGN','Housing'), mk('Diffusers',15000,'NGN','Shopping'), mk('Miscellaneous',305395,'NGN','Other')],
        savings: [mk('Investment',2100000,'NGN','Savings')]
      }
    }};
    // seed recurring templates from the items flagged above in month 1/2
    var recurring = [];
    var seen = {};
    [1,2,3].forEach(function (mo) {
      var b = data[2026][mo];
      ['income','expenses','savings'].forEach(function (sec) {
        b[sec].forEach(function (e) {
          if (e.recurring) {
            var k = sec + '|' + e.name.toLowerCase();
            if (!seen[k]) { seen[k] = 1; recurring.push({ id: genId(), section: sec, name: e.name, amount: e.amount, currency: e.currency, category: e.category }); }
          }
        });
      });
    });
    return {
      data: data,
      rates: { NGN: 1, USD: 1600, EUR: 1750 },
      ratesMeta: { updated: null, source: 'manual' },
      wiseToken: '',
      displayCurrency: 'NGN',
      year: 2026,
      hidden: false,
      recurring: recurring,
      // transient view state
      view: 'dashboard', activeMonth: null, modal: null,
      settingsOpen: false, ratesMsg: null, recurringOpen: false,
      importData: null, toast: null
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return {
        data: o.data || {},
        rates: o.rates || { NGN: 1, USD: 1600, EUR: 1750 },
        ratesMeta: o.ratesMeta || { updated: null, source: 'manual' },
        wiseToken: o.wiseToken || '',
        displayCurrency: o.displayCurrency || 'NGN',
        year: o.year || 2026,
        hidden: !!o.hidden,
        recurring: o.recurring || [],
        view: 'dashboard', activeMonth: null, modal: null,
        settingsOpen: false, ratesMsg: null, recurringOpen: false,
        importData: null, toast: null
      };
    } catch (e) { return null; }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        data: state.data, rates: state.rates, ratesMeta: state.ratesMeta,
        wiseToken: state.wiseToken, displayCurrency: state.displayCurrency,
        year: state.year, hidden: state.hidden, recurring: state.recurring
      }));
    } catch (e) {}
  }

  function genId() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---- money helpers ------------------------------------------------------
  function conv(a, from, to) { var r = state.rates; return a * (r[from] || 1) / (r[to] || 1); }
  function fmt(a, cur) {
    var opts = cur === 'NGN' ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 0, maximumFractionDigits: 2 };
    return (SYM[cur] || '') + new Intl.NumberFormat('en-US', opts).format(a);
  }
  function fmtSigned(a, cur) { var s = a < -0.005 ? '−' : ''; return s + fmt(Math.abs(a), cur); }
  function sumConv(list, to) { return (list || []).reduce(function (s, e) { return s + conv(e.amount, e.currency, to); }, 0); }
  function addNative(o, list) { (list || []).forEach(function (e) { o[e.currency] = (o[e.currency] || 0) + e.amount; }); }
  function showNat(o, disp) { var ks = CURS.filter(function (c) { return o[c] > 0; }); return ks.length > 1 || (ks.length === 1 && ks[0] !== disp); }
  function natStr(o) { return CURS.filter(function (c) { return o[c] > 0; }).map(function (c) { return fmt(o[c], c); }).join('   +   '); }

  function autoCategory(name, section) {
    if (section === 'income') return 'Salary';
    if (section === 'savings') return 'Savings';
    var n = ' ' + String(name || '').toLowerCase() + ' ';
    for (var i = 0; i < CAT_HINTS.length; i++) {
      var cat = CAT_HINTS[i][0], words = CAT_HINTS[i][1];
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

  // ---- Wise exchange-rate API --------------------------------------------
  // Wise "Get rate" endpoint: GET https://api.wise.com/v1/rates?source=USD&target=NGN
  // Header: Authorization: Bearer <API token>. Response: [{ "rate": 1600.5, ... }].
  function fetchWiseRates() {
    var token = (state.wiseToken || '').trim();
    if (!token) { state.ratesMsg = { type: 'err', text: 'Enter your Wise API token first, then fetch.' }; renderSettings(); return; }
    state.ratesMsg = { type: 'info', text: 'Fetching live rates from Wise…' };
    renderSettings();

    var wanted = ['USD', 'EUR'];
    Promise.all(wanted.map(function (cur) {
      return fetch('https://api.wise.com/v1/rates?source=' + cur + '&target=NGN', {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (json) {
        var rate = Array.isArray(json) ? (json[0] && json[0].rate) : (json && json.rate);
        if (!(rate > 0)) throw new Error('No rate returned for ' + cur);
        return [cur, rate];
      });
    })).then(function (pairs) {
      var next = { NGN: 1 };
      pairs.forEach(function (p) { next[p[0]] = p[1]; });
      state.rates = next;
      state.ratesMeta = { updated: new Date().toISOString(), source: 'wise' };
      state.ratesMsg = { type: 'ok', text: 'Live rates updated from Wise.' };
      persist();
      renderSettings();
    }).catch(function (err) {
      state.ratesMsg = { type: 'err', text: 'Could not reach Wise (' + esc(err.message) + '). Check the token, or your browser may block the request (CORS) — you can still set rates manually below.' };
      renderSettings();
    });
  }

  function maybeAutoFetchRates() {
    if (!state.wiseToken) return;
    var last = state.ratesMeta && state.ratesMeta.updated ? Date.parse(state.ratesMeta.updated) : 0;
    if (Date.now() - last > 12 * 3600 * 1000) { fetchWiseRates(); }
  }

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
    if (state.toast) html += '<div class="toast">' + esc(state.toast) + '</div>';
    app.innerHTML = html;
    persist();
  }

  function renderHeader() {
    var disp = state.displayCurrency;
    function curBtn(c) { return '<button class="seg' + (disp === c ? ' active' : '') + '" data-act="cur" data-cur="' + c + '">' + NAME[c] + '</button>'; }
    return '' +
      '<header class="header">' +
        '<div class="brand"><span class="logo">L</span><span class="name">Ledger</span></div>' +
        '<div class="tools">' +
          '<div class="segset">' + curBtn('NGN') + curBtn('USD') + curBtn('EUR') + '</div>' +
          '<div class="yearnav">' +
            '<button data-act="year" data-d="-1">‹</button>' +
            '<span class="label">' + state.year + '</span>' +
            '<button data-act="year" data-d="1">›</button>' +
          '</div>' +
          '<button class="pill" data-act="openRecurring" title="Recurring items">' + icoRepeat() + 'Recurring</button>' +
          '<button class="pill" data-act="openImport" title="Import a spreadsheet">' + icoUpload() + 'Import</button>' +
          '<button class="pill" data-act="openSettings">' + icoRate() + 'Rates</button>' +
        '</div>' +
      '</header>';
  }

  // ---- dashboard ----------------------------------------------------------
  function renderDashboard() {
    var disp = state.displayCurrency, year = state.year;
    var h = hide;
    var yearData = state.data[year] || {};

    var months = MONTHS.map(function (name, i) {
      var mo = i + 1;
      var md = yearData[mo] || { income: [], expenses: [], savings: [] };
      var inc = sumConv(md.income, disp), exp = sumConv(md.expenses, disp), sav = sumConv(md.savings, disp);
      var has = ((md.income || []).length + (md.expenses || []).length + (md.savings || []).length) > 0;
      return { mo: mo, name: name, has: has, inc: inc, exp: exp, sav: sav, net: inc - exp };
    });

    var inc = 0, exp = 0, sav = 0;
    var incN = { NGN: 0, USD: 0, EUR: 0 }, expN = { NGN: 0, USD: 0, EUR: 0 }, savN = { NGN: 0, USD: 0, EUR: 0 };
    Object.keys(yearData).forEach(function (k) {
      var md = yearData[k];
      inc += sumConv(md.income, disp); exp += sumConv(md.expenses, disp); sav += sumConv(md.savings, disp);
      addNative(incN, md.income); addNative(expN, md.expenses); addNative(savN, md.savings);
    });
    var maxT = Math.max(inc, exp, sav, 1);

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
      '<div class="hero-sub">Income minus expenses · displayed in ' + NAME[disp] + '</div>' +
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
      glance(icoDown(), 'Income', fmt(inc, disp), Math.round(inc / maxT * 100) + '%', showNat(incN, disp), natStr(incN)) +
      glance(icoUp(), 'Expenses', fmt(exp, disp), Math.round(exp / maxT * 100) + '%', showNat(expN, disp), natStr(expN)) +
      glance(icoTrend(), 'Savings / Invest', fmt(sav, disp), Math.round(sav / maxT * 100) + '%', showNat(savN, disp), natStr(savN)) +
      '</section>';

    // month table
    html += '<div class="section-title-row"><h2>Month by month</h2><span class="hint">Tap a month to edit</span></div>';
    html += '<section class="table-wrap"><div class="table-scroll"><table class="months"><thead><tr>' +
      '<th class="l">Month</th><th>Income</th><th>Expenses</th><th>Saved</th><th>Net</th></tr></thead><tbody>';
    months.forEach(function (m) {
      html += '<tr class="' + (m.has ? '' : 'empty') + '" data-act="openMonth" data-mo="' + m.mo + '">' +
        '<td class="name">' + m.name + '</td>' +
        '<td>' + (m.has ? h(fmt(m.inc, disp)) : '—') + '</td>' +
        '<td>' + (m.has ? h(fmt(m.exp, disp)) : '—') + '</td>' +
        '<td>' + (m.has ? h(fmt(m.sav, disp)) : '—') + '</td>' +
        '<td class="net">' + (m.has ? h(fmtSigned(m.net, disp)) : '—') + '</td></tr>';
    });
    html += '</tbody><tfoot><tr>' +
      '<td class="name">' + year + ' total</td>' +
      '<td>' + h(fmt(inc, disp)) + '</td><td>' + h(fmt(exp, disp)) + '</td><td>' + h(fmt(sav, disp)) + '</td>' +
      '<td class="net">' + h(fmtSigned(inc - exp, disp)) + '</td></tr></tfoot></table></div></section>';

    return html;
  }

  // ---- month view ---------------------------------------------------------
  function renderMonth() {
    var disp = state.displayCurrency, year = state.year, mo = state.activeMonth;
    var h = hide;
    var yd = state.data[year] || {};
    var md = yd[mo] || { income: [], expenses: [], savings: [] };

    var incT = sumConv(md.income, disp), expT = sumConv(md.expenses, disp), savT = sumConv(md.savings, disp);

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
        '<div class="item"><span class="dot"></span><span class="lbl">Saved</span><span class="amt">' + h(fmt(savT, disp)) + '</span></div>' +
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
      bucket('savings', 'Savings / Invest', md.savings, savT, disp) +
      '</section>';
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
    function seg(c) { return '<button class="seg' + (m.currency === c ? ' active' : '') + '" data-act="mCur" data-cur="' + c + '">' + NAME[c] + '</button>'; }
    var catOpts = CATEGORIES.map(function (c) { return '<option value="' + attr(c) + '"' + (m.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    return '<div class="overlay" data-act="closeModal"><div class="modal" data-stop="1">' +
      '<div class="title">' + esc(title) + '</div>' +
      '<label class="field"><span class="lbl">Name</span>' +
        '<input id="m-name" value="' + attr(m.name) + '" placeholder="e.g. NW Salary" autocomplete="off"></label>' +
      '<label class="field"><span class="lbl">Amount</span>' +
        '<input id="m-amount" type="number" inputmode="decimal" value="' + attr(m.amount) + '" placeholder="0"></label>' +
      '<label class="field"><span class="lbl">Category</span><select id="m-category">' + catOpts + '</select></label>' +
      '<div class="field"><span class="lbl">Currency</span><div class="segset full">' + seg('NGN') + seg('USD') + seg('EUR') + '</div></div>' +
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
    var srcLabel = meta.source === 'wise' ? 'Wise live rates' : 'Manual';
    var msg = state.ratesMsg;
    return '<div class="overlay" data-act="closeSettings"><div class="modal" data-stop="1">' +
      '<div class="title">Exchange rates</div>' +
      '<div class="desc">Rates are quoted as Naira per 1 unit. Fetch live rates from Wise, or set them manually. Entries keep their original currency — this only affects converted totals.</div>' +

      '<div class="rate-status">' +
        '<div class="rate-row"><span>Source</span><strong>' + esc(srcLabel) + '</strong></div>' +
        '<div class="rate-row"><span>Last updated</span><strong>' + esc(updated) + '</strong></div>' +
        '<div class="rate-row"><span>₦ / $ USD</span><strong>' + fmt(r.USD, 'NGN') + '</strong></div>' +
        '<div class="rate-row"><span>₦ / € EUR</span><strong>' + fmt(r.EUR, 'NGN') + '</strong></div>' +
      '</div>' +

      '<label class="field"><span class="lbl">Wise API token</span>' +
        '<input id="s-token" type="password" value="' + attr(state.wiseToken) + '" placeholder="Bearer token from wise.com" autocomplete="off"></label>' +
      '<div class="modal-actions" style="margin-top:12px">' +
        '<div class="spacer"></div>' +
        '<button class="btn primary" data-act="fetchWise">' + icoRate() + ' Fetch live rates</button>' +
      '</div>' +
      (msg ? '<div class="' + (msg.type === 'ok' ? 'ok' : (msg.type === 'err' ? 'err' : 'rate-status')) + '">' + msg.text + '</div>' : '') +

      '<label class="field"><span class="lbl">₦ per 1 US Dollar (manual)</span>' +
        '<input id="s-usd" type="number" inputmode="decimal" value="' + attr(r.USD) + '"></label>' +
      '<label class="field"><span class="lbl">₦ per 1 Euro (manual)</span>' +
        '<input id="s-eur" type="number" inputmode="decimal" value="' + attr(r.EUR) + '"></label>' +

      '<div class="modal-actions">' +
        '<div class="spacer"></div>' +
        '<button class="btn ghost" data-act="closeSettings">Close</button>' +
        '<button class="btn primary" data-act="saveSettings">Save rates</button>' +
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
        var sheetName = wb.SheetNames[0];
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', blankrows: false });
        // find first non-empty row as header
        var hi = 0;
        while (hi < rows.length && rows[hi].every(function (c) { return c === '' || c == null; })) hi++;
        var headers = (rows[hi] || []).map(function (c, i) { return String(c || '').trim() || ('Column ' + (i + 1)); });
        var body = rows.slice(hi + 1).filter(function (r) { return r.some(function (c) { return c !== '' && c != null; }); });
        state.importData = {
          sheetName: sheetName, headers: headers, rows: body,
          mapping: autoMap(headers),
          defaultType: 'expenses', defaultCurrency: state.displayCurrency,
          error: null, msg: null
        };
        render();
      } catch (e) {
        state.importData = { error: 'Could not read that file: ' + e.message, headers: [], rows: [], mapping: {} };
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

  function renderImportHtml() {
    var d = state.importData;
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
      CURS.map(function (c) { return '<option value="' + c + '"' + (d.defaultCurrency === c ? ' selected' : '') + '>' + NAME[c] + '</option>'; }).join('') + '</select></div>';

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

      var currency = d.defaultCurrency;
      if (d.mapping.currency >= 0) {
        var cu = cellStr(r[d.mapping.currency]).toUpperCase().replace(/[^A-Z]/g, '');
        if (cu.indexOf('USD') >= 0 || cu.indexOf('$') >= 0) currency = 'USD';
        else if (cu.indexOf('EUR') >= 0) currency = 'EUR';
        else if (cu.indexOf('NGN') >= 0 || cu.indexOf('NAIRA') >= 0) currency = 'NGN';
        else if (CURS.indexOf(cu) >= 0) currency = cu;
      }

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
    var amt = parseFloat(m.amount);
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

  // settings helpers that re-render only the overlay area (full render is fine here)
  function renderSettings() { render(); }

  function saveSettings() {
    var usd = document.getElementById('s-usd'), eur = document.getElementById('s-eur'), tok = document.getElementById('s-token');
    var u = parseFloat(usd && usd.value), e = parseFloat(eur && eur.value);
    var next = { NGN: 1, USD: u > 0 ? u : state.rates.USD, EUR: e > 0 ? e : state.rates.EUR };
    var changed = next.USD !== state.rates.USD || next.EUR !== state.rates.EUR;
    state.rates = next;
    if (tok) state.wiseToken = tok.value.trim();
    if (changed) state.ratesMeta = { updated: new Date().toISOString(), source: 'manual' };
    state.settingsOpen = false; state.ratesMsg = null;
    persist(); render();
  }

  function captureToken() { var tok = document.getElementById('s-token'); if (tok) state.wiseToken = tok.value.trim(); }

  // =========================================================================
  //  EVENT DELEGATION
  // =========================================================================
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');

    switch (act) {
      case 'cur': state.displayCurrency = t.getAttribute('data-cur'); persist(); render(); break;
      case 'year': changeYear(parseInt(t.getAttribute('data-d'), 10)); break;
      case 'hide': state.hidden = !state.hidden; persist(); render(); break;
      case 'openMonth': state.view = 'month'; state.activeMonth = parseInt(t.getAttribute('data-mo'), 10); render(); break;
      case 'back': state.view = 'dashboard'; state.activeMonth = null; render(); break;

      case 'add': openModal(t.getAttribute('data-section'), null); break;
      case 'edit': { var e = findEntry(t.getAttribute('data-section'), t.getAttribute('data-id')); if (e) openModal(t.getAttribute('data-section'), e); break; }
      case 'delDirect': delDirect(t.getAttribute('data-section'), t.getAttribute('data-id')); break;
      case 'saveModal': saveModal(); break;
      case 'deleteEntry': deleteFromModal(); break;
      case 'mCur': snapshotModalInputs(); state.modal.currency = t.getAttribute('data-cur'); render(); break;
      case 'closeModal': if (isBackdrop(ev, t)) { state.modal = null; render(); } break;

      case 'applyRecurring': applyRecurring(state.year, state.activeMonth); break;
      case 'openRecurring': state.recurringOpen = true; render(); break;
      case 'closeRecurring': if (t.tagName === 'BUTTON' || isBackdrop(ev, t)) { state.recurringOpen = false; render(); } break;
      case 'delRecurring': removeRecurring(t.getAttribute('data-id')); break;

      case 'openSettings': state.settingsOpen = true; state.ratesMsg = null; render(); break;
      case 'closeSettings': if (t.tagName === 'BUTTON' || isBackdrop(ev, t)) { state.settingsOpen = false; state.ratesMsg = null; render(); } break;
      case 'saveSettings': saveSettings(); break;
      case 'fetchWise': captureToken(); fetchWiseRates(); break;

      case 'openImport': openImport(); break;
      case 'pickFile': openImport(); break;
      case 'runImport': runImport(); break;
      case 'closeImport': if (t.tagName === 'BUTTON' || isBackdrop(ev, t)) { state.importData = null; render(); } break;
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
    }
  });

  // Mark the category as user-chosen so it isn't overwritten by auto-detection.
  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'm-category' && state.modal) state.modal.categoryTouched = true;
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

  // =========================================================================
  //  BOOT
  // =========================================================================
  render();
  maybeAutoFetchRates();
})();
