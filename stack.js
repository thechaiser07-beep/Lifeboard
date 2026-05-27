
(() => {
  'use strict';

  const storeGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const storeSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function getActiveDate() {
    const now = new Date();
    if (now.getHours() < 6) now.setDate(now.getDate() - 1);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const TEMPLATE_VERSION = 5;

  const STACK_DEFAULTS = [
    { id: 'm1', name: 'XXXXX - Supplement of choice', dose: '', window: 'morning', note: 'how much MG, meal times, any data below', tag: null,    ordered: true  },
    { id: 'm2', name: 'XXXXX - Supplement of choice', dose: '', window: 'morning', note: 'how much MG, meal times, any data below', tag: 'stack', ordered: true  },
    { id: 'm3', name: 'XXXXX - Supplement of choice', dose: '', window: 'morning', note: 'how much MG, meal times, any data below', tag: null,    ordered: true  },
    { id: 'l1', name: 'XXXXX - Supplement of choice', dose: '', window: 'lunch',   note: 'how much MG, meal times, any data below', tag: null,    ordered: true  },
    { id: 'l2', name: 'XXXXX - Supplement of choice', dose: '', window: 'lunch',   note: 'how much MG, meal times, any data below', tag: null,    ordered: true  },
    { id: 'e1', name: 'XXXXX - Supplement of choice', dose: '', window: 'evening', note: 'how much MG, meal times, any data below', tag: null,    ordered: true  },
    { id: 'e2', name: 'XXXXX - Supplement of choice', dose: '', window: 'evening', note: 'how much MG, meal times, any data below', tag: 'not-ordered', ordered: false },
    { id: 'e3', name: 'XXXXX - Supplement of choice', dose: '', window: 'evening', note: 'how much MG, meal times, any data below', tag: null,    ordered: true  },
  ];

  const STACK_WINDOWS = [
    { key: 'morning', icon: '🌅', title: 'Morning', time: '7–10 AM', cutoffHour: 10 },
    { key: 'lunch',   icon: '🍽️', title: 'Lunch',   time: '12–2 PM', cutoffHour: 14 },
    { key: 'evening', icon: '🌙', title: 'Evening', time: '9–11 PM', cutoffHour: 23 },
    { key: 'anytime', icon: '⏱️', title: 'Anytime', time: 'No fixed window', cutoffHour: null },
  ];

  // ====== SUPPLEMENT DATABASE — researched defaults ======
  const SUPPLEMENT_DB = [
    { name: 'Creatine monohydrate', dose: '5g', window: 'anytime', note: 'Daily — consistency matters more than timing', icon: '🏋️', aliases: ['creatine'] },
    { name: 'Beta-alanine', dose: '2–5g', window: 'morning', note: 'Pre-workout — split doses to avoid tingles', icon: '🏋️', aliases: ['beta alanine'] },
    { name: 'L-citrulline', dose: '6–8g', window: 'morning', note: '~30 min pre-workout for pump', icon: '🏋️', aliases: ['citrulline'] },
    { name: 'BCAAs', dose: '5–10g', window: 'anytime', note: 'Around workout window', icon: '🏋️', aliases: ['bcaa'] },
    { name: 'Whey protein', dose: '25–40g', window: 'anytime', note: 'Post-workout or to hit daily target', icon: '🥤', aliases: ['whey'] },
    { name: 'Casein protein', dose: '25–40g', window: 'evening', note: 'Before bed for slow overnight aminos', icon: '🥤', aliases: ['casein'] },
    { name: 'L-carnitine', dose: '1–2g', window: 'morning', note: 'With carbs for best uptake', icon: '🏋️', aliases: ['carnitine'] },
    { name: 'Acetyl-L-carnitine', dose: '500mg–2g', window: 'morning', note: 'Cognitive variant — crosses BBB', icon: '🧠', aliases: ['alcar'] },
    { name: 'HMB', dose: '3g', window: 'anytime', note: 'Split 3x daily — muscle preservation', icon: '🏋️', aliases: ['hmb'] },
    { name: 'Glutamine', dose: '5g', window: 'anytime', note: 'Recovery — post-workout or before bed', icon: '🏋️', aliases: ['l-glutamine'] },
    { name: 'Vitamin D3', dose: '2000–5000 IU', window: 'lunch', note: 'Fat-soluble — take with biggest meal', icon: '☀️', aliases: ['vit d', 'vitamin d', 'd3', 'cholecalciferol'] },
    { name: 'Vitamin K2 (MK-7)', dose: '100–200 mcg', window: 'lunch', note: 'Pairs with D3 — same meal', icon: '💊', aliases: ['vit k', 'vitamin k', 'k2', 'mk7'] },
    { name: 'Vitamin C', dose: '500–1000mg', window: 'morning', note: 'Water-soluble — split if over 500mg', icon: '🍊', aliases: ['vit c', 'ascorbic acid'] },
    { name: 'Vitamin B12', dose: '500–1000mcg', window: 'morning', note: 'Methylcobalamin form preferred', icon: '⚡', aliases: ['b12', 'methylcobalamin'] },
    { name: 'B-complex', dose: '1 cap', window: 'morning', note: 'All B vitamins — energy', icon: '⚡', aliases: ['b complex', 'b vitamins'] },
    { name: 'Vitamin A', dose: '5000 IU', window: 'lunch', note: 'Fat-soluble — with fat', icon: '💊', aliases: ['vit a', 'retinol'] },
    { name: 'Vitamin E', dose: '400 IU', window: 'lunch', note: 'Fat-soluble — with fat', icon: '💊', aliases: ['vit e', 'tocopherol'] },
    { name: 'Folate', dose: '400–800mcg', window: 'morning', note: 'Methylfolate preferred', icon: '💊', aliases: ['folic acid', 'b9', 'methylfolate'] },
    { name: 'Biotin', dose: '30mcg–5mg', window: 'anytime', note: 'Hair, skin, nails', icon: '💅', aliases: ['biotin', 'b7'] },
    { name: 'Multivitamin', dose: '1 serving', window: 'lunch', note: 'Take with food', icon: '💊', aliases: ['multi', 'multivitamin'] },
    { name: 'Magnesium glycinate', dose: '200–400mg', window: 'evening', note: '30–60 min before bed — sleep helper', icon: '🌙', aliases: ['magnesium', 'mag glycinate', 'bisglycinate'] },
    { name: 'Magnesium L-threonate', dose: '144mg elemental', window: 'evening', note: 'Cognitive variant — crosses BBB', icon: '🧠', aliases: ['magtein', 'threonate'] },
    { name: 'Magnesium citrate', dose: '200–400mg', window: 'evening', note: 'Also supports digestion', icon: '🌙', aliases: ['mag citrate'] },
    { name: 'Zinc', dose: '15–30mg', window: 'evening', note: 'With food — not with calcium or iron', icon: '💊', aliases: ['zinc'] },
    { name: 'Iron', dose: '18–65mg', window: 'morning', note: 'Empty stomach with vit C', icon: '💊', aliases: ['iron'] },
    { name: 'Calcium', dose: '500mg', window: 'evening', note: 'With food — not with iron', icon: '🦴', aliases: ['calcium'] },
    { name: 'Selenium', dose: '100–200mcg', window: 'anytime', note: 'Thyroid + antioxidant', icon: '💊', aliases: ['selenium'] },
    { name: 'Iodine', dose: '150mcg', window: 'morning', note: 'Thyroid support', icon: '💊', aliases: ['iodine'] },
    { name: 'Omega-3 (Fish oil)', dose: '2–3g EPA+DHA', window: 'lunch', note: 'With biggest fatty meal', icon: '🐟', aliases: ['omega 3', 'omega3', 'fish oil', 'epa', 'dha'] },
    { name: 'Krill oil', dose: '500–1000mg', window: 'lunch', note: 'More absorbable than fish oil', icon: '🐟', aliases: ['krill'] },
    { name: 'MCT oil', dose: '1–2 tbsp', window: 'morning', note: 'Fast energy — start low', icon: '🥥', aliases: ['mct'] },
    { name: 'Flaxseed oil', dose: '1–2g', window: 'lunch', note: 'Plant omega-3 — with food', icon: '🌱', aliases: ['flax', 'flaxseed'] },
    { name: 'L-theanine', dose: '100–200mg', window: 'morning', note: 'Stacks with caffeine 2:1', icon: '🧠', aliases: ['theanine'] },
    { name: 'Caffeine', dose: '100–200mg', window: 'morning', note: 'Stack with L-theanine for cleaner focus', icon: '☕', aliases: ['caffeine'] },
    { name: 'Rhodiola rosea', dose: '200–400mg', window: 'morning', note: 'Adaptogen — energy and stress', icon: '🌿', aliases: ['rhodiola'] },
    { name: 'Lion\'s mane', dose: '500–1000mg', window: 'morning', note: 'Cognitive support — daily', icon: '🍄', aliases: ['lions mane', 'hericium'] },
    { name: 'Bacopa monnieri', dose: '300–600mg', window: 'morning', note: 'With fat — long-term memory', icon: '🌿', aliases: ['bacopa'] },
    { name: 'Ginkgo biloba', dose: '120–240mg', window: 'morning', note: 'Circulation and cognition', icon: '🌿', aliases: ['ginkgo'] },
    { name: 'Alpha-GPC', dose: '300–600mg', window: 'morning', note: 'Choline — focus and learning', icon: '🧠', aliases: ['alpha gpc'] },
    { name: 'Phosphatidylserine', dose: '100–300mg', window: 'evening', note: 'Cortisol regulation', icon: '🧠', aliases: ['ps'] },
    { name: 'NAC', dose: '600–1800mg', window: 'morning', note: 'Glutathione precursor — split doses', icon: '💊', aliases: ['nac', 'n-acetyl cysteine'] },
    { name: 'Melatonin', dose: '0.3–3mg', window: 'evening', note: '30–60 min before bed — start low', icon: '🌙', aliases: ['melatonin'] },
    { name: 'Glycine', dose: '3g', window: 'evening', note: 'Body temp drop = better sleep onset', icon: '🌙', aliases: ['glycine'] },
    { name: 'Apigenin', dose: '50mg', window: 'evening', note: 'From chamomile — before bed', icon: '🌙', aliases: ['apigenin'] },
    { name: 'Ashwagandha', dose: '300–600mg', window: 'evening', note: 'KSM-66 form — stress and cortisol', icon: '🌿', aliases: ['ashwagandha', 'ksm-66'] },
    { name: 'L-tryptophan', dose: '500mg–1g', window: 'evening', note: 'Serotonin precursor — sleep onset', icon: '🌙', aliases: ['tryptophan'] },
    { name: 'GABA', dose: '500–750mg', window: 'evening', note: 'Calming — before bed', icon: '🌙', aliases: ['gaba'] },
    { name: 'Valerian root', dose: '300–600mg', window: 'evening', note: 'Sleep onset support', icon: '🌙', aliases: ['valerian'] },
    { name: 'Probiotics', dose: '10–50 billion CFU', window: 'morning', note: 'Empty stomach or with food', icon: '🦠', aliases: ['probiotic'] },
    { name: 'Quercetin', dose: '500–1000mg', window: 'anytime', note: 'Pairs well with vitamin C', icon: '🌿', aliases: ['quercetin'] },
    { name: 'Curcumin', dose: '500–1000mg', window: 'lunch', note: 'With black pepper + fat', icon: '🌿', aliases: ['curcumin', 'turmeric'] },
    { name: 'Resveratrol', dose: '250–500mg', window: 'morning', note: 'With fat for absorption', icon: '🍇', aliases: ['resveratrol'] },
    { name: 'CoQ10 / Ubiquinol', dose: '100–200mg', window: 'lunch', note: 'Fat-soluble — with biggest meal', icon: '💊', aliases: ['coq10', 'ubiquinol'] },
    { name: 'Alpha lipoic acid', dose: '300–600mg', window: 'morning', note: 'Empty stomach for absorption', icon: '💊', aliases: ['ala', 'alpha lipoic'] },
    { name: 'Glutathione', dose: '250–1000mg', window: 'morning', note: 'Liposomal form for absorption', icon: '💊', aliases: ['glutathione'] },
    { name: 'Astaxanthin', dose: '4–12mg', window: 'lunch', note: 'Fat-soluble — with fatty meal', icon: '💊', aliases: ['astaxanthin'] },
    { name: 'Berberine', dose: '500mg', window: 'lunch', note: 'Before meals — glucose support', icon: '💊', aliases: ['berberine'] },
    { name: 'Milk thistle', dose: '200–400mg', window: 'anytime', note: 'Silymarin — liver support', icon: '🌿', aliases: ['milk thistle', 'silymarin'] },
    { name: 'Spirulina', dose: '3–5g', window: 'morning', note: 'Algae — protein and antioxidants', icon: '🌱', aliases: ['spirulina'] },
    { name: 'Chlorella', dose: '2–4g', window: 'morning', note: 'Algae — detox support', icon: '🌱', aliases: ['chlorella'] },
    { name: 'Tongkat ali', dose: '200–400mg', window: 'morning', note: 'Cycle 8 weeks on/off', icon: '🌿', aliases: ['tongkat', 'longjack'] },
    { name: 'Fadogia agrestis', dose: '600mg', window: 'morning', note: 'Cycle 8 weeks on/off', icon: '🌿', aliases: ['fadogia'] },
    { name: 'DHEA', dose: '25–50mg', window: 'morning', note: 'Hormonal — consult doctor', icon: '💊', aliases: ['dhea'] },
    { name: 'Pregnenolone', dose: '10–50mg', window: 'morning', note: 'Hormonal — consult doctor', icon: '💊', aliases: ['pregnenolone'] },
    { name: 'Tribulus terrestris', dose: '250–750mg', window: 'morning', note: 'Libido and energy', icon: '🌿', aliases: ['tribulus'] },
    { name: 'Maca root', dose: '1.5–3g', window: 'morning', note: 'Adaptogen — energy and libido', icon: '🌿', aliases: ['maca'] },
    { name: 'Collagen peptides', dose: '10–20g', window: 'anytime', note: 'With vitamin C for synthesis', icon: '💅', aliases: ['collagen'] },
    { name: 'Glucosamine', dose: '1500mg', window: 'lunch', note: 'With food', icon: '🦴', aliases: ['glucosamine'] },
    { name: 'Chondroitin', dose: '1200mg', window: 'lunch', note: 'Often paired with glucosamine', icon: '🦴', aliases: ['chondroitin'] },
    { name: 'MSM', dose: '1–3g', window: 'anytime', note: 'Joint support', icon: '🦴', aliases: ['msm'] },
    { name: 'Hyaluronic acid', dose: '120–200mg', window: 'anytime', note: 'Skin and joint hydration', icon: '💅', aliases: ['hyaluronic', 'ha'] },
    { name: 'Cordyceps', dose: '1–3g', window: 'morning', note: 'Energy and endurance', icon: '🍄', aliases: ['cordyceps'] },
    { name: 'Reishi', dose: '1–2g', window: 'evening', note: 'Calming adaptogen', icon: '🍄', aliases: ['reishi', 'ganoderma'] },
    { name: 'Chaga', dose: '1–2g', window: 'morning', note: 'Antioxidant and immune', icon: '🍄', aliases: ['chaga'] },
  ];

  let todayKey = `stack:taken:${getActiveDate()}`;

  function getItems() {
    const storedVersion = storeGet('stack:version');
    const stored = storeGet('stack:items');
    if (!stored || !Array.isArray(stored) || !stored.length || storedVersion !== TEMPLATE_VERSION) {
      const fresh = JSON.parse(JSON.stringify(STACK_DEFAULTS));
      storeSet('stack:items', fresh);
      storeSet('stack:version', TEMPLATE_VERSION);
      return fresh;
    }
    return stored;
  }
  function setItems(items) { storeSet('stack:items', items); }
  function getTaken() { return storeGet(todayKey) || {}; }
  function setTaken(map) { storeSet(todayKey, map); }
  function getLow() { return storeGet('stack:low') || []; }
  function setLow(arr) { storeSet('stack:low', arr); }

  function toggleTaken(id) {
    const taken = getTaken();
    if (taken[id]) delete taken[id]; else taken[id] = Date.now();
    setTaken(taken); render();
  }
  function toggleLow(id) {
    const low = getLow();
    if (low.includes(id)) setLow(low.filter(x => x !== id));
    else { low.push(id); setLow(low); }
    render();
  }
  function deleteItem(id) {
    setItems(getItems().filter(i => i.id !== id));
    const taken = getTaken();
    delete taken[id];
    setTaken(taken);
    setLow(getLow().filter(x => x !== id));
    render();
  }
  function addItem(name, dose, windowKey, note = '') {
    const v = String(name || '').trim();
    if (!v) return;
    const items = getItems();
    const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    items.push({
      id, name: v,
      dose: String(dose || '').trim(),
      window: ['morning','lunch','evening','anytime'].includes(windowKey) ? windowKey : 'anytime',
      note: String(note || '').trim(),
      tag: null, ordered: true
    });
    setItems(items);
    render();
  }
  function updateItem(id, field, value) {
    const items = getItems();
    const item = items.find(i => i.id === id);
    if (!item) return;
    item[field] = value;
    setItems(items);
  }

  function render() {
    const items = getItems();
    const taken = getTaken();
    const low = getLow();
    const totalCount = items.length;
    const takenCount = items.filter(i => taken[i.id]).length;
    document.getElementById('stackProgressText').textContent =
      `${takenCount} / ${totalCount} taken today · resets at 6 AM`;
    const pct = totalCount === 0 ? 0 : (takenCount / totalCount) * 100;
    document.getElementById('stackProgressBar').style.width = pct + '%';

    const groupsEl = document.getElementById('stackGroups');
    groupsEl.innerHTML = '';

    const now = new Date();
    const nowHour = now.getHours() + (now.getMinutes() / 60);

    STACK_WINDOWS.forEach(win => {
      const winItems = items.filter(i => (i.window || 'anytime') === win.key);
      if (winItems.length === 0) return;

      const group = document.createElement('div');
      group.className = 'stack-window';
      group.innerHTML = `
        <div class="stack-window-header">
          <span class="stack-window-icon">${win.icon}</span>
          <span class="stack-window-title">${win.title}</span>
          <span class="stack-window-time">${win.time}</span>
        </div>`;

      const isPastCutoff = win.cutoffHour !== null && nowHour > win.cutoffHour;

      winItems.forEach(item => {
        const isTaken = !!taken[item.id];
        const isLow = low.includes(item.id);
        const isMissed = !isTaken && isPastCutoff;

        const row = document.createElement('div');
        row.className = 'stack-item' + (isTaken ? ' taken' : '') + (isMissed ? ' missed' : '');

        let tagHtml = '';
        if (item.tag === 'stack') tagHtml = '<span class="stack-item-tag tag-stack">stack</span>';
        else if (item.tag === 'not-ordered') tagHtml = '<span class="stack-item-tag tag-not-ordered">not ordered</span>';

        row.innerHTML = `
          <button class="stack-check ${isTaken ? 'checked' : ''}" data-action="toggle" data-id="${item.id}" aria-label="Mark taken">${isTaken ? '✓' : ''}</button>
          <div class="stack-item-body">
            <div class="stack-item-name" data-edit="name" data-id="${item.id}">
              <span class="stack-item-name-text">${escapeHtml(item.name)}</span>${tagHtml}
            </div>
            <div class="stack-item-meta" data-edit="meta" data-id="${item.id}">${escapeHtml(metaText(item))}</div>
          </div>
          <button class="stack-low-btn ${isLow ? 'is-low' : ''}" data-action="low" data-id="${item.id}">↓ Running low</button>
          <button class="stack-item-del" data-action="del" data-id="${item.id}" aria-label="Delete">×</button>`;

        group.appendChild(row);
      });

      groupsEl.appendChild(group);
    });

    if (groupsEl.children.length === 0) {
      groupsEl.innerHTML = `<div class="stack-window-empty">No items yet — add one below to start your stack.</div>`;
    }

    // Sync ticker after every render
    renderTicker();
  }

  // ====== TICKER ======
  let tickerIndex = 0;
  let tickerInterval = null;
  let cachedIssues = [];

  function getStackIssues() {
    const items = getItems();
    const taken = getTaken();
    const low = getLow();
    const now = new Date();
    const nowHour = now.getHours() + (now.getMinutes() / 60);

    const missed = [];
    const lowList = [];

    items.forEach(item => {
      const win = STACK_WINDOWS.find(w => w.key === (item.window || 'anytime'));
      const isPastCutoff = win && win.cutoffHour !== null && nowHour > win.cutoffHour;
      const isTaken = !!taken[item.id];
      if (isPastCutoff && !isTaken) {
        missed.push({
          type: 'missed',
          text: `${item.name} — missed ${win.title.toLowerCase()} dose`
        });
      }
      if (low.includes(item.id)) {
        lowList.push({
          type: 'low',
          text: `${item.name} — running low, reorder soon`
        });
      }
    });

    return [...missed, ...lowList];
  }

  function renderTicker() {
    const issues = getStackIssues();
    const tickerEl = document.getElementById('stackTicker');
    const msgEl = document.getElementById('stackTickerMsg');
    const countEl = document.getElementById('stackTickerCount');
    const totalItems = getItems().length;

    cachedIssues = issues;

    if (issues.length === 0) {
      msgEl.textContent = 'All caught up — keep it rolling';
      tickerEl.classList.remove('status-low', 'status-missed');
      countEl.textContent = `0/${totalItems}`;
      tickerIndex = 0;
      return;
    }

    const hasMissed = issues.some(i => i.type === 'missed');
    tickerEl.classList.remove('status-low', 'status-missed');
    tickerEl.classList.add(hasMissed ? 'status-missed' : 'status-low');

    if (tickerIndex >= issues.length) tickerIndex = 0;
    msgEl.textContent = issues[tickerIndex].text;
    countEl.textContent = `${issues.length}/${totalItems}`;
  }

  function cycleTicker() {
    if (cachedIssues.length <= 1) {
      renderTicker();
      return;
    }
    const msgEl = document.getElementById('stackTickerMsg');
    msgEl.classList.add('is-fading');
    setTimeout(() => {
      tickerIndex++;
      renderTicker();
      msgEl.classList.remove('is-fading');
    }, 280);
  }

  function startTicker() {
    if (tickerInterval) clearInterval(tickerInterval);
    tickerInterval = setInterval(cycleTicker, 5000);
  }

  function metaText(item) {
    const parts = [];
    if (item.dose) parts.push(item.dose);
    if (item.note) parts.push(item.note);
    return parts.join(' · ');
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  document.getElementById('stackGroups').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();
    const id = btn.dataset.id;
    if (btn.dataset.action === 'toggle') toggleTaken(id);
    else if (btn.dataset.action === 'low') toggleLow(id);
    else if (btn.dataset.action === 'del') deleteItem(id);
  });
  document.getElementById('stackGroups').addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('[data-action="del"]');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    deleteItem(btn.dataset.id);
  });
  document.getElementById('stackGroups').addEventListener('click', (e) => {
    const editEl = e.target.closest('[data-edit]');
    if (!editEl) return;
    if (e.target.closest('[data-action]')) return;
    if (editEl.getAttribute('contenteditable') === 'true') return;
    startEdit(editEl);
  });

  function startEdit(el) {
    const id = el.dataset.id;
    const field = el.dataset.edit;
    if (field === 'name') {
      const textSpan = el.querySelector('.stack-item-name-text');
      if (!textSpan) return;
      textSpan.setAttribute('contenteditable', 'true');
      textSpan.style.outline = '1px solid rgba(255,255,255,0.25)';
      textSpan.style.outlineOffset = '4px';
      textSpan.style.borderRadius = '4px';
      textSpan.focus();
      placeCaretAtEnd(textSpan);
      const finish = (commit) => {
        textSpan.removeAttribute('contenteditable');
        textSpan.style.outline = ''; textSpan.style.outlineOffset = '';
        if (commit) {
          const newVal = textSpan.textContent.trim();
          if (newVal) updateItem(id, 'name', newVal); else render();
        } else render();
      };
      textSpan.addEventListener('blur', () => finish(true), { once: true });
      textSpan.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); textSpan.blur(); }
        if (e.key === 'Escape') { textSpan.blur(); render(); }
      });
    }
    if (field === 'meta') {
      el.setAttribute('contenteditable', 'true');
      el.focus(); placeCaretAtEnd(el);
      const finish = (commit) => {
        el.removeAttribute('contenteditable');
        if (commit) {
          const text = el.textContent.trim();
          const parts = text.split(/\s*·\s*/);
          updateItem(id, 'dose', parts[0] || '');
          updateItem(id, 'note', parts.slice(1).join(' · '));
        }
        render();
      };
      el.addEventListener('blur', () => finish(true), { once: true });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        if (e.key === 'Escape') { el.blur(); render(); }
      });
    }
  }

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ====== ADD FORM + SEARCH AUTOCOMPLETE ======
  const nameInput = document.getElementById('stackAddName');
  const doseInput = document.getElementById('stackAddDose');
  const winSelect = document.getElementById('stackAddWindow');
  const addBtn = document.getElementById('stackAddBtn');
  const resultsEl = document.getElementById('stackSearchResults');

  let pendingNote = ''; // hidden note auto-filled when a DB result is selected

  function searchSupplements(q) {
    const query = q.toLowerCase().trim();
    if (!query) return [];
    const starts = [];
    const contains = [];
    SUPPLEMENT_DB.forEach(s => {
      const nameLC = s.name.toLowerCase();
      const aliases = (s.aliases || []).map(a => a.toLowerCase());
      const allNames = [nameLC, ...aliases];
      if (allNames.some(n => n.startsWith(query))) starts.push(s);
      else if (allNames.some(n => n.includes(query))) contains.push(s);
    });
    return [...starts, ...contains].slice(0, 6);
  }

  function renderSearchResults(q) {
    const matches = searchSupplements(q);
    if (!q.trim() || matches.length === 0) {
      resultsEl.hidden = true;
      resultsEl.innerHTML = '';
      return;
    }
    resultsEl.hidden = false;
    resultsEl.innerHTML = matches.map(s => {
      const winMeta = STACK_WINDOWS.find(w => w.key === s.window) || STACK_WINDOWS[3];
      return `
        <button class="stack-result" data-name="${escapeHtml(s.name)}" data-dose="${escapeHtml(s.dose)}" data-window="${s.window}" data-note="${escapeHtml(s.note)}">
          <div class="stack-result-icon">${s.icon || '💊'}</div>
          <div class="stack-result-body">
            <div class="stack-result-name">${escapeHtml(s.name)}</div>
            <div class="stack-result-meta">${escapeHtml(s.dose)} · ${winMeta.icon} ${winMeta.title.toLowerCase()} · ${escapeHtml(s.note)}</div>
          </div>
        </button>`;
    }).join('');
  }

  nameInput.addEventListener('input', () => {
    renderSearchResults(nameInput.value);
    pendingNote = ''; // reset note if user is typing manually
  });
  nameInput.addEventListener('focus', () => {
    if (nameInput.value.trim()) renderSearchResults(nameInput.value);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.stack-name-wrap')) resultsEl.hidden = true;
  });

  resultsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.stack-result');
    if (!btn) return;
    nameInput.value = btn.dataset.name;
    doseInput.value = btn.dataset.dose;
    winSelect.value = btn.dataset.window;
    pendingNote = btn.dataset.note;
    resultsEl.hidden = true;
    addBtn.focus();
  });

  addBtn.addEventListener('click', () => {
    addItem(nameInput.value, doseInput.value, winSelect.value, pendingNote);
    nameInput.value = '';
    doseInput.value = '';
    pendingNote = '';
    resultsEl.hidden = true;
    nameInput.focus();
  });

  [nameInput, doseInput].forEach(i => {
    i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        // If search dropdown is open with matches, pick the first one
        if (!resultsEl.hidden && i === nameInput) {
          const firstResult = resultsEl.querySelector('.stack-result');
          if (firstResult) { e.preventDefault(); firstResult.click(); return; }
        }
        addBtn.click();
      }
      if (e.key === 'Escape') resultsEl.hidden = true;
    });
  });

  setInterval(() => {
    const newKey = `stack:taken:${getActiveDate()}`;
    if (newKey !== todayKey) todayKey = newKey;
    render();
  }, 60 * 1000);

  render();
  startTicker();
})();



