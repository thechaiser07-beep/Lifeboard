
(function() {

  // ============================================================
  // STORAGE — localStorage (immediate) + Supabase cloud sync.
  // All finance state is bundled into a single app_state row so
  // every device stays in sync without a per-table schema.
  // ============================================================
  const APP_KEY = 'finance';
  const SYNC_KEYS = ['nw:bank','nw:stocks','nw:crypto','nw:other','nw_activity','nw_history','subs','incoming_orders','wishlist','nw_currency','transactions','budgets','goals'];

  let _supa = null;
  let _syncTimer = null;

  function storeGet(key) {
    try { const raw = localStorage.getItem(key); return raw == null ? null : JSON.parse(raw); }
    catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    if (SYNC_KEYS.includes(key)) _scheduleSync();
  }
  function _syncBadge(state) {
    const el = document.getElementById('cloudSyncDot');
    if (el) el.dataset.state = state;
  }
  function _scheduleSync() {
    if (!_supa) return;
    _syncBadge('syncing');
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_pushToCloud, 900);
  }
  async function _pushToCloud() {
    if (!_supa) return;
    const state = {};
    SYNC_KEYS.forEach(k => { const v = storeGet(k); if (v !== null) state[k] = v; });
    try {
      const res = await fetch(SUPABASE_URL + '/rest/v1/app_state?on_conflict=key', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ key: APP_KEY, data: state })
      });
      _syncBadge(res.ok ? 'ok' : 'err');
    } catch (e) { _syncBadge('err'); }
  }

  // ============================================================
  // ORD_FROM_META — must be hoisted to the top of the IIFE.
  // renderOrders runs as part of the FIRST renderAllNetWorth call
  // (long before the ORDERS section is reached) and will TDZ-crash
  // the whole script if any saved orders trigger the render path
  // and ORD_FROM_META hasn't been initialized yet.
  // ============================================================
  const ORD_FROM_META = {
    bank:   { name: 'Bank',   color: '#7DD3FC' },
    stocks: { name: 'Stocks', color: '#6EE7B7' },
    crypto: { name: 'Crypto', color: '#FBBF24' },
    other:  { name: 'Other',  color: '#B794F4' }
  };

  // ============================================================
  // BOTTOM TABS — switch between Net Worth / Subs / Orders.
  // Active tab persisted in localStorage.
  // ============================================================
  const TAB_KEY = 'finance_active_tab';
  const tabs = document.querySelectorAll('.bot-tab');
  const sections = document.querySelectorAll('.section[data-section]');
  function setActiveTab(name) {
    tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    sections.forEach(s => {
      if (s.dataset.section === name) s.removeAttribute('hidden');
      else s.setAttribute('hidden', '');
    });
    storeSet(TAB_KEY, name);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  tabs.forEach(b => b.addEventListener('click', () => setActiveTab(b.dataset.tab)));
  const VALID_TABS = ['net','subs','incoming','wishlist','overview','budgets','calendar','txn'];
  const savedTab = storeGet(TAB_KEY);
  setActiveTab(savedTab && VALID_TABS.includes(savedTab) ? savedTab : 'net');

  // ============================================================
  // NET WORTH (copied from the main dashboard, verbatim logic)
  // ============================================================
  const CURRENCY_KEY = 'nw_currency';
  const NW_CATS = [
    { key: 'bank',   listId: 'bankList',   totalId: 'bankTotal',   nameId: 'bankName',   amtId: 'bankAmount',   addId: 'bankAddBtn' },
    { key: 'stocks', listId: 'stocksList', totalId: 'stocksTotal', nameId: 'stocksName', amtId: 'stocksAmount', addId: 'stocksAddBtn' },
    { key: 'crypto', listId: 'cryptoList', totalId: 'cryptoTotal', nameId: 'cryptoName', amtId: 'cryptoAmount', addId: 'cryptoAddBtn' },
    { key: 'other',  listId: 'otherList',  totalId: 'otherTotal',  nameId: 'otherName',  amtId: 'otherAmount',  addId: 'otherAddBtn' }
  ];
  const currencyEl = document.getElementById('netWorthCurrency');
  const netWorthTotal = document.getElementById('netWorthTotal');
  const netWorthBreakdown = document.getElementById('netWorthBreakdown');

  let exchangeRates = { CHF: 1, USD: 1, EUR: 1, GBP: 1, AUD: 1 };
  async function loadExchangeRates() {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/CHF');
      const data = await res.json();
      if (data && data.rates) {
        exchangeRates = {
          CHF: 1,
          USD: data.rates.USD || 1,
          EUR: data.rates.EUR || 1,
          GBP: data.rates.GBP || 1,
          AUD: data.rates.AUD || 1
        };
        renderAllNetWorth();
        if (typeof renderSubs === 'function') renderSubs();
      }
    } catch (e) {}
  }
  loadExchangeRates();

  function fmtMoney(amountCHF) {
    const symbol = currencyEl ? currencyEl.value : 'CHF';
    const rate = exchangeRates[symbol] || 1;
    const num = (Number(amountCHF) || 0) * rate;
    return symbol + ' ' + num.toLocaleString('en-US', { minimumFractionDigits: num % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  }

  function renderNetWorthCategory(cat) {
    const items = storeGet('nw:' + cat.key) || [];
    const list = document.getElementById(cat.listId);
    if (!list) return 0;
    list.innerHTML = '';
    let total = 0;
    items.forEach((it, idx) => {
      total += Number(it.amount) || 0;
      const row = document.createElement('div');
      row.className = 'nw-row';
      const name = document.createElement('span');
      name.className = 'nw-name nw-name-edit';
      name.textContent = it.name;
      name.title = 'Tap to rename';
      name.addEventListener('click', () => beginNwNameEdit(name, items, idx, cat.key));
      const amt = document.createElement('span');
      amt.className = 'nw-amt nw-amt-edit';
      amt.textContent = fmtMoney(it.amount);
      amt.title = 'Tap to edit · type +500 to add, -200 to subtract, or a new total';
      amt.addEventListener('click', () => beginNwAmountEdit(amt, items, idx, cat.key));
      const del = document.createElement('button'); del.className = 'nw-del'; del.textContent = '×';
      del.addEventListener('click', () => {
        const removed = items[idx];
        items.splice(idx, 1); storeSet('nw:' + cat.key, items);
        if (removed) logActivity(cat.key, removed.name, -(Number(removed.amount) || 0), 'delete');
        renderAllNetWorth();
      });
      row.appendChild(name); row.appendChild(amt); row.appendChild(del);
      list.appendChild(row);
      // Show reserved amount from wishlist items linked to this account
      const reserved = getReservedCHF(cat.key, it.name);
      if (reserved > 0) {
        const resRow = document.createElement('div');
        resRow.className = 'nw-reserved-row';
        resRow.innerHTML = '<span class="nw-reserved-label">🔒 Reserved</span><span class="nw-reserved-amt">' + fmtMoney(reserved) + '</span>';
        list.appendChild(resRow);
      }
    });
    document.getElementById(cat.totalId).textContent = fmtMoney(total);
    return total;
  }

  function beginNwAmountEdit(amtEl, items, idx, catKey) {
    if (amtEl.querySelector('input')) return;
    const symbol = currencyEl ? currencyEl.value : 'CHF';
    const rate = exchangeRates[symbol] || 1;
    const curCHF = Number(items[idx].amount) || 0;
    const curDisplay = curCHF * rate;
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.value = String(curDisplay.toFixed(curDisplay % 1 === 0 ? 0 : 2));
    input.style.cssText = 'width:110px;padding:4px 8px;font-family:var(--font-mono);font-size:12px;background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);color:var(--text-primary);border-radius:6px;text-align:right;font-variant-numeric:tabular-nums;outline:none;';
    amtEl.textContent = '';
    amtEl.appendChild(input);
    setTimeout(() => { input.focus(); input.select(); }, 0);
    let saved = false;
    function save() {
      if (saved) return; saved = true;
      const v = input.value.trim();
      if (v === '') { renderAllNetWorth(); return; }
      // Input is in the DISPLAY currency. Convert back to CHF before storing.
      let nextDisplay = curDisplay;
      if (/^[+\-]\s*\d/.test(v)) {
        const delta = parseFloat(v.replace(/\s+/g, ''));
        if (!isNaN(delta)) nextDisplay = curDisplay + delta;
      } else {
        const n = parseFloat(v);
        if (!isNaN(n)) nextDisplay = n;
      }
      if (nextDisplay < 0) nextDisplay = 0;
      const nextCHF = nextDisplay / rate;
      const deltaCHF = nextCHF - curCHF;
      items[idx].amount = nextCHF;
      storeSet('nw:' + catKey, items);
      if (Math.abs(deltaCHF) > 0.005) {
        logActivity(catKey, items[idx].name, deltaCHF, 'edit');
      }
      renderAllNetWorth();
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { saved = true; renderAllNetWorth(); }
    });
    input.addEventListener('blur', save);
  }
  function beginNwNameEdit(nameEl, items, idx, catKey) {
    if (nameEl.querySelector('input')) return;
    const cur = String(items[idx].name || '');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = cur;
    input.style.cssText = 'width:100%;padding:4px 8px;font-family:inherit;font-size:13px;background:rgba(0,0,0,0.30);border:1px solid rgba(255,255,255,0.10);color:var(--text-primary);border-radius:6px;outline:none;';
    nameEl.textContent = '';
    nameEl.appendChild(input);
    setTimeout(() => { input.focus(); input.select(); }, 0);
    let saved = false;
    function save() {
      if (saved) return; saved = true;
      const v = input.value.trim();
      if (v) { items[idx].name = v; storeSet('nw:' + catKey, items); }
      renderAllNetWorth();
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { saved = true; renderAllNetWorth(); }
    });
    input.addEventListener('blur', save);
  }

  function renderAllNetWorth() {
    let grand = 0;
    const breakdown = [];
    const sliceTotals = {};
    NW_CATS.forEach(cat => {
      const sub = renderNetWorthCategory(cat);
      grand += sub;
      sliceTotals[cat.key] = sub;
      if (sub > 0) breakdown.push(cat.key + ': ' + fmtMoney(sub));
    });
    if (netWorthTotal) netWorthTotal.textContent = fmtMoney(grand);
    if (netWorthBreakdown) netWorthBreakdown.textContent = breakdown.join('  •  ');
    logNetWorthSnapshot(grand);
    renderNetWorthChart();
    renderAllocationDonut(sliceTotals, grand);
    renderActivity();
    if (typeof renderWishlist         === 'function') renderWishlist();
    if (typeof renderWishlistCombined === 'function') renderWishlistCombined();
    if (typeof renderOrders           === 'function') renderOrders();
    if (typeof updateOrdPreview       === 'function') updateOrdPreview();
  }

  // ============================================================
  // ACTIVITY LOG — every add / edit / delete with delta in CHF.
  // Renders newest first. Cap at 50.
  // ============================================================
  const ACTIVITY_KEY = 'nw:activity';
  const ACTIVITY_MAX = 50;
  function logActivity(catKey, name, deltaCHF, kind) {
    const arr = storeGet(ACTIVITY_KEY) || [];
    arr.push({ ts: Date.now(), cat: catKey, name: String(name || ''), delta: Number(deltaCHF) || 0, kind: kind || 'add' });
    if (arr.length > ACTIVITY_MAX) arr.splice(0, arr.length - ACTIVITY_MAX);
    storeSet(ACTIVITY_KEY, arr);
  }
  function fmtActivityDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (dayStart === today) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    if (dayStart === yesterday) return 'yest';
    const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return mons[d.getMonth()] + ' ' + d.getDate();
  }
  function renderActivity() {
    const list = document.getElementById('nwActivityList');
    const empty = document.getElementById('nwActivityEmpty');
    const count = document.getElementById('nwActivityCount');
    if (!list) return;
    const arr = (storeGet(ACTIVITY_KEY) || []).slice().sort((a, b) => b.ts - a.ts);
    if (!arr.length) {
      list.classList.add('hidden');
      empty.classList.remove('hidden');
      count.textContent = '—';
      return;
    }
    list.classList.remove('hidden');
    empty.classList.add('hidden');
    count.textContent = arr.length + ' event' + (arr.length === 1 ? '' : 's');
    list.innerHTML = arr.slice(0, 30).map(e => {
      const meta = NW_SLICE_META[e.cat] || { name: e.cat, color: '#FFFFFF' };
      const sign = e.delta >= 0 ? '+' : '—';
      const cls = e.delta >= 0 ? 'up' : 'down';
      const amt = fmtMoney(Math.abs(e.delta));
      const kind = e.kind === 'edit' ? 'EDIT' : (e.kind === 'delete' ? 'DELETE' : 'ADD');
      return '<div class="nw-activity-row" style="color:' + meta.color + '">'
        + '<span class="nw-activity-bar" style="background:' + meta.color + '"></span>'
        + '<div class="nw-activity-info">'
        +   '<div class="nw-activity-name">' + escapeHtml(e.name || '(unnamed)') + '</div>'
        +   '<div class="nw-activity-meta">' + meta.name + ' · ' + kind + '</div>'
        + '</div>'
        + '<span class="nw-activity-amt ' + cls + '">' + sign + amt + '</span>'
        + '<span class="nw-activity-date">' + fmtActivityDate(e.ts) + '</span>'
        + '</div>';
    }).join('');
  }

  // ============================================================
  // ALLOCATION DONUT — pie chart of where money lives + annual subs
  // burn (so you can see how much subs are eating vs your assets).
  // Each NW category gets a fixed color; subs get red because outflow.
  // ============================================================
  const NW_SLICE_META = {
    bank:   { name: 'Bank',     color: '#7DD3FC' },
    stocks: { name: 'Stocks',   color: '#6EE7B7' },
    crypto: { name: 'Crypto',   color: '#FBBF24' },
    other:  { name: 'Other',    color: '#B794F4' },
    subs:   { name: 'Subs/yr',  color: '#FF8A8A' }
  };
  function donutArcPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
    const x1o = cx + rOuter * Math.cos(startAngle);
    const y1o = cy + rOuter * Math.sin(startAngle);
    const x2o = cx + rOuter * Math.cos(endAngle);
    const y2o = cy + rOuter * Math.sin(endAngle);
    const x1i = cx + rInner * Math.cos(endAngle);
    const y1i = cy + rInner * Math.sin(endAngle);
    const x2i = cx + rInner * Math.cos(startAngle);
    const y2i = cy + rInner * Math.sin(startAngle);
    const large = (endAngle - startAngle) > Math.PI ? 1 : 0;
    return 'M ' + x1o.toFixed(2) + ' ' + y1o.toFixed(2)
      + ' A ' + rOuter + ' ' + rOuter + ' 0 ' + large + ' 1 ' + x2o.toFixed(2) + ' ' + y2o.toFixed(2)
      + ' L ' + x1i.toFixed(2) + ' ' + y1i.toFixed(2)
      + ' A ' + rInner + ' ' + rInner + ' 0 ' + large + ' 0 ' + x2i.toFixed(2) + ' ' + y2i.toFixed(2)
      + ' Z';
  }
  function renderAllocationDonut(catTotals, grand) {
    const svg    = document.getElementById('nwDonutSvg');
    const total  = document.getElementById('nwDonutTotal');
    const empty  = document.getElementById('nwDonutEmpty');
    const legend = document.getElementById('nwDonutLegend');
    const count  = document.getElementById('nwDonutCount');
    if (!svg || !total || !legend) return;

    // Build one slice per individual NW account, colored by parent category.
    // So "star one" (bank) and "Revolute" (bank) become two blue slices,
    // "vanguard" (stocks) a green slice, etc. — instead of one aggregate
    // "Bank" / "Stocks" slice each.
    const slices = [];
    NW_CATS.forEach(cat => {
      const meta = NW_SLICE_META[cat.key] || { color: '#FFFFFF' };
      const items = storeGet('nw:' + cat.key) || [];
      items.forEach((it, i) => {
        const v = Number(it.amount) || 0;
        if (v > 0) {
          slices.push({
            key: cat.key + '::' + i,
            name: String(it.name || '(unnamed)'),
            color: meta.color,
            value: v
          });
        }
      });
    });
    // Subs annualized — one aggregate slice (no per-sub breakdown here).
    const subItems = storeGet('subs') || [];
    const annualSubsCHF = subItems.reduce((s, it) => s + monthlyEquivalent(it) * 12, 0);
    if (annualSubsCHF > 0) {
      const meta = NW_SLICE_META.subs;
      slices.push({ key: 'subs', name: meta.name, color: meta.color, value: annualSubsCHF });
    }

    const sliceTotal = slices.reduce((s, x) => s + x.value, 0);

    if (!slices.length || sliceTotal <= 0) {
      svg.innerHTML = '<circle cx="70" cy="70" r="60" fill="rgba(255,255,255,0.025)"/>'
                    + '<circle cx="70" cy="70" r="44" fill="#0A0A0B"/>';
      total.textContent = '—';
      empty.classList.remove('hidden');
      legend.innerHTML = '';
      count.textContent = '—';
      return;
    }
    empty.classList.add('hidden');
    total.textContent = fmtMoney(grand).split(' ')[1] || fmtMoney(grand);
    count.textContent = slices.length + ' slice' + (slices.length === 1 ? '' : 's');

    // Sort largest first
    slices.sort((a, b) => b.value - a.value);
    let angle = -Math.PI / 2;
    let html = '';
    slices.forEach(s => {
      const sliceAngle = (s.value / sliceTotal) * Math.PI * 2;
      const pad = slices.length > 1 ? 0.015 : 0;
      const a1 = angle + pad;
      const a2 = angle + sliceAngle - pad;
      if (a2 > a1) {
        html += '<path d="' + donutArcPath(70, 70, 60, 44, a1, a2) + '" fill="' + s.color + '"></path>';
      }
      angle += sliceAngle;
    });
    svg.innerHTML = html;

    legend.innerHTML = slices.map(s => {
      const pct = ((s.value / sliceTotal) * 100).toFixed(1);
      return '<div class="nw-leg" style="color:' + s.color + '">'
        + '<span class="nw-leg-dot" style="background:' + s.color + '"></span>'
        + '<span class="nw-leg-name">' + escapeHtml(s.name) + '</span>'
        + '<span class="nw-leg-pct">' + pct + '%</span>'
        + '</div>';
    }).join('');
  }

  // Net-worth history chart
  const NW_HISTORY_KEY = 'nw:history';
  const NW_HISTORY_MAX = 500;
  function logNetWorthSnapshot(grandCHF) {
    const v = Number(grandCHF) || 0;
    const hist = storeGet(NW_HISTORY_KEY) || [];
    const last = hist[hist.length - 1];
    if (last && Math.abs((last.v || 0) - v) < 0.005) return;
    hist.push({ t: Date.now(), v: v });
    if (hist.length > NW_HISTORY_MAX) hist.splice(0, hist.length - NW_HISTORY_MAX);
    storeSet(NW_HISTORY_KEY, hist);
  }
  function nwSmoothPath(points) {
    if (points.length < 2) return '';
    if (points.length === 2) return 'M' + points[0].x + ',' + points[0].y + ' L' + points[1].x + ',' + points[1].y;
    const d = ['M' + points[0].x + ',' + points[0].y];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d.push('C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + p2.x + ',' + p2.y);
    }
    return d.join(' ');
  }
  function renderNetWorthChart() {
    const wrap = document.getElementById('nwChartWrap');
    const svg = document.getElementById('nwChartSvg');
    const linePath = document.getElementById('nwChartLine');
    const areaPath = document.getElementById('nwChartArea');
    const deltaEl = document.getElementById('nwChartDelta');
    if (!wrap || !svg || !linePath || !areaPath) return;
    const hist = storeGet(NW_HISTORY_KEY) || [];
    if (hist.length < 1) {
      wrap.classList.remove('has-data');
      linePath.setAttribute('d', '');
      areaPath.setAttribute('d', '');
      if (deltaEl) { deltaEl.textContent = '—'; deltaEl.classList.remove('up', 'down'); }
      renderChartStats([]);
      return;
    }
    wrap.classList.add('has-data');
    const first = hist[0].v;
    const last = hist[hist.length - 1].v;
    const change = last - first;
    const direction = Math.abs(change) < 0.005 ? 'flat' : (change > 0 ? 'up' : 'down');
    const color = direction === 'up' ? '#6BE3A4' : direction === 'down' ? '#FF8A8A' : 'var(--text-tertiary)';
    svg.style.color = color;
    if (deltaEl) {
      deltaEl.classList.remove('up', 'down');
      if (direction === 'up')   deltaEl.classList.add('up');
      if (direction === 'down') deltaEl.classList.add('down');
      if (direction === 'flat') {
        deltaEl.textContent = 'Flat';
      } else if (Math.abs(first) < 0.5) {
        // Baseline was effectively zero — % would be infinite. Show the
        // absolute amount instead so "added 1,276" reads clearly.
        const sign = change > 0 ? '+' : '—';
        deltaEl.textContent = sign + fmtMoney(Math.abs(change));
      } else {
        const pct = (change / Math.abs(first)) * 100;
        const sign = change > 0 ? '+' : '—';
        const absPct = Math.abs(pct);
        const pctStr = absPct >= 100 ? absPct.toFixed(0) : absPct >= 10 ? absPct.toFixed(1) : absPct.toFixed(2);
        deltaEl.textContent = sign + pctStr + '%';
      }
    }
    const W = 600, H = 200, pad = 8;
    const vals = hist.map(p => p.v);
    const minV = Math.min.apply(null, vals);
    const maxV = Math.max.apply(null, vals);
    const range = (maxV - minV) || Math.max(1, Math.abs(maxV));
    if (hist.length === 1) {
      const y = H / 2;
      linePath.setAttribute('d', 'M0,' + y + ' L' + W + ',' + y);
      areaPath.setAttribute('d', 'M0,' + y + ' L' + W + ',' + y + ' L' + W + ',' + H + ' L0,' + H + ' Z');
      renderChartStats(hist);
      return;
    }
    const points = hist.map((p, i) => ({
      x: (i / (hist.length - 1)) * W,
      y: H - pad - ((p.v - minV) / range) * (H - pad * 2)
    }));
    const lineD = nwSmoothPath(points);
    linePath.setAttribute('d', lineD);
    const lastPt = points[points.length - 1];
    const firstPt = points[0];
    areaPath.setAttribute('d', lineD + ' L' + lastPt.x + ',' + H + ' L' + firstPt.x + ',' + H + ' Z');
    renderChartStats(hist);
  }

  // Stats overlay — what 1% is worth, all-time high/low, snapshot count.
  // Reads the snapshot history (CHF base) and converts to display currency.
  function renderChartStats(hist) {
    const oneEl   = document.getElementById('nwStat1pct');
    const highEl  = document.getElementById('nwStatHigh');
    const lowEl   = document.getElementById('nwStatLow');
    const countEl = document.getElementById('nwStatCount');
    if (!oneEl) return;
    if (!hist || !hist.length) {
      oneEl.textContent = '—';
      highEl.textContent = '—';
      lowEl.textContent = '—';
      countEl.textContent = '0';
      return;
    }
    const vals = hist.map(p => p.v);
    const last = vals[vals.length - 1];
    const high = Math.max.apply(null, vals);
    const low  = Math.min.apply(null, vals);
    oneEl.textContent   = fmtMoney(last / 100);
    highEl.textContent  = fmtMoney(high);
    lowEl.textContent   = fmtMoney(low);
    countEl.textContent = String(hist.length);
  }

  NW_CATS.forEach(cat => {
    const addBtn = document.getElementById(cat.addId);
    const nameInput = document.getElementById(cat.nameId);
    const amtInput = document.getElementById(cat.amtId);
    if (!addBtn) return;
    function doAdd() {
      const n = nameInput.value.trim();
      const a = parseFloat(amtInput.value);
      if (!n || isNaN(a)) return;
      // Interpret the input in the CURRENTLY SELECTED display currency, then
      // convert to CHF for storage. So if USD is selected and user types 40000,
      // we store 40000 / USD-per-CHF rate — 31,400 CHF; displays as $40,000.
      const symbol = currencyEl ? currencyEl.value : 'CHF';
      const rate = exchangeRates[symbol] || 1;
      const amountCHF = a / rate;
      const items = storeGet('nw:' + cat.key) || [];
      items.push({ name: n, amount: amountCHF });
      storeSet('nw:' + cat.key, items);
      logActivity(cat.key, n, amountCHF, 'add');
      nameInput.value = ''; amtInput.value = '';
      renderAllNetWorth();
    }
    addBtn.addEventListener('click', doAdd);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
    amtInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  });

  if (currencyEl) {
    const savedCur = storeGet(CURRENCY_KEY);
    currencyEl.value = savedCur || 'AUD';
    currencyEl.addEventListener('change', () => {
      storeSet(CURRENCY_KEY, currencyEl.value);
      renderAllNetWorth();
      renderSubs();
    });
  }
  renderAllNetWorth();

  // ============================================================
  // SUBSCRIPTIONS
  // ============================================================
  const subsList = document.getElementById('subsList');
  const subsEmpty = document.getElementById('subsEmpty');
  const subsTotal = document.getElementById('subsTotal');
  const subsYearly = document.getElementById('subsYearly');
  const subsCount = document.getElementById('subsCount');
  const subAddBtn = document.getElementById('subAddBtn');
  const subName = document.getElementById('subName');
  const subAmount = document.getElementById('subAmount');
  const subPeriod = document.getElementById('subPeriod');

  function monthlyEquivalent(item) {
    const a = Number(item.amount) || 0;
    if (item.period === 'yearly')      return a / 12;
    if (item.period === 'weekly')      return a * 4.345;
    if (item.period === 'fortnightly') return a * 26 / 12;
    return a;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function formatRenewal(iso) {
    if (!iso) return '';
    const isoSafe = (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) ? iso + 'T00:00' : iso;
    const d = new Date(isoSafe);
    if (isNaN(d)) return iso;
    const now = new Date();
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((dayStart - todayStart) / (1000 * 60 * 60 * 24));
    const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    let prefix = '';
    if (diffDays < 0) prefix = 'past · ';
    else if (diffDays === 0) prefix = 'today · ';
    else if (diffDays === 1) prefix = 'tomorrow · ';
    else if (diffDays <= 7) prefix = 'in ' + diffDays + 'd · ';
    return prefix + dateLabel;
  }

  function renderSubs() {
    if (!subsList) return;
    // Auto-deduct any matured renewals before painting
    processAutoDeductSubs();
    // Keep the From-account dropdown synced with current NW accounts
    populateSubFromSelect();
    const items = storeGet('subs') || [];
    subsList.innerHTML = '';
    if (!items.length) {
      subsEmpty.style.display = 'flex';
      subsTotal.innerHTML = fmtMoney(0) + ' <span style="font-size:13px;color:var(--text-tertiary);font-weight:500">/ mo</span>';
      subsYearly.textContent = '';
      subsCount.textContent = '';
      return;
    }
    subsEmpty.style.display = 'none';
    let monthly = 0;
    items.forEach((it, idx) => {
      const m = monthlyEquivalent(it);
      monthly += m;
      // Days until next renewal (rolls past dates forward by the period so
      // a "Renews Apr 28 · monthly" sub shows the *next* upcoming renewal).
      let daysToRenew = null;
      let nextDate = null;
      if (it.renewal && typeof nextRenewalDate === 'function') {
        nextDate = nextRenewalDate(it.renewal, it.period);
        if (nextDate) {
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          daysToRenew = Math.round((nextDate.getTime() - today) / 86400000);
        }
      }
      const isUrgent = daysToRenew != null && daysToRenew <= 5;
      const row = document.createElement('div');
      row.className = 'sub-row' + (isUrgent ? ' is-urgent' : '');
      row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;align-items:center;padding:12px 14px;background:rgba(255,255,255,0.025);border-radius:var(--radius-md);margin-bottom:8px;gap:12px;';
      const renewLine = it.renewal
        ? '<div class="sub-renew-line" style="font-size:10px;color:#F2C063;margin-top:3px">↻ Renews ' + formatRenewal(nextDate || it.renewal) + '</div>'
        : '';
      // Linked NW account + auto-deduct toggle pills
      let metaLine = '';
      const pills = [];
      if (it.fromCat && it.fromAccount) {
        pills.push('<span class="sub-from-pill">from · ' + escapeHtml(it.fromAccount) + '</span>');
      }
      pills.push(
        '<button class="sub-row-toggle' + (it.autoDeduct ? ' is-on' : '') + '" data-sub-toggle="' + idx + '" type="button" title="Auto-deduct from the linked account on each renewal">'
        + '<span class="sub-row-toggle-dot"></span>'
        + (it.autoDeduct ? 'Auto-deduct ON' : 'Auto-deduct off')
        + '</button>'
      );
      metaLine = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">' + pills.join('') + '</div>';

      const left = document.createElement('div');
      left.style.cssText = 'min-width:0';
      left.innerHTML = '<div style="font-weight:600;color:var(--text-primary);font-size:14px">' + escapeHtml(it.name) + '</div>' +
        '<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;text-transform:capitalize">' + it.period + '</div>' +
        renewLine +
        metaLine;
      const cost = document.createElement('div');
      cost.style.cssText = 'text-align:right;line-height:1.1';
      const bigNum = fmtMoney(m);
      const origHint = (it.entered_currency && it.entered_currency !== 'CHF' && it.entered_amount != null)
        ? '<div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">billed ' + it.entered_currency + ' ' + Number(it.entered_amount).toLocaleString('en-US', { minimumFractionDigits: it.entered_amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }) + ' / ' + it.period + '</div>'
        : (it.period !== 'monthly'
            ? '<div style="font-size:10px;color:var(--text-tertiary);margin-top:2px">billed ' + fmtMoney(it.amount) + ' / ' + it.period + '</div>'
            : '');
      cost.innerHTML = '<div style="font-size:20px;font-weight:700;color:var(--text-primary);font-variant-numeric:tabular-nums">' + bigNum + '</div>' +
        '<div style="font-size:10px;color:var(--text-tertiary);margin-top:1px">/ month</div>' +
        origHint;
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:center';
      const editBtn = document.createElement('button');
      editBtn.title = 'Edit';
      editBtn.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.10);color:var(--text-tertiary);cursor:pointer;font-size:12px;padding:3px 7px;border-radius:5px;font-family:inherit;line-height:1';
      editBtn.textContent = '✏';
      editBtn.addEventListener('click', () => editSubInline(idx));
      const del = document.createElement('button');
      del.title = 'Delete';
      del.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.10);color:var(--text-tertiary);cursor:pointer;font-size:12px;padding:3px 7px;border-radius:5px;font-family:inherit;line-height:1';
      del.textContent = '×';
      del.addEventListener('click', () => {
        if (!confirm('Delete "' + it.name + '"?')) return;
        items.splice(idx, 1); storeSet('subs', items); renderSubs();
      });
      actions.appendChild(editBtn);
      actions.appendChild(del);
      row.appendChild(left); row.appendChild(cost); row.appendChild(actions);
      subsList.appendChild(row);
    });
    // Wire row-level auto-deduct toggle buttons
    subsList.querySelectorAll('[data-sub-toggle]').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(b.dataset.subToggle, 10);
        const arr = storeGet('subs') || [];
        if (!arr[i]) return;
        if (!arr[i].autoDeduct && (!arr[i].fromCat || !arr[i].fromAccount)) {
          alert('Pick a "From account" first (use the ✏ edit button) so the deduction knows where to take the money from.');
          return;
        }
        arr[i].autoDeduct = !arr[i].autoDeduct;
        storeSet('subs', arr);
        renderSubs();
      });
    });
    subsTotal.innerHTML = fmtMoney(monthly) + ' <span style="font-size:13px;color:var(--text-tertiary);font-weight:500">/ mo</span>';
    subsYearly.textContent = '~' + fmtMoney(monthly * 12) + ' per year';
    subsCount.textContent = items.length + (items.length === 1 ? ' subscription' : ' subscriptions');
    // Re-render the donut so the subs slice updates with the latest annualized total
    if (typeof renderAllNetWorth === 'function') renderAllNetWorth();
  }

  // ============================================================
  // Build/refresh the From-account dropdown in the subs add form,
  // mirroring the same source-of-truth used by the orders form.
  // ============================================================
  function populateSubFromSelect() {
    const sel = document.getElementById('subFromCat');
    if (!sel) return;
    const prev = sel.value;
    const accounts = (typeof listAllNwAccounts === 'function') ? listAllNwAccounts() : [];
    const ICONS = { bank: '🏦', stocks: '📈', crypto: '🪙', other: '💼' };
    if (!accounts.length) {
      sel.innerHTML = '<option value="">No accounts yet</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = accounts.map(a => {
      const value = a.catKey + '::' + a.itemName;
      return '<option value="' + value + '">' + ICONS[a.catKey] + ' ' + escapeHtml(a.itemName) + '</option>';
    }).join('');
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  }

  // ============================================================
  // AUTO-DEDUCT — runs every time subs are rendered. For each sub
  // whose autoDeduct is ON and whose renewal date has arrived (or
  // passed), subtract the bill from the linked NW account, log the
  // activity, and roll the renewal date forward to the next cycle.
  // Idempotent via `lastDeductedAt` so refreshing the page doesn't
  // double-charge.
  // ============================================================
  function processAutoDeductSubs() {
    const items = storeGet('subs') || [];
    if (!items.length) return false;
    const now = new Date();
    const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let changed = false;
    items.forEach(it => {
      if (!it.autoDeduct || !it.renewal || !it.fromCat || !it.fromAccount) return;
      const isoSafe = (typeof it.renewal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(it.renewal)) ? it.renewal + 'T00:00' : it.renewal;
      let renewalDate = new Date(isoSafe);
      if (isNaN(renewalDate)) return;
      let safety = 0;
      while (renewalDate.getTime() <= todayMs && safety++ < 200) {
        const renewalMs = new Date(renewalDate.getFullYear(), renewalDate.getMonth(), renewalDate.getDate()).getTime();
        if (!(it.lastDeductedAt && it.lastDeductedAt >= renewalMs)) {
          const nwItems = storeGet('nw:' + it.fromCat) || [];
          const idx = nwItems.findIndex(x => String(x.name) === String(it.fromAccount));
          if (idx < 0) break;
          const cost = Number(it.amount) || 0;
          nwItems[idx].amount = (Number(nwItems[idx].amount) || 0) - cost;
          storeSet('nw:' + it.fromCat, nwItems);
          logActivity(it.fromCat, nwItems[idx].name, -cost, 'edit');
          it.lastDeductedAt = renewalMs;
          changed = true;
        }
        if (it.period === 'weekly')           renewalDate.setDate(renewalDate.getDate() + 7);
        else if (it.period === 'fortnightly') renewalDate.setDate(renewalDate.getDate() + 14);
        else if (it.period === 'yearly')      renewalDate.setFullYear(renewalDate.getFullYear() + 1);
        else                                  renewalDate.setMonth(renewalDate.getMonth() + 1);
      }
      const newRenewal = renewalDate.getFullYear() + '-' + String(renewalDate.getMonth() + 1).padStart(2, '0') + '-' + String(renewalDate.getDate()).padStart(2, '0');
      if (newRenewal !== it.renewal) {
        it.renewal = newRenewal;
        changed = true;
      }
    });
    if (changed) storeSet('subs', items);
    return changed;
  }

  function editSubInline(idx) {
    const items = storeGet('subs') || [];
    const it = items[idx];
    if (!it) return;
    const rows = subsList.querySelectorAll('.sub-row');
    const row = rows[idx];
    if (!row) return;
    const enteredCcy = it.entered_currency || 'CHF';
    const enteredAmt = it.entered_amount != null ? it.entered_amount : it.amount;
    const periodOpts = ['monthly','fortnightly','yearly','weekly'].map(p =>
      '<option value="' + p + '"' + (p === it.period ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>'
    ).join('');
    const ccyOpts = ['CHF','USD','EUR','GBP','AUD'].map(c =>
      '<option value="' + c + '"' + (c === enteredCcy ? ' selected' : '') + '>' + c + '</option>'
    ).join('');
    // Build From-account options from the live NW accounts
    const accounts = (typeof listAllNwAccounts === 'function') ? listAllNwAccounts() : [];
    const ICONS = { bank: '🏦', stocks: '📈', crypto: '🪙', other: '💼' };
    const currentFrom = (it.fromCat && it.fromAccount) ? (it.fromCat + '::' + it.fromAccount) : '';
    const fromOpts = '<option value="">No account linked</option>' + accounts.map(a => {
      const v = a.catKey + '::' + a.itemName;
      return '<option value="' + v + '"' + (v === currentFrom ? ' selected' : '') + '>' + ICONS[a.catKey] + ' ' + escapeHtml(a.itemName) + '</option>';
    }).join('');
    row.innerHTML = '';
    row.style.gridTemplateColumns = '1fr';
    row.style.padding = '14px';
    const form = document.createElement('div');
    form.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center';
    form.innerHTML =
      '<input type="text" class="se-name" value="' + escapeHtml(it.name) + '" style="flex:1.5;min-width:120px;padding:6px 10px;border:0.5px solid rgba(255,255,255,0.10);border-radius:var(--radius-md);font-size:12px;font-family:inherit;background:var(--bg-card);color:var(--text-primary)" />' +
      '<input type="number" step="0.01" class="se-amt" value="' + Number(enteredAmt).toFixed(2) + '" style="width:90px;padding:6px 10px;border:0.5px solid rgba(255,255,255,0.10);border-radius:var(--radius-md);font-size:12px;font-family:inherit;background:var(--bg-card);color:var(--text-primary)" />' +
      '<select class="se-ccy fin-select" style="padding:7px 28px 7px 11px">' + ccyOpts + '</select>' +
      '<select class="se-per fin-select" style="padding:7px 28px 7px 11px">' + periodOpts + '</select>' +
      '<label class="date-field" style="min-width:140px"><span class="date-emoji" aria-hidden="true">📅</span><input type="date" class="se-ren" value="' + (it.renewal && /^\d{4}-\d{2}-\d{2}/.test(it.renewal) ? it.renewal.slice(0,10) : '') + '" /></label>' +
      '<select class="se-from" style="padding:6px 10px;border:0.5px solid rgba(255,255,255,0.10);border-radius:var(--radius-md);font-size:12px;font-family:inherit;background:var(--bg-card);color:var(--text-primary);min-width:130px">' + fromOpts + '</select>' +
      '<label class="sub-auto-toggle" style="padding:6px 10px"><input type="checkbox" class="se-auto"' + (it.autoDeduct ? ' checked' : '') + ' /><span class="sub-auto-track"><span class="sub-auto-thumb"></span></span><span class="sub-auto-label">Auto-deduct</span></label>' +
      '<button class="se-save quick-add-btn">Save</button>' +
      '<button class="se-cancel" style="background:transparent;border:1px solid rgba(255,255,255,0.10);color:var(--text-tertiary);cursor:pointer;font-size:12px;padding:6px 10px;border-radius:var(--radius-md);font-family:inherit">Cancel</button>';
    row.appendChild(form);
    const save = () => {
      const newName = row.querySelector('.se-name').value.trim();
      const newAmtRaw = parseFloat(row.querySelector('.se-amt').value);
      const newCcy = row.querySelector('.se-ccy').value;
      const newPer = row.querySelector('.se-per').value;
      const newRen = row.querySelector('.se-ren').value || null;
      const newFromVal = row.querySelector('.se-from').value;
      const newAuto = row.querySelector('.se-auto').checked;
      let newFromCat = null, newFromAccount = null;
      if (newFromVal) {
        const ix = newFromVal.indexOf('::');
        if (ix > 0) { newFromCat = newFromVal.slice(0, ix); newFromAccount = newFromVal.slice(ix + 2); }
      }
      if (newAuto && (!newFromCat || !newFromAccount)) {
        alert('Pick a "From account" — auto-deduct needs somewhere to take the money from.');
        return;
      }
      if (!newName || isNaN(newAmtRaw)) return;
      const rate = exchangeRates[newCcy] || 1;
      items[idx] = { ...it, name: newName, amount: newAmtRaw / rate, period: newPer, renewal: newRen, entered_amount: newAmtRaw, entered_currency: newCcy, fromCat: newFromCat, fromAccount: newFromAccount, autoDeduct: newAuto };
      storeSet('subs', items); renderSubs();
    };
    const cancel = () => renderSubs();
    row.querySelector('.se-save').addEventListener('click', save);
    row.querySelector('.se-cancel').addEventListener('click', cancel);
    row.querySelectorAll('input').forEach(i => {
      i.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        else if (e.key === 'Escape') cancel();
      });
    });
    row.querySelector('.se-name').focus();
  }

  function doSubAdd() {
    try {
      const nEl = document.getElementById('subName');
      const aEl = document.getElementById('subAmount');
      const ccEl = document.getElementById('subCurrency');
      const pEl = document.getElementById('subPeriod');
      const rEl = document.getElementById('subRenewal');
      const fEl = document.getElementById('subFromCat');
      const tEl = document.getElementById('subAutoDeduct');
      if (!nEl || !aEl) return;
      const n = (nEl.value || '').trim();
      const aRaw = parseFloat(aEl.value);
      if (!n || isNaN(aRaw)) { nEl.focus(); return; }
      const enteredCcy = ccEl ? ccEl.value : 'CHF';
      const rate = exchangeRates[enteredCcy] || 1;
      const amountCHF = aRaw / rate;
      // Parse "From" selection — value is "catKey::accountName"
      let fromCat = null, fromAccount = null;
      if (fEl && fEl.value) {
        const ix = fEl.value.indexOf('::');
        if (ix > 0) { fromCat = fEl.value.slice(0, ix); fromAccount = fEl.value.slice(ix + 2); }
      }
      const autoDeduct = !!(tEl && tEl.checked);
      // Guard: auto-deduct requires a linked account
      if (autoDeduct && (!fromCat || !fromAccount)) {
        alert('Pick a "From account" first — auto-deduct needs to know where to take the money from.');
        return;
      }
      const items = storeGet('subs') || [];
      items.push({
        name: n, amount: amountCHF,
        period: pEl ? pEl.value : 'monthly',
        renewal: rEl && rEl.value ? rEl.value : null,
        entered_amount: aRaw,
        entered_currency: enteredCcy,
        fromCat: fromCat,
        fromAccount: fromAccount,
        autoDeduct: autoDeduct,
        lastDeductedAt: null
      });
      storeSet('subs', items);
      nEl.value = ''; aEl.value = '';
      if (rEl) rEl.value = '';
      if (tEl) tEl.checked = false;
      renderSubs();
    } catch (e) { console.error('subAdd failed', e); }
  }
  // Add button uses event delegation (see safety-net at the bottom).
  // Enter key on the inputs still triggers add directly.
  if (subName)   subName.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubAdd(); });
  if (subAmount) subAmount.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubAdd(); });
  renderSubs();

  // ============================================================
  // WISHLIST — items with % of net worth.
  // Each item is { name, amountCHF, ts, ccy }. Stored in 'wishlist'.
  // Colors: <5% green, 5-25% amber, >25% red.
  // ============================================================
  // NOTE: don't use consts here — renderWishlist gets called from inside
  // renderAllNetWorth which runs BEFORE this section's code (temporal dead
  // zone). All DOM lookups happen inside the function body instead.
  function nwGrandCHF() {
    let g = 0;
    NW_CATS.forEach(cat => {
      const items = storeGet('nw:' + cat.key) || [];
      items.forEach(it => { g += Number(it.amount) || 0; });
    });
    return g;
  }
  function pctClass(pct) {
    if (pct < 5)  return 'good';
    if (pct < 25) return 'warn';
    return 'bad';
  }
  function renderWishlist() {
    const wishList    = document.getElementById('wishList');
    const wishEmpty   = document.getElementById('wishEmpty');
    const wishTotalEl = document.getElementById('wishTotal');
    const wishPctEl   = document.getElementById('wishPctOfNw');
    const wishCountEl = document.getElementById('wishCount');
    const heroPctEl   = document.getElementById('wishPctOfNwHero');
    const heroFill    = document.getElementById('wishHeroFill');
    if (!wishList) { if (typeof renderWishlistCombined === 'function') renderWishlistCombined(); return; }
    const items = storeGet('wishlist') || [];
    const grand = nwGrandCHF();
    let total = 0;
    items.forEach(it => { total += Number(it.amount) || 0; });

    // Hero: total + huge % + color-coded
    if (wishTotalEl) wishTotalEl.textContent = fmtMoney(total);
    if (grand > 0) {
      const pct = (total / grand) * 100;
      const cls = pctClass(pct);
      if (heroPctEl) {
        heroPctEl.textContent = pct.toFixed(2) + '%';
        heroPctEl.className = 'wish-hero-pct-num' + (cls === 'good' ? '' : (cls === 'warn' ? ' warn' : ' bad'));
      }
      if (heroFill) heroFill.style.width = Math.min(100, pct) + '%';
      if (wishPctEl) wishPctEl.textContent = 'Your wishlist is ' + pct.toFixed(2) + '% of your ' + fmtMoney(grand) + ' net worth';
    } else {
      if (heroPctEl) { heroPctEl.textContent = '—'; heroPctEl.className = 'wish-hero-pct-num'; }
      if (heroFill) heroFill.style.width = '0%';
      if (wishPctEl) wishPctEl.textContent = 'Add accounts in Net Worth first to see this as a %';
    }
    if (wishCountEl) wishCountEl.textContent = items.length + (items.length === 1 ? ' item' : ' items');

    wishList.innerHTML = '';
    if (!items.length) { if (wishEmpty) wishEmpty.classList.remove('hidden'); return; }
    if (wishEmpty) wishEmpty.classList.add('hidden');

    // Sort largest first so the biggest dreams sit at the top
    items.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)).forEach((it) => {
      const idx = items.indexOf(it);
      const cost = Number(it.amount) || 0;
      const pct = grand > 0 ? (cost / grand) * 100 : null;
      const cls = pct == null ? 'flat' : pctClass(pct);
      const pctText = pct == null ? '—' : pct.toFixed(2) + '%';
      const fillPct = Math.min(100, pct == null ? 0 : pct);
      const monthsToSave = (grand > 0 && cost > 0) ? Math.ceil(cost / Math.max(1, grand * 0.05)) : null; // rough: if you saved 5%/mo
      const row = document.createElement('div');
      row.className = 'wish-row';
      row.innerHTML =
          '<div class="wish-row-h">'
        + '<div class="wish-row-info">'
        +   '<div class="wish-row-name">' + escapeHtml(it.name) + '</div>'
        +   '<div class="wish-row-meta">' + (it.entered_currency || 'CHF') + ' ' + Number(it.entered_amount != null ? it.entered_amount : it.amount).toLocaleString('en-US', {maximumFractionDigits: 2}) + ' · added ' + fmtActivityDate(it.ts || Date.now()) + '</div>'
        + '</div>'
        + '<div class="wish-row-amt-wrap">'
        +   '<div class="wish-row-amt">' + fmtMoney(cost) + '</div>'
        +   '<div class="wish-row-pct ' + cls + '">' + pctText + ' of NW</div>'
        + '</div>'
        + '<button class="wish-row-x" data-i="' + idx + '" aria-label="Remove">×</button>'
        + '</div>'
        + '<div class="wish-row-bar"><div class="wish-row-bar-fill ' + cls + '" style="width:' + fillPct + '%"></div></div>';
      wishList.appendChild(row);
    });
    wishList.querySelectorAll('.wish-row-x').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.i, 10);
        const arr = storeGet('wishlist') || [];
        arr.splice(i, 1);
        storeSet('wishlist', arr);
        renderWishlist();
      });
    });
  }
  function doWishAdd() {
    try {
      const nEl = document.getElementById('wishName');
      const aEl = document.getElementById('wishAmount');
      const cEl = document.getElementById('wishCurrency');
      if (!nEl || !aEl) return;
      const n = (nEl.value || '').trim();
      const aRaw = parseFloat(aEl.value);
      if (!n || isNaN(aRaw)) { nEl.focus(); return; }
      const enteredCcy = cEl ? cEl.value : 'CHF';
      const rate = exchangeRates[enteredCcy] || 1;
      const amountCHF = aRaw / rate;
      const arr = storeGet('wishlist') || [];
      arr.push({
        name: n, amount: amountCHF, ts: Date.now(),
        entered_amount: aRaw, entered_currency: enteredCcy
      });
      storeSet('wishlist', arr);
      nEl.value = ''; aEl.value = '';
      renderWishlist();
    } catch (e) { console.error('wishAdd failed', e); }
  }
  // Old wish inputs removed from DOM — no wiring needed. Combined page below.
  renderWishlist();

  // ============================================================
  // WISHLIST COMBINED — unified wishes + goals
  // ============================================================
  function getReservedCHF(catKey, itemName) {
    const items = storeGet('wishlist') || [];
    return items
      .filter(w => w.linkedCat === catKey && w.linkedAccount === itemName && !w.boughtAt)
      .reduce((s, w) => s + (Number(w.amount) || 0), 0);
  }

  function populateWlFromSelect() {
    const sel = document.getElementById('wlFromAcct');
    if (!sel) return;
    const accounts = (typeof listAllNwAccounts === 'function') ? listAllNwAccounts() : [];
    const ICONS = { bank: '🏦', stocks: '📈', crypto: '🪙', other: '💼' };
    const prev = sel.value;
    sel.innerHTML = '<option value="">No account linked</option>'
      + accounts.map(a => {
          const v = a.catKey + '::' + a.itemName;
          return '<option value="' + v + '">' + ICONS[a.catKey] + ' ' + escapeHtml(a.itemName) + '</option>';
        }).join('');
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  }

  function renderWishlistCombined() {
    populateWlFromSelect();
    const wlList    = document.getElementById('wlList');
    const wlEmpty   = document.getElementById('wlEmpty');
    const wlTotalEl = document.getElementById('wlTotal');
    const wlPctFoot = document.getElementById('wlPctFoot');
    const wlCountEl = document.getElementById('wlCount');
    const heroPctEl = document.getElementById('wlPctHero');
    const heroFill  = document.getElementById('wlHeroFill');
    if (!wlList) return;

    const wishItems = (storeGet('wishlist') || []).filter(w => !w.boughtAt);
    const goalItems = storeGet('goals') || [];
    const grand = nwGrandCHF();
    let totalCHF = 0;
    wishItems.forEach(w => { totalCHF += Number(w.amount) || 0; });
    goalItems.forEach(g => { totalCHF += Number(g.target) || 0; });

    if (wlTotalEl) wlTotalEl.textContent = fmtMoney(totalCHF);
    if (grand > 0) {
      const pct = (totalCHF / grand) * 100;
      const cls = pctClass(pct);
      if (heroPctEl) {
        heroPctEl.textContent = pct.toFixed(2) + '%';
        heroPctEl.className = 'wish-hero-pct-num' + (cls === 'good' ? '' : (cls === 'warn' ? ' warn' : ' bad'));
      }
      if (heroFill) heroFill.style.width = Math.min(100, pct) + '%';
      if (wlPctFoot) wlPctFoot.textContent = 'Your wishlist is ' + pct.toFixed(2) + '% of your ' + fmtMoney(grand) + ' net worth';
    } else {
      if (heroPctEl) { heroPctEl.textContent = '—'; heroPctEl.className = 'wish-hero-pct-num'; }
      if (heroFill) heroFill.style.width = '0%';
      if (wlPctFoot) wlPctFoot.textContent = 'Add accounts in Net Worth first to see this as a %';
    }
    const totalCount = wishItems.length + goalItems.length;
    if (wlCountEl) wlCountEl.textContent = totalCount + (totalCount === 1 ? ' item' : ' items');

    wlList.innerHTML = '';
    if (!totalCount) { if (wlEmpty) wlEmpty.classList.remove('hidden'); return; }
    if (wlEmpty) wlEmpty.classList.add('hidden');

    const allWish = storeGet('wishlist') || [];

    // --- Wishlist items ---
    wishItems.slice().sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1; if (b.deadline) return 1;
      return (b.amount || 0) - (a.amount || 0);
    }).forEach(it => {
      const realIdx = allWish.findIndex(w =>
        (w.id && w.id === it.id) || (!w.id && w.ts === it.ts && w.name === it.name));
      const cost = Number(it.amount) || 0;
      const pct  = grand > 0 ? (cost / grand) * 100 : null;
      const cls  = pct == null ? 'flat' : pctClass(pct);
      const pctText = pct == null ? '—' : pct.toFixed(2) + '%';

      let linkedHtml = '', buyHtml = '';
      if (it.linkedCat && it.linkedAccount) {
        const ICONS2 = { bank: '🏦', stocks: '📈', crypto: '🪙', other: '💼' };
        const acctItems = storeGet('nw:' + it.linkedCat) || [];
        const acct = acctItems.find(a => String(a.name) === String(it.linkedAccount));
        const acctBal = acct ? Number(acct.amount) : 0;
        const hasEnough = acctBal >= cost - 0.005;
        linkedHtml = '<div class="wl-linked">'
          + (ICONS2[it.linkedCat] || '💰') + ' ' + escapeHtml(it.linkedAccount)
          + ' <span class="wl-reserved-pill">reserved</span></div>';
        buyHtml = '<button class="wl-buy-btn' + (hasEnough ? '' : ' insufficient') + '" data-wl-idx="' + realIdx + '" type="button">'
          + (hasEnough ? '✓ Buy — ' + fmtMoney(acctBal) + ' available'
                       : '⚠ Need ' + fmtMoney(Math.abs(cost - acctBal)) + ' more')
          + '</button>';
      }

      let deadlineHtml = '';
      if (it.deadline) {
        const dl = new Date(it.deadline + 'T00:00');
        const daysLeft = Math.ceil((dl - new Date()) / 86400000);
        deadlineHtml = '<div class="wl-deadline' + (daysLeft < 0 ? ' overdue' : daysLeft <= 7 ? ' soon' : '') + '">📅 '
          + (daysLeft < 0 ? 'Overdue' : daysLeft === 0 ? 'Due today'
             : daysLeft + 'd left · ' + dl.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
          + '</div>';
      }

      const card = document.createElement('div');
      card.className = 'wl-card';
      card.innerHTML = ''
        + '<div class="wl-card-h">'
        +   '<div class="wl-card-name">' + escapeHtml(it.name) + '</div>'
        +   '<div class="wl-card-amt-wrap">'
        +     '<div class="wl-card-amt">' + fmtMoney(cost) + '</div>'
        +     '<div class="wl-card-pct ' + cls + '">' + pctText + ' of NW</div>'
        +   '</div>'
        +   '<button class="wl-del" data-wl-idx="' + realIdx + '" aria-label="Remove">×</button>'
        + '</div>'
        + ((linkedHtml || deadlineHtml) ? '<div class="wl-card-meta">' + linkedHtml + deadlineHtml + '</div>' : '')
        + '<div class="wl-card-bar"><div class="wl-card-bar-fill ' + cls + '" style="width:' + Math.min(100, pct || 0) + '%"></div></div>'
        + (buyHtml ? '<div class="wl-card-foot">' + buyHtml + '</div>' : '');
      wlList.appendChild(card);
    });

    // --- Goals ---
    if (goalItems.length) {
      const div = document.createElement('div');
      div.className = 'wl-section-divider';
      div.textContent = 'SAVINGS GOALS';
      wlList.appendChild(div);
      goalItems.forEach((g, idx) => {
        const saved  = Number(g.saved)  || 0;
        const target = Number(g.target) || 0;
        const pct    = target > 0 ? Math.min(100, Math.round(saved / target * 100)) : 0;
        const done   = pct >= 100;
        const color  = done ? '#6BE3A4' : pct >= 60 ? '#9D4EDD' : pct >= 30 ? '#4CC9F0' : '#F2C063';
        let dlHtml = '';
        if (g.deadline) {
          const dl = new Date(g.deadline + 'T00:00');
          const dLeft = Math.ceil((dl - new Date()) / 86400000);
          dlHtml = '<div class="wl-deadline' + (dLeft < 0 ? ' overdue' : '') + '">📅 '
            + (dLeft < 0 ? 'Overdue' : dLeft === 0 ? 'Due today' : dLeft + 'd left') + '</div>';
        }
        const card = document.createElement('div');
        card.className = 'wl-card wl-goal-card';
        card.innerHTML = ''
          + '<div class="wl-card-h">'
          +   '<div class="wl-card-name">' + escapeHtml(g.name) + '</div>'
          +   '<div class="wl-card-amt-wrap">'
          +     '<div class="wl-card-amt">' + fmtMoney(saved) + '<span class="wl-goal-of"> / ' + fmtMoney(target) + '</span></div>'
          +     '<div class="wl-card-pct" style="color:' + color + '">' + pct + '%</div>'
          +   '</div>'
          +   '<button class="wl-del-goal" data-goal-idx="' + idx + '" aria-label="Remove">×</button>'
          + '</div>'
          + (dlHtml ? '<div class="wl-card-meta">' + dlHtml + '</div>' : '')
          + '<div class="wl-card-bar"><div class="wl-card-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
          + '<div class="wl-card-foot">'
          +   (done ? '<span class="wl-done-badge">Goal reached!</span>' : '')
          +   '<button class="wl-goal-contribute" data-goal-idx="' + idx + '" type="button">+ Add money</button>'
          +   '<button class="wl-goal-edit" data-goal-idx="' + idx + '" type="button">✏ Edit</button>'
          + '</div>';
        wlList.appendChild(card);
      });
    }

    // Wire wishlist delete
    wlList.querySelectorAll('.wl-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.wlIdx);
        const arr = storeGet('wishlist') || [];
        if (i < 0 || !arr[i]) return;
        if (!confirm('Remove "' + arr[i].name + '"?')) return;
        arr.splice(i, 1); storeSet('wishlist', arr);
        renderWishlistCombined();
      });
    });

    // Wire buy
    wlList.querySelectorAll('.wl-buy-btn:not(.insufficient)').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.wlIdx);
        const arr = storeGet('wishlist') || [];
        const it = arr[i];
        if (!it || !it.linkedCat || !it.linkedAccount) return;
        if (!confirm('Buy "' + it.name + '" for ' + fmtMoney(it.amount) + '?\nDeducts from: ' + it.linkedAccount)) return;
        const acctItems = storeGet('nw:' + it.linkedCat) || [];
        const aIdx = acctItems.findIndex(a => String(a.name) === String(it.linkedAccount));
        if (aIdx < 0) { alert('Linked account not found.'); return; }
        const cost = Number(it.amount) || 0;
        acctItems[aIdx].amount = (Number(acctItems[aIdx].amount) || 0) - cost;
        storeSet('nw:' + it.linkedCat, acctItems);
        logActivity(it.linkedCat, acctItems[aIdx].name + ' · bought ' + it.name, -cost, 'edit');
        arr[i] = { ...it, boughtAt: Date.now() };
        storeSet('wishlist', arr);
        renderAllNetWorth();
        renderWishlistCombined();
      });
    });

    // Wire goal delete
    wlList.querySelectorAll('.wl-del-goal').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.goalIdx);
        const arr = storeGet('goals') || [];
        if (!confirm('Delete goal "' + (arr[i] || {}).name + '"?')) return;
        arr.splice(i, 1); storeSet('goals', arr);
        renderWishlistCombined();
      });
    });

    // Wire goal contribute + edit (reuse existing modal functions)
    wlList.querySelectorAll('.wl-goal-contribute').forEach(btn => {
      btn.addEventListener('click', () => openContributeModal(parseInt(btn.dataset.goalIdx)));
    });
    wlList.querySelectorAll('.wl-goal-edit').forEach(btn => {
      btn.addEventListener('click', () => openGoalEditModal(parseInt(btn.dataset.goalIdx)));
    });
  }

  function doWlAdd() {
    try {
      const nEl = document.getElementById('wlName');
      const aEl = document.getElementById('wlAmount');
      const cEl = document.getElementById('wlCurrency');
      const fEl = document.getElementById('wlFromAcct');
      const dEl = document.getElementById('wlDeadline');
      if (!nEl || !aEl) return;
      const n = (nEl.value || '').trim();
      const aRaw = parseFloat(aEl.value);
      if (!n || isNaN(aRaw)) { nEl.focus(); return; }
      const ccy = cEl ? cEl.value : 'AUD';
      const rate = exchangeRates[ccy] || 1;
      const amountCHF = aRaw / rate;
      let linkedCat = null, linkedAccount = null;
      if (fEl && fEl.value) {
        const ix = fEl.value.indexOf('::');
        if (ix > 0) { linkedCat = fEl.value.slice(0, ix); linkedAccount = fEl.value.slice(ix + 2); }
      }
      const arr = storeGet('wishlist') || [];
      arr.push({
        id: 'wl_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
        name: n, amount: amountCHF, entered_amount: aRaw, entered_currency: ccy,
        linkedCat, linkedAccount,
        deadline: (dEl && dEl.value) ? dEl.value : null,
        ts: Date.now(), boughtAt: null
      });
      storeSet('wishlist', arr);
      nEl.value = ''; aEl.value = '';
      if (dEl) dEl.value = '';
      if (fEl) fEl.value = '';
      renderAllNetWorth();
      renderWishlistCombined();
    } catch (e) { console.error('wlAdd failed', e); }
  }
  window.__addWl = doWlAdd;
  const _wlName   = document.getElementById('wlName');
  const _wlAmount = document.getElementById('wlAmount');
  if (_wlName)   _wlName.addEventListener('keydown',   e => { if (e.key === 'Enter') doWlAdd(); });
  if (_wlAmount) _wlAmount.addEventListener('keydown', e => { if (e.key === 'Enter') doWlAdd(); });
  const _wlAddBtn = document.getElementById('wlAddBtn');
  if (_wlAddBtn) _wlAddBtn.addEventListener('click', doWlAdd);
  renderWishlistCombined();

  // ============================================================
  // TRANSACTIONS — log outflows, optionally deduct from net worth
  // Each item: { id, name, amount (CHF), entered_amount, entered_currency,
  //              category, date (YYYY-MM-DD), ts, deductedAt, deductedFrom }
  // ============================================================
  const TXN_CATS = {
    food:      { label: 'Food & Drink',  emoji: '🍔', color: '#F97316' },
    transport: { label: 'Transport',     emoji: '🚗', color: '#7DD3FC' },
    shopping:  { label: 'Shopping',      emoji: '🛍️', color: '#B794F4' },
    entertain: { label: 'Entertainment', emoji: '🎬', color: '#FBBF24' },
    health:    { label: 'Health',        emoji: '🏥', color: '#6EE7B7' },
    housing:   { label: 'Housing',       emoji: '🏠', color: '#94A3B8' },
    utilities: { label: 'Utilities',     emoji: '💡', color: '#F2C063' },
    other:     { label: 'Other',         emoji: '📦', color: '#76746E' }
  };

  function renderTransactions() {
    const list  = document.getElementById('txnList');
    const empty = document.getElementById('txnEmpty');
    if (!list) return;

    const items = storeGet('transactions') || [];
    const now = new Date();
    const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const thisYear  = String(now.getFullYear());

    // Compute summary stats
    let monthTotal = 0, ytdTotal = 0, allTotal = 0;
    const monthCats = {};
    items.forEach(tx => {
      const v = Number(tx.amount) || 0;
      const txDate = tx.date || '';
      allTotal += v;
      if (txDate.startsWith(thisYear))  ytdTotal  += v;
      if (txDate.startsWith(thisMonth)) {
        monthTotal += v;
        const ck = tx.category || 'other';
        monthCats[ck] = (monthCats[ck] || 0) + v;
      }
    });

    const heroAmt      = document.getElementById('txnHeroAmt');
    const heroMonth    = document.getElementById('txnHeroMonth');
    const txnYtdEl     = document.getElementById('txnYtd');
    const txnMthCount  = document.getElementById('txnMonthCount');
    const txnTopCatEl  = document.getElementById('txnTopCat');
    const txnAllTimeEl = document.getElementById('txnAllTime');

    // Re-compute with income/expense distinction
    let monthIncome = 0, monthExpense = 0, ytdIncome = 0, ytdExpense = 0;
    items.forEach(tx => {
      const v = Number(tx.amount) || 0;
      const txDate = tx.date || '';
      const isInc = (tx.type === 'income');
      if (txDate.startsWith(thisYear))  { isInc ? ytdIncome += v : ytdExpense += v; }
      if (txDate.startsWith(thisMonth)) { isInc ? monthIncome += v : monthExpense += v; }
    });
    monthTotal = monthExpense;
    ytdTotal   = ytdExpense;
    allTotal   = items.filter(tx => tx.type !== 'income').reduce((s, tx) => s + (Number(tx.amount) || 0), 0);

    if (heroMonth)    heroMonth.textContent    = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
    if (heroAmt)      heroAmt.textContent      = fmtMoney(monthExpense);
    if (txnYtdEl)     txnYtdEl.textContent     = fmtMoney(ytdExpense);
    const mthItems = items.filter(tx => (tx.date || '').startsWith(thisMonth));
    if (txnMthCount)  txnMthCount.textContent  = mthItems.length + (mthItems.length === 1 ? ' txn' : ' txns');
    if (txnTopCatEl) {
      const topKey = Object.entries(monthCats).sort((a, b) => b[1] - a[1])[0];
      const topMeta = topKey ? TXN_CATS[topKey[0]] : null;
      txnTopCatEl.textContent = topMeta ? topMeta.emoji + ' ' + topMeta.label : '—';
    }
    if (txnAllTimeEl) txnAllTimeEl.textContent = fmtMoney(allTotal);

    list.innerHTML = '';
    if (!items.length) { if (empty) empty.classList.remove('hidden'); return; }
    if (empty) empty.classList.add('hidden');

    // Group by month key YYYY-MM, sorted newest first
    const groups = {};
    items.forEach(tx => {
      const mk = (tx.date || '').slice(0, 7) || 'undated';
      if (!groups[mk]) groups[mk] = { items: [], total: 0 };
      groups[mk].items.push(tx);
      groups[mk].total += Number(tx.amount) || 0;
    });
    Object.keys(groups).sort((a, b) => b.localeCompare(a)).forEach(mk => {
      const g = groups[mk];
      let monthLabel = 'UNDATED';
      if (mk !== 'undated') {
        const [y, m] = mk.split('-');
        monthLabel = new Date(parseInt(y), parseInt(m) - 1, 1)
          .toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
      }
      const header = document.createElement('div');
      header.className = 'txn-month-header';
      header.innerHTML =
          '<span class="txn-month-label">' + monthLabel + '</span>'
        + '<span class="txn-month-total">−' + fmtMoney(g.total) + '</span>';
      list.appendChild(header);

      // Newest first within the group
      g.items.slice().sort((a, b) => {
        const da = a.date || '', db = b.date || '';
        if (da !== db) return db.localeCompare(da);
        return (b.ts || 0) - (a.ts || 0);
      }).forEach(tx => {
        const catMeta  = TXN_CATS[tx.category] || TXN_CATS.other;
        const isIncome = (tx.type === 'income');
        const isDeducted = !!tx.deductedAt && !isIncome;
        const dateStr = tx.date
          ? new Date(tx.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          : '';

        const footHtml = isIncome
          ? ''
          : isDeducted
          ? '<div class="txn-card-foot">'
            + '<span class="txn-deducted-pill">Deducted from ' + escapeHtml(tx.deductedFrom && tx.deductedFrom.name ? tx.deductedFrom.name : 'account') + '</span>'
            + '<button class="txn-deduct-undo" data-undo-id="' + tx.id + '">Undo</button>'
            + '</div>'
          : '<div class="txn-card-foot">'
            + '<button class="txn-deduct-btn" data-deduct-id="' + tx.id + '">− Deduct from net worth</button>'
            + '</div>';

        const row = document.createElement('div');
        row.className = 'txn-card' + (isIncome ? ' is-income' : '');
        row.style.borderLeftColor = isIncome ? '#6BE3A4' : catMeta.color;
        row.innerHTML =
            '<div class="txn-card-h">'
          +   '<div class="txn-card-name">' + escapeHtml(tx.name) + '</div>'
          +   '<div class="txn-card-amt">' + fmtMoney(tx.amount) + '</div>'
          +   '<button class="txn-card-x" data-id="' + tx.id + '" aria-label="Remove">×</button>'
          + '</div>'
          + '<div class="txn-card-meta">'
          +   '<span class="txn-cat-pill" style="background:' + catMeta.color + '22;color:' + catMeta.color + '">' + catMeta.emoji + ' ' + catMeta.label + '</span>'
          +   (dateStr ? '<span class="txn-date-pill">' + dateStr + '</span>' : '')
          +   (isDeducted && tx.deductedFrom ? '<span class="txn-from-pill">from · ' + escapeHtml(tx.deductedFrom.name) + '</span>' : '')
          + '</div>'
          + footHtml;
        list.appendChild(row);
      });
    });

    list.querySelectorAll('.txn-card-x').forEach(b => {
      b.addEventListener('click', () => {
        const arr = (storeGet('transactions') || []).filter(x => x.id !== b.dataset.id);
        storeSet('transactions', arr);
        renderTransactions();
      });
    });
    list.querySelectorAll('.txn-deduct-btn').forEach(b => {
      b.addEventListener('click', () => openTxnDeductChooser(b.dataset.deductId, b.closest('.txn-card')));
    });
    list.querySelectorAll('.txn-deduct-undo').forEach(b => {
      b.addEventListener('click', () => undoTxnDeduct(b.dataset.undoId));
    });
  }

  function openTxnDeductChooser(txnId, cardEl) {
    if (!cardEl) return;
    const existing = cardEl.querySelector('.ord-deduct-chooser');
    if (existing) { existing.remove(); return; }
    const tx = (storeGet('transactions') || []).find(x => x.id === txnId);
    if (!tx) return;
    const accounts = listAllNwAccounts();
    if (!accounts.length) { alert('Add at least one net worth account before deducting.'); return; }
    const ICONS = { bank: '🏦', stocks: '📈', crypto: '🪙', other: '💼' };
    const cost = Number(tx.amount) || 0;
    const optsHtml = accounts.map(a => {
      const insuf = a.amountCHF < cost - 0.005;
      return '<button class="ord-deduct-opt' + (insuf ? ' insufficient' : '') + '" '
        + 'data-cat="' + a.catKey + '" data-name="' + escapeHtml(a.itemName) + '"'
        + (insuf ? ' data-insuf="1"' : '') + '>'
        + ICONS[a.catKey] + ' ' + escapeHtml(a.itemName)
        + '<small>' + fmtMoney(a.amountCHF) + (insuf ? ' · not enough' : ' available') + '</small>'
        + '</button>';
    }).join('');
    const chooser = document.createElement('div');
    chooser.className = 'ord-deduct-chooser';
    chooser.innerHTML =
        '<div class="ord-deduct-chooser-title">Deduct ' + fmtMoney(cost) + ' from…</div>'
      + '<div class="ord-deduct-options">' + optsHtml + '</div>'
      + '<button class="ord-deduct-cancel" type="button">cancel</button>';
    cardEl.appendChild(chooser);
    chooser.querySelectorAll('.ord-deduct-opt').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.insuf === '1' && !confirm('That account doesn\'t have enough — deduct anyway?')) return;
        confirmTxnDeduct(txnId, b.dataset.cat, b.dataset.name);
      });
    });
    chooser.querySelector('.ord-deduct-cancel').addEventListener('click', () => chooser.remove());
  }

  function confirmTxnDeduct(txnId, catKey, itemName) {
    const txns = storeGet('transactions') || [];
    const tIdx = txns.findIndex(x => x.id === txnId);
    if (tIdx < 0) return;
    const tx = txns[tIdx];
    if (tx.deductedAt) return;
    const nwItems = storeGet('nw:' + catKey) || [];
    const itemIdx = nwItems.findIndex(it => String(it.name) === String(itemName));
    if (itemIdx < 0) { alert('That account no longer exists.'); return; }
    const cost = Number(tx.amount) || 0;
    nwItems[itemIdx].amount = (Number(nwItems[itemIdx].amount) || 0) - cost;
    storeSet('nw:' + catKey, nwItems);
    logActivity(catKey, nwItems[itemIdx].name, -cost, 'edit');
    txns[tIdx] = { ...tx, deductedAt: Date.now(), deductedFrom: { cat: catKey, name: nwItems[itemIdx].name } };
    storeSet('transactions', txns);
    renderAllNetWorth();
    renderTransactions();
  }

  function undoTxnDeduct(txnId) {
    const txns = storeGet('transactions') || [];
    const tIdx = txns.findIndex(x => x.id === txnId);
    if (tIdx < 0) return;
    const tx = txns[tIdx];
    if (!tx.deductedAt || !tx.deductedFrom) return;
    const cost = Number(tx.amount) || 0;
    const nwItems = storeGet('nw:' + tx.deductedFrom.cat) || [];
    const itemIdx = nwItems.findIndex(it => String(it.name) === String(tx.deductedFrom.name));
    if (itemIdx >= 0) {
      nwItems[itemIdx].amount = (Number(nwItems[itemIdx].amount) || 0) + cost;
      storeSet('nw:' + tx.deductedFrom.cat, nwItems);
      logActivity(tx.deductedFrom.cat, nwItems[itemIdx].name, cost, 'edit');
    }
    txns[tIdx] = { ...tx, deductedAt: null, deductedFrom: null };
    storeSet('transactions', txns);
    renderAllNetWorth();
    renderTransactions();
  }

  function doTxnAdd() {
    try {
      const nEl   = document.getElementById('txnName');
      const aEl   = document.getElementById('txnAmt');
      const cEl   = document.getElementById('txnCcy');
      const catEl = document.getElementById('txnCat');
      const dEl   = document.getElementById('txnDate');
      if (!nEl || !aEl) return;
      const n    = (nEl.value || '').trim();
      const aRaw = parseFloat(aEl.value);
      if (!n || isNaN(aRaw) || aRaw <= 0) { nEl.focus(); return; }
      const ccy  = cEl ? cEl.value : 'CHF';
      const rate = exchangeRates[ccy] || 1;
      const today = new Date();
      const todayIso = today.getFullYear() + '-'
        + String(today.getMonth() + 1).padStart(2, '0') + '-'
        + String(today.getDate()).padStart(2, '0');
      const txns = storeGet('transactions') || [];
      const txnType = (typeof _currentTxnType === 'string') ? _currentTxnType : 'expense';
      txns.push({
        id: 'tx_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
        name: n,
        amount: aRaw / rate,
        entered_amount: aRaw,
        entered_currency: ccy,
        category: catEl ? catEl.value : 'other',
        type: txnType,
        date: (dEl && dEl.value) ? dEl.value : todayIso,
        ts: Date.now(),
        deductedAt: null,
        deductedFrom: null
      });
      storeSet('transactions', txns);
      nEl.value = ''; aEl.value = '';
      renderTransactions();
    } catch (e) { console.error('txnAdd failed', e); }
  }
  window.__addTxn = doTxnAdd;
  const _txnName = document.getElementById('txnName');
  const _txnAmt  = document.getElementById('txnAmt');
  if (_txnName) _txnName.addEventListener('keydown', e => { if (e.key === 'Enter') doTxnAdd(); });
  if (_txnAmt)  _txnAmt.addEventListener('keydown',  e => { if (e.key === 'Enter') doTxnAdd(); });
  // Default the date field to today
  const _txnDateEl = document.getElementById('txnDate');
  if (_txnDateEl && !_txnDateEl.value) {
    const _td = new Date();
    _txnDateEl.value = _td.getFullYear() + '-'
      + String(_td.getMonth() + 1).padStart(2, '0') + '-'
      + String(_td.getDate()).padStart(2, '0');
  }
  renderTransactions();

  // ============================================================
  // TRANSACTION TYPE TOGGLE
  // ============================================================
  let _currentTxnType = 'expense';
  window.setTxnType = function(type) {
    _currentTxnType = type;
    const expBtn = document.getElementById('txnTypeExp');
    const incBtn = document.getElementById('txnTypeInc');
    if (expBtn) expBtn.className = 'txn-type-btn' + (type === 'expense' ? ' active-exp' : '');
    if (incBtn) incBtn.className = 'txn-type-btn' + (type === 'income'  ? ' active-inc' : '');
  };

  // ============================================================
  // ADD-BUTTON BULLETPROOFING — three independent paths:
  //   1. inline onclick attribute (in the HTML) calls window.__addX
  //   2. document-level click delegation matches by id
  //   3. Enter-key on the inputs (already wired above)
  // Any one working is enough — but together they're impossible to break.
  // ============================================================
  window.__addSub  = doSubAdd;
  window.__addWish = doWishAdd;
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    // Skip if the button already has an inline onclick (it'll fire that itself).
    if (t.hasAttribute('onclick')) return;
    if (t.id === 'subAddBtn')  { e.preventDefault(); doSubAdd();  }
    if (t.id === 'wishAddBtn') { e.preventDefault(); doWishAdd(); }
  });

  // ============================================================
  // INCOMING ORDERS — full-spec: name, cost (CHF base), currency,
  // fromCat, expectedDate, ts. Stored under 'incoming_orders'.
  // (ORD_FROM_META is declared at the top of this IIFE — see the
  // header — because renderOrders runs as part of the very first
  // renderAllNetWorth, which fires *before* this section is reached.
  // Declaring it here would put it in the TDZ for that first call
  // and crash the whole script if any orders were already saved.)
  // ============================================================
  function ordPctClass(pct) {
    if (pct < 5)  return 'good';
    if (pct < 25) return 'warn';
    return 'bad';
  }
  function ordFmtArrival(iso) {
    if (!iso) return null;
    const isoSafe = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T00:00' : iso;
    const d = new Date(isoSafe);
    if (isNaN(d)) return null;
    const now = new Date();
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((dayStart - todayStart) / 86400000);
    const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    let cls = '', prefix = '';
    if (diffDays < 0)        { cls = 'past';  prefix = 'late · '; }
    else if (diffDays === 0) { cls = 'today'; prefix = 'today · '; }
    else if (diffDays === 1) { cls = 'soon';  prefix = 'tomorrow · '; }
    else if (diffDays <= 7)  { cls = 'soon';  prefix = 'in ' + diffDays + 'd · '; }
    return { cls, label: prefix + dateLabel };
  }
  // Build the flat list of every NW account (across all 4 categories) so
  // both the "From" dropdown on the add form AND the deduct chooser share
  // the same source of truth.
  function listAllNwAccounts() {
    const out = [];
    NW_CATS.forEach(cat => {
      const items = storeGet('nw:' + cat.key) || [];
      items.forEach((it, idx) => {
        out.push({
          catKey: cat.key,
          itemIdx: idx,
          itemName: String(it.name || ''),
          amountCHF: Number(it.amount) || 0
        });
      });
    });
    return out;
  }
  // Refill the order add-form's "From" select with the user's actual NW
  // accounts, preserving the current selection if that account still exists.
  function populateOrdFromSelect() {
    const sel = document.getElementById('ordFromCat');
    if (!sel) return;
    const accounts = listAllNwAccounts();
    const prev = sel.value;
    const ICONS = { bank: '🏦', stocks: '📈', crypto: '🪙', other: '💼' };
    if (!accounts.length) {
      sel.innerHTML = '<option value="">No accounts yet</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    sel.innerHTML = accounts.map(a => {
      const value = a.catKey + '::' + a.itemName;
      return '<option value="' + value + '">' + ICONS[a.catKey] + ' ' + escapeHtml(a.itemName) + '</option>';
    }).join('');
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  }
  function renderOrders() {
    const list = document.getElementById('ordList');
    const empty = document.getElementById('ordEmpty');
    const count = document.getElementById('ordCount');
    if (!list) return;
    // Refresh the "From" dropdown so newly added/renamed/deleted NW accounts show up.
    populateOrdFromSelect();
    const items = storeGet('incoming_orders') || [];
    const grand = nwGrandCHF();
    if (count) count.textContent = items.length + (items.length === 1 ? ' item' : ' items');
    // Always clear before painting — earlier this re-rendered as an APPEND
    // (so every NW change duplicated the cards). Now it's an idempotent paint.
    list.innerHTML = '';
    if (!items.length) {
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    // Sort: arrival date soonest first, undated last
    items.slice().sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    }).forEach(o => {
      const cost = Number(o.amount) || 0;
      const isDeducted = !!o.deductedAt;
      // Use frozen pct once deducted; live pct otherwise.
      let pct, pctText, pctCls;
      if (isDeducted && typeof o.pctAtDeduction === 'number') {
        pct = o.pctAtDeduction;
        pctText = pct.toFixed(2) + '% of NW';
        pctCls = ordPctClass(pct) + ' frozen';
      } else if (grand > 0) {
        pct = (cost / grand) * 100;
        pctText = pct.toFixed(2) + '% of NW';
        pctCls = ordPctClass(pct);
      } else {
        pct = null;
        pctText = '— of NW';
        pctCls = '';
      }
      const fromMeta = ORD_FROM_META[o.fromCat] || ORD_FROM_META.bank;
      const fromAccountLabel = o.fromAccount ? escapeHtml(o.fromAccount) : fromMeta.name;
      const arr = ordFmtArrival(o.date);
      const arrHtml = arr
        ? '<span class="ord-meta-pill date ' + arr.cls + '">' + arr.label + '</span>'
        : '<span class="ord-meta-pill date">no arrival</span>';
      const row = document.createElement('div');
      row.className = 'ord-card cat-' + (o.fromCat || 'bank') + (isDeducted ? ' is-deducted' : '');
      const footHtml = isDeducted
        ? '<div class="ord-card-foot">'
          +   '<span class="ord-deducted-pill">Deducted from ' + escapeHtml(o.deductedFrom && o.deductedFrom.name ? o.deductedFrom.name : fromAccountLabel) + '</span>'
          +   '<button class="ord-deduct-undo" data-undo-id="' + o.id + '">Undo</button>'
          + '</div>'
        : '<div class="ord-card-foot">'
          +   '<button class="ord-deduct-btn" data-deduct-id="' + o.id + '">− Deduct from net worth</button>'
          + '</div>';
      row.innerHTML =
          '<div class="ord-card-h">'
        +   '<div class="ord-card-name">' + escapeHtml(o.name) + '</div>'
        +   '<div class="ord-card-amt">' + fmtMoney(cost) + '</div>'
        +   '<button class="ord-card-x" data-id="' + o.id + '" aria-label="Remove">×</button>'
        + '</div>'
        + '<div class="ord-card-meta">'
        +   '<span class="ord-meta-pill from">from · ' + fromAccountLabel + '</span>'
        +   '<span class="ord-meta-pill pct ' + pctCls + '">' + pctText + '</span>'
        +   arrHtml
        + '</div>'
        + footHtml;
      list.appendChild(row);
    });
    // Wire up delete (×), deduct, and undo buttons.
    list.querySelectorAll('.ord-card-x').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.dataset.id;
        const arr = (storeGet('incoming_orders') || []).filter(x => x.id !== id);
        storeSet('incoming_orders', arr);
        renderOrders();
      });
    });
    list.querySelectorAll('.ord-deduct-btn').forEach(b => {
      b.addEventListener('click', () => openDeductChooser(b.dataset.deductId, b.closest('.ord-card')));
    });
    list.querySelectorAll('.ord-deduct-undo').forEach(b => {
      b.addEventListener('click', () => undoDeduct(b.dataset.undoId));
    });
  }
  // ============================================================
  // DEDUCT — open the inline chooser of NW accounts. Picking one
  // subtracts the order amount from that account (in CHF), logs the
  // activity, freezes the order's % at the moment of deduction, and
  // marks the order as deducted (with no further % updates).
  // ============================================================
  function openDeductChooser(orderId, cardEl) {
    if (!cardEl) return;
    // Toggle: if a chooser already exists in this card, remove it.
    const existing = cardEl.querySelector('.ord-deduct-chooser');
    if (existing) { existing.remove(); return; }
    const order = (storeGet('incoming_orders') || []).find(x => x.id === orderId);
    if (!order) return;
    const accounts = listAllNwAccounts();
    if (!accounts.length) {
      alert('Add at least one net worth account before deducting.');
      return;
    }
    const ICONS = { bank: '🏦', stocks: '📈', crypto: '🪙', other: '💼' };
    const cost = Number(order.amount) || 0;
    const optsHtml = accounts.map(a => {
      const insufficient = a.amountCHF < cost - 0.005;
      const cls = 'ord-deduct-opt' + (insufficient ? ' insufficient' : '');
      return '<button class="' + cls + '" '
        + 'data-cat="' + a.catKey + '" '
        + 'data-name="' + escapeHtml(a.itemName) + '" '
        + (insufficient ? 'data-insuf="1" ' : '')
        + '>'
        + ICONS[a.catKey] + ' ' + escapeHtml(a.itemName)
        + '<small>' + fmtMoney(a.amountCHF) + (insufficient ? ' · not enough' : ' available') + '</small>'
        + '</button>';
    }).join('');
    const chooser = document.createElement('div');
    chooser.className = 'ord-deduct-chooser';
    chooser.innerHTML =
        '<div class="ord-deduct-chooser-title">Deduct ' + fmtMoney(cost) + ' from…</div>'
      + '<div class="ord-deduct-options">' + optsHtml + '</div>'
      + '<button class="ord-deduct-cancel" type="button">cancel</button>';
    cardEl.appendChild(chooser);
    chooser.querySelectorAll('.ord-deduct-opt').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.insuf === '1') {
          if (!confirm('That account doesn\'t have enough — deduct anyway? (it will go negative)')) return;
        }
        confirmDeduct(orderId, b.dataset.cat, b.dataset.name);
      });
    });
    chooser.querySelector('.ord-deduct-cancel').addEventListener('click', () => chooser.remove());
  }
  function confirmDeduct(orderId, catKey, itemName) {
    const orders = storeGet('incoming_orders') || [];
    const oIdx = orders.findIndex(x => x.id === orderId);
    if (oIdx < 0) return;
    const order = orders[oIdx];
    if (order.deductedAt) return; // already deducted
    const items = storeGet('nw:' + catKey) || [];
    const itemIdx = items.findIndex(it => String(it.name) === String(itemName));
    if (itemIdx < 0) {
      alert('That account no longer exists. Refresh the chooser.');
      return;
    }
    const cost = Number(order.amount) || 0;
    const grandBefore = nwGrandCHF();
    const pctAtDeduction = grandBefore > 0 ? (cost / grandBefore) * 100 : 0;
    // Subtract from the chosen NW account
    items[itemIdx].amount = (Number(items[itemIdx].amount) || 0) - cost;
    storeSet('nw:' + catKey, items);
    logActivity(catKey, items[itemIdx].name, -cost, 'edit');
    // Mark the order as deducted with frozen %
    orders[oIdx] = {
      ...order,
      deductedAt: Date.now(),
      pctAtDeduction: pctAtDeduction,
      deductedFrom: { cat: catKey, name: items[itemIdx].name }
    };
    storeSet('incoming_orders', orders);
    renderAllNetWorth();   // re-paints NW totals, donut, activity, and orders
  }
  function undoDeduct(orderId) {
    const orders = storeGet('incoming_orders') || [];
    const oIdx = orders.findIndex(x => x.id === orderId);
    if (oIdx < 0) return;
    const order = orders[oIdx];
    if (!order.deductedAt || !order.deductedFrom) return;
    const cost = Number(order.amount) || 0;
    const items = storeGet('nw:' + order.deductedFrom.cat) || [];
    const itemIdx = items.findIndex(it => String(it.name) === String(order.deductedFrom.name));
    if (itemIdx >= 0) {
      items[itemIdx].amount = (Number(items[itemIdx].amount) || 0) + cost;
      storeSet('nw:' + order.deductedFrom.cat, items);
      logActivity(order.deductedFrom.cat, items[itemIdx].name, cost, 'edit');
    }
    orders[oIdx] = { ...order, deductedAt: null, pctAtDeduction: null, deductedFrom: null };
    storeSet('incoming_orders', orders);
    renderAllNetWorth();
  }
  // Wire renderOrders into the global render so it stays in sync with NW changes
  const _prevRenderAll = (typeof renderAllNetWorth === 'function') ? renderAllNetWorth : null;
  // The "From" select uses values like "bank::star one". Split into parts.
  function parseFromValue(v) {
    const s = String(v || '');
    const ix = s.indexOf('::');
    if (ix < 0) return { cat: 'bank', name: '' };
    return { cat: s.slice(0, ix), name: s.slice(ix + 2) };
  }
  // Live preview on the add card — updates as user types the cost
  function updateOrdPreview() {
    const costEl = document.getElementById('ordCost');
    const ccyEl  = document.getElementById('ordCurrency');
    const fromEl = document.getElementById('ordFromCat');
    const prev   = document.getElementById('ordAddPreview');
    if (!prev) return;
    const aRaw = parseFloat(costEl && costEl.value);
    if (!costEl || isNaN(aRaw) || aRaw <= 0) {
      prev.textContent = 'Type a cost — preview will show what % of net worth it takes.';
      prev.className = 'ord-add-preview';
      return;
    }
    const ccy = ccyEl ? ccyEl.value : 'CHF';
    const rate = exchangeRates[ccy] || 1;
    const amountCHF = aRaw / rate;
    const grand = nwGrandCHF();
    const parsed = parseFromValue(fromEl ? fromEl.value : '');
    const fromName = parsed.name || (ORD_FROM_META[parsed.cat] || ORD_FROM_META.bank).name;
    if (grand > 0) {
      const pct = (amountCHF / grand) * 100;
      const cls = ordPctClass(pct);
      prev.textContent = fmtMoney(amountCHF) + ' from ' + fromName + ' · ' + pct.toFixed(2) + '% of your ' + fmtMoney(grand) + ' net worth';
      prev.className = 'ord-add-preview ' + (cls === 'good' ? '' : cls);
    } else {
      prev.textContent = fmtMoney(amountCHF) + ' from ' + fromName + ' · add net worth first to see %';
      prev.className = 'ord-add-preview';
    }
  }
  function doOrdAdd() {
    try {
      const nEl = document.getElementById('ordName');
      const aEl = document.getElementById('ordCost');
      const cEl = document.getElementById('ordCurrency');
      const fEl = document.getElementById('ordFromCat');
      const dEl = document.getElementById('ordArrival');
      if (!nEl || !aEl) return;
      const n = (nEl.value || '').trim();
      const aRaw = parseFloat(aEl.value);
      if (!n || isNaN(aRaw)) { nEl.focus(); return; }
      const ccy = cEl ? cEl.value : 'CHF';
      const rate = exchangeRates[ccy] || 1;
      const amountCHF = aRaw / rate;
      const parsed = parseFromValue(fEl ? fEl.value : '');
      const arr = storeGet('incoming_orders') || [];
      arr.push({
        id: 'o_' + Date.now() + '_' + Math.floor(Math.random() * 9999),
        name: n,
        amount: amountCHF,
        entered_amount: aRaw,
        entered_currency: ccy,
        fromCat: parsed.cat || 'bank',
        fromAccount: parsed.name || null,    // the actual NW item the user picked
        date: dEl && dEl.value ? dEl.value : null,
        ts: Date.now(),
        deductedAt: null,
        pctAtDeduction: null,
        deductedFrom: null
      });
      storeSet('incoming_orders', arr);
      nEl.value = ''; aEl.value = '';
      if (dEl) dEl.value = '';
      updateOrdPreview();
      renderOrders();
    } catch (e) { console.error('ordAdd failed', e); }
  }
  window.__addOrder = doOrdAdd;
  // Wire live-preview listeners
  ['ordCost','ordCurrency','ordFromCat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateOrdPreview);
    if (el) el.addEventListener('change', updateOrdPreview);
  });
  ['ordName','ordCost'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') doOrdAdd(); });
  });
  renderOrders();
  updateOrdPreview();

  // ============================================================
  // FINANCE TICKER — rotates through upcoming subscription renewals
  // every 5 seconds. Flashes red whenever the currently displayed sub
  // renews in 5 days or fewer. Hides itself if there are no renewals.
  // ============================================================
  // Roll a renewal date forward by the period until it's >= today, so a
  // sub that renewed Apr 28 (monthly) auto-shows the next renewal date
  // instead of "past". Returns a Date.
  function nextRenewalDate(isoDate, period) {
    const isoSafe = (typeof isoDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)) ? isoDate + 'T00:00' : isoDate;
    let d = new Date(isoSafe);
    if (isNaN(d)) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let safety = 0;
    while (d < today && safety++ < 600) {
      if (period === 'weekly')           d.setDate(d.getDate() + 7);
      else if (period === 'fortnightly') d.setDate(d.getDate() + 14);
      else if (period === 'yearly')      d.setFullYear(d.getFullYear() + 1);
      else                               d.setMonth(d.getMonth() + 1);
    }
    return d;
  }
  function buildTickerEntries() {
    const subs = storeGet('subs') || [];
    const out = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    subs.forEach(s => {
      if (!s.renewal) return;
      const next = nextRenewalDate(s.renewal, s.period);
      if (!next) return;
      const days = Math.round((next.getTime() - today) / 86400000);
      // Use the period-local cost for what the user actually pays at renewal,
      // not the monthlyEquivalent — this ticker shows "what's about to hit".
      out.push({
        name: s.name,
        amount: Number(s.amount) || 0,
        days,
        period: s.period
      });
    });
    out.sort((a, b) => a.days - b.days);
    return out;
  }
  let tickerIdx = 0;
  let tickerTimer = null;
  let tickerLastSig = '';   // signature of last-painted entries — skip re-paint if unchanged
  let tickerLastEntries = [];
  function tickerSig(entries) {
    return entries.map(e => e.name + '|' + e.amount + '|' + e.days + '|' + (e.period || '')).join('~');
  }
  function paintTickerActive(wrap, stream, dots, entries) {
    if (tickerIdx >= entries.length) tickerIdx = 0;
    const items = stream.querySelectorAll('.ticker-item');
    const dotEls = dots.querySelectorAll('.ticker-dot');
    items.forEach((el, i) => el.classList.toggle('active', i === tickerIdx));
    dotEls.forEach((el, i) => el.classList.toggle('active', i === tickerIdx));
    const cur = entries[tickerIdx];
    wrap.classList.toggle('urgent', !!(cur && cur.days <= 5));
  }
  function renderTicker() {
    const wrap   = document.getElementById('financeTicker');
    const stream = document.getElementById('tickerStream');
    const dots   = document.getElementById('tickerDots');
    if (!wrap || !stream || !dots) return;
    const entries = buildTickerEntries();
    const sig = tickerSig(entries);
    // Fast path: nothing changed — don't repaint, don't disturb rotation.
    if (sig === tickerLastSig) {
      // Refresh urgent state in case the active item ticked closer (days didn't change but it's nice to keep in sync)
      if (entries.length) paintTickerActive(wrap, stream, dots, entries);
      return;
    }
    tickerLastSig = sig;
    tickerLastEntries = entries;
    if (!entries.length) {
      wrap.classList.add('hidden');
      stream.innerHTML = '';
      dots.innerHTML = '';
      if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
      return;
    }
    wrap.classList.remove('hidden');
    if (tickerIdx >= entries.length) tickerIdx = 0;

    // Paint the items as overlapping absolute layers; .active is the visible one
    stream.innerHTML = entries.map((e, i) => {
      const daysLabel = e.days < 0
        ? Math.abs(e.days) + 'd late'
        : e.days === 0
          ? 'TODAY'
          : e.days === 1
            ? 'TOMORROW'
            : 'in ' + e.days + 'd';
      return '<div class="ticker-item' + (i === tickerIdx ? ' active' : '') + '" data-i="' + i + '">'
        +   '<span class="ticker-item-name">' + escapeHtml(e.name) + '</span>'
        +   '<span class="ticker-item-amt">' + fmtMoney(e.amount) + '</span>'
        +   '<span class="ticker-item-days">' + daysLabel + '</span>'
        + '</div>';
    }).join('');
    dots.innerHTML = entries.map((_, i) =>
      '<span class="ticker-dot' + (i === tickerIdx ? ' active' : '') + '"></span>'
    ).join('');
    paintTickerActive(wrap, stream, dots, entries);

    if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
    if (entries.length > 1) {
      tickerTimer = setInterval(() => {
        if (!tickerLastEntries.length) return;
        tickerIdx = (tickerIdx + 1) % tickerLastEntries.length;
        const w = document.getElementById('financeTicker');
        const s = document.getElementById('tickerStream');
        const d = document.getElementById('tickerDots');
        if (w && s && d) paintTickerActive(w, s, d, tickerLastEntries);
      }, 5000);
    }
  }
  // Drive the ticker on a 1s heartbeat — bulletproof and avoids any
  // fragile wrapping of renderSubs (which broke the add buttons before).
  // The actual swap is gated by tickerTimer's own 5s interval inside
  // renderTicker; this loop just keeps the data fresh whenever subs change.
  function safeRenderTicker() {
    try { renderTicker(); } catch (e) { console.error('ticker render failed', e); }
  }
  safeRenderTicker();
  setInterval(safeRenderTicker, 1500);

  // ============================================================
  // SUPABASE INIT — pull remote state on load, hydrate localStorage,
  // re-render with cloud data, then subscribe to realtime so changes
  // from other devices appear instantly without a page refresh.
  // ============================================================
  (async function _initCloudSync() {
    if (!window.supabase || !SUPABASE_URL || !SUPABASE_KEY) return;
    if (SUPABASE_URL.indexOf('PASTE-') === 0 || SUPABASE_KEY.indexOf('PASTE-') === 0) return;
    try {
      _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      _syncBadge('syncing');
      const { data, error } = await _supa
        .from('app_state').select('data').eq('key', APP_KEY).maybeSingle();
      if (!error && data && data.data && Object.keys(data.data).length > 0) {
        const remote = data.data;
        let changed = false;
        SYNC_KEYS.forEach(k => {
          if (remote[k] !== undefined) {
            localStorage.setItem(k, JSON.stringify(remote[k]));
            changed = true;
          }
        });
        if (changed) {
          renderAllNetWorth();
          renderSubs();
          renderOrders();
          renderTransactions();
          safeRenderTicker();
          if (typeof renderWishlistCombined === 'function') renderWishlistCombined();
          if (typeof renderOverview         === 'function') renderOverview();
          if (typeof renderBudgets          === 'function') renderBudgets();
          if (typeof renderFinCalendar      === 'function') renderFinCalendar();
        }
      }
      _syncBadge('ok');

      // Realtime — push from other devices lands here instantly
      _supa.channel('finance-sync')
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'app_state',
          filter: 'key=eq.' + APP_KEY
        }, payload => {
          const remote = (payload.new || {}).data;
          if (!remote) return;
          SYNC_KEYS.forEach(k => {
            if (remote[k] !== undefined) localStorage.setItem(k, JSON.stringify(remote[k]));
          });
          renderAllNetWorth();
          renderSubs();
          renderOrders();
          renderTransactions();
          safeRenderTicker();
          if (typeof renderWishlistCombined === 'function') renderWishlistCombined();
          if (typeof renderOverview         === 'function') renderOverview();
          if (typeof renderBudgets          === 'function') renderBudgets();
          if (typeof renderFinCalendar      === 'function') renderFinCalendar();
        })
        .subscribe();
    } catch (e) { _syncBadge('err'); console.error('finance sync init failed', e); }
  })();

  // ============================================================
  // OVERVIEW — income / expense dashboard with month selector
  // ============================================================
  const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  let _ovwYear  = new Date().getFullYear();
  let _ovwMonth = new Date().getMonth();

  function _ovwFmtMonth(year, month) {
    return MONTH_NAMES_FULL[month] + ' ' + year;
  }

  function renderOverview() {
    const now = new Date();
    const monthKey  = _ovwYear + '-' + String(_ovwMonth + 1).padStart(2, '0');
    const prevDate  = new Date(_ovwYear, _ovwMonth - 1, 1);
    const prevKey   = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

    const labelEl = document.getElementById('ovwMonthLabel');
    if (labelEl) labelEl.textContent = _ovwFmtMonth(_ovwYear, _ovwMonth);

    const nextBtn = document.getElementById('ovwNextBtn');
    if (nextBtn) nextBtn.disabled = (_ovwYear === now.getFullYear() && _ovwMonth === now.getMonth());

    const items = storeGet('transactions') || [];
    function monthTotals(key) {
      let income = 0, expense = 0;
      const cats = {};
      items.forEach(tx => {
        if (!(tx.date || '').startsWith(key)) return;
        const v = Number(tx.amount) || 0;
        if (tx.type === 'income') { income += v; }
        else { expense += v; cats[tx.category || 'other'] = (cats[tx.category || 'other'] || 0) + v; }
      });
      return { income, expense, cats };
    }
    const cur  = monthTotals(monthKey);
    const prev = monthTotals(prevKey);
    const balance = cur.income - cur.expense;

    const balEl = document.getElementById('ovwBalance');
    if (balEl) {
      balEl.textContent = fmtMoney(Math.abs(balance));
      balEl.className = 'ovw-balance-num ' + (balance > 0 ? 'positive' : balance < 0 ? 'negative' : 'zero');
    }
    const saveTextEl = document.getElementById('ovwSavingsText');
    if (saveTextEl) {
      if (cur.income > 0) {
        const rate = Math.round((cur.income - cur.expense) / cur.income * 100);
        saveTextEl.textContent = (balance >= 0 ? 'Surplus · ' : 'Deficit · ') + Math.abs(rate) + '% savings rate';
      } else {
        saveTextEl.textContent = 'No income logged this month';
      }
    }

    const incEl = document.getElementById('ovwIncome');
    if (incEl) incEl.textContent = fmtMoney(cur.income);
    const expEl = document.getElementById('ovwExpenses');
    if (expEl) expEl.textContent = fmtMoney(cur.expense);

    function pctChange(curr, prev) {
      if (!prev) return null;
      return Math.round((curr - prev) / prev * 100);
    }
    const incChangeEl = document.getElementById('ovwIncomeChange');
    if (incChangeEl) {
      const p = pctChange(cur.income, prev.income);
      if (p === null) { incChangeEl.textContent = ''; }
      else {
        incChangeEl.className = 'ovw-metric-change ' + (p >= 0 ? 'up' : 'down');
        incChangeEl.textContent = (p >= 0 ? '+' : '') + p + '% vs prev';
      }
    }
    const expChangeEl = document.getElementById('ovwExpChange');
    if (expChangeEl) {
      const p = pctChange(cur.expense, prev.expense);
      if (p === null) { expChangeEl.textContent = ''; }
      else {
        expChangeEl.className = 'ovw-metric-change ' + (p <= 0 ? 'up' : 'down');
        expChangeEl.textContent = (p >= 0 ? '+' : '') + p + '% vs prev';
      }
    }

    const rateEl = document.getElementById('ovwSavingsRate');
    if (rateEl) {
      if (cur.income > 0) {
        const rate = Math.round((cur.income - cur.expense) / cur.income * 100);
        rateEl.textContent = rate + '%';
        rateEl.style.color = rate >= 20 ? '#6BE3A4' : rate >= 0 ? 'var(--text-primary)' : '#FF8A8A';
      } else {
        rateEl.textContent = '—';
        rateEl.style.color = '';
      }
    }

    // Bank accounts section removed — deduct via Net Worth section or Wishlist reserved accounts.
    if (false) {
      const bankItems = storeGet('nw:bank') || [];
      if (bankItems.length) {
        bankSection.style.display = '';
        const bankTotal = bankItems.reduce((s, it) => s + (Number(it.amount) || 0), 0);

        let bHtml = '<div class="ovw-bank-total">' + fmtMoney(bankTotal) + '</div>';
        bankItems.forEach((it, idx) => {
          const v = Number(it.amount) || 0;
          const pct = bankTotal > 0 ? Math.round(v / bankTotal * 100) : 0;
          bHtml += '<div class="ovw-bank-row">'
            + '<div class="ovw-cat-name">🏦 ' + escapeHtml(it.name) + '</div>'
            + '<div class="ovw-cat-bar-wrap"><div class="ovw-cat-bar-fill" style="width:' + pct + '%;background:#7DD3FC"></div></div>'
            + '<div class="ovw-bank-row-right">'
            +   '<span class="ovw-cat-amt">' + fmtMoney(v) + '</span>'
            +   '<button class="ovw-bank-minus" data-idx="' + idx + '" type="button">−</button>'
            + '</div>'
            + '</div>'
            + '<div class="ovw-bank-inline-wrap" id="ovwBankInline_' + idx + '" style="display:none">'
            +   '<input type="number" class="ovw-bank-inline-amt" placeholder="Amount" step="0.01" />'
            +   '<input type="text" class="ovw-bank-inline-label" placeholder="Description (optional)" />'
            +   '<button class="ovw-bank-inline-ok" data-idx="' + idx + '" type="button">Deduct</button>'
            +   '<button class="ovw-bank-inline-cancel" data-idx="' + idx + '" type="button">Cancel</button>'
            + '</div>';
        });

        bHtml += '<button class="ovw-bank-split-btn" id="ovwBankSplitBtn" type="button">+ Split expense across accounts</button>'
          + '<div class="ovw-bank-split-wrap" id="ovwBankSplitWrap" style="display:none">'
          +   '<div class="ovw-bank-split-head">Split expense across accounts</div>'
          +   '<input type="text" id="ovwSplitLabel" class="ovw-bank-split-label-input" placeholder="Description (optional)" />'
          +   bankItems.map((it, idx) => {
                const v = Number(it.amount) || 0;
                return '<div class="ovw-bank-split-row">'
                  + '<label class="ovw-split-chk-label">'
                  +   '<input type="checkbox" class="ovw-split-chk" data-idx="' + idx + '" />'
                  +   '<span class="ovw-split-chk-name">🏦 ' + escapeHtml(it.name) + '</span>'
                  +   '<span class="ovw-split-avail">' + fmtMoney(v) + '</span>'
                  + '</label>'
                  + '<input type="number" class="ovw-split-amt" data-idx="' + idx + '" placeholder="Amount" step="0.01" style="display:none" />'
                  + '</div>';
              }).join('')
          +   '<div class="ovw-bank-split-footer">'
          +     '<button class="ovw-bank-split-apply" id="ovwSplitApply" type="button">Apply deductions</button>'
          +     '<button class="ovw-bank-split-close" id="ovwSplitClose" type="button">Cancel</button>'
          +   '</div>'
          + '</div>';

        bankList.innerHTML = bHtml;

        // Toggle single-account inline deduct form
        bankList.querySelectorAll('.ovw-bank-minus').forEach(btn => {
          btn.addEventListener('click', () => {
            const i = parseInt(btn.dataset.idx);
            const wrap = document.getElementById('ovwBankInline_' + i);
            if (!wrap) return;
            const isOpen = wrap.style.display !== 'none';
            bankItems.forEach((_, j) => {
              const w = document.getElementById('ovwBankInline_' + j);
              if (w) w.style.display = 'none';
            });
            if (!isOpen) {
              wrap.style.display = 'flex';
              const inp = wrap.querySelector('.ovw-bank-inline-amt');
              if (inp) { inp.value = ''; inp.focus(); }
            }
          });
        });

        bankList.querySelectorAll('.ovw-bank-inline-cancel').forEach(btn => {
          btn.addEventListener('click', () => {
            const wrap = document.getElementById('ovwBankInline_' + btn.dataset.idx);
            if (wrap) wrap.style.display = 'none';
          });
        });

        bankList.querySelectorAll('.ovw-bank-inline-ok').forEach(btn => {
          btn.addEventListener('click', () => {
            const i = parseInt(btn.dataset.idx);
            const wrap = document.getElementById('ovwBankInline_' + i);
            if (!wrap) return;
            const amtInp = wrap.querySelector('.ovw-bank-inline-amt');
            const lblInp = wrap.querySelector('.ovw-bank-inline-label');
            const symbol = currencyEl ? currencyEl.value : 'AUD';
            const rate = exchangeRates[symbol] || 1;
            const amt = parseFloat(amtInp ? amtInp.value : '');
            if (isNaN(amt) || amt <= 0) { if (amtInp) amtInp.focus(); return; }
            const amtCHF = amt / rate;
            const items = storeGet('nw:bank') || [];
            if (!items[i]) return;
            const lbl = lblInp && lblInp.value.trim() ? ' · ' + lblInp.value.trim() : '';
            items[i].amount = (Number(items[i].amount) || 0) - amtCHF;
            storeSet('nw:bank', items);
            logActivity('bank', items[i].name + lbl, -amtCHF, 'edit');
            renderAllNetWorth();
            renderOverview();
          });
        });

        // Enter / Escape on inline inputs
        bankList.querySelectorAll('.ovw-bank-inline-wrap').forEach(wrap => {
          wrap.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('keydown', e => {
              if (e.key === 'Enter')  wrap.querySelector('.ovw-bank-inline-ok').click();
              else if (e.key === 'Escape') wrap.querySelector('.ovw-bank-inline-cancel').click();
            });
          });
        });

        // Split form toggle
        const splitBtn = document.getElementById('ovwBankSplitBtn');
        const splitWrap = document.getElementById('ovwBankSplitWrap');
        if (splitBtn && splitWrap) {
          splitBtn.addEventListener('click', () => {
            const isOpen = splitWrap.style.display !== 'none';
            splitWrap.style.display = isOpen ? 'none' : '';
            splitBtn.textContent = isOpen ? '+ Split expense across accounts' : '− Close split form';
          });
        }

        // Reveal per-account amount input when checkbox is checked
        bankList.querySelectorAll('.ovw-split-chk').forEach(chk => {
          chk.addEventListener('change', () => {
            const inp = bankList.querySelector('.ovw-split-amt[data-idx="' + chk.dataset.idx + '"]');
            if (!inp) return;
            inp.style.display = chk.checked ? '' : 'none';
            if (chk.checked) { inp.value = ''; inp.focus(); }
          });
        });

        // Apply split deductions
        const applyBtn = document.getElementById('ovwSplitApply');
        if (applyBtn) {
          applyBtn.addEventListener('click', () => {
            const lbl = ((document.getElementById('ovwSplitLabel') || {}).value || '').trim();
            const checked = bankList.querySelectorAll('.ovw-split-chk:checked');
            if (!checked.length) { alert('Select at least one account.'); return; }
            const symbol = currencyEl ? currencyEl.value : 'AUD';
            const rate = exchangeRates[symbol] || 1;
            const items = storeGet('nw:bank') || [];
            let anyDone = false;
            checked.forEach(chk => {
              const i = parseInt(chk.dataset.idx);
              const inp = bankList.querySelector('.ovw-split-amt[data-idx="' + i + '"]');
              const amt = parseFloat(inp ? inp.value : '');
              if (isNaN(amt) || amt <= 0 || !items[i]) return;
              const amtCHF = amt / rate;
              items[i].amount = (Number(items[i].amount) || 0) - amtCHF;
              logActivity('bank', items[i].name + (lbl ? ' · ' + lbl : ''), -amtCHF, 'edit');
              anyDone = true;
            });
            if (!anyDone) { alert('Enter an amount for at least one selected account.'); return; }
            storeSet('nw:bank', items);
            renderAllNetWorth();
            renderOverview();
          });
        }

        // Close split form
        const closeBtn = document.getElementById('ovwSplitClose');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => {
            if (splitWrap) splitWrap.style.display = 'none';
            if (splitBtn) splitBtn.textContent = '+ Split expense across accounts';
          });
        }

      } else {
        bankSection.style.display = 'none';
      }
    }

    const catSection = document.getElementById('ovwCatSection');
    const catList = document.getElementById('ovwCatList');
    if (catSection && catList) {
      const entries = Object.entries(cur.cats).sort((a, b) => b[1] - a[1]);
      if (!entries.length) { catSection.style.display = 'none'; }
      else {
        catSection.style.display = '';
        const maxVal = entries[0][1];
        const CAT_COLORS_MAP = {
          food: '#F97316', transport: '#7DD3FC', shopping: '#B794F4',
          entertain: '#FBBF24', health: '#6EE7B7', housing: '#94A3B8',
          utilities: '#F2C063', other: '#76746E'
        };
        catList.innerHTML = entries.map(([key, val]) => {
          const meta = TXN_CATS[key] || { label: key, emoji: '📦', color: '#76746E' };
          const pct  = maxVal > 0 ? Math.round(val / maxVal * 100) : 0;
          return '<div class="ovw-cat-row">'
            + '<div class="ovw-cat-name">' + meta.emoji + ' ' + escapeHtml(meta.label) + '</div>'
            + '<div class="ovw-cat-bar-wrap"><div class="ovw-cat-bar-fill" style="width:' + pct + '%;background:' + (meta.color || '#76746E') + '"></div></div>'
            + '<div class="ovw-cat-amt">' + fmtMoney(val) + '</div>'
            + '</div>';
        }).join('');
      }
    }
  }

  const ovwPrev = document.getElementById('ovwPrevBtn');
  const ovwNext = document.getElementById('ovwNextBtn');
  if (ovwPrev) ovwPrev.addEventListener('click', () => {
    if (_ovwMonth === 0) { _ovwMonth = 11; _ovwYear--; } else _ovwMonth--;
    renderOverview();
  });
  if (ovwNext) ovwNext.addEventListener('click', () => {
    const now = new Date();
    if (_ovwYear === now.getFullYear() && _ovwMonth === now.getMonth()) return;
    if (_ovwMonth === 11) { _ovwMonth = 0; _ovwYear++; } else _ovwMonth++;
    renderOverview();
  });
  renderOverview();

  // ============================================================
  // BUDGETS — category limits, track spending from transactions
  // Stored as: [{ id, category, limit }]  (always CHF base)
  // ============================================================
  function renderBudgets() {
    const budgets = storeGet('budgets') || [];
    const heroEl  = document.getElementById('bgtHero');
    const listEl  = document.getElementById('bgtList');
    const emptyEl = document.getElementById('bgtEmpty');
    if (!listEl) return;

    const now = new Date();
    const monthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const txns = storeGet('transactions') || [];
    const monthSpent = {};
    txns.forEach(tx => {
      if (!(tx.date || '').startsWith(monthKey) || tx.type === 'income') return;
      const cat = tx.category || 'other';
      monthSpent[cat] = (monthSpent[cat] || 0) + (Number(tx.amount) || 0);
    });

    if (!budgets.length) {
      if (heroEl)  heroEl.style.display  = 'none';
      if (emptyEl) emptyEl.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    if (heroEl)  heroEl.style.display = '';

    let totalLimit = 0, totalSpent = 0;
    budgets.forEach(b => { totalLimit += Number(b.limit) || 0; totalSpent += monthSpent[b.category] || 0; });
    const totalRem = totalLimit - totalSpent;

    const limEl = document.getElementById('bgtTotalLimit');
    const sptEl = document.getElementById('bgtTotalSpent');
    const remEl = document.getElementById('bgtTotalRemaining');
    if (limEl) limEl.textContent = fmtMoney(totalLimit);
    if (sptEl) sptEl.textContent = fmtMoney(totalSpent);
    if (remEl) {
      remEl.textContent = fmtMoney(Math.abs(totalRem));
      remEl.className = 'bgt-hero-val ' + (totalRem < 0 ? 'over' : 'ok');
    }

    listEl.innerHTML = '';
    budgets.forEach((b, idx) => {
      const limit = Number(b.limit) || 0;
      const spent = monthSpent[b.category] || 0;
      const pct   = limit > 0 ? Math.min(100, Math.round(spent / limit * 100)) : 0;
      const over  = pct >= 100;
      const warn  = pct >= 80 && !over;
      const color = over ? '#FF8A8A' : warn ? '#F2C063' : '#6BE3A4';
      const badgeTxt  = over ? 'Over' : warn ? 'Near limit' : 'On track';
      const badgeCls  = over ? 'over' : warn ? 'warn' : 'ok';
      const card = document.createElement('div');
      card.className = 'bgt-card';
      card.innerHTML = ''
        + '<div class="bgt-card-head">'
        +   '<div class="bgt-cat-name">' + escapeHtml(b.category) + '</div>'
        +   '<span class="bgt-badge ' + badgeCls + '">' + badgeTxt + '</span>'
        + '</div>'
        + '<div class="bgt-progress-row">'
        +   '<div class="bgt-nums">' + fmtMoney(spent) + ' / ' + fmtMoney(limit) + '</div>'
        +   '<div style="font-size:10px;color:' + color + ';font-family:var(--font-mono);font-weight:700">' + pct + '%</div>'
        + '</div>'
        + '<div class="bgt-bar-wrap"><div class="bgt-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
        + '<div class="bgt-card-actions">'
        +   '<button class="bgt-edit-btn" data-bgt-idx="' + idx + '">✏ Edit</button>'
        +   '<button class="bgt-del-btn" data-bgt-idx="' + idx + '">× Delete</button>'
        + '</div>';
      listEl.appendChild(card);
    });

    listEl.querySelectorAll('.bgt-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.bgtIdx, 10);
        openBgtModal(i);
      });
    });
    listEl.querySelectorAll('.bgt-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.bgtIdx, 10);
        const arr = storeGet('budgets') || [];
        if (!confirm('Delete "' + arr[i].category + '" budget?')) return;
        arr.splice(i, 1);
        storeSet('budgets', arr);
        renderBudgets();
      });
    });
  }

  function openBgtModal(idx) {
    const budgets = storeGet('budgets') || [];
    const b = idx != null ? budgets[idx] : null;
    openFinModal(
      b ? 'Edit budget' : 'Add budget',
      '<div class="fin-modal-field">'
        + '<label class="fin-modal-label">Category name</label>'
        + '<input class="fin-modal-input" id="bgtModalCat" type="text" value="' + escapeHtml(b ? b.category : '') + '" placeholder="e.g. Food">'
        + '</div>'
        + '<div class="fin-modal-field">'
        + '<label class="fin-modal-label">Monthly limit (AUD)</label>'
        + '<input class="fin-modal-input" id="bgtModalLimit" type="number" step="0.01" value="' + (b ? b.limit : '') + '" placeholder="0.00">'
        + '</div>',
      [
        { label: 'Cancel', cls: 'fin-modal-cancel', cb: closeFinModal },
        { label: b ? 'Save' : 'Add', cls: 'fin-modal-save', cb: () => {
          const cat   = (document.getElementById('bgtModalCat').value || '').trim();
          const limit = parseFloat(document.getElementById('bgtModalLimit').value);
          if (!cat || isNaN(limit) || limit <= 0) return;
          const arr = storeGet('budgets') || [];
          if (idx != null) { arr[idx] = { ...arr[idx], category: cat, limit }; }
          else { arr.push({ id: 'b_' + Date.now(), category: cat, limit }); }
          storeSet('budgets', arr);
          closeFinModal();
          renderBudgets();
        }}
      ]
    );
    setTimeout(() => { const el = document.getElementById('bgtModalCat'); if (el) el.focus(); }, 50);
  }

  function doAddBudget() {
    const catEl   = document.getElementById('bgtName');
    const limitEl = document.getElementById('bgtLimit');
    if (!catEl || !limitEl) return;
    const cat   = (catEl.value || '').trim();
    const limit = parseFloat(limitEl.value);
    if (!cat || isNaN(limit) || limit <= 0) { catEl.focus(); return; }
    const arr = storeGet('budgets') || [];
    // Update if category already exists, otherwise push
    const existing = arr.findIndex(b => b.category.toLowerCase() === cat.toLowerCase());
    if (existing >= 0) { arr[existing].limit = limit; }
    else { arr.push({ id: 'b_' + Date.now(), category: cat, limit }); }
    storeSet('budgets', arr);
    catEl.value = ''; limitEl.value = '';
    renderBudgets();
  }
  window.__addBudget = doAddBudget;
  const _bgtName  = document.getElementById('bgtName');
  const _bgtLimit = document.getElementById('bgtLimit');
  if (_bgtName)  _bgtName.addEventListener('keydown',  e => { if (e.key === 'Enter') doAddBudget(); });
  if (_bgtLimit) _bgtLimit.addEventListener('keydown', e => { if (e.key === 'Enter') doAddBudget(); });
  const _bgtAddBtn = document.getElementById('bgtAddBtn');
  if (_bgtAddBtn) _bgtAddBtn.addEventListener('click', doAddBudget);
  renderBudgets();

  // ============================================================
  // GOALS — savings targets with contributions
  // Stored as: [{ id, name, target, saved, deadline, ts }]
  // ============================================================
  function renderGoals() {
    const goals   = storeGet('goals') || [];
    const listEl  = document.getElementById('goalList');
    const emptyEl = document.getElementById('goalEmpty');
    const heroEl  = document.getElementById('goalHeroRow');
    if (!listEl) { if (typeof renderWishlistCombined === 'function') renderWishlistCombined(); return; }

    if (!goals.length) {
      if (heroEl)  heroEl.style.display  = 'none';
      if (emptyEl) emptyEl.classList.remove('hidden');
      listEl.innerHTML = '';
      // Reset hero
      ['goalTotalSaved','goalTotalTarget','goalCount'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '0'; });
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    if (heroEl)  heroEl.style.display = '';

    let totalSaved = 0, totalTarget = 0;
    goals.forEach(g => { totalSaved += Number(g.saved) || 0; totalTarget += Number(g.target) || 0; });
    const sEl = document.getElementById('goalTotalSaved');
    const tEl = document.getElementById('goalTotalTarget');
    const cEl = document.getElementById('goalCount');
    if (sEl) sEl.textContent = fmtMoney(totalSaved);
    if (tEl) tEl.textContent = fmtMoney(totalTarget);
    if (cEl) cEl.textContent = goals.length;

    const now = new Date();
    listEl.innerHTML = '';
    goals.forEach((g, idx) => {
      const saved  = Number(g.saved)  || 0;
      const target = Number(g.target) || 0;
      const pct    = target > 0 ? Math.min(100, Math.round(saved / target * 100)) : 0;
      const done   = pct >= 100;
      const color  = done ? '#6BE3A4' : pct >= 60 ? '#9D4EDD' : pct >= 30 ? '#4CC9F0' : '#F2C063';
      let deadlineHtml = '';
      if (g.deadline) {
        const dl = new Date(g.deadline + 'T00:00');
        const daysLeft = Math.ceil((dl - now) / 86400000);
        const dlCls    = daysLeft < 0 ? 'overdue' : '';
        deadlineHtml = '<div class="goal-card-deadline ' + dlCls + '">'
          + (daysLeft < 0 ? 'Overdue' : daysLeft === 0 ? 'Due today' : daysLeft + 'd left')
          + '</div>';
      }
      const card = document.createElement('div');
      card.className = 'goal-card';
      card.innerHTML = ''
        + '<div class="goal-card-head">'
        +   '<div class="goal-card-name">' + escapeHtml(g.name) + '</div>'
        +   (done ? '<span class="bgt-badge ok">Done!</span>' : '<span class="bgt-badge" style="background:' + color + '22;color:' + color + '">' + pct + '%</span>')
        + '</div>'
        + deadlineHtml
        + '<div class="goal-card-nums">'
        +   '<span class="goal-card-saved">' + fmtMoney(saved) + '</span>'
        +   '<span class="goal-card-target"> / ' + fmtMoney(target) + '</span>'
        + '</div>'
        + '<div class="goal-bar-wrap"><div class="goal-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>'
        + '<div class="goal-card-actions">'
        +   (done ? '' : '<button class="goal-contribute-btn" data-goal-idx="' + idx + '">+ Add money</button>')
        +   '<button class="goal-edit-btn" data-goal-idx="' + idx + '">✏ Edit</button>'
        +   '<button class="goal-del-btn" data-goal-idx="' + idx + '">× Delete</button>'
        + '</div>';
      listEl.appendChild(card);
    });

    listEl.querySelectorAll('.goal-contribute-btn').forEach(btn => {
      btn.addEventListener('click', () => openContributeModal(parseInt(btn.dataset.goalIdx, 10)));
    });
    listEl.querySelectorAll('.goal-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openGoalEditModal(parseInt(btn.dataset.goalIdx, 10)));
    });
    listEl.querySelectorAll('.goal-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.goalIdx, 10);
        const arr = storeGet('goals') || [];
        if (!confirm('Delete goal "' + arr[i].name + '"?')) return;
        arr.splice(i, 1);
        storeSet('goals', arr);
        renderGoals();
      });
    });
  }

  function openContributeModal(idx) {
    const goals = storeGet('goals') || [];
    const g = goals[idx];
    if (!g) return;
    openFinModal(
      'Add to: ' + g.name,
      '<div class="fin-modal-field">'
        + '<label class="fin-modal-label">Amount (AUD)</label>'
        + '<input class="fin-modal-input" id="contributeAmt" type="number" step="0.01" placeholder="0.00">'
        + '</div>',
      [
        { label: 'Cancel', cls: 'fin-modal-cancel', cb: closeFinModal },
        { label: '+ Add', cls: 'fin-modal-save', cb: () => {
          const amt = parseFloat(document.getElementById('contributeAmt').value);
          if (isNaN(amt) || amt <= 0) return;
          const arr = storeGet('goals') || [];
          arr[idx].saved = (Number(arr[idx].saved) || 0) + amt;
          storeSet('goals', arr);
          closeFinModal();
          renderGoals();
        }}
      ]
    );
    setTimeout(() => { const el = document.getElementById('contributeAmt'); if (el) el.focus(); }, 50);
  }

  function openGoalEditModal(idx) {
    const goals = storeGet('goals') || [];
    const g = idx != null ? goals[idx] : null;
    openFinModal(
      g ? 'Edit goal' : 'Add goal',
      '<div class="fin-modal-field">'
        + '<label class="fin-modal-label">Goal name</label>'
        + '<input class="fin-modal-input" id="goalModalName" type="text" value="' + escapeHtml(g ? g.name : '') + '" placeholder="e.g. Japan trip">'
        + '</div>'
        + '<div class="fin-modal-field">'
        + '<label class="fin-modal-label">Target amount (AUD)</label>'
        + '<input class="fin-modal-input" id="goalModalTarget" type="number" step="0.01" value="' + (g ? g.target : '') + '" placeholder="0.00">'
        + '</div>'
        + '<div class="fin-modal-field">'
        + '<label class="fin-modal-label">Deadline (optional)</label>'
        + '<input class="fin-modal-input" id="goalModalDeadline" type="date" value="' + (g && g.deadline ? g.deadline : '') + '">'
        + '</div>',
      [
        { label: 'Cancel', cls: 'fin-modal-cancel', cb: closeFinModal },
        { label: 'Save', cls: 'fin-modal-save', cb: () => {
          const name     = (document.getElementById('goalModalName').value || '').trim();
          const target   = parseFloat(document.getElementById('goalModalTarget').value);
          const deadline = document.getElementById('goalModalDeadline').value || null;
          if (!name || isNaN(target) || target <= 0) return;
          const arr = storeGet('goals') || [];
          if (idx != null) { arr[idx] = { ...arr[idx], name, target, deadline }; }
          else { arr.push({ id: 'g_' + Date.now(), name, target, saved: 0, deadline, ts: Date.now() }); }
          storeSet('goals', arr);
          closeFinModal();
          renderGoals();
        }}
      ]
    );
    setTimeout(() => { const el = document.getElementById('goalModalName'); if (el) el.focus(); }, 50);
  }

  function doAddGoal() {
    const nEl = document.getElementById('goalName');
    const tEl = document.getElementById('goalTarget');
    const dEl = document.getElementById('goalDeadline');
    if (!nEl || !tEl) return;
    const name   = (nEl.value || '').trim();
    const target = parseFloat(tEl.value);
    if (!name || isNaN(target) || target <= 0) { nEl.focus(); return; }
    const deadline = (dEl && dEl.value) ? dEl.value : null;
    const arr = storeGet('goals') || [];
    arr.push({ id: 'g_' + Date.now(), name, target, saved: 0, deadline, ts: Date.now() });
    storeSet('goals', arr);
    nEl.value = ''; tEl.value = '';
    if (dEl) dEl.value = '';
    renderGoals();
  }
  window.__addGoal = doAddGoal;
  const _goalName   = document.getElementById('goalName');
  const _goalTarget = document.getElementById('goalTarget');
  if (_goalName)   _goalName.addEventListener('keydown',   e => { if (e.key === 'Enter') doAddGoal(); });
  if (_goalTarget) _goalTarget.addEventListener('keydown', e => { if (e.key === 'Enter') doAddGoal(); });
  const _goalAddBtn = document.getElementById('goalAddBtn');
  if (_goalAddBtn) _goalAddBtn.addEventListener('click', doAddGoal);
  renderGoals();

  // ============================================================
  // FINANCIAL CALENDAR — monthly grid, click a day to drill down
  // ============================================================
  let _calYear  = new Date().getFullYear();
  let _calMonth = new Date().getMonth();
  let _calSelectedDay = null;

  function renderFinCalendar() {
    const now = new Date();
    const year  = _calYear;
    const month = _calMonth;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow    = new Date(year, month, 1).getDay();
    const todayStr    = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const monthKey    = year + '-' + String(month + 1).padStart(2, '0');

    const labelEl = document.getElementById('calMonthLabel');
    if (labelEl) labelEl.textContent = MONTH_NAMES_FULL[month] + ' ' + year;

    const txns = storeGet('transactions') || [];
    const byDate = {};
    let monthIncome = 0, monthExpense = 0;
    txns.forEach(tx => {
      if (!(tx.date || '').startsWith(monthKey)) return;
      const isInc = tx.type === 'income';
      const v = Number(tx.amount) || 0;
      if (isInc) monthIncome += v; else monthExpense += v;
      if (!byDate[tx.date]) byDate[tx.date] = { income: 0, expense: 0, list: [] };
      if (isInc) byDate[tx.date].income += v; else byDate[tx.date].expense += v;
      byDate[tx.date].list.push(tx);
    });

    const calIncEl = document.getElementById('calIncome');
    const calExpEl = document.getElementById('calExpenses');
    if (calIncEl) calIncEl.textContent = fmtMoney(monthIncome);
    if (calExpEl) calExpEl.textContent = fmtMoney(monthExpense);

    const grid = document.getElementById('finCalGrid');
    if (!grid) return;
    let html = '';
    for (let i = 0; i < firstDow; i++) {
      html += '<div class="fin-cal-cell fin-cal-empty"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const day = byDate[dateStr];
      let cls = 'fin-cal-cell';
      if (dateStr === todayStr) cls += ' fin-cal-today';
      if (dateStr === _calSelectedDay) cls += ' fin-cal-selected';
      if (day) cls += ' fin-cal-has-txns';
      html += '<div class="' + cls + '" data-date="' + dateStr + '">'
        + '<div class="fin-cal-day-num">' + d + '</div>'
        + (day && day.expense > 0 ? '<div class="fin-cal-exp">−' + fmtMoney(day.expense).split(' ')[1] + '</div>' : '')
        + (day && day.income  > 0 ? '<div class="fin-cal-inc">+' + fmtMoney(day.income).split(' ')[1]  + '</div>' : '')
        + '</div>';
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.fin-cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        const d = cell.dataset.date;
        _calSelectedDay = (_calSelectedDay === d) ? null : d;
        renderFinCalendar();
      });
    });

    const detail = document.getElementById('finCalDetail');
    const detailHead = document.getElementById('finCalDetailHead');
    const detailList = document.getElementById('finCalDetailList');
    if (detail) {
      if (_calSelectedDay && byDate[_calSelectedDay]) {
        detail.style.display = '';
        const dp = new Date(_calSelectedDay + 'T00:00');
        if (detailHead) detailHead.textContent = dp.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
        if (detailList) {
          detailList.innerHTML = byDate[_calSelectedDay].list.map(tx => {
            const isInc = tx.type === 'income';
            return '<div class="fin-cal-detail-row">'
              + '<div class="fin-cal-detail-name">' + escapeHtml(tx.name || '') + '</div>'
              + '<div class="fin-cal-detail-amt ' + (isInc ? 'inc' : 'exp') + '">'
              + (isInc ? '+' : '−') + fmtMoney(tx.amount).split(' ')[1]
              + '</div>'
              + '</div>';
          }).join('');
        }
      } else if (_calSelectedDay) {
        detail.style.display = '';
        const dp = new Date(_calSelectedDay + 'T00:00');
        if (detailHead) detailHead.textContent = dp.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
        if (detailList) detailList.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary);padding:8px 0">No transactions on this day.</div>';
      } else {
        detail.style.display = 'none';
      }
    }
  }

  const calPrev = document.getElementById('calPrevBtn');
  const calNext = document.getElementById('calNextBtn');
  if (calPrev) calPrev.addEventListener('click', () => {
    if (_calMonth === 0) { _calMonth = 11; _calYear--; } else _calMonth--;
    _calSelectedDay = null; renderFinCalendar();
  });
  if (calNext) calNext.addEventListener('click', () => {
    if (_calMonth === 11) { _calMonth = 0; _calYear++; } else _calMonth++;
    _calSelectedDay = null; renderFinCalendar();
  });
  renderFinCalendar();

  // ============================================================
  // SHARED FIN MODAL — lightweight reusable overlay
  // ============================================================
  function openFinModal(title, bodyHtml, buttons) {
    const overlay = document.getElementById('finModal');
    const titleEl = document.getElementById('finModalTitle');
    const bodyEl  = document.getElementById('finModalBody');
    const actEl   = document.getElementById('finModalActions');
    if (!overlay) return;
    if (titleEl) titleEl.textContent = title;
    if (bodyEl)  bodyEl.innerHTML = bodyHtml;
    if (actEl) {
      actEl.innerHTML = '';
      buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.className = b.cls;
        btn.textContent = b.label;
        btn.addEventListener('click', b.cb);
        actEl.appendChild(btn);
      });
    }
    overlay.style.display = 'flex';
  }
  function closeFinModal() {
    const overlay = document.getElementById('finModal');
    if (overlay) overlay.style.display = 'none';
  }
  window.closeFinModal = closeFinModal;
  const _finModalOverlay = document.getElementById('finModal');
  if (_finModalOverlay) {
    _finModalOverlay.addEventListener('click', e => { if (e.target === _finModalOverlay) closeFinModal(); });
  }

})();
