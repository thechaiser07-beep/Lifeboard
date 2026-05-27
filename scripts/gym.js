
const CONFIG = {
  appTitle: "Progressive Overload Coach",

  // Weight unit shown everywhere. "kg" or "lb".
  units: "kg",

  // Gyms you train at. Add as many as you want.
  // `id` must be a short unique slug (no spaces). `name` is what people see.
  gyms: [
    { id: "home",  name: "Home Gym" },
    { id: "comm",  name: "Commercial Gym" }
  ],

  // Training split. Most people use Push/Pull/Legs but you can rename
  // these to "Upper", "Lower", "Full Body", "Day A", anything.
  days: [
    { id: "upper", name: "Upper" },
    { id: "lower", name: "Lower" }
  ],

  // Split rotation — the order your training days cycle through. Use day
  // ids from `days` above, plus "rest" for off-days. The pill at the top
  // of the app reads this + splitAnchor to compute "what day is today".
  // Tue=Upper, Wed=Lower, Thu=Rest, Fri=Upper, Sat=Rest, Sun=Lower, Mon=Rest
  splitRotation: ["upper", "lower", "rest", "upper", "rest", "lower", "rest"],

  // Anchor: pair a real calendar date with which split day fell on it.
  // The rotation advances from this point. Set `date` to a recent day
  // when you knew what split you were on, and `splitId` to that day.
  // Edit this if your split drifts.
  splitAnchor: {
    date: "2026-05-26",
    splitId: "upper"
  },

  // Progression rule: hit this many reps on the top set → coach tells you
  // to add weight next session. Lower this to be more aggressive (e.g. 6),
  // raise it for more volume bias (e.g. 10).
  upgradeAtReps: 8,

  // Composition estimate (optional, for the weight chart).
  // Estimates how much of recent weight change is muscle vs fat by
  // cross-referencing the strength trend. Set yearsTraining to scale
  // expected muscle gain rate.
  composition: {
    enabled: true,
    yearsTraining: 1,        // 1 = beginner, 2 = intermediate, 3+ = advanced
    windowDays: 30           // window to compute weight + strength change
  },

  // Starter exercise list. Each one needs:
  //   name        — what shows in the dropdown
  //   gym         — one of the gym ids above, or "both"
  //   day         — one of the day ids above
  //   repMin      — bottom of your target rep range
  //   repMax      — top of your target rep range
  //   step        — how much weight you add when progressing (kg/lb)
  //   startWeight — starting weight (ignored when bw: true)
  //   bw          — true for bodyweight movements (logs reps only)
  //
  // First-run defaults. Once a user logs anything, they edit through
  // the in-app + / gear buttons; this block stays as the seed.
  defaultExercises: [
    { name: "Bench press",       gym: "comm", day: "upper", repMin: 5, repMax: 8,  step: 2.5, startWeight: 60 },
    { name: "Overhead press",    gym: "comm", day: "upper", repMin: 5, repMax: 8,  step: 2.5, startWeight: 35 },
    { name: "Tricep pushdown",   gym: "comm", day: "upper", repMin: 8, repMax: 12, step: 2.5, startWeight: 25 },
    { name: "Pull-ups",          gym: "both", day: "upper", repMin: 5, repMax: 10, step: 1,   startWeight: 0, bw: true },
    { name: "Barbell row",       gym: "comm", day: "upper", repMin: 6, repMax: 10, step: 2.5, startWeight: 50 },
    { name: "Bicep curl",        gym: "comm", day: "upper", repMin: 8, repMax: 12, step: 1.25,startWeight: 15 },
    { name: "Back squat",        gym: "comm", day: "lower", repMin: 5, repMax: 8,  step: 5,   startWeight: 80 },
    { name: "Romanian deadlift", gym: "comm", day: "lower", repMin: 6, repMax: 10, step: 5,   startWeight: 60 },
    { name: "Leg press",         gym: "comm", day: "lower", repMin: 8, repMax: 12, step: 5,   startWeight: 100 }
  ]
};