// ── Supabase cross-device sync ────────────────────────────────────────────────
(function() {
  const SUPABASE_URL = 'https://uaqhwvtxmzaorfjackpa.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_sLs1FGWDe7a_ue9md3juzw_uQUL4Csw';
  const APP_KEY = 'daily-stack';

  function getActiveDate() {
    const now = new Date();
    if (now.getHours() < 6) now.setDate(now.getDate() - 1);
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const SYNCED_KEYS = ['stack:items', 'stack:low', `stack:taken:${getActiveDate()}`];

  let supa = null;
  let lastSyncedJson = null;

  function collectState() {
    const state = {};
    for (const k of SYNCED_KEYS) {
      const v = localStorage.getItem(k);
      if (v !== null) state[k] = JSON.parse(v);
    }
    return state;
  }

  function applyRemote(data) {
    for (const [k, v] of Object.entries(data)) {
      localStorage.setItem(k, JSON.stringify(v));
    }
    // Re-render by dispatching storage event
    window.dispatchEvent(new Event('stack-sync'));
  }

  let pushTimer = null;
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(doPush, 1200);
  }

  async function doPush() {
    if (!supa) return;
    const state = collectState();
    if (!Object.keys(state).length) return;
    const json = JSON.stringify(state);
    if (json === lastSyncedJson) return;
    lastSyncedJson = json;
    await supa.from('app_state').upsert({
      key: APP_KEY, data: state, updated_at: new Date().toISOString()
    });
  }

  // Patch localStorage so every write triggers a push
  const _setItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(k, v) {
    _setItem(k, v);
    if (SYNCED_KEYS.some(sk => k === sk || k.startsWith('stack:'))) schedulePush();
  };

  (async function init() {
    if (!window.supabase) return;
    supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    try {
      const { data, error } = await supa.from('app_state').select('data').eq('key', APP_KEY).maybeSingle();
      if (!error && data && data.data && Object.keys(data.data).length > 0) {
        lastSyncedJson = JSON.stringify(data.data);
        applyRemote(data.data);
      } else if (Object.keys(collectState()).length > 0) {
        schedulePush();
      }
    } catch (_) {}

    supa.channel('app_state_' + APP_KEY)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'app_state',
        filter: 'key=eq.' + APP_KEY,
      }, (payload) => {
        if (!payload.new || !payload.new.data) return;
        const incoming = JSON.stringify(payload.new.data);
        if (incoming === lastSyncedJson) return;
        lastSyncedJson = incoming;
        applyRemote(payload.new.data);
      }).subscribe();
  })();
})();
