// js/migrate.js — Eenmalige overzetting van de oude Google Sheet-app naar dit huishouden
//
// Leest via de bestaande Apps Script-API (alleen lezen) en schrijft met de oorspronkelijke id's naar Firestore.
// Omdat de id's gelijk blijven, kloppen alle verwijzingen (categorie → budget, spaarregel → doel) en is opnieuw
// uitvoeren veilig: bestaande documenten met dezelfde id worden overschreven, niet verdubbeld.

const Migrate = (() => {
  let _st = {
    phase: 'form',          // form | fetching | preview | writing | done | error
    url:   localStorage.getItem('kasboek_script_url') || '',
    key:   localStorage.getItem('kasboek_api_key')    || '',
    log:   [],
    docs:  null,            // [{ coll, id, data }]
    skipped: 0,
    progress: '',
    error: ''
  };

  const _el = () => document.getElementById('migrate-card');
  const _now = () => new Date().toISOString();
  const _num = v => (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? null : parseFloat(v);
  const _month = v => String(v || '').slice(0, 7);
  const _date = v => String(v || '').slice(0, 10);

  const COLLS = [
    ['categories', 'categorieën'], ['budgets', 'budgetten (incl. versies)'], ['budget_overrides', 'maandoverschrijvingen'],
    ['transactions', 'transacties'], ['savings_goals', 'spaardoelen'], ['savings_rules', 'spaarafspraken'],
    ['savings_jobs', 'openstaande spaartaken']
  ];

  // ─── Oude API (alleen GET) ───────────────────────────────────────────────────
  async function _get(params) {
    const u = new URL(_st.url);
    u.searchParams.set('apiKey', _st.key);
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') u.searchParams.set(k, v); });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(u.toString(), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Server fout ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'API fout');
      return json.data;
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'De oude server reageerde niet op tijd.' : e.message);
    } finally {
      clearTimeout(timer);
    }
  }

  function _log(text) { _st.log.push(text); _draw(); }

  async function _fetchAll() {
    _st.phase = 'fetching'; _st.log = []; _st.error = ''; _draw();
    try {
      _log('Categorieën ophalen…');
      const categories = await _get({ action: 'getCategories' });
      _log('Budgetten ophalen…');
      const budgets = await _get({ action: 'getBudgets' });
      _log('Transacties ophalen…');
      const transactions = await _get({ action: 'getTransactions' });
      _log('Spaardoelen ophalen…');
      const goals = await _get({ action: 'getSavingsGoals' });
      _log('Spaartaken ophalen…');
      const jobs = await _get({ action: 'getSavingsJobs' });

      // Overschrijvingen zijn alleen per maand op te vragen: loop de maanden langs vanaf de oudste gegevens
      const starts = [
        ...transactions.map(t => _month(t.date)),
        ...budgets.map(b => _month(b.created_at)),
        ...budgets.map(b => _month(b.effective_from))
      ].filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
      const ym = currentYearMonth();
      const endIdx = ym.year * 12 + (ym.month - 1) + 12;
      let idx = starts.length ? (parseInt(starts[0].slice(0, 4)) * 12 + parseInt(starts[0].slice(5)) - 1) : endIdx - 12;
      idx = Math.max(idx, endIdx - 120);
      const months = [];
      for (let i = idx; i <= endIdx; i++) months.push(`${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`);

      const overrides = new Map();
      let done = 0;
      const queue = months.slice();
      const worker = async () => {
        while (queue.length) {
          const m = queue.shift();
          const rows = await _get({ action: 'getBudgetStats', from: `${m}-01`, to: `${m}-31` });
          rows.filter(r => r.has_override && r.override_amount !== null).forEach(r => {
            overrides.set(`${r.budget_id}__${m}`, { budget_id: String(r.budget_id), month: m, amount: parseFloat(r.override_amount) });
          });
          done++;
          if (done % 5 === 0 || done === months.length) {
            _st.log[_st.log.length - 1] = `Maandoverschrijvingen controleren… ${done} van ${months.length} maanden`;
            _draw();
          }
        }
      };
      _log(`Maandoverschrijvingen controleren… 0 van ${months.length} maanden`);
      await Promise.all([worker(), worker(), worker()]);

      _st.docs = _build({ categories, budgets, transactions, goals, jobs, overrides: [...overrides.values()] });
      _st.phase = 'preview';
    } catch (e) {
      _st.phase = 'error'; _st.error = e.message || String(e);
    }
    _draw();
  }

  // ─── Vertalen naar Firestore-documenten ──────────────────────────────────────
  function _build({ categories, budgets, transactions, goals, jobs, overrides }) {
    const docs = [];
    const uid = Config.user.uid;
    const now = _now();
    _st.skipped = 0;

    const add = (coll, id, data) => {
      const key = String(id === undefined || id === null ? '' : id).trim();
      if (!key || key.includes('/') || key === '.' || key === '..') { _st.skipped++; return; }
      docs.push({ coll, id: key, data });
    };

    categories.forEach(c => add('categories', c.id, {
      name: String(c.name || ''), color: String(c.color || '#cccccc'),
      budget_id: String(c.budget_id || ''), created_at: String(c.created_at || now)
    }));

    budgets.forEach(b => add('budgets', b.id, {
      name: String(b.name || ''), default_amount: parseFloat(b.default_amount) || 0,
      created_at: String(b.created_at || now),
      budget_id: String(b.budget_id || ''), effective_from: _month(b.effective_from)
    }));

    overrides.forEach(o => add('budget_overrides', `${o.budget_id}__${o.month}`, {
      budget_id: o.budget_id, month: o.month, amount: o.amount, created_at: now
    }));

    transactions.forEach(t => add('transactions', t.id, {
      date: _date(t.date), amount: parseFloat(t.amount) || 0,
      category_id: String(t.category_id || ''), description: String(t.description || ''),
      created_at: String(t.created_at || now), updated_at: String(t.updated_at || t.created_at || now),
      created_by: uid
    }));

    goals.forEach(g => {
      add('savings_goals', g.id, {
        name: String(g.name || ''), current_balance: parseFloat(g.current_balance) || 0,
        target_amount: _num(g.target_amount), target_date: _date(g.target_date),
        notes: String(g.notes || ''), active: true, created_at: now
      });
      (g.rules || []).forEach(r => add('savings_rules', r.id, {
        goal_id: String(g.id), type: String(r.type || ''), amount: _num(r.amount), percentage: _num(r.percentage),
        source: String(r.source || ''), day_of_month: _num(r.day_of_month) === null ? null : parseInt(r.day_of_month),
        active: r.active !== false, notes: String(r.notes || ''), created_at: now
      }));
    });

    jobs.forEach(j => add('savings_jobs', j.id, {
      rule_id: String(j.rule_id || ''), goal_id: String(j.goal_id || ''), goal_name: String(j.goal_name || ''),
      scheduled_date: _date(j.scheduled_date), executed_at: '', amount: parseFloat(j.amount) || 0,
      status: 'pending', created_at: String(j.created_at || now)
    }));

    return docs;
  }

  // ─── Wegschrijven ────────────────────────────────────────────────────────────
  async function _write() {
    const hid = Config.householdId;
    if (!hid || !_st.docs) return;

    const existing = await Promise.all([Api.getCategories(), Api.getBudgets()]).catch(() => [[], []]);
    if (existing[0].length || existing[1].length) {
      if (!confirm('Dit huishouden bevat al categorieën of budgetten (bijvoorbeeld de voorbeeldgegevens). ' +
                   'Die blijven staan, dus je kunt dubbele items krijgen. Toch doorgaan?')) return;
    }

    _st.phase = 'writing'; _st.error = ''; _draw();
    const docs = _st.docs;
    const SIZE = 400;
    try {
      for (let i = 0; i < docs.length; i += SIZE) {
        _st.progress = `${Math.min(i + SIZE, docs.length)} van ${docs.length} schrijven…`;
        _draw();
        const batch = FB.writeBatch(FB.db);
        docs.slice(i, i + SIZE).forEach(d => batch.set(FB.doc(FB.db, 'households', hid, d.coll, d.id), d.data));
        await batch.commit();
      }
      _st.phase = 'done';
      Api.clearCache();
      showToast('Migratie voltooid', 'success');
    } catch (e) {
      _st.phase = 'error';
      _st.error = (e.code === 'permission-denied' ? 'Geen toegang (controleer de beveiligingsregels). ' : '') +
                  (e.message || String(e)) + ' Opnieuw proberen is veilig: bestaande gegevens worden overschreven, niet verdubbeld.';
    }
    _draw();
  }

  // ─── Scherm ──────────────────────────────────────────────────────────────────
  function _counts() {
    const n = {};
    (_st.docs || []).forEach(d => { n[d.coll] = (n[d.coll] || 0) + 1; });
    return COLLS.map(([k, label]) => `<li><strong>${n[k] || 0}</strong> ${label}</li>`).join('');
  }

  function _draw() {
    const el = _el();
    if (!el) return;
    const log = `<ul class="migrate-log">${_st.log.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
    let body = '';

    if (_st.phase === 'form' || _st.phase === 'error') {
      body = `
        ${_st.phase === 'error' ? `<div class="auth-message error">${escapeHtml(_st.error)}</div>` : ''}
        <div class="form-group"><label class="form-label" for="mg-url">Script URL van de oude app</label>
          <input id="mg-url" class="input" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${escapeHtml(_st.url)}"></div>
        <div class="form-group"><label class="form-label" for="mg-key">API-sleutel van de oude app</label>
          <input id="mg-key" class="input" type="password" autocomplete="off" value="${escapeHtml(_st.key)}"></div>
        <button class="btn btn-full" id="mg-fetch" type="button">Gegevens ophalen</button>`;
    } else if (_st.phase === 'fetching') {
      body = `<div class="loading-state"><div class="spinner"></div></div>${log}`;
    } else if (_st.phase === 'preview') {
      body = `
        <p class="settings-info" style="margin-bottom:8px">Dit wordt overgezet naar <strong>${escapeHtml(Config.household ? Config.household.name : '')}</strong>:</p>
        <ul class="migrate-counts">${_counts()}</ul>
        ${_st.skipped ? `<p class="settings-info">${_st.skipped} rijen zonder bruikbare id overgeslagen.</p>` : ''}
        <p class="settings-info" style="margin:8px 0 12px">Niet meegenomen: inactieve spaardoelen, de historie van spaarstortingen en afgeronde taken (het saldo per doel wel), en de zonnescherminstellingen.</p>
        <button class="btn btn-full" id="mg-write" type="button">Nu importeren</button>
        <button class="btn btn-secondary btn-full" id="mg-cancel" type="button" style="margin-top:8px">Annuleren</button>`;
    } else if (_st.phase === 'writing') {
      body = `<div class="loading-state"><div class="spinner"></div></div><p class="settings-info">${escapeHtml(_st.progress)}</p>`;
    } else if (_st.phase === 'done') {
      body = `
        <div class="auth-message" style="background:var(--color-primary-lt);color:var(--color-primary-dk)">Alles is overgezet. Controleer de totalen op het dashboard en bij Budgetten.</div>
        <button class="btn btn-secondary btn-full" id="mg-again" type="button">Opnieuw uitvoeren</button>`;
    }

    el.innerHTML = `
      <h3>Migreren uit de oude app</h3>
      <p class="settings-info" style="margin-bottom:12px">Zet je gegevens uit de Google Sheet-versie over naar dit huishouden. De oude app wordt alleen gelezen en blijft ongewijzigd. Je vindt de URL en sleutel in de Instellingen van de oude app.</p>
      ${body}`;

    const on = (id, fn) => { const b = el.querySelector(id); if (b) b.addEventListener('click', fn); };
    const urlIn = el.querySelector('#mg-url'), keyIn = el.querySelector('#mg-key');
    if (urlIn) urlIn.addEventListener('input', () => { _st.url = urlIn.value.trim(); });
    if (keyIn) keyIn.addEventListener('input', () => { _st.key = keyIn.value.trim(); });

    on('#mg-fetch', () => {
      if (!/^https:\/\/script\.google\.com\//.test(_st.url) || !_st.key) {
        showToast('Vul een geldige Script URL (https://script.google.com/…) en de API-sleutel in.', 'error');
        return;
      }
      _fetchAll();
    });
    on('#mg-write', _write);
    on('#mg-cancel', () => { _st.phase = 'form'; _st.docs = null; _draw(); });
    on('#mg-again', () => { _st.phase = 'form'; _st.docs = null; _draw(); });
  }

  function renderCard(el) {
    if (!el) return;
    if (!Config.user || !Config.household || Config.readOnly) { el.innerHTML = ''; el.style.display = Config.readOnly ? 'none' : ''; return; }
    _draw();
  }

  return { renderCard };
})();
