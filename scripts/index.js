
  // ── Schedule settings (editable via topbar cog) ──
  function getSchedule() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('dashboard:settings')) || {}; } catch (e) {}
    const wakeTime  = s.wakeTime  || '08:00';
    const sleepTime = s.sleepTime || '00:00';
    function toH(t) { const [h, m] = t.split(':').map(Number); return h + m / 60; }
    const wakeH  = toH(wakeTime);
    let   sleepH = toH(sleepTime);
    if (sleepH <= wakeH) sleepH += 24; // crosses midnight
    return { WAKE_HOUR: wakeH, SLEEP_HOUR: sleepH };
  }
  const ANTHROPIC_API_KEY = '';

  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── Sync indicator helpers ──
  function syncStatus(state, msg) {
    const dot = document.getElementById('syncDot');
    if (!dot) return;
    dot.className = 'sync-dot ' + state;
    dot.title = msg || state;
  }

  // ── Storage helpers ──
  function storeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function storeSet(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    syncStatus('syncing', 'Saving…');
    db.from('kv').upsert({ key, value, updated_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) { console.error('[sync] upsert failed:', error); syncStatus('error', 'Sync failed — ' + error.message); }
        else syncStatus('synced', 'Saved');
      });
  }
  function storeDelete(key) {
    localStorage.removeItem(key);
    db.from('kv').delete().eq('key', key).then(({ error }) => {
      if (error) console.error('[sync] delete failed:', error);
    });
  }
  function storeListKeys(prefix) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    return keys;
  }

  // Apply a fresh set of remote rows into localStorage then re-render
  function applyRemoteRows(rows) {
    for (const row of rows) {
      localStorage.setItem(row.key, JSON.stringify(row.value));
    }
    loadToday();
    loadTomorrow();
    renderStreak();
    cycleIdx = 0;
    window.dispatchEvent(new CustomEvent('goals-changed'));
  }

  // Pull all rows from Supabase on load, then subscribe to realtime changes
  async function syncFromSupabase() {
    syncStatus('syncing', 'Connecting…');
    const { data, error } = await db.from('kv').select('key, value');
    if (error) {
      console.error('[sync] initial pull failed:', error);
      syncStatus('error', 'Sync error — ' + error.message + '. Have you created the kv table in Supabase?');
      return;
    }

    if (data.length === 0) {
      // First launch: remote is empty — push local data up so existing work isn't lost
      const localKeys = storeListKeys('goals:');
      localKeys.push('goal_streak_v1');
      for (const k of localKeys) {
        const val = storeGet(k);
        if (val !== null) {
          await db.from('kv').upsert({ key: k, value: val, updated_at: new Date().toISOString() });
        }
      }
      syncStatus('synced', 'First sync — local data uploaded');
    } else {
      applyRemoteRows(data);
      syncStatus('synced', 'Synced');
    }

    // Realtime subscription — changes from another device apply within ~1 second
    db.channel('kv-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kv' }, (payload) => {
        const { eventType, new: row, old } = payload;
        if (eventType === 'DELETE') {
          localStorage.removeItem(old.key);
        } else if (row && row.key) {
          localStorage.setItem(row.key, JSON.stringify(row.value));
        }
        loadToday();
        loadTomorrow();
        renderStreak();
        cycleIdx = 0;
        window.dispatchEvent(new CustomEvent('goals-changed'));
        syncStatus('synced', 'Synced from another device');
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') syncStatus('synced', 'Live sync active');
        if (status === 'CHANNEL_ERROR') syncStatus('error', 'Realtime connection failed');
      });
  }

  // ── Date helpers ──
  function padZ(n) { return String(n).padStart(2, '0'); }

  function toDateString(d) {
    return `${d.getFullYear()}-${padZ(d.getMonth()+1)}-${padZ(d.getDate())}`;
  }

  function getActiveDateString() {
    const now = new Date();
    if (now.getHours() < 6) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return toDateString(yesterday);
    }
    return toDateString(now);
  }

  function getTomorrowDateString() {
    const now = new Date();
    if (now.getHours() < 6) {
      return toDateString(now);
    }
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return toDateString(tomorrow);
  }

  function formatDate(ds) {
    const [y, m, d] = ds.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${weekdays[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
  }

  // ── Rollover & streak ──
  function runRollover() {
    const activeDate = getActiveDateString();
    const allKeys = storeListKeys('goals:').sort();
    const todayGoals = storeGet(`goals:${activeDate}`) || [];
    let changed = false;

    for (const k of allKeys) {
      const ds = k.replace('goals:', '');
      if (ds >= activeDate) continue;
      const old = storeGet(k) || [];
      const undone = old.filter(g => !g.done);
      if (undone.length > 0) {
        const existingTexts = new Set(todayGoals.map(g => g.text));
        for (const g of undone) {
          if (!existingTexts.has(g.text)) {
            todayGoals.push({ text: g.text, done: false });
            existingTexts.add(g.text);
          }
        }
        changed = true;
      }
      storeDelete(k);
    }

    if (changed) storeSet(`goals:${activeDate}`, todayGoals);
  }

  function runStreakCheck() {
    const streakData = storeGet('goal_streak_v1') || { count: 0, lastProcessedDate: null };
    const allKeys = storeListKeys('goals:').sort();
    const activeDate = getActiveDateString();

    for (const k of allKeys) {
      const ds = k.replace('goals:', '');
      if (ds >= activeDate) continue;
      if (streakData.lastProcessedDate && ds <= streakData.lastProcessedDate) continue;
      const goals = storeGet(k) || [];
      if (goals.length === 0) { streakData.lastProcessedDate = ds; continue; }
      const allDone = goals.every(g => g.done);
      streakData.count = allDone ? streakData.count + 1 : 0;
      streakData.lastProcessedDate = ds;
    }

    storeSet('goal_streak_v1', streakData);
  }

  // ── Goal Ticker ──
  let tickerItems = [];
  let cycleIdx = 0;
  let tickerInterval = null;

  function buildTickerItems() {
    const key = `goals:${getActiveDateString()}`;
    const goals = storeGet(key) || [];
    const total = goals.length;
    const done  = goals.filter(g => g.done).length;

    let items;
    if (total === 0) {
      items = [{ status: 'empty', text: 'No goals set for today — add one to get rolling.' }];
    } else if (done === total) {
      items = [{ status: 'done', text: '✓ All goals done — solid day.' }];
    } else {
      items = goals.filter(g => !g.done).map(g => ({ status: 'pending', text: fixMojibake(g.text) }));
    }
    return { items, done, total };
  }

  function getStatusGlyph(status) {
    if (status === 'done')    return '✓';
    if (status === 'pending') return '○';
    return '·';
  }

  function tick(isFirst) {
    const { items, done, total } = buildTickerItems();
    tickerItems = items;

    document.getElementById('goalTickerMeta').textContent = `${done}/${total}`;

    const stage = document.getElementById('goalTickerStage');
    const item  = tickerItems[cycleIdx % tickerItems.length];
    cycleIdx = (cycleIdx + 1) % Math.max(tickerItems.length, 1);

    const oldRow = stage.querySelector('.goal-ticker-row');

    const newRow = document.createElement('div');
    newRow.className = 'goal-ticker-row';
    newRow.innerHTML = `<span class="goal-ticker-status" data-status="${item.status}">${getStatusGlyph(item.status)}</span><span class="goal-ticker-text">${escHtml(item.text)}</span>`;

    if (isFirst || !oldRow) {
      if (oldRow) oldRow.remove();
      stage.appendChild(newRow);
    } else {
      oldRow.classList.add('is-leaving');
      setTimeout(() => {
        if (oldRow.parentNode) oldRow.remove();
        stage.appendChild(newRow);
        requestAnimationFrame(() => newRow.classList.add('is-entering'));
      }, 260);
    }
  }

  function startTicker() {
    tick(true);
    tickerInterval = setInterval(() => tick(false), 5000);
  }

  window.addEventListener('goals-changed', () => {
    cycleIdx = 0;
    tick(false);
  });

  // ── Day Ring ──
  const SUN_STOPS = [
    [255, 216, 158],
    [255, 205, 121],
    [255, 227, 143],
    [255, 183, 106],
    [255, 149,  89],
    [243, 111,  79],
    [226,  93, 122],
    [123,  91, 176],
    [ 47,  58, 102],
  ];

  function lerpColor(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }

  function getSunColor(pct) {
    const stops = SUN_STOPS;
    const t = Math.max(0, Math.min(1, pct / 100));
    const idx = t * (stops.length - 1);
    const lo  = Math.floor(idx);
    const hi  = Math.min(stops.length - 1, lo + 1);
    const frac = idx - lo;
    const [r, g, b] = lerpColor(stops[lo], stops[hi], frac);
    return `rgb(${r},${g},${b})`;
  }

  function formatClockTime(now) {
    let h = now.getHours();
    const m = padZ(now.getMinutes());
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  }

  function formatDuration(totalMins) {
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  function updateDayBar() {
    const { WAKE_HOUR, SLEEP_HOUR } = getSchedule();
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    const C = 2 * Math.PI * 52;

    const ringFill  = document.getElementById('ringFill');
    const ringTrack = document.getElementById('ringTrack');
    const ringPercEl = document.getElementById('ringPercent');
    const ringPhaseEl = document.getElementById('ringPhase');
    const ringClockEl = document.getElementById('ringClock');
    const ringStatusEl = document.getElementById('ringStatus');
    const ringRemainingEl = document.getElementById('ringRemaining');

    ringFill.style.strokeDasharray = C;
    ringClockEl.textContent = formatClockTime(now);

    if (hours < WAKE_HOUR) {
      ringFill.setAttribute('stroke', '#4D4B47');
      ringFill.style.strokeDashoffset = C;
      ringPercEl.textContent = '—';
      ringPhaseEl.textContent = 'SLEEPING';
      ringStatusEl.textContent = '😴 Still sleeping';
      const minsUntil = Math.round((WAKE_HOUR - hours) * 60);
      ringRemainingEl.textContent = `${formatDuration(minsUntil)} until wake-up`;
    } else if (hours < SLEEP_HOUR) {
      const pct = (hours - WAKE_HOUR) / (SLEEP_HOUR - WAKE_HOUR) * 100;
      const color = getSunColor(pct);
      ringFill.setAttribute('stroke', color);
      ringFill.style.strokeDashoffset = C * (1 - pct / 100);
      ringPercEl.textContent = `${Math.round(pct)}%`;

      let phase, status;
      if (pct < 18.75) {
        phase = 'MORNING'; status = '☀️ Morning — fresh start';
      } else if (pct < 31.25) {
        phase = 'MIDDAY'; status = '⚡ Midday — keep moving';
      } else if (pct < 56.25) {
        phase = 'AFTERNOON'; status = '🔥 Afternoon — push it';
      } else if (pct < 90) {
        phase = 'EVENING'; status = '⏳ Evening — wrap up';
      } else {
        phase = 'BEDTIME'; status = '🌙 Bedtime soon';
      }

      ringPhaseEl.textContent = phase;
      ringStatusEl.textContent = status;
      const minsLeft = Math.round((SLEEP_HOUR - hours) * 60);
      ringRemainingEl.textContent = `${formatDuration(minsLeft)} awake time left`;
    } else {
      ringFill.setAttribute('stroke', '#E25D7A');
      ringFill.style.strokeDashoffset = 0;
      ringPercEl.textContent = '100%';
      ringPhaseEl.textContent = 'PAST BEDTIME';
      ringStatusEl.textContent = '⚠️ Past bedtime';
      ringRemainingEl.textContent = 'Sleep!';
    }
  }

  // ── Escape HTML ──
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fixMojibake(str) {
    if (!str || typeof str !== 'string') return str;
    if (!/[\x80-\xff]/.test(str)) return str;
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 0xff) return str;
    }
    try {
      const bytes = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) { return str; }
  }

  // ── Render today header ──
  function renderTodayHeader() {
    const key = `goals:${getActiveDateString()}`;
    const goals = storeGet(key) || [];
    const total = goals.length;
    const done  = goals.filter(g => g.done).length;

    document.getElementById('todayLabel').textContent = `Today — ${formatDate(getActiveDateString())}`;
    document.getElementById('gmProgressNum').textContent = done;
    document.getElementById('gmProgressTotal').textContent = `/ ${total}`;

    const labelEl = document.getElementById('gmProgressLabel');
    if (total === 0) {
      labelEl.textContent = 'no goals yet';
    } else if (done === total) {
      labelEl.textContent = 'all done — solid day';
    } else {
      labelEl.textContent = 'complete';
    }

    // Segmented bar
    const bar = document.getElementById('gmBar');
    bar.innerHTML = '';
    goals.forEach(g => {
      const seg = document.createElement('div');
      seg.className = 'gm-bar-seg' + (g.done ? ' gm-bar-seg-done' : '');
      bar.appendChild(seg);
    });

    // All done state
    const card = document.getElementById('todayCard');
    if (total > 0 && done === total) {
      card.classList.add('gm-all-done');
    } else {
      card.classList.remove('gm-all-done');
    }

    // Push button
    const pushBtn = document.getElementById('gmPushBtn');
    const hasUnchecked = goals.some(g => !g.done);
    pushBtn.style.display = hasUnchecked ? 'block' : 'none';
  }

  function renderStreak() {
    const data = storeGet('goal_streak_v1') || { count: 0 };
    const count = data.count || 0;
    document.getElementById('gmStreakNum').textContent = count;
    const el = document.getElementById('gmStreak');
    if (count > 0) {
      el.classList.add('gm-streak-active');
    } else {
      el.classList.remove('gm-streak-active');
    }
  }

  function renderTomorrowCount() {
    const key = `goals:${getTomorrowDateString()}`;
    const goals = storeGet(key) || [];
    const ct = document.getElementById('gmTomorrowCount');
    ct.textContent = `${goals.length} planned`;
    document.getElementById('tomorrowLabel').textContent = `Plan tomorrow — ${formatDate(getTomorrowDateString())}`;
  }

  // ── Inline edit ──
  function makeInlineEdit(el, onCommit) {
    let original = '';
    el.addEventListener('click', (e) => {
      if (el.getAttribute('contenteditable') === 'true') return;
      original = el.textContent;
      el.setAttribute('contenteditable', 'true');
      el.focus();
      // Place caret at end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') {
        el.textContent = original;
        el.setAttribute('contenteditable', 'false');
      }
    });
    el.addEventListener('blur', () => {
      if (el.getAttribute('contenteditable') !== 'true') return;
      el.setAttribute('contenteditable', 'false');
      const newText = el.textContent.trim();
      if (newText && newText !== original) {
        onCommit(newText);
      } else {
        el.textContent = original;
      }
    });
  }

  // ── Drag reorder ──
  function wireDragReorder(li, goals, idx, key, reload) {
    li.setAttribute('draggable', 'true');
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', idx);
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('drag-over-top');
    });
    li.addEventListener('dragleave', () => {
      li.classList.remove('drag-over-top');
      li.classList.remove('drag-over-bottom');
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over-top');
      li.classList.remove('drag-over-bottom');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      if (fromIdx === idx) return;
      const updated = storeGet(key) || [];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(idx, 0, moved);
      storeSet(key, updated);
      reload();
    });
  }

  // ── Build goal row ──
  function buildGoalRow(g, idx, key, readOnly, reload) {
    const li = document.createElement('li');
    li.className = 'goal-row' + (g.done ? ' is-done' : '') + (g.queued ? ' is-queued' : '');

    // Drag handle
    const handle = document.createElement('span');
    handle.className = 'goal-drag-handle';
    handle.textContent = '⋮⋮';
    handle.setAttribute('aria-hidden', 'true');
    li.appendChild(handle);

    // Checkbox
    const cbWrap = document.createElement('label');
    cbWrap.className = 'goal-cb-wrap';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = g.done;
    if (readOnly) {
      cb.disabled = true;
      cb.title = 'Activates at 6 AM tomorrow';
    }
    const cbBox = document.createElement('span');
    cbBox.className = 'goal-cb-box';
    cbWrap.appendChild(cb);
    cbWrap.appendChild(cbBox);
    li.appendChild(cbWrap);

    // Text
    const textEl = document.createElement('span');
    textEl.className = 'goal-text';
    textEl.textContent = fixMojibake(g.text);
    li.appendChild(textEl);

    // Queue button
    const qBtn = document.createElement('button');
    qBtn.className = 'gm-queue-btn' + (g.queued ? ' is-queued' : '');
    qBtn.textContent = '⚡';
    qBtn.title = 'Toggle productivity queue';
    if (readOnly) qBtn.disabled = true;
    li.appendChild(qBtn);

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'goal-delete';
    delBtn.textContent = '×';
    delBtn.title = 'Delete goal';
    li.appendChild(delBtn);

    // Wire checkbox
    if (!readOnly) {
      cb.addEventListener('change', () => {
        const goals = storeGet(key) || [];
        goals[idx].done = cb.checked;
        if (cb.checked) goals[idx].doneAt = Date.now();
        else delete goals[idx].doneAt;
        storeSet(key, goals);
        window.dispatchEvent(new CustomEvent('goals-changed'));
        reload();
      });
    }

    // Wire inline edit
    if (!readOnly) {
      makeInlineEdit(textEl, (newText) => {
        const goals = storeGet(key) || [];
        goals[idx].text = newText;
        storeSet(key, goals);
        window.dispatchEvent(new CustomEvent('goals-changed'));
        reload();
      });
    }

    // Wire queue
    if (!readOnly) {
      qBtn.addEventListener('click', () => {
        const goals = storeGet(key) || [];
        goals[idx].queued = !goals[idx].queued;
        storeSet(key, goals);
        li.classList.add('is-queue-flashing');
        window.dispatchEvent(new CustomEvent('goals-changed'));
        setTimeout(() => reload(), 480);
      });
    }

    // Wire delete
    delBtn.addEventListener('click', () => {
      const goals = storeGet(key) || [];
      goals.splice(idx, 1);
      storeSet(key, goals);
      window.dispatchEvent(new CustomEvent('goals-changed'));
      reload();
    });

    // Wire drag
    wireDragReorder(li, null, idx, key, reload);

    return li;
  }

  // ── Render list ──
  function renderListInto(goals, listEl, emptyEl, key, readOnly) {
    listEl.innerHTML = '';
    if (goals.length === 0) {
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    const SHOW_LIMIT = 5;
    const visible = goals.slice(0, SHOW_LIMIT);
    const hidden  = goals.slice(SHOW_LIMIT);
    let expanded = false;

    const reload = readOnly ? loadTomorrow : loadToday;

    visible.forEach((g, i) => {
      listEl.appendChild(buildGoalRow(g, i, key, readOnly, reload));
    });

    if (hidden.length > 0) {
      const toggle = document.createElement('div');
      toggle.className = 'show-more-row';
      toggle.textContent = `Show ${hidden.length} more ▾`;
      listEl.appendChild(toggle);

      const hiddenEls = [];
      hidden.forEach((g, i) => {
        const row = buildGoalRow(g, SHOW_LIMIT + i, key, readOnly, reload);
        row.style.display = 'none';
        hiddenEls.push(row);
        listEl.insertBefore(row, toggle);
      });

      toggle.addEventListener('click', () => {
        expanded = !expanded;
        hiddenEls.forEach(r => r.style.display = expanded ? '' : 'none');
        toggle.textContent = expanded ? 'Show less ▴' : `Show ${hidden.length} more ▾`;
      });
    }

    if (!readOnly) renderTodayHeader();
    else renderTomorrowCount();
  }

  function loadToday() {
    const key   = `goals:${getActiveDateString()}`;
    const goals = storeGet(key) || [];
    renderListInto(goals, document.getElementById('goalList'), document.getElementById('emptyState'), key, false);
    renderTodayHeader();
  }

  function loadTomorrow() {
    const key   = `goals:${getTomorrowDateString()}`;
    const goals = storeGet(key) || [];
    renderListInto(goals, document.getElementById('tomorrowList'), document.getElementById('tomorrowEmptyState'), key, true);
    renderTomorrowCount();
  }

  // ── Polish via Claude API ──
  async function polishGoal(text) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Clean up this goal into one clear, concise action item. Return ONLY a JSON array with exactly one string element, no preamble, no markdown fences.\n\nGoal: ${text}`,
        }],
      }),
    });
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = await resp.json();
    const raw = data.content[0].text.trim();
    const arr = JSON.parse(raw);
    return arr[0];
  }

  // ── Make add handlers ──
  function makeAddHandlers(inputEl, addBtn, polishBtn, key, statusEl, reload) {
    function showStatus(msg, isError, duration) {
      statusEl.textContent = msg;
      statusEl.className = 'polish-status' + (isError ? ' error' : '');
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'polish-status'; }, duration || 3500);
    }

    function doAdd(text) {
      if (!text) return;
      const goals = storeGet(key) || [];
      goals.push({ text, done: false });
      storeSet(key, goals);
      inputEl.value = '';
      window.dispatchEvent(new CustomEvent('goals-changed'));
      reload();
    }

    addBtn.addEventListener('click', () => doAdd(inputEl.value.trim()));
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAdd(inputEl.value.trim());
    });

    polishBtn.addEventListener('click', async () => {
      const text = inputEl.value.trim();
      if (!text) return;
      if (!ANTHROPIC_API_KEY) {
        doAdd(text);
        showStatus('Polish needs an Anthropic API key — added as-typed.');
        return;
      }
      polishBtn.disabled = true;
      polishBtn.textContent = '✨ Polishing…';
      try {
        const polished = await polishGoal(text);
        doAdd(polished);
      } catch (err) {
        doAdd(text);
        showStatus('Polish failed — added as-typed.', true);
      } finally {
        polishBtn.disabled = false;
        polishBtn.textContent = '✨ Polish';
      }
    });
  }

  // ── Push remaining (custom modal) ──
  function doPushToTomorrow() {
    const todayKey    = `goals:${getActiveDateString()}`;
    const tomorrowKey = `goals:${getTomorrowDateString()}`;
    const todayGoals  = storeGet(todayKey) || [];
    const tmrGoals    = storeGet(tomorrowKey) || [];
    const tmrTexts    = new Set(tmrGoals.map(g => g.text));

    const unchecked = todayGoals.filter(g => !g.done);
    for (const g of unchecked) {
      if (!tmrTexts.has(g.text)) {
        tmrGoals.push({ text: g.text, done: false });
        tmrTexts.add(g.text);
      }
    }
    storeSet(tomorrowKey, tmrGoals);

    const remaining = todayGoals.filter(g => g.done);
    storeSet(todayKey, remaining);

    window.dispatchEvent(new CustomEvent('goals-changed'));
    loadToday();
    loadTomorrow();
  }

  function openPushModal() {
    const key = `goals:${getActiveDateString()}`;
    const goals = storeGet(key) || [];
    const count = goals.filter(g => !g.done).length;
    const noun = count === 1 ? 'goal' : 'goals';
    document.getElementById('pushModalBody').innerHTML =
      `<strong>${count} unchecked ${noun}</strong> will be moved to tomorrow's list.`;
    document.getElementById('pushModal').classList.add('is-open');
  }

  function closePushModal() {
    document.getElementById('pushModal').classList.remove('is-open');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const cogBtn = document.getElementById('ringCogBtn');
    if (cogBtn) cogBtn.addEventListener('click', () => window._schedOpen && window._schedOpen());

    document.getElementById('gmPushBtn').addEventListener('click', openPushModal);
    document.getElementById('pushModalCancel').addEventListener('click', closePushModal);
    document.getElementById('pushModalConfirm').addEventListener('click', () => {
      closePushModal();
      doPushToTomorrow();
    });
    document.getElementById('pushModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closePushModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePushModal();
    });
  });

  // ── Init ──
  (async () => {
    await syncFromSupabase(); // pull latest data from Supabase before rendering

    runRollover();
    runStreakCheck();

    makeAddHandlers(
      document.getElementById('goalInput'),
      document.getElementById('goalAddBtn'),
      document.getElementById('goalPolishBtn'),
      `goals:${getActiveDateString()}`,
      document.getElementById('polishStatus'),
      loadToday
    );

    makeAddHandlers(
      document.getElementById('tomorrowInput'),
      document.getElementById('tomorrowAddBtn'),
      document.getElementById('tomorrowPolishBtn'),
      `goals:${getTomorrowDateString()}`,
      document.getElementById('tomorrowStatus'),
      loadTomorrow
    );

    loadToday();
    loadTomorrow();
    renderStreak();

    updateDayBar();
    setInterval(updateDayBar, 60 * 1000);
    window.addEventListener('dashboard-settings-changed', updateDayBar);

    startTicker();
  })();