(function() {
  // ============================================================
  // STATE — all logs + edits live in browser localStorage. Each
  // device has its own copy. Export JSON from settings if you
  // want to back up or move to another device.
  // ============================================================
  const LS_KEY = 'po_coach_v1';

  function buildDefaultExercises() {
    return CONFIG.defaultExercises.map((e, i) => Object.assign({
      id: 'seed_' + i + '_' + Date.now()
    }, e));
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) {}
    return normalize({});
  }
  function normalize(s) {
    s = s || {};
    s.units = s.units || CONFIG.units || 'kg';
    s.gyms  = (Array.isArray(s.gyms)  && s.gyms.length)  ? s.gyms  : CONFIG.gyms.slice();
    s.days  = (Array.isArray(s.days)  && s.days.length)  ? s.days  : CONFIG.days.slice();
    s.exercises = Array.isArray(s.exercises) ? s.exercises : buildDefaultExercises();
    s.logs = (s.logs && typeof s.logs === 'object') ? s.logs : {};
    s.filterGym = s.filterGym || s.gyms[0].id;
    s.filterDay = s.filterDay || s.days[0].id;
    // Split rotation lives in state so the user can edit it via the pill modal.
    // Stored as a plain array of names (e.g. ["Push", "Pull", "Legs", "Rest"]).
    if (!Array.isArray(s.splitRotation) || !s.splitRotation.length) {
      s.splitRotation = (CONFIG.splitRotation || ['Push', 'Pull', 'Legs', 'Rest']).map(x =>
        // CONFIG used ids — map id → display name where possible
        (CONFIG.days || []).find(d => d.id === x) ? (CONFIG.days.find(d => d.id === x).name) :
        (x === 'rest' ? 'Rest' : x.charAt(0).toUpperCase() + x.slice(1))
      );
    }
    if (!s.splitAnchor || !s.splitAnchor.date || s.splitAnchor.index == null) {
      // Map old anchor-by-id to new anchor-by-index, or default to today=index 0.
      const oldId = (CONFIG.splitAnchor && CONFIG.splitAnchor.splitId) || null;
      let idx = 0;
      if (oldId) {
        const oldName = (CONFIG.days || []).find(d => d.id === oldId);
        const targetName = oldName ? oldName.name : (oldId === 'rest' ? 'Rest' : oldId);
        const found = s.splitRotation.findIndex(n => n.toLowerCase() === targetName.toLowerCase());
        if (found >= 0) idx = found;
      }
      s.splitAnchor = {
        date: (CONFIG.splitAnchor && CONFIG.splitAnchor.date) || new Date().toISOString().slice(0, 10),
        index: idx
      };
    }
    return s;
  }
  function saveState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
  }
  let state = loadState();
  document.getElementById('appTitle').textContent = CONFIG.appTitle || 'Progressive Overload Coach';

  // ============================================================
  // HELPERS
  // ============================================================
  const $ = (id) => document.getElementById(id);
  function unit() { return state.units; }
  function uid() { return 'ex_' + Date.now() + '_' + Math.floor(Math.random() * 9999); }
  function gymName(id) { const g = state.gyms.find(x => x.id === id); return g ? g.name : id; }
  function dayName(id) { const d = state.days.find(x => x.id === id); return d ? d.name : id; }
  function estimate1RM(w, r) { if (r < 2) return w; return w * (1 + r / 30); }
  function roundToStep(v, s) { return Math.round(v / s) * s; }
  function getFiltered() {
    return state.exercises.filter(e =>
      (e.gym === state.filterGym || e.gym === 'both') && e.day === state.filterDay);
  }
  function getCurrentEx() {
    const f = getFiltered();
    if (!f.length) return null;
    let ex = f.find(e => e.id === state.currentEx);
    if (!ex) { ex = f[0]; state.currentEx = ex.id; saveState(); }
    return ex;
  }
  function getLogs() { return (state.logs[state.currentEx] || []).slice(); }

  // Prescription engine — "what should I do next session?"
  // Upgrade trigger: hits CONFIG.upgradeAtReps (default 8) OR the
  // exercise's repMax, whichever fires first. So a 5-8 lifter hits
  // upgrade at 8; a 6-12 lifter ALSO hits it at 8 instead of grinding
  // out 12 reps before adding weight.
  function getRx(ex, logs) {
    if (!logs.length) return null;
    const last = logs[logs.length - 1];
    const { weight, reps } = last;
    const { repMin, repMax, step, bw } = ex;
    const upgradeAt = Math.min(CONFIG.upgradeAtReps || 8, repMax);
    let stuck = 0;
    for (let i = logs.length - 1; i >= 0; i--) {
      if (logs[i].weight === weight) stuck++; else break;
    }
    if (bw) {
      if (reps >= upgradeAt) return { type: 'up', weight: 0, reps: reps + 1, tag: 'Push for more', reason: reps + ' reps — strong. Push for ' + (reps + 1) + ' next time.', bw: true };
      if (reps >= repMin) return { type: 'hold', weight: 0, reps: reps + 1, tag: 'Add a rep', reason: reps + ' reps. Push for ' + (reps + 1) + ' next session.', bw: true };
      return { type: 'hold', weight: 0, reps: repMin, tag: 'Repeat', reason: reps + ' reps fell short. Repeat until you hit ' + repMin + '+.', bw: true };
    }
    if (stuck >= 3 && reps < repMin) {
      const dl = roundToStep(weight * 0.9, step);
      return { type: 'down', weight: dl, reps: repMax, tag: 'Deload', reason: 'Stuck at ' + weight + unit() + ' for ' + stuck + ' sessions. Drop 10%, reset, build back cleaner.' };
    }
    if (reps >= upgradeAt) return { type: 'up', weight: weight + step, reps: repMin, tag: 'Add weight', reason: 'You hit ' + reps + ' reps — time to add ' + step + unit() + '. Expect ' + repMin + '-' + (repMin + 1) + ' next session.' };
    if (reps >= repMin && reps < upgradeAt) return { type: 'hold', weight: weight, reps: reps + 1, tag: 'Add a rep', reason: reps + ' reps in target. Stay at ' + weight + unit() + ', push for ' + (reps + 1) + '.' };
    return { type: 'hold', weight: weight, reps: repMin, tag: 'Repeat', reason: reps + ' reps short of ' + repMin + '-' + upgradeAt + '. Repeat ' + weight + unit() + ' until you hit ' + repMin + '+ clean.' };
  }

  // ============================================================
  // RENDER
  // ============================================================
  function renderFilters() {
    $('gymSeg').innerHTML = state.gyms.map(g =>
      '<button class="po-seg-btn ' + (g.id === state.filterGym ? 'active' : '') + '" data-gym="' + g.id + '">' + escape(g.name) + '</button>'
    ).join('');
    $('daySeg').innerHTML = state.days.map(d =>
      '<button class="po-seg-btn ' + (d.id === state.filterDay ? 'active' : '') + '" data-day="' + d.id + '">' + escape(d.name) + '</button>'
    ).join('');
    $('gymSeg').querySelectorAll('.po-seg-btn').forEach(b => {
      b.addEventListener('click', () => { state.filterGym = b.dataset.gym; state.currentEx = null; saveState(); renderAll(); });
    });
    $('daySeg').querySelectorAll('.po-seg-btn').forEach(b => {
      b.addEventListener('click', () => {
        state.filterDay = b.dataset.day;
        state.currentEx = null;
        // User has now manually picked a day — stop auto-overriding to today's split.
        state._userPickedDay = true;
        saveState(); renderAll();
      });
    });
  }
  function renderSelect() {
    const sel = $('exSelect');
    const f = getFiltered();
    const noMsg = $('noExMsg');
    const editBtn = $('editExBtn');
    const logBtn = $('logBtn');
    if (!f.length) {
      sel.innerHTML = '<option>—</option>';
      sel.disabled = true; editBtn.disabled = true; logBtn.disabled = true;
      noMsg.style.display = 'block'; state.currentEx = null;
      return;
    }
    sel.disabled = false; editBtn.disabled = false; logBtn.disabled = false;
    noMsg.style.display = 'none';
    if (!f.find(e => e.id === state.currentEx)) state.currentEx = f[0].id;
    sel.innerHTML = f.map(e => {
      const wLbl = e.bw ? ' · BW' : (e.startWeight ? ' · ' + e.startWeight + unit() : '');
      const sh = e.gym === 'both' ? ' ★' : '';
      return '<option value="' + e.id + '"' + (e.id === state.currentEx ? ' selected' : '') + '>' + escape(e.name) + wLbl + sh + '</option>';
    }).join('');
  }
  function renderForm() {
    const ex = getCurrentEx();
    const banner = $('bwBanner');
    const wField = $('weightField');
    const oneRmLbl = $('oneRmLabel');
    const grid = $('logGrid');
    $('weightLabel').textContent = 'Weight (' + unit() + ')';
    if (ex && ex.bw) {
      banner.classList.add('show');
      wField.style.display = 'none';
      grid.classList.add('po-bw-mode');
      oneRmLbl.textContent = 'Best reps';
    } else {
      banner.classList.remove('show');
      wField.style.display = '';
      grid.classList.remove('po-bw-mode');
      oneRmLbl.textContent = 'Est. 1RM';
    }
  }
  function renderLastSet() {
    const wrap = $('lastSet');
    const v = $('lastSetValue');
    const m = $('lastSetMeta');
    const ex = getCurrentEx();
    const logs = ex ? getLogs() : [];
    if (!ex || !logs.length) { wrap.classList.remove('show'); return; }
    const last = logs[logs.length - 1];
    const setStr = ex.bw ? (last.reps + ' reps') : (last.weight + unit() + ' × ' + last.reps);
    const d = new Date(last.date);
    const da = Math.floor((Date.now() - d.getTime()) / 86400000);
    const ago = da === 0 ? 'today' : da === 1 ? 'yesterday' : da + ' days ago';
    v.textContent = setStr;
    m.textContent = ago;
    wrap.classList.add('show');
  }
  function renderRx() {
    const wrap = $('rxWrap');
    const ex = getCurrentEx();
    if (!ex) { wrap.innerHTML = '<div class="po-rx-empty">Pick a gym and day above.</div>'; return; }
    const logs = getLogs();
    const rx = getRx(ex, logs);
    if (!rx) {
      const sw = ex.startWeight, sr = ex.repMin;
      const head = ex.bw
        ? '<span class="po-accent">' + sr + '</span> reps'
        : '<span class="po-accent">' + (sw || 0) + unit() + '</span> × ' + sr + ' reps';
      const reason = ex.bw
        ? 'Aim for ' + ex.repMin + '-' + ex.repMax + ' clean reps. Once you hit ' + ex.repMax + '+, push for more.'
        : 'Hit ' + ex.repMin + '-' + ex.repMax + ' reps. Once logged, the coach will start prescribing.';
      wrap.innerHTML = '<div class="po-rx-card"><div class="po-rx-label">' + escape(ex.name) + ' · starting point</div><div class="po-rx-headline">' + head + '</div><span class="po-rx-tag hold">Start here</span><p class="po-rx-reason">' + reason + '</p></div>';
      return;
    }
    const head = rx.bw
      ? '<span class="po-accent">' + rx.reps + '</span> reps'
      : '<span class="po-accent">' + rx.weight + unit() + '</span> × ' + rx.reps + ' reps';
    wrap.innerHTML = '<div class="po-rx-card po-rx-' + rx.type + '"><div class="po-rx-label">' + escape(ex.name) + '</div><div class="po-rx-headline">' + head + '</div><span class="po-rx-tag ' + rx.type + '">' + rx.tag + '</span><p class="po-rx-reason">' + rx.reason + '</p></div>';
  }
  function renderStats() {
    const ex = getCurrentEx();
    const logs = ex ? getLogs() : [];
    if (!logs.length) {
      $('oneRm').innerHTML = '—<span class="po-unit">' + unit() + '</span>';
      $('bestSet').textContent = '—';
      $('sessionCount').textContent = '—';
      return;
    }
    if (ex.bw) {
      const br = Math.max.apply(null, logs.map(l => l.reps));
      $('oneRm').innerHTML = br + '<span class="po-unit">reps</span>';
    } else {
      const orm = Math.max.apply(null, logs.map(l => estimate1RM(l.weight, l.reps)));
      $('oneRm').innerHTML = Math.round(orm) + '<span class="po-unit">' + unit() + '</span>';
    }
    let best = logs[0];
    logs.forEach(l => {
      const cur = ex.bw ? l.reps : estimate1RM(l.weight, l.reps);
      const bestVal = ex.bw ? best.reps : estimate1RM(best.weight, best.reps);
      if (cur > bestVal) best = l;
    });
    $('bestSet').textContent = ex.bw ? (best.reps + 'r') : (best.weight + '×' + best.reps);
    $('sessionCount').textContent = logs.length;
  }
  function renderSparkline() {
    const svg = $('sparkline');
    const empty = $('sparkEmpty');
    const ex = getCurrentEx();
    const logs = ex ? getLogs().slice(-10) : [];
    if (logs.length < 2) {
      svg.style.display = 'none'; empty.style.display = 'block';
      return;
    }
    svg.style.display = 'block'; empty.style.display = 'none';
    const vals = logs.map(l => ex.bw ? l.reps : estimate1RM(l.weight, l.reps));
    const min = Math.min.apply(null, vals);
    const max = Math.max.apply(null, vals);
    const range = max - min || 1;
    const W = 300, H = 60, pad = 4;
    const pts = vals.map((v, i) => {
      const x = pad + (W - pad * 2) * (i / (vals.length - 1));
      const y = H - pad - (H - pad * 2) * ((v - min) / range);
      return [x, y];
    });
    const linePath = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const fillPath = linePath + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + H + ' L' + pts[0][0].toFixed(1) + ' ' + H + ' Z';
    // Keep <defs> in place; replace any prior paths
    const defsHTML = '<defs><linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="rgba(255,255,255,0.18)"/><stop offset="100%" stop-color="rgba(255,255,255,0)"/></linearGradient></defs>';
    svg.innerHTML = defsHTML
      + '<path class="po-spark-fill" d="' + fillPath + '"/>'
      + '<path class="po-spark-line" d="' + linePath + '"/>';
  }
  function renderHistory() {
    const wrap = $('historyCard');
    const ex = getCurrentEx();
    const logs = ex ? getLogs().slice().reverse() : [];
    if (!logs.length) {
      wrap.innerHTML = '<div class="po-empty">No logs yet.</div>';
      return;
    }
    wrap.innerHTML = logs.slice(0, 12).map((l, i) => {
      const d = new Date(l.date);
      const dStr = (d.getMonth() + 1) + '/' + d.getDate();
      const setStr = ex.bw ? (l.reps + ' reps') : (l.weight + unit() + ' × ' + l.reps);
      const realIdx = logs.length - 1 - i; // since we reversed
      return '<div class="po-hist-row">'
        + '<div class="po-hist-date">' + dStr + '</div>'
        + '<div class="po-hist-set">' + setStr + '</div>'
        + '<button class="po-hist-del" data-idx="' + realIdx + '" aria-label="Delete">×</button>'
        + '</div>';
    }).join('');
    wrap.querySelectorAll('.po-hist-del').forEach(b => {
      b.addEventListener('click', () => {
        if (!confirm('Delete this log?')) return;
        const realIdx = parseInt(b.dataset.idx, 10);
        const arr = state.logs[state.currentEx] || [];
        // realIdx is index in REVERSED list; map back to original
        const origIdx = arr.length - 1 - realIdx;
        arr.splice(origIdx, 1);
        if (!arr.length) delete state.logs[state.currentEx];
        else state.logs[state.currentEx] = arr;
        saveState(); renderAll();
      });
    });
  }
  // Compute today's split from state.splitRotation + state.splitAnchor.
  // Returns the rotation entry name (e.g. "Push" or "Rest") AND the index.
  function todaySplit() {
    try {
      const rot = state.splitRotation;
      if (!rot || !rot.length) return { name: '—', index: 0 };
      const a = new Date(state.splitAnchor.date);
      const t = new Date();
      a.setHours(0,0,0,0); t.setHours(0,0,0,0);
      const diffDays = Math.round((t - a) / 86400000);
      const idx = ((state.splitAnchor.index + diffDays) % rot.length + rot.length) % rot.length;
      return { name: rot[idx], index: idx };
    } catch (e) {
      return { name: (state.splitRotation && state.splitRotation[0]) || '—', index: 0 };
    }
  }
  function todayDateLabel() {
    const d = new Date();
    const dows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const mons = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return dows[d.getDay()] + ', ' + mons[d.getMonth()] + ' ' + d.getDate();
  }
  function isRestName(name) { return /^rest\b/i.test(name || ''); }
  function splitLabel(name) {
    if (!name) return '—';
    return (isRestName(name) ? 'REST DAY' : (name + ' DAY')).toUpperCase();
  }
  function renderDayPill() {
    const split = todaySplit();
    $('dayPillDate').textContent = todayDateLabel();
    const splitEl = $('dayPillSplit');
    splitEl.textContent = splitLabel(split.name);
    splitEl.classList.toggle('is-rest', isRestName(split.name));
  }

  // Build the rep buttons based on the current exercise's repMin/repMax.
  // Always spans repMin → repMax + 2 (a small buffer for over-performing
  // sets that trigger the upgrade signal), capped at 16 buttons total so
  // wide ranges don't break the mobile layout.
  function renderRepsRow() {
    const row = document.getElementById('repsRow');
    if (!row) return;
    const ex = getCurrentEx();
    let repMin, repMax;
    if (ex) {
      repMin = Math.max(1, parseInt(ex.repMin, 10) || 1);
      repMax = Math.max(repMin, parseInt(ex.repMax, 10) || repMin);
    } else {
      repMin = 4; repMax = 12;
    }
    const upper = Math.max(repMax + 2, repMin + 5);
    const end = Math.min(upper, repMin + 15);

    // Preserve the previously-selected rep if it still fits in the new
    // range; otherwise default to the target (repMax).
    const prev = parseInt(row.dataset.value, 10);
    const active = (prev >= repMin && prev <= end) ? prev : repMax;

    let html = '';
    for (let i = repMin; i <= end; i++) {
      html += '<button type="button" class="po-reps-pill' +
        (i === active ? ' active' : '') +
        '" data-v="' + i + '">' + i + '</button>';
    }
    row.innerHTML = html;
    row.dataset.value = String(active);
  }

  function renderAll() {
    renderDayPill();
    renderFilters(); renderSelect(); renderForm(); renderLastSet();
    renderRepsRow();
    renderRx(); renderStats(); renderSparkline(); renderHistory();
    renderTodaysWorkout();
    renderPastWorkouts();
    // Pre-fill weight input with last logged weight (or starting weight)
    const ex = getCurrentEx();
    if (ex && !ex.bw) {
      const logs = getLogs();
      const w = logs.length ? logs[logs.length - 1].weight : (ex.startWeight || 0);
      $('weightInput').value = w;
    }
  }

  // ============================================================
  // TODAY'S WORKOUT + PAST WORKOUTS
  //
  // Reads state.logs, groups by date, surfaces:
  //  - Today: every set logged today, per exercise, with set count + total
  //    volume (kg lifted = sum of weight × reps across all working sets).
  //  - Past: every previous workout day, sorted newest-first, with the
  //    same summary numbers + a DONE badge if the user marked that day.
  //
  // The total volume here is what the composition-estimate uses (combined
  // with the 1RM trend) — more weekly volume + strength gain = more of
  // recent body-weight delta gets attributed to muscle.
  // ============================================================
  const WORKOUT_DONE_KEY = 'po_coach_workout_done';
  function loadDoneDays() {
    try { const raw = localStorage.getItem(WORKOUT_DONE_KEY); return raw ? JSON.parse(raw) : {}; }
    catch (e) { return {}; }
  }
  function saveDoneDays(d) {
    try { localStorage.setItem(WORKOUT_DONE_KEY, JSON.stringify(d)); } catch (e) {}
  }
  let doneDays = loadDoneDays();

  function logsByDay() {
    const byDay = {};
    state.exercises.forEach(ex => {
      (state.logs[ex.id] || []).forEach(l => {
        const dk = l.date.slice(0, 10);
        if (!byDay[dk]) byDay[dk] = [];
        byDay[dk].push({ ex, log: l });
      });
    });
    return byDay;
  }

  function fmtPastDate(dk) {
    const [y, m, d] = dk.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const dows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const mons = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return dows[dt.getDay()] + ' ' + mons[dt.getMonth()] + ' ' + dt.getDate();
  }

  function summarizeDay(daySets) {
    // daySets: [{ex, log}]. Group by exercise, return {sets: N, vol: kg, perEx: [...]}.
    const byEx = {};
    daySets.forEach(({ex, log}) => {
      if (!byEx[ex.id]) byEx[ex.id] = { ex, sets: [], vol: 0 };
      byEx[ex.id].sets.push(log);
      byEx[ex.id].vol += (log.weight || 0) * (log.reps || 0);
    });
    const perEx = Object.values(byEx);
    const totalSets = perEx.reduce((s, e) => s + e.sets.length, 0);
    const totalVol = perEx.reduce((s, e) => s + e.vol, 0);
    return { perEx, totalSets, totalVol };
  }

  function renderTodaysWorkout() {
    const todayKey = wtDateKey(new Date());
    const all = logsByDay();
    const todaySets = all[todayKey] || [];
    const sum = summarizeDay(todaySets);
    const u = state.units;

    const eyebrow = $('poTwDateLabel');
    const dows = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
    const mons = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const d = new Date();
    eyebrow.textContent = 'TODAY · ' + dows[d.getDay()] + ', ' + mons[d.getMonth()] + ' ' + d.getDate();

    $('poTwSetCount').textContent = sum.totalSets;
    $('poTwTotalVol').textContent = Math.round(sum.totalVol).toLocaleString() + ' ' + u + ' lifted';

    const list = $('poTwList');
    const empty = $('poTwEmpty');
    if (sum.totalSets === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      list.innerHTML = sum.perEx.map(e => {
        const top = e.ex.bw
          ? 'top ' + Math.max.apply(null, e.sets.map(s => s.reps)) + ' reps'
          : 'top ' + Math.max.apply(null, e.sets.map(s => s.weight)) + u;
        const meta = e.ex.bw
          ? (e.sets.length + ' set' + (e.sets.length === 1 ? '' : 's') + ' · ' + top)
          : (e.sets.length + ' set' + (e.sets.length === 1 ? '' : 's') + ' · ' + top + ' · ' + Math.round(e.vol) + u + ' total');
        return '<li class="po-tw-row">'
          + '<span class="po-tw-row-name">' + escape(e.ex.name) + '</span>'
          + '<span class="po-tw-row-meta">' + meta + '</span>'
          + '</li>';
      }).join('');
    }

    // Done button state
    const btn = $('poTwDoneBtn');
    const isDone = !!doneDays[todayKey];
    btn.textContent = isDone ? '✓ Done' : 'Mark workout done';
    btn.classList.toggle('is-done', isDone);
    btn.disabled = sum.totalSets === 0 && !isDone;
    btn.style.opacity = btn.disabled ? '0.4' : '';
  }

  function renderPastWorkouts() {
    const todayKey = wtDateKey(new Date());
    const all = logsByDay();
    const past = Object.entries(all)
      .filter(([dk]) => dk !== todayKey)
      .sort((a, b) => b[0].localeCompare(a[0]));
    $('poTwPastCount').textContent = past.length;
    const body = $('poTwPastBody');
    if (!past.length) {
      body.innerHTML = '<div class="po-tw-past-empty">No past workouts yet.</div>';
      return;
    }
    const u = state.units;
    body.innerHTML = past.slice(0, 30).map(([dk, sets]) => {
      const sum = summarizeDay(sets);
      const isDone = !!doneDays[dk];
      const exNames = sum.perEx.map(e => e.ex.name).slice(0, 3).join(', ')
        + (sum.perEx.length > 3 ? '…' : '');
      return '<div class="po-tw-past-day">'
        + '<div class="po-tw-past-day-h">'
        +   '<span class="po-tw-past-day-date">' + fmtPastDate(dk) + '</span>'
        +   '<span class="po-tw-past-day-summary">'
        +     sum.totalSets + ' sets · ' + Math.round(sum.totalVol).toLocaleString() + ' ' + u
        +     (isDone ? ' <span class="po-tw-past-day-done">DONE</span>' : '')
        +   '</span>'
        + '</div>'
        + '<div class="po-tw-past-day-summary" style="margin-top:6px; font-size:11px; color:var(--text-3);">'
        +   escape(exNames)
        + '</div>'
        + '</div>';
    }).join('');
  }

  $('poTwDoneBtn').addEventListener('click', () => {
    const todayKey = wtDateKey(new Date());
    if (doneDays[todayKey]) {
      delete doneDays[todayKey];
    } else {
      doneDays[todayKey] = new Date().toISOString();
    }
    saveDoneDays(doneDays);
    renderTodaysWorkout();
    renderPastWorkouts();
  });
  $('poTwPastToggle').addEventListener('click', () => {
    const body = $('poTwPastBody');
    const toggle = $('poTwPastToggle');
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'flex';
    body.style.flexDirection = 'column';
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
  });

  // ============================================================
  // EVENT WIRING
  // ============================================================
  // Tap the day pill → opens the rotation editor so you can rename /
  // reorder / add / delete entries (e.g. switch Push/Pull/Legs/Rest to
  // Legs/Arms/Back/Chest). Long-press isn't a thing on web reliably so
  // this is the only action — the day filter still auto-snaps on load.
  $('dayPill').addEventListener('click', () => openRotationModal());

  // First-load nicety: if today's split matches one of the day filters
  // by name (case-insensitive) and the user hasn't manually picked one,
  // pre-select that day.
  (function autoSelectTodaySplit() {
    const s = todaySplit();
    if (!s.name || isRestName(s.name) || state._userPickedDay) return;
    const match = state.days.find(d => d.name.toLowerCase() === s.name.toLowerCase());
    if (match) state.filterDay = match.id;
  })();

  $('exSelect').addEventListener('change', e => {
    state.currentEx = e.target.value; saveState(); renderAll();
  });
  $('weightDownBtn').addEventListener('click', () => {
    const ex = getCurrentEx(); if (!ex || ex.bw) return;
    const w = parseFloat($('weightInput').value) || 0;
    $('weightInput').value = Math.max(0, w - (ex.step || 2.5));
  });
  $('weightUpBtn').addEventListener('click', () => {
    const ex = getCurrentEx(); if (!ex || ex.bw) return;
    const w = parseFloat($('weightInput').value) || 0;
    $('weightInput').value = w + (ex.step || 2.5);
  });
  // Delegated click handler — reps row is regenerated per exercise via
  // renderRepsRow(), so we listen on the container rather than the
  // individual buttons.
  $('repsRow').addEventListener('click', (e) => {
    const p = e.target.closest('.po-reps-pill');
    if (!p) return;
    $('repsRow').querySelectorAll('.po-reps-pill').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    $('repsRow').dataset.value = p.dataset.v;
  });
  $('logBtn').addEventListener('click', () => {
    const ex = getCurrentEx();
    if (!ex) return;
    const reps = parseInt($('repsRow').dataset.value, 10) || 0;
    if (reps <= 0) { alert('Pick a rep count.'); return; }
    const w = ex.bw ? 0 : (parseFloat($('weightInput').value) || 0);
    if (!ex.bw && w <= 0) { alert('Enter a weight.'); return; }
    const arr = state.logs[ex.id] || [];
    arr.push({ weight: w, reps: reps, date: new Date().toISOString() });
    state.logs[ex.id] = arr;
    saveState(); renderAll();
    // Strength changed → composition estimate may shift
    if (typeof wtRender === 'function') wtRender();
    // Tiny pulse on the button so the user feels the save
    const btn = $('logBtn');
    btn.style.transition = 'transform 0.15s';
    btn.style.transform = 'scale(0.96)';
    setTimeout(() => { btn.style.transform = ''; }, 160);
  });

  // ============================================================
  // EXERCISE MODAL (add / edit)
  // ============================================================
  let editingExId = null;
  let modalGym = null, modalDay = null;
  function renderModalSegs() {
    $('exGymSeg').innerHTML = state.gyms.map(g =>
      '<button data-gym="' + g.id + '" class="' + (modalGym === g.id ? 'active' : '') + '">' + escape(g.name) + '</button>'
    ).join('') + '<button data-gym="both" class="' + (modalGym === 'both' ? 'active' : '') + '">Both</button>';
    $('exDaySeg').innerHTML = state.days.map(d =>
      '<button data-day="' + d.id + '" class="' + (modalDay === d.id ? 'active' : '') + '">' + escape(d.name) + '</button>'
    ).join('');
    $('exGymSeg').querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        modalGym = b.dataset.gym;
        $('exGymSeg').querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
    });
    $('exDaySeg').querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        modalDay = b.dataset.day;
        $('exDaySeg').querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      });
    });
  }
  function openExModal(mode, ex) {
    editingExId = mode === 'edit' ? ex.id : null;
    $('exModalTitle').textContent = mode === 'edit' ? 'Edit exercise' : 'Add exercise';
    $('exDelete').style.display = mode === 'edit' ? 'block' : 'none';
    if (mode === 'edit') {
      $('exName').value = ex.name;
      modalGym = ex.gym;
      modalDay = ex.day;
      $('exBw').checked = !!ex.bw;
      $('exStartWeight').value = ex.startWeight || 0;
      $('exRepMin').value = ex.repMin;
      $('exRepMax').value = ex.repMax;
      $('exStep').value = ex.step;
    } else {
      $('exName').value = '';
      modalGym = state.filterGym;
      modalDay = state.filterDay;
      $('exBw').checked = false;
      $('exStartWeight').value = 20;
      $('exRepMin').value = 6;
      $('exRepMax').value = 8;
      $('exStep').value = 2.5;
    }
    renderModalSegs();
    toggleBwFields();
    $('exModalBg').classList.add('show');
    setTimeout(() => $('exName').focus(), 60);
  }
  function toggleBwFields() {
    const isBw = $('exBw').checked;
    $('exStartWeightField').style.display = isBw ? 'none' : '';
    $('exStepField').style.display = isBw ? 'none' : '';
  }
  $('exBw').addEventListener('change', toggleBwFields);
  $('addExBtn').addEventListener('click', () => openExModal('add'));
  $('editExBtn').addEventListener('click', () => {
    const ex = getCurrentEx();
    if (ex) openExModal('edit', ex);
  });
  $('exModalCancel').addEventListener('click', () => $('exModalBg').classList.remove('show'));
  $('exModalSave').addEventListener('click', () => {
    const name = $('exName').value.trim();
    if (!name) { alert('Name is required.'); return; }
    if (!modalGym) { alert('Pick a gym.'); return; }
    if (!modalDay) { alert('Pick a day.'); return; }
    const isBw = $('exBw').checked;
    const repMin = parseInt($('exRepMin').value, 10) || 6;
    const repMax = parseInt($('exRepMax').value, 10) || 8;
    const data = {
      name, gym: modalGym, day: modalDay,
      bw: isBw,
      startWeight: isBw ? 0 : (parseFloat($('exStartWeight').value) || 0),
      repMin, repMax,
      step: isBw ? 1 : (parseFloat($('exStep').value) || 2.5)
    };
    if (editingExId) {
      const ex = state.exercises.find(e => e.id === editingExId);
      if (ex) Object.assign(ex, data);
    } else {
      const ex = Object.assign({ id: uid() }, data);
      state.exercises.push(ex);
      state.currentEx = ex.id;
      state.filterGym = (modalGym === 'both') ? state.filterGym : modalGym;
      state.filterDay = modalDay;
    }
    saveState();
    $('exModalBg').classList.remove('show');
    renderAll();
  });
  $('exDelete').addEventListener('click', () => {
    if (!editingExId) return;
    if (!confirm('Delete this exercise and all its logs?')) return;
    state.exercises = state.exercises.filter(e => e.id !== editingExId);
    delete state.logs[editingExId];
    if (state.currentEx === editingExId) state.currentEx = null;
    editingExId = null;
    saveState();
    $('exModalBg').classList.remove('show');
    renderAll();
  });

  // ============================================================
  // ROTATION EDITOR (tap the day pill)
  // Edit the split cycle in place: rename, reorder, add, delete.
  // "Today is →" jumps the cycle anchor to any entry, so you can change
  // both the order AND which day in that order is "today".
  // ============================================================
  let rotDraft = null;          // working copy while modal is open
  let rotDraftTodayIdx = 0;     // which entry IS today in the draft

  function openRotationModal() {
    rotDraft = (state.splitRotation || []).slice();
    if (!rotDraft.length) rotDraft = ['Push', 'Pull', 'Legs', 'Rest'];
    rotDraftTodayIdx = todaySplit().index;
    if (rotDraftTodayIdx >= rotDraft.length) rotDraftTodayIdx = 0;
    renderRotList();
    $('rotModalBg').classList.add('show');
  }

  function renderRotList() {
    const list = $('rotList');
    list.innerHTML = rotDraft.map((name, i) => {
      const isToday = (i === rotDraftTodayIdx);
      return '<div class="rot-row ' + (isToday ? 'is-today' : '') + '" data-i="' + i + '">'
        + '<span class="rot-row-num">' + (i + 1) + '</span>'
        + '<input type="text" value="' + escape(name) + '" placeholder="e.g. Arms" maxlength="30">'
        + (isToday
            ? '<span class="rot-today-tag">TODAY</span>'
            : '<button type="button" class="rot-today-btn" data-action="today">Today is →</button>')
        + '<button type="button" class="rot-mini" data-action="up"   aria-label="Move up">↑</button>'
        + '<button type="button" class="rot-mini" data-action="down" aria-label="Move down">↓</button>'
        + '<button type="button" class="rot-mini rot-mini-del" data-action="del" aria-label="Delete">×</button>'
        + '</div>';
    }).join('');
    list.querySelectorAll('.rot-row').forEach(row => {
      const i = parseInt(row.dataset.i, 10);
      row.querySelector('input').addEventListener('input', e => { rotDraft[i] = e.target.value; });
      const upBtn = row.querySelector('[data-action="up"]');
      const dnBtn = row.querySelector('[data-action="down"]');
      const delBtn = row.querySelector('[data-action="del"]');
      const todayBtn = row.querySelector('[data-action="today"]');
      if (upBtn) upBtn.addEventListener('click', () => {
        if (i === 0) return;
        [rotDraft[i-1], rotDraft[i]] = [rotDraft[i], rotDraft[i-1]];
        if (rotDraftTodayIdx === i)   rotDraftTodayIdx = i - 1;
        else if (rotDraftTodayIdx === i - 1) rotDraftTodayIdx = i;
        renderRotList();
      });
      if (dnBtn) dnBtn.addEventListener('click', () => {
        if (i >= rotDraft.length - 1) return;
        [rotDraft[i+1], rotDraft[i]] = [rotDraft[i], rotDraft[i+1]];
        if (rotDraftTodayIdx === i)   rotDraftTodayIdx = i + 1;
        else if (rotDraftTodayIdx === i + 1) rotDraftTodayIdx = i;
        renderRotList();
      });
      if (delBtn) delBtn.addEventListener('click', () => {
        if (rotDraft.length <= 1) { alert('Need at least one day in the cycle.'); return; }
        rotDraft.splice(i, 1);
        if (rotDraftTodayIdx >= rotDraft.length) rotDraftTodayIdx = rotDraft.length - 1;
        else if (i < rotDraftTodayIdx) rotDraftTodayIdx--;
        renderRotList();
      });
      if (todayBtn) todayBtn.addEventListener('click', () => {
        rotDraftTodayIdx = i;
        renderRotList();
      });
    });
  }

  $('rotAddBtn').addEventListener('click', () => {
    rotDraft.push('New day');
    renderRotList();
    // Focus the newly added input
    setTimeout(() => {
      const inputs = $('rotList').querySelectorAll('input');
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    }, 30);
  });
  $('rotCancel').addEventListener('click', () => {
    $('rotModalBg').classList.remove('show');
    rotDraft = null;
  });
  $('rotSave').addEventListener('click', () => {
    // Trim + drop empty entries
    const cleaned = rotDraft.map(s => (s || '').trim()).filter(Boolean);
    if (!cleaned.length) { alert('Need at least one day in the cycle.'); return; }
    let newTodayIdx = rotDraftTodayIdx;
    if (newTodayIdx >= cleaned.length) newTodayIdx = 0;
    state.splitRotation = cleaned;
    state.splitAnchor = {
      date: new Date().toISOString().slice(0, 10),
      index: newTodayIdx
    };
    saveState();
    $('rotModalBg').classList.remove('show');
    rotDraft = null;
    renderAll();
  });

  // ============================================================
  // SETTINGS MODAL (gyms, days, units, data)
  // ============================================================
  function renderSettings() {
    $('setUnitsSeg').querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.u === state.units);
    });
    $('setGyms').innerHTML = state.gyms.map((g, i) =>
      '<div class="po-set-row" data-i="' + i + '">'
      + '<input type="text" value="' + escape(g.name) + '" data-field="name" placeholder="Gym name">'
      + '<button class="po-mini-btn" data-action="del" aria-label="Delete">×</button>'
      + '</div>'
    ).join('');
    $('setDays').innerHTML = state.days.map((d, i) =>
      '<div class="po-set-row" data-i="' + i + '">'
      + '<input type="text" value="' + escape(d.name) + '" data-field="name" placeholder="Day name">'
      + '<button class="po-mini-btn" data-action="del" aria-label="Delete">×</button>'
      + '</div>'
    ).join('');
    $('setGyms').querySelectorAll('.po-set-row').forEach(row => {
      const i = parseInt(row.dataset.i, 10);
      row.querySelector('input').addEventListener('input', e => {
        state.gyms[i].name = e.target.value;
        saveState();
      });
      row.querySelector('[data-action="del"]').addEventListener('click', () => {
        if (state.gyms.length <= 1) { alert('You need at least one gym.'); return; }
        if (!confirm('Remove "' + state.gyms[i].name + '"? Exercises tagged to this gym will become invisible until you reassign them.')) return;
        state.gyms.splice(i, 1);
        if (!state.gyms.find(g => g.id === state.filterGym)) state.filterGym = state.gyms[0].id;
        saveState(); renderSettings(); renderAll();
      });
    });
    $('setDays').querySelectorAll('.po-set-row').forEach(row => {
      const i = parseInt(row.dataset.i, 10);
      row.querySelector('input').addEventListener('input', e => {
        state.days[i].name = e.target.value;
        saveState();
      });
      row.querySelector('[data-action="del"]').addEventListener('click', () => {
        if (state.days.length <= 1) { alert('You need at least one day.'); return; }
        if (!confirm('Remove "' + state.days[i].name + '"?')) return;
        state.days.splice(i, 1);
        if (!state.days.find(d => d.id === state.filterDay)) state.filterDay = state.days[0].id;
        saveState(); renderSettings(); renderAll();
      });
    });
  }
  $('settingsBtn').addEventListener('click', () => {
    renderSettings();
    $('setModalBg').classList.add('show');
  });
  $('setModalClose').addEventListener('click', () => {
    $('setModalBg').classList.remove('show');
    renderAll();
  });
  $('setUnitsSeg').querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      state.units = b.dataset.u; saveState();
      $('setUnitsSeg').querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      if (typeof wtRender === 'function') wtRender();
    });
  });
  $('setAddGym').addEventListener('click', () => {
    const name = (prompt('New gym name:') || '').trim();
    if (!name) return;
    const id = 'g_' + Date.now();
    state.gyms.push({ id, name });
    saveState(); renderSettings(); renderAll();
  });
  $('setAddDay').addEventListener('click', () => {
    const name = (prompt('New day name:') || '').trim();
    if (!name) return;
    const id = 'd_' + Date.now();
    state.days.push({ id, name });
    saveState(); renderSettings(); renderAll();
  });

  // Export / Import / Reset
  $('setExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'po-coach-data-' + new Date().toISOString().slice(0,10) + '.json';
    a.click(); URL.revokeObjectURL(url);
  });
  $('setImport').addEventListener('click', () => $('setImportFile').click());
  $('setImportFile').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!confirm('Replace ALL current data with the imported file? This cannot be undone.')) return;
        state = normalize(parsed);
        saveState(); renderSettings(); renderAll();
      } catch (err) { alert('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
  });
  $('setReset').addEventListener('click', () => {
    if (!confirm('Delete EVERYTHING (logs, edits, gyms, days)? This cannot be undone.')) return;
    localStorage.removeItem(LS_KEY);
    state = loadState();
    $('setModalBg').classList.remove('show');
    renderAll();
  });

  function escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ============================================================
  // WEIGHT TRACKER + COMPOSITION ESTIMATE + PROGRESS PHOTOS
  // All persisted to localStorage:
  //   po_coach_weights : [{ dateKey:'YYYY-MM-DD', weight:Number }]
  //   po_coach_photos  : [{ id, dataUrl, dateKey, weight }]
  // ============================================================
  const WT_KEY = 'po_coach_weights';
  const PHOTO_KEY = 'po_coach_photos';

  function wtLoad() {
    try {
      const raw = localStorage.getItem(WT_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.sort((a,b) => a.dateKey.localeCompare(b.dateKey)) : [];
    } catch (e) { return []; }
  }
  function wtSave(arr) {
    try { localStorage.setItem(WT_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function wtDateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function wtParseKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function wtSmoothPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return 'M ' + points[0].x + ' ' + points[0].y;
    let d = 'M ' + points[0].x.toFixed(2) + ' ' + points[0].y.toFixed(2);
    for (let i = 1; i < points.length; i++) {
      const prev = points[i-1], curr = points[i];
      const cx = (prev.x + curr.x) / 2;
      d += ' Q ' + cx.toFixed(2) + ' ' + prev.y.toFixed(2) + ', ' + cx.toFixed(2) + ' ' + ((prev.y + curr.y)/2).toFixed(2);
      d += ' T ' + curr.x.toFixed(2) + ' ' + curr.y.toFixed(2);
    }
    return d;
  }

  let wtEntries = wtLoad();

  function wtSaveEntry(weight) {
    const key = wtDateKey(new Date());
    const existing = wtEntries.find(e => e.dateKey === key);
    if (existing) existing.weight = weight;
    else { wtEntries.push({ dateKey: key, weight }); wtEntries.sort((a,b) => a.dateKey.localeCompare(b.dateKey)); }
    wtSave(wtEntries);
    wtRender();
  }

  function wtRender() {
    const last = wtEntries[wtEntries.length - 1] || null;
    const todayKey = wtDateKey(new Date());
    const todayEntry = wtEntries.find(e => e.dateKey === todayKey);
    const u = state.units;

    // Sync unit labels everywhere
    $('wtUnit').textContent = u;
    $('wtUnitStatic').textContent = u;
    $('wtNum').textContent = last ? last.weight.toFixed(1) : '—';

    // Locked vs input
    if (todayEntry) {
      $('wtEmpty').classList.add('hidden');
      $('wtLockedValue').textContent = todayEntry.weight.toFixed(1) + ' ' + u;
      $('wtLocked').classList.remove('hidden');
      $('wtInputRow').classList.add('hidden');
    } else {
      if (wtEntries.length === 0) $('wtEmpty').classList.remove('hidden');
      else $('wtEmpty').classList.add('hidden');
      $('wtLocked').classList.add('hidden');
      $('wtInputRow').classList.remove('hidden');
      if (last && !$('wtInput').value) $('wtInput').value = last.weight.toFixed(1);
    }

    // Chart, delta, composition need 2+ entries
    if (wtEntries.length >= 2) {
      $('wtChartWrap').classList.remove('hidden');
      $('wtLegend').classList.remove('hidden');
      wtRenderChart();
      wtRenderDelta();
      wtRenderComposition();
    } else {
      $('wtChartWrap').classList.add('hidden');
      $('wtLegend').classList.add('hidden');
      $('wtDelta').classList.add('hidden');
      $('wtComp').classList.add('hidden');
    }
    wtRenderStreak();
  }

  // Streak — consecutive days ending at today (or yesterday if today
  // hasn't been logged yet) with at least one weight entry.
  function wtRenderStreak() {
    const el = $('wtStreak');
    let streak = 0;
    let cursor = new Date(new Date());
    if (!wtEntries.find(e => e.dateKey === wtDateKey(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (wtEntries.find(e => e.dateKey === wtDateKey(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    if (streak >= 2) {
      $('wtStreakNum').textContent = streak + ' day streak';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function wtRenderChart() {
    const recent = wtEntries.slice(-30);
    const weights = recent.map(e => e.weight);
    const min = Math.min.apply(null, weights);
    const max = Math.max.apply(null, weights);
    const pad = Math.max((max - min) * 0.15, 0.5);
    const yMin = min - pad, yMax = max + pad;
    const xLeft = 8, xRight = 312, yTop = 20, yBot = 110;
    const xRange = xRight - xLeft, yRange = yBot - yTop;
    const xFor = (i) => recent.length === 1 ? xRight : xLeft + (i / (recent.length - 1)) * xRange;
    const yFor = (w) => yBot - ((w - yMin) / (yMax - yMin)) * yRange;
    const points = recent.map((e, i) => ({ x: xFor(i), y: yFor(e.weight) }));
    const linePath = wtSmoothPath(points);
    const areaPath = linePath + ' L ' + points[points.length - 1].x.toFixed(2) + ' ' + yBot + ' L ' + points[0].x.toFixed(2) + ' ' + yBot + ' Z';
    // 7d moving avg
    const avgPoints = recent.map((_, i) => {
      const start = Math.max(0, i - 6);
      const win = recent.slice(start, i + 1);
      const avg = win.reduce((s, p) => s + p.weight, 0) / win.length;
      return { x: xFor(i), y: yFor(avg) };
    });
    const avgPath = wtSmoothPath(avgPoints);
    let html = '<path class="wt-avg-line" d="' + avgPath + '"></path>'
             + '<path class="wt-area" d="' + areaPath + '"></path>'
             + '<path class="wt-line" filter="url(#wtGlow)" d="' + linePath + '"></path>';
    points.forEach((p, i) => {
      const cls = (i === points.length - 1) ? 'wt-dot-today' : 'wt-dot';
      const r = (i === points.length - 1) ? 5 : 3;
      html += '<circle class="' + cls + '" cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="' + r + '"/>';
    });
    $('wtChartContent').innerHTML = html;
    $('wtYAxisMax').textContent = yMax.toFixed(1);
    $('wtYAxisMin').textContent = yMin.toFixed(1);
    $('wtMeta').textContent = wtEntries.length + ' ' + (wtEntries.length === 1 ? 'entry' : 'entries') + ' · last ' + recent.length + ' days';
  }

  function wtRenderDelta() {
    const last = wtEntries[wtEntries.length - 1];
    const lastDate = wtParseKey(last.dateKey);
    const cutoff = new Date(lastDate); cutoff.setDate(cutoff.getDate() - 7);
    const baseline = wtEntries.find(e => wtParseKey(e.dateKey) >= cutoff) || wtEntries[0];
    const diff = last.weight - baseline.weight;
    const el = $('wtDelta');
    if (Math.abs(diff) < 0.05) { el.classList.add('hidden'); return; }
    const arrow = diff > 0 ? '↑' : '↓';
    const sign = diff > 0 ? '+' : '−';
    el.textContent = arrow + ' ' + sign + Math.abs(diff).toFixed(1) + ' ' + state.units + ' · last 7d';
    el.classList.toggle('up',   diff > 0);
    el.classList.toggle('down', diff < 0);
    el.classList.remove('hidden');
  }

  // ============================================================
  // COMPOSITION ESTIMATE — muscle vs fat from weight + strength trend
  //
  // Math:
  //   weightDelta   = current weight − weight ~30 days ago
  //   strengthDelta = avg of (current 1RM / 1RM 30 days ago across all
  //                   exercises with logs in BOTH windows)
  //   yearsTraining → max muscle gain rate per week:
  //     1y → 0.45 kg, 2y → 0.23 kg, 3y+ → 0.11 kg (Lyle McDonald's
  //     model — cited intermediate intermediate values are real ceilings)
  //   estimated muscle gain = max muscle rate × weeks × (1 + strengthDelta)
  //                           clipped to [0, weightDelta]
  //   estimated fat gain    = weightDelta − estimated muscle gain
  //
  // If you LOSE weight: any positive strength delta means you're keeping
  // (or building) muscle, so the loss is mostly fat.
  // ============================================================
  function wtRenderComposition() {
    const compEl = $('wtComp');
    if (!CONFIG.composition || !CONFIG.composition.enabled) {
      compEl.classList.add('hidden'); return;
    }
    const window = CONFIG.composition.windowDays || 30;
    if (wtEntries.length < 2) { compEl.classList.add('hidden'); return; }

    const now = wtParseKey(wtEntries[wtEntries.length - 1].dateKey);
    const start = new Date(now); start.setDate(start.getDate() - window);

    // Find weight at start of window (closest entry on or after start)
    const startEntry = wtEntries.find(e => wtParseKey(e.dateKey) >= start);
    const endEntry = wtEntries[wtEntries.length - 1];
    if (!startEntry || startEntry === endEntry) { compEl.classList.add('hidden'); return; }
    const weightDelta = endEntry.weight - startEntry.weight;
    const actualDays = Math.max(1, Math.round((wtParseKey(endEntry.dateKey) - wtParseKey(startEntry.dateKey)) / 86400000));
    const weeks = actualDays / 7;

    // Strength delta — for each exercise, take the AVG 1RM of logs inside
    // the window vs AVG of logs of equal count just before the window.
    let strengthRatios = [];
    let workoutDays = new Set();
    let totalVolumeInWindow = 0;
    state.exercises.forEach(ex => {
      const logs = (state.logs[ex.id] || []).slice();
      if (logs.length < 2 || ex.bw) {
        // Still count volume / sessions even for bodyweight + sparse exercises
        logs.forEach(l => {
          if (new Date(l.date) >= start) {
            workoutDays.add(l.date.slice(0, 10));
            totalVolumeInWindow += (l.weight || 0) * (l.reps || 0);
          }
        });
        return;
      }
      const inWin  = logs.filter(l => new Date(l.date) >= start);
      const before = logs.filter(l => new Date(l.date) < start);
      inWin.forEach(l => {
        workoutDays.add(l.date.slice(0, 10));
        totalVolumeInWindow += (l.weight || 0) * (l.reps || 0);
      });
      if (!inWin.length || !before.length) return;
      const avg = arr => arr.reduce((s, l) => s + estimate1RM(l.weight, l.reps), 0) / arr.length;
      const a = avg(before), b = avg(inWin);
      if (a <= 0) return;
      strengthRatios.push(b / a);
    });
    const strengthDelta = strengthRatios.length
      ? (strengthRatios.reduce((s, r) => s + r, 0) / strengthRatios.length) - 1
      : 0;
    // Frequency factor: 4+ training days/week = full credit, fewer = penalty.
    // Volume factor: moderate cap so a single huge day doesn't game the score.
    const sessionsPerWeek = (workoutDays.size / actualDays) * 7;
    const frequencyFactor = Math.max(0.4, Math.min(1.2, sessionsPerWeek / 4));

    // Max muscle gain rate per week (kg). Convert to lb if user's units are lb.
    const yt = CONFIG.composition.yearsTraining || 1;
    let maxMuscleKgPerWeek;
    if (yt <= 1) maxMuscleKgPerWeek = 0.45;
    else if (yt === 2) maxMuscleKgPerWeek = 0.23;
    else maxMuscleKgPerWeek = 0.11;
    const unitConv = (state.units === 'lb') ? 2.20462 : 1;
    const maxMusclePerWeek = maxMuscleKgPerWeek * unitConv;

    // Estimated muscle: scale by strength gain (capped between 0.5x and 1.5x)
    // AND by training frequency (you can't build muscle you didn't stimulate).
    const strengthBoost = Math.max(0.5, Math.min(1.5, 1 + strengthDelta * 4));
    let estMuscle = maxMusclePerWeek * weeks * strengthBoost * frequencyFactor;

    let estFat;
    let headlineCls = '';
    let headline = '';
    if (weightDelta > 0) {
      // Surplus: split between muscle and fat. Cap muscle at the weight gained.
      estMuscle = Math.min(estMuscle, weightDelta);
      estFat = Math.max(0, weightDelta - estMuscle);
      const musclePct = estMuscle / weightDelta;
      if (musclePct >= 0.6 && strengthDelta > 0) {
        headlineCls = 'good';
        headline = '+' + weightDelta.toFixed(1) + ' ' + state.units + ' — mostly muscle, strength up.';
      } else if (musclePct >= 0.35) {
        headlineCls = 'warn';
        headline = '+' + weightDelta.toFixed(1) + ' ' + state.units + ' — mixed. Tighten kcal or push lifts harder.';
      } else {
        headlineCls = 'bad';
        headline = '+' + weightDelta.toFixed(1) + ' ' + state.units + ' — mostly fat. Strength flat. Cut kcal.';
      }
    } else {
      // Deficit: assume fat first, only credit muscle loss if strength dropped.
      const wDown = Math.abs(weightDelta);
      if (strengthDelta >= 0) {
        // Strength preserved or up → all fat lost, slight muscle gain
        estMuscle = Math.min(maxMusclePerWeek * weeks * 0.3, 0.5);
        estFat = wDown + estMuscle;
        headlineCls = 'good';
        headline = '−' + wDown.toFixed(1) + ' ' + state.units + ' — strength holding, fat dropping.';
      } else {
        // Strength dropped → some muscle loss
        const lossPct = Math.min(0.4, Math.abs(strengthDelta) * 2);
        estMuscle = -wDown * lossPct;
        estFat = -(wDown + estMuscle);
        headlineCls = 'warn';
        headline = '−' + wDown.toFixed(1) + ' ' + state.units + ' — strength slipping. You may be losing muscle.';
      }
    }

    // Render
    compEl.classList.remove('hidden');
    $('wtCompWindow').textContent = 'last ' + actualDays + 'd';
    const headlineEl = $('wtCompHeadline');
    headlineEl.textContent = headline;
    headlineEl.className = 'wt-comp-headline ' + headlineCls;

    // Bars
    const totalAbs = Math.abs(estMuscle) + Math.abs(estFat) || 1;
    const musclePct = (Math.abs(estMuscle) / totalAbs) * 100;
    const fatPct = (Math.abs(estFat) / totalAbs) * 100;
    $('wtCompBars').innerHTML =
      '<div class="wt-comp-bar muscle" style="width:' + musclePct.toFixed(1) + '%"></div>' +
      '<div class="wt-comp-bar fat" style="width:' + fatPct.toFixed(1) + '%"></div>';

    // Foot line — strength + training frequency (so you can see why the
    // muscle estimate is what it is).
    const sd = strengthDelta * 100;
    const sdStr = (sd >= 0 ? '+' : '') + sd.toFixed(1) + '%';
    const muscleSign = estMuscle >= 0 ? '+' : '';
    const fatSign = estFat >= 0 ? '+' : '';
    const freqStr = sessionsPerWeek.toFixed(1) + ' sessions/wk';
    $('wtCompFoot').textContent =
      '~' + muscleSign + estMuscle.toFixed(1) + ' ' + state.units + ' muscle · '
      + '~' + fatSign + estFat.toFixed(1) + ' ' + state.units + ' fat · '
      + 'strength ' + sdStr
      + ' · ' + freqStr
      + (strengthRatios.length ? '' : ' (no lift data)');
  }

  // Wire weight UI
  $('wtSaveBtn').addEventListener('click', () => {
    const v = parseFloat($('wtInput').value);
    if (isNaN(v) || v <= 0) return;
    wtSaveEntry(v);
  });
  $('wtInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('wtSaveBtn').click();
  });
  $('wtEditBtn').addEventListener('click', () => {
    $('wtLocked').classList.add('hidden');
    $('wtInputRow').classList.remove('hidden');
    const todayEntry = wtEntries.find(e => e.dateKey === wtDateKey(new Date()));
    if (todayEntry) $('wtInput').value = todayEntry.weight.toFixed(1);
    $('wtInput').focus(); $('wtInput').select();
  });

  // ============================================================
  // PROGRESS PHOTOS
  // ============================================================
  let photos = [];
  try {
    const raw = localStorage.getItem(PHOTO_KEY);
    if (raw) photos = JSON.parse(raw);
  } catch (e) { photos = []; }

  function photosSave() {
    try {
      localStorage.setItem(PHOTO_KEY, JSON.stringify(photos));
      return true;
    } catch (e) {
      return false;
    }
  }
  // Downscale a dataURL to a max longest-side dimension and re-encode as
  // JPEG. Phone camera photos are often 2–5MB which blows the ~5MB
  // localStorage quota after one or two saves. Compressing to ~1080px /
  // q=0.75 typically drops each photo to <100KB.
  function compressPhotoDataUrl(dataUrl, maxDim, quality) {
    maxDim = maxDim || 1080;
    quality = quality == null ? 0.75 : quality;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > maxDim || h > maxDim) {
          if (w >= h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
          else { w = Math.round(w * (maxDim / h)); h = maxDim; }
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        try { resolve(c.toDataURL('image/jpeg', quality)); }
        catch { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }
  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const bytes = atob(parts[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function photoFmtDate(key) {
    const d = wtParseKey(key);
    const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return mons[d.getMonth()] + ' ' + d.getDate();
  }
  function photoCurrentWeight() {
    const last = wtEntries[wtEntries.length - 1];
    return last ? (last.weight.toFixed(1) + ' ' + state.units) : '—';
  }
  function photosRender() {
    const grid = $('wtPhotoGrid');
    if (!photos.length) {
      grid.innerHTML = '<div class="wt-photo-empty">No photos yet · tap Take Photo to start</div>';
    } else {
      grid.innerHTML = photos.map(p =>
        '<button class="wt-photo-card" data-id="' + p.id + '" type="button">' +
          '<img src="' + (p.storageUrl || p.dataUrl) + '" alt="">' +
          '<div class="wt-photo-overlay"></div>' +
          '<div class="wt-photo-meta">' +
            '<span class="wt-photo-date">' + photoFmtDate(p.dateKey) + '</span>' +
            '<span class="wt-photo-weight">' + (p.weight || '—') + '</span>' +
          '</div>' +
        '</button>'
      ).join('');
      grid.querySelectorAll('.wt-photo-card').forEach(card => {
        card.addEventListener('click', () => openPhoto(card.dataset.id));
      });
    }
    // Update count on the link
    if (!photos.length) $('wtProgressCount').textContent = '0 photos';
    else if (photos.length === 1) $('wtProgressCount').textContent = '1 photo · latest ' + photoFmtDate(photos[0].dateKey);
    else $('wtProgressCount').textContent = photos.length + ' photos · latest ' + photoFmtDate(photos[0].dateKey);
  }
  async function photosAdd(dataUrl) {
    let compressed = dataUrl;
    try { compressed = await compressPhotoDataUrl(dataUrl); } catch {}
    const id = 'p' + Date.now() + '_' + Math.floor(Math.random() * 999);
    const entry = {
      id,
      dataUrl: compressed,
      storageUrl: null,
      dateKey: wtDateKey(new Date()),
      weight: photoCurrentWeight()
    };
    photos.unshift(entry);
    if (!photosSave()) {
      try { entry.dataUrl = await compressPhotoDataUrl(dataUrl, 800, 0.6); } catch {}
      if (!photosSave()) {
        photos.shift();
        alert('Phone storage is full — delete some older progress photos before adding a new one.');
        return;
      }
    }
    photosRender();
    // Upload to Supabase Storage (progress-photos bucket) so the photo
    // syncs to every device. Once uploaded, we strip the local blob and
    // save again so the sync row stays small.
    if (pcSupa) {
      try {
        const blob = dataUrlToBlob(compressed);
        const path = APP_KEY + '/' + id + '.jpg';
        const { error } = await pcSupa.storage
          .from('progress-photos')
          .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (!error) {
          const { data: urlData } = pcSupa.storage
            .from('progress-photos')
            .getPublicUrl(path);
          entry.storageUrl = urlData.publicUrl;
          delete entry.dataUrl;
          photosSave();
        }
      } catch (_) {}
    }
  }
  function fileToPhoto(file) {
    const r = new FileReader();
    r.onload = (e) => photosAdd(e.target.result);
    r.readAsDataURL(file);
  }

  $('wtProgressLink').addEventListener('click', () => {
    photosRender();
    $('wtOverlay').classList.add('is-open');
    document.body.style.overflow = 'hidden';
  });
  $('wtBack').addEventListener('click', () => {
    $('wtOverlay').classList.remove('is-open');
    document.body.style.overflow = '';
  });

  // Take Photo: try in-browser camera, fall back to file input
  let camStream = null;
  let camFacing = 'environment';
  async function openCam() {
    $('wtCam').classList.add('is-open');
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: camFacing } }, audio: false
      });
      $('wtCamVideo').srcObject = camStream;
    } catch (e) {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        $('wtCamVideo').srcObject = camStream;
      } catch (e2) {
        closeCam();
        alert('Camera unavailable. Use "From Library" instead.');
        throw e2;
      }
    }
  }
  function closeCam() {
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    $('wtCamVideo').srcObject = null;
    $('wtCam').classList.remove('is-open');
  }
  $('wtTakePhotoBtn').addEventListener('click', async () => {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try { await openCam(); return; } catch (e) {}
    }
    $('wtFileCamera').click();
  });
  $('wtFileCamera').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) fileToPhoto(f);
    e.target.value = '';
  });
  $('wtFromLibraryBtn').addEventListener('click', () => $('wtFileLibrary').click());
  $('wtFileLibrary').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) fileToPhoto(f);
    e.target.value = '';
  });
  $('wtCamCancel').addEventListener('click', closeCam);
  $('wtCamFlip').addEventListener('click', async () => {
    camFacing = camFacing === 'environment' ? 'user' : 'environment';
    if (camStream) camStream.getTracks().forEach(t => t.stop());
    try { await openCam(); } catch (e) {}
  });
  $('wtCamShutter').addEventListener('click', () => {
    const video = $('wtCamVideo'), canvas = $('wtCamCanvas');
    if (!video.videoWidth) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    closeCam();
    photosAdd(dataUrl);
  });

  // Photo viewer
  let activePhotoId = null;
  let comparePhotoId = null;       // the OTHER photo being compared to
  let pvDeleteConfirm = false;
  function openPhoto(id) {
    const p = photos.find(x => x.id === id);
    if (!p) return;
    activePhotoId = id;
    $('wtViewerImg').src = p.dataUrl;
    $('wtViewerDate').textContent = photoFmtDate(p.dateKey).toUpperCase();
    $('wtViewerWeight').textContent = p.weight || '—';
    $('wtViewer').dataset.mode = 'single';
    $('wtViewer').classList.add('is-open');
    pvDeleteConfirm = false;
    $('wtViewerDelete').textContent = 'Delete';
    $('wtViewerDelete').classList.remove('is-confirm');
    // Disable Compare button if there's no other photo to compare against
    $('wtViewerCompare').disabled = photos.length < 2;
    $('wtViewerCompare').style.opacity = photos.length < 2 ? '0.4' : '';
  }
  function closePhoto() {
    $('wtViewer').classList.remove('is-open');
    $('wtViewer').dataset.mode = 'single';
    activePhotoId = null;
    comparePhotoId = null;
  }

  // Pull a number out of "162.0 lbs" / "73.5 kg" / "—"
  function parseWeightStr(w) {
    if (!w) return null;
    const m = String(w).match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  // Format a delta with arrow + sign
  function fmtDelta(diff, units) {
    if (diff == null) return '';
    if (Math.abs(diff) < 0.05) return '· no change';
    const sign = diff > 0 ? '+' : '−';
    return '· ' + sign + Math.abs(diff).toFixed(1) + ' ' + units;
  }

  // Pick the "compare to" photo for a given active id. Default: the most
  // recent photo BEFORE the active one (older → time-progress comparison).
  // Falls back to the most recent newer photo if active is the oldest.
  function defaultCompareFor(activeId) {
    const idx = photos.findIndex(p => p.id === activeId);
    if (idx === -1) return null;
    if (photos[idx + 1]) return photos[idx + 1].id;        // photos are stored newest-first
    if (photos[idx - 1]) return photos[idx - 1].id;
    return null;
  }

  function openCompare(activeId, otherId) {
    const A = photos.find(p => p.id === activeId);
    const B = photos.find(p => p.id === otherId);
    if (!A || !B) return;
    activePhotoId = activeId;
    comparePhotoId = otherId;
    $('wtCmpImgA').src = A.dataUrl;
    $('wtCmpImgB').src = B.dataUrl;
    $('wtCmpMetaA').textContent = photoFmtDate(A.dateKey) + ' · ' + (A.weight || '—');
    $('wtCmpMetaB').textContent = photoFmtDate(B.dateKey) + ' · ' + (B.weight || '—');
    // Headline — date arrow + weight delta
    const wA = parseWeightStr(A.weight);
    const wB = parseWeightStr(B.weight);
    const headEl = $('wtCompareHeadline');
    let cls = 'flat', headline = photoFmtDate(A.dateKey) + ' → ' + photoFmtDate(B.dateKey);
    if (wA != null && wB != null) {
      const diff = wA - wB; // active vs comparison
      headline += ' ' + fmtDelta(diff, state.units);
      if (Math.abs(diff) < 0.05) cls = 'flat';
      else if (diff > 0) cls = 'up';
      else cls = 'down';
    }
    headEl.textContent = headline;
    headEl.className = 'wt-compare-headline ' + cls;
    $('wtViewer').dataset.mode = 'compare';
    $('wtViewer').classList.add('is-open');
    pvDeleteConfirm = false;
    $('wtCompareDelete').textContent = 'Delete';
    $('wtCompareDelete').classList.remove('is-confirm');
  }

  function cycleCompareTarget() {
    if (!activePhotoId) return;
    const others = photos.filter(p => p.id !== activePhotoId);
    if (!others.length) return;
    const curIdx = others.findIndex(p => p.id === comparePhotoId);
    const nextIdx = (curIdx + 1) % others.length;
    openCompare(activePhotoId, others[nextIdx].id);
  }

  function deleteActivePhoto(deleteBtn) {
    if (!activePhotoId) return;
    if (!pvDeleteConfirm) {
      pvDeleteConfirm = true;
      deleteBtn.textContent = 'Confirm delete?';
      deleteBtn.classList.add('is-confirm');
      setTimeout(() => {
        pvDeleteConfirm = false;
        deleteBtn.textContent = 'Delete';
        deleteBtn.classList.remove('is-confirm');
      }, 3000);
      return;
    }
    const deletedId = activePhotoId;
    const deletedPhoto = photos.find(p => p.id === deletedId);
    photos = photos.filter(p => p.id !== deletedId);
    photosSave();
    photosRender();
    closePhoto();
    if (pcSupa && deletedPhoto && deletedPhoto.storageUrl) {
      pcSupa.storage.from('progress-photos')
        .remove([APP_KEY + '/' + deletedId + '.jpg'])
        .catch(() => {});
    }
  }

  $('wtViewerClose').addEventListener('click', closePhoto);
  $('wtCompareClose').addEventListener('click', closePhoto);
  $('wtViewerDelete').addEventListener('click', () => deleteActivePhoto($('wtViewerDelete')));
  $('wtCompareDelete').addEventListener('click', () => deleteActivePhoto($('wtCompareDelete')));
  $('wtViewerCompare').addEventListener('click', () => {
    if (!activePhotoId) return;
    const otherId = defaultCompareFor(activePhotoId);
    if (!otherId) { alert('Need at least one other photo to compare.'); return; }
    openCompare(activePhotoId, otherId);
  });
  $('wtCompareBack').addEventListener('click', () => {
    if (activePhotoId) {
      $('wtViewer').dataset.mode = 'single';
    } else {
      closePhoto();
    }
  });
  // Tap the right-hand "other" photo to cycle through different comparison targets
  $('wtCmpSideB').addEventListener('click', cycleCompareTarget);

  // ============================================================
  // BOOT
  // ============================================================
  renderAll();
  wtRender();
  photosRender();

  // ============================================================
  // CLOUD SYNC via Supabase  (OPTIONAL — leave blank for local-only)
  // ------------------------------------------------------------
  // Stores your gym state as one JSONB row in the public.app_state
  // table, keyed by APP_KEY. Supabase's realtime channel pushes
  // changes to every device the instant they happen.
  //
  // SETUP (5 minutes, all in a browser):
  //   1. Make a free account at https://supabase.com
  //   2. Create a new project
  //   3. In your project: Settings → API → copy your Project URL +
  //      "Publishable" key (the one starting with `sb_publishable_`)
  //   4. Paste them below, replacing the two placeholder strings
  //   5. Open the SQL Editor and run the SQL block from README.md
  //
  // If you leave the placeholders unchanged the app still works,
  // just only on this device (data stays in your browser).
  // ============================================================
  const APP_KEY = 'po-coach';
  const PC_SYNCED_KEYS = ['po_coach_v1', 'po_coach_workout_done', 'po_coach_weights', 'po_coach_photos'];

  let pcSupa = null;
  let pcPushTimer = null;
  let pcSuppressSync = false;
  let pcPendingRemote = null;
  // JSON of the last state we sent or received — used to ignore
  // realtime echoes of our own pushes so we don't infinite-loop.
  let pcLastSyncedJson = null;

  const _pcOrigSet = localStorage.setItem.bind(localStorage);
  const _pcOrigRemove = localStorage.removeItem.bind(localStorage);
  // Wrap setItem/removeItem so a sync-side error can NEVER prevent the
  // underlying write from happening. The original call always runs;
  // any error in the sync scheduling is swallowed.
  localStorage.setItem = function(k, v) {
    _pcOrigSet(k, v);
    try {
      if (!pcSuppressSync && PC_SYNCED_KEYS.indexOf(k) !== -1) pcSchedulePush();
    } catch (e) {}
  };
  localStorage.removeItem = function(k) {
    _pcOrigRemove(k);
    try {
      if (!pcSuppressSync && PC_SYNCED_KEYS.indexOf(k) !== -1) pcSchedulePush();
    } catch (e) {}
  };

  function pcCollectState() {
    const out = {};
    for (const k of PC_SYNCED_KEYS) {
      const v = localStorage.getItem(k);
      if (v == null) continue;
      try { out[k] = JSON.parse(v); } catch {}
    }
    return out;
  }

  function pcIsUserEditing() {
    const ae = document.activeElement;
    if (!ae) return false;
    const tag = ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (ae.getAttribute && ae.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  function pcRerender() {
    // Reload every closure variable that mirrors a synced localStorage
    // key — otherwise renderAll/wtRender/photosRender would read stale
    // in-memory copies from before the remote pull.
    try { state = loadState(); } catch {}
    try { wtEntries = wtLoad(); } catch {}
    try {
      const raw = localStorage.getItem(PHOTO_KEY);
      photos = raw ? JSON.parse(raw) : [];
    } catch { photos = []; }
    try { renderAll(); } catch {}
    try { wtRender(); } catch {}
    try { photosRender(); } catch {}
  }

  function pcApplyRemoteState(remote) {
    if (!remote || typeof remote !== 'object') return false;
    pcSuppressSync = true;
    let changed = false;
    try {
      for (const k of PC_SYNCED_KEYS) {
        if (k in remote) {
          const incoming = JSON.stringify(remote[k]);
          const local = localStorage.getItem(k);
          if (local !== incoming) { try { _pcOrigSet(k, incoming); changed = true; } catch {} }
        } else if (localStorage.getItem(k) != null) {
          try { _pcOrigRemove(k); changed = true; } catch {}
        }
      }
    } finally {
      pcSuppressSync = false;
    }
    if (changed) { try { pcRerender(); } catch (e) {} }
    return changed;
  }

  function pcMaybeApplyRemote(remote) {
    if (pcIsUserEditing()) { pcPendingRemote = remote; return; }
    pcApplyRemoteState(remote);
  }

  function pcApplyPendingIfReady() {
    if (pcPendingRemote && !pcIsUserEditing()) {
      const r = pcPendingRemote;
      pcPendingRemote = null;
      pcApplyRemoteState(r);
    }
  }

  async function pcPushNow() {
    if (!pcSupa) return;
    const state = pcCollectState();
    const json = JSON.stringify(state);
    if (json === pcLastSyncedJson) return;
    try {
      const { error } = await pcSupa
        .from('app_state')
        .upsert(
          { key: APP_KEY, data: state, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        );
      if (!error) pcLastSyncedJson = json;
    } catch (_) {}
  }

  function pcSchedulePush() {
    if (pcSuppressSync) return;
    clearTimeout(pcPushTimer);
    pcPushTimer = setTimeout(pcPushNow, 250);
  }

  // Backup push on unload via fetch keepalive so a fast refresh
  // doesn't lose the latest change before the debounced push fires.
  function pcFlushPushOnUnload() {
    if (!pcSupa) return;
    const state = pcCollectState();
    const json = JSON.stringify(state);
    if (json === pcLastSyncedJson) return;
    try {
      fetch(SUPABASE_URL + '/rest/v1/app_state?on_conflict=key', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify({ key: APP_KEY, data: state, updated_at: new Date().toISOString() }),
        keepalive: true,
      }).catch(() => {});
      pcLastSyncedJson = json;
    } catch (_) {}
  }

  // Initial sync: connect Supabase, pull current state, subscribe to
  // realtime updates so other devices' changes appear instantly.
  (async function pcInitCloudSync() {
    if (!window.supabase || !SUPABASE_URL || !SUPABASE_KEY) return;
    // Skip if the placeholder values are still in place (local-only mode)
    if (SUPABASE_URL.indexOf('PASTE-') === 0 || SUPABASE_KEY.indexOf('PASTE-') === 0) return;
    pcSupa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    try {
      const { data, error } = await pcSupa
        .from('app_state').select('data').eq('key', APP_KEY).maybeSingle();
      if (!error && data && data.data && Object.keys(data.data).length > 0) {
        pcLastSyncedJson = JSON.stringify(data.data);
        pcMaybeApplyRemote(data.data);
      } else if (Object.keys(pcCollectState()).length > 0) {
        pcSchedulePush();
      }
    } catch (_) {}
    pcSupa.channel('app_state_' + APP_KEY)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'app_state',
        filter: 'key=eq.' + APP_KEY,
      }, (payload) => {
        if (!payload.new || !payload.new.data) return;
        const incoming = JSON.stringify(payload.new.data);
        if (incoming === pcLastSyncedJson) return; // echo of our own push
        pcLastSyncedJson = incoming;
        pcMaybeApplyRemote(payload.new.data);
      })
      .subscribe();
  })();

  document.addEventListener('focusout', () => {
    setTimeout(pcApplyPendingIfReady, 0);
  }, true);
  window.addEventListener('pagehide', pcFlushPushOnUnload);
  window.addEventListener('beforeunload', pcFlushPushOnUnload);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pcFlushPushOnUnload();
  });
})();
