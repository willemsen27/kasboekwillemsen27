// js/api.js — Gegevenslaag op Firestore
//
// Werking:
//  • Per verzameling (categorieën, budgetten, ...) en per opgevraagd datumbereik (transacties) staat een
//    realtime-luisteraar open. Bij het openen van de app komen de gegevens meteen uit de lokale cache
//    (IndexedDB) en worden ze op de achtergrond met de server vergeleken. Is er iets anders, dan meldt
//    Api.onChange() dit en ververst het scherm zichzelf.
//  • Schrijfacties werken direct op de lokale cache (het scherm is meteen bijgewerkt) en worden op de
//    achtergrond naar de server gestuurd. Ook offline of na het sluiten van de app blijft de wachtrij bewaard.
//    Mislukt een schrijfactie op de server, dan wordt de wijziging teruggedraaid en volgt een foutmelding.
//  • Totalen (getStats, getBudgetStats) worden in de browser uitgerekend uit de gegevens.
//
// De publieke functies en de vorm van de gegevens (snake_case-velden) zijn gelijk aan de Google Sheets-versie.

const Api = (() => {

  const _READY_TIMEOUT = 3000;   // ms wachten op de server als de cache leeg is
  const _SYNC_TIMEOUT  = 8000;
  const _TX_MAX        = 8;      // maximaal aantal openstaande maand-luisteraars voor transacties

  let _hid = null;
  let _reads = 0, _writes = 0;
  const _ls = new Map();         // key → luisteraar
  const _changeListeners = new Set();
  const _busyListeners   = new Set();

  // ─── Events ──────────────────────────────────────────────────────────────────
  function onChange(fn) { _changeListeners.add(fn); return () => _changeListeners.delete(fn); }
  function onBusy(fn)   { _busyListeners.add(fn);   return () => _busyListeners.delete(fn); }
  function _emitChange(key) { _changeListeners.forEach(fn => { try { fn(key); } catch {} }); }
  function _emitBusy()      { _busyListeners.forEach(fn => { try { fn({ reads: _reads, writes: _writes }); } catch {} }); }
  function pendingWrites()  { return _writes; }

  // ─── Huishouden ──────────────────────────────────────────────────────────────
  let _readOnly = false;         // admin die meekijkt: alleen lezen
  function _needHid() { if (!_hid) throw new Error('Geen huishouden geselecteerd.'); }
  function _need() {
    _needHid();
    if (_readOnly) throw new Error('Je kijkt alleen mee; wijzigen kan niet.');
  }
  function _col(name) { return FB.collection(FB.db, 'households', _hid, name); }
  function _ref(name, id) { return id ? FB.doc(FB.db, 'households', _hid, name, String(id)) : FB.doc(_col(name)); }

  function _teardown() {
    _ls.forEach(L => { try { L.unsub && L.unsub(); } catch {} clearTimeout(L.timer); });
    _ls.clear();
  }

  function setHousehold(hid, readOnly) {
    const ro = !!readOnly;
    if (hid === _hid && ro === _readOnly) return;
    _teardown();
    _hid = hid || null;
    _readOnly = ro && !!_hid;
  }

  // ─── Luisteraars ─────────────────────────────────────────────────────────────
  const _byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'nl');
  const _byBudget = (a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'nl') ||
    String(a.effective_from || '').localeCompare(String(b.effective_from || ''));
  const _byDateDesc = (a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')) ||
    String(b.created_at || '').localeCompare(String(a.created_at || ''));
  const _byCreated = (a, b) =>
    String(a.created_at || '').localeCompare(String(b.created_at || '')) || _byName(a, b);

  // Een luisteraar is "klaar" zodra er bruikbare gegevens zijn: van de server, of uit de cache (als daar iets
  // in staat). Een lege cache kan ook "nog nooit opgehaald" betekenen, dus dan wachten we op de server (max 3 s).
  function _listener(key, makeSource, sort) {
    let L = _ls.get(key);
    if (L) { L.used = Date.now(); return L; }
    _needHid();
    L = { key, rows: [], ready: false, synced: false, sig: null, waiters: [], syncWaiters: [], unsub: null, timer: null, used: Date.now() };
    _ls.set(key, L);

    const settle = err => {
      if (L.ready) return;
      L.ready = true;
      clearTimeout(L.timer);
      const w = L.waiters; L.waiters = [];
      w.forEach(x => err ? x.reject(err) : x.resolve(L.rows));
    };
    L.timer = setTimeout(() => settle(), _READY_TIMEOUT);

    L.unsub = FB.onSnapshot(makeSource(), { includeMetadataChanges: true }, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (sort) rows.sort(sort);
      const sig = JSON.stringify(rows);
      const changed = sig !== L.sig;
      L.rows = rows; L.sig = sig;

      if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites && !L.synced) {
        L.synced = true;
        const sw = L.syncWaiters; L.syncWaiters = [];
        sw.forEach(f => f(true));
      }
      if (!L.ready) { if (!snap.metadata.fromCache || rows.length) settle(); }
      else if (changed) _emitChange(key);
    }, err => {
      console.error('Firestore-luisteraar mislukt:', key, err);
      if (_ls.get(key) === L) _ls.delete(key);   // volgende keer opnieuw proberen
      const wasReady = L.ready;
      settle(err);
      L.syncWaiters.forEach(f => f(false)); L.syncWaiters = [];
      if (wasReady) showToast('Verbinding met de database verbroken: ' + _msg(err), 'error');
    });
    return L;
  }

  function _load(L, quiet) {
    if (L.ready) return Promise.resolve(L.rows);
    if (!quiet) { _reads++; _emitBusy(); }
    return new Promise((resolve, reject) => L.waiters.push({ resolve, reject })).finally(() => {
      if (!quiet) { _reads--; _emitBusy(); }
    });
  }

  function _whenSynced(L) {
    if (L.synced) return Promise.resolve(true);
    return new Promise(resolve => {
      L.syncWaiters.push(resolve);
      setTimeout(() => resolve(false), _SYNC_TIMEOUT);
    });
  }

  const _catsL     = () => _listener('categories',       () => _col('categories'),       _byName);
  const _budgetsL  = () => _listener('budgets',          () => _col('budgets'),          _byBudget);
  const _overL     = () => _listener('budget_overrides', () => _col('budget_overrides'), null);
  const _goalsL    = () => _listener('savings_goals',    () => _col('savings_goals'),    _byName);
  const _rulesL    = () => _listener('savings_rules',    () => _col('savings_rules'),    null);
  const _jobsL     = () => _listener('savings_jobs',     () => _col('savings_jobs'),     (a, b) => String(a.scheduled_date || '').localeCompare(String(b.scheduled_date || '')));

  function _txL(from, to) {
    const f = from || '0000-01-01', t = to || '9999-12-31';
    const key = `tx:${f}:${t}`;
    const isNew = !_ls.has(key);
    const L = _listener(key, () => FB.query(_col('transactions'), FB.where('date', '>=', f), FB.where('date', '<=', t)), _byDateDesc);
    if (isNew) {
      const txKeys = [..._ls.keys()].filter(k => k.startsWith('tx:'));
      if (txKeys.length > _TX_MAX) {
        const oldest = txKeys.filter(k => k !== key).sort((a, b) => _ls.get(a).used - _ls.get(b).used)[0];
        const O = _ls.get(oldest);
        if (O) { try { O.unsub(); } catch {} clearTimeout(O.timer); _ls.delete(oldest); }
      }
    }
    return L;
  }

  const _q = opts => !!(opts && opts.prefetch);

  // ─── Lezen ───────────────────────────────────────────────────────────────────
  async function getCategories(opts) {
    return (await _load(_catsL(), _q(opts))).slice();
  }

  async function getTransactions({ from, to, categoryId, budgetId } = {}, opts) {
    const q = _q(opts);
    const [rows, cats] = await Promise.all([_load(_txL(from, to), q), budgetId ? _load(_catsL(), q) : null]);
    let out = rows;
    if (budgetId) {
      const ids = new Set(cats.filter(c => String(c.budget_id) === String(budgetId)).map(c => String(c.id)));
      out = out.filter(t => ids.has(String(t.category_id)));
    }
    if (categoryId) out = out.filter(t => String(t.category_id) === String(categoryId));
    return out.slice();
  }

  async function getStats(from, to, budgetId, opts) {
    const q = _q(opts);
    const [cats, tx] = await Promise.all([_load(_catsL(), q), _load(_txL(from, to), q)]);
    let list = tx;
    if (budgetId) {
      const ids = new Set(cats.filter(c => String(c.budget_id) === String(budgetId)).map(c => String(c.id)));
      list = list.filter(t => ids.has(String(t.category_id)));
    }
    const stats = {};
    list.forEach(t => {
      const catId = String(t.category_id || '') || '__none__';
      if (!stats[catId]) stats[catId] = { category_id: catId, spent: 0, received: 0 };
      const amount = parseFloat(t.amount) || 0;
      if (amount >= 0) stats[catId].spent += amount;
      else             stats[catId].received += Math.abs(amount);
    });
    return Object.values(stats).map(s => {
      const cat = cats.find(c => String(c.id) === s.category_id);
      return {
        ...s,
        category_name:  cat ? String(cat.name)  : 'Onbekend',
        category_color: cat ? String(cat.color) : '#cccccc'
      };
    });
  }

  async function getBudgets(opts) {
    return (await _load(_budgetsL(), _q(opts))).slice();
  }

  // Bedrag van een budget in een maand: de meest recente versie die op of vóór die maand ingaat
  // (een rij zonder effective_from is het oorspronkelijke bedrag).
  function _effectiveRow(rows, budgetId, month) {
    return rows
      .filter(b => String(b.budget_id || b.id) === String(budgetId))
      .sort((a, b) => String(b.effective_from || '').localeCompare(String(a.effective_from || '')))
      .find(b => !b.effective_from || String(b.effective_from) <= month);
  }

  async function getBudgetStats(from, to, opts) {
    const q = _q(opts);
    const month = String(from || '').substring(0, 7);
    const [rows, cats, overrides, tx] = await Promise.all([
      _load(_budgetsL(), q), _load(_catsL(), q), _load(_overL(), q), _load(_txL(from, to), q)
    ]);

    // Unieke budgetten in volgorde van aanmaken
    const ids = [];
    rows.slice().sort(_byCreated).forEach(b => {
      const id = String(b.budget_id || b.id);
      if (!ids.includes(id)) ids.push(id);
    });

    return ids.map(budgetId => {
      const eff = _effectiveRow(rows, budgetId, month);
      const parent = rows.find(b => String(b.id) === budgetId) || rows.find(b => String(b.budget_id || b.id) === budgetId);
      if (!parent) return null;

      const catIds = new Set(cats.filter(c => String(c.budget_id) === budgetId).map(c => String(c.id)));
      let spent = 0, contributions = 0;
      tx.forEach(t => {
        if (!catIds.has(String(t.category_id))) return;
        const amt = parseFloat(t.amount) || 0;
        if (amt >= 0) spent += amt; else contributions += Math.abs(amt);
      });

      const override      = overrides.find(o => String(o.budget_id) === budgetId && String(o.month) === month);
      const defaultAmount = eff ? parseFloat(eff.default_amount) || 0 : 0;
      const budgetAmount  = override ? parseFloat(override.amount) || 0 : defaultAmount;
      const totalAvailable = budgetAmount + contributions;

      return {
        budget_id:       budgetId,
        budget_name:     String((eff && eff.name) || parent.name),
        default_amount:  defaultAmount,
        budget_amount:   budgetAmount,
        has_override:    !!override,
        override_amount: override ? parseFloat(override.amount) || 0 : null,
        contributions,
        total_available: totalAvailable,
        spent,
        remaining:       totalAvailable - spent
      };
    }).filter(Boolean);
  }

  // Alles van één maand ophalen (is met luisteraars al "vers"; blijft bestaan voor compatibiliteit)
  function refreshMonth(from, to) {
    return Promise.all([getTransactions({ from, to }), getStats(from, to), getBudgetStats(from, to)]);
  }

  // Luisteraars opnieuw opbouwen; de server wordt daarbij opnieuw bevraagd
  function clearCache() {
    _teardown();
    _emitChange('*');
  }

  // ─── Schrijven ───────────────────────────────────────────────────────────────
  // Schrijfacties zijn direct zichtbaar (lokale cache). De belofte van Firestore wordt pas afgerond als de
  // server het heeft bevestigd; daar wachten we niet op. Mislukt het, dan volgt een foutmelding.
  function _msg(err) {
    const code = err && err.code;
    if (code === 'permission-denied')  return 'Geen toegang (controleer de beveiligingsregels).';
    if (code === 'unavailable')        return 'Geen verbinding met de server.';
    if (code === 'not-found')          return 'Item niet gevonden.';
    return (err && err.message) || 'Onbekende fout';
  }

  function _track(promise) {
    _writes++; _emitBusy();
    promise
      .catch(err => { console.error(err); showToast('Opslaan mislukt: ' + _msg(err), 'error'); })
      .finally(() => { _writes--; _emitBusy(); });
  }

  function _commit(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const batch = FB.writeBatch(FB.db);
      ops.slice(i, i + 400).forEach(op => op(batch));
      _track(batch.commit());
    }
  }

  const _now = () => new Date().toISOString();
  const _uid = () => (Config.user && Config.user.uid) || '';
  const _numOrNull = v => (v !== null && v !== undefined && v !== '' && !isNaN(parseFloat(v))) ? parseFloat(v) : null;

  // ─── Transacties ─────────────────────────────────────────────────────────────
  function createTransaction({ date, amount, categoryId, description }) {
    _need();
    const ref = _ref('transactions');
    const now = _now();
    _track(FB.setDoc(ref, {
      date: String(date), amount: parseFloat(amount), category_id: String(categoryId || ''),
      description: String(description || ''), created_at: now, updated_at: now, created_by: _uid()
    }));
    return Promise.resolve({ id: ref.id });
  }

  function updateTransaction(id, { date, amount, categoryId, description }) {
    _need();
    _track(FB.updateDoc(_ref('transactions', id), {
      date: String(date), amount: parseFloat(amount), category_id: String(categoryId || ''),
      description: String(description || ''), updated_at: _now()
    }));
    return Promise.resolve({ id });
  }

  function deleteTransaction(id) {
    _need();
    _track(FB.deleteDoc(_ref('transactions', id)));
    return Promise.resolve({ deleted: true });
  }

  // ─── Categorieën ─────────────────────────────────────────────────────────────
  function createCategory({ name, color, budgetId }) {
    _need();
    const ref = _ref('categories');
    _track(FB.setDoc(ref, {
      name: String(name), color: String(color || '#cccccc'), budget_id: String(budgetId || ''), created_at: _now()
    }));
    return Promise.resolve({ id: ref.id });
  }

  function updateCategory(id, { name, color, budgetId }) {
    _need();
    _track(FB.updateDoc(_ref('categories', id), {
      name: String(name), color: String(color || '#cccccc'), budget_id: String(budgetId || '')
    }));
    return Promise.resolve({ id });
  }

  // Wacht op de server (zoekt de transacties van de categorie op); de wijziging zelf gaat daarna op de achtergrond.
  async function deleteCategory(id) {
    _need();
    const snap = await FB.getDocs(FB.query(_col('transactions'), FB.where('category_id', '==', String(id))));
    const now = _now();
    const ops = [b => b.delete(_ref('categories', id))];
    snap.docs.forEach(d => ops.push(b => b.update(d.ref, { category_id: '', updated_at: now })));
    _commit(ops);
    return { deleted: true };
  }

  // ─── Budgetten ───────────────────────────────────────────────────────────────
  function createBudget({ name, defaultAmount }) {
    _need();
    const ref = _ref('budgets');
    _track(FB.setDoc(ref, {
      name: String(name), default_amount: parseFloat(defaultAmount) || 0, created_at: _now(),
      budget_id: '', effective_from: ''
    }));
    return Promise.resolve({ id: ref.id });
  }

  function updateBudget(id, { name, defaultAmount }) {
    _need();
    _track(FB.updateDoc(_ref('budgets', id), { name: String(name), default_amount: parseFloat(defaultAmount) || 0 }));
    return Promise.resolve({ id });
  }

  // Verwijdert het budget én al zijn versies en overschrijvingen; categorieën verliezen hun budget
  async function deleteBudget(id) {
    _need();
    const [rows, cats, overrides] = await Promise.all([_load(_budgetsL()), _load(_catsL()), _load(_overL())]);
    const ops = [b => b.delete(_ref('budgets', id))];
    rows.filter(r => String(r.budget_id || '') === String(id)).forEach(r => ops.push(b => b.delete(_ref('budgets', r.id))));
    overrides.filter(o => String(o.budget_id) === String(id)).forEach(o => ops.push(b => b.delete(_ref('budget_overrides', o.id))));
    cats.filter(c => String(c.budget_id) === String(id)).forEach(c => ops.push(b => b.update(_ref('categories', c.id), { budget_id: '' })));
    _commit(ops);
    return { deleted: true };
  }

  // Een versie is een rij met zowel budget_id (het oorspronkelijke budget) als effective_from
  const _isVersion = r => !!(r && String(r.budget_id || '') !== '' && String(r.effective_from || '') !== '');

  // Nieuwe versie vanaf een maand; latere versies van dit budget vervallen
  async function setBudgetEffectiveFrom(budgetId, newAmount, effectiveFromMonth, name) {
    _need();
    const rows     = await _load(_budgetsL());
    const amount   = parseFloat(newAmount) || 0;
    const month    = String(effectiveFromMonth);
    const existing = rows.find(r => String(r.id) === String(budgetId));
    if (!existing) throw new Error('Budget niet gevonden');
    const parentId = String(existing.budget_id || existing.id);
    const parent   = rows.find(r => String(r.id) === parentId) || existing;

    const sameMonth = rows.find(r => String(r.budget_id || r.id) === parentId && String(r.effective_from || '') === month);
    let keepId, result;
    const ops = [];
    if (sameMonth) {
      keepId = sameMonth.id;
      const patch = { default_amount: amount, effective_from: month };
      if (name) patch.name = String(name);
      ops.push(b => b.update(_ref('budgets', keepId), patch));
      result = { id: keepId, updated: true };
    } else {
      const ref = _ref('budgets');
      keepId = ref.id;
      ops.push(b => b.set(ref, {
        budget_id: parentId, name: String(name || parent.name), default_amount: amount,
        created_at: _now(), effective_from: month
      }));
      result = { id: keepId, created: true };
    }
    rows.filter(r => String(r.budget_id || r.id) === parentId && String(r.effective_from || '') > month && r.id !== keepId)
        .forEach(r => ops.push(b => b.delete(_ref('budgets', r.id))));
    _commit(ops);
    return result;
  }

  async function updateBudgetVersion(id, { amount, effectiveFromMonth }) {
    _need();
    const rows = await _load(_budgetsL());
    const row  = rows.find(r => String(r.id) === String(id));
    if (!row) throw new Error('Budgetversie niet gevonden');
    if (!_isVersion(row)) throw new Error('Dit is geen toekomstige budgetversie');
    const value = parseFloat(amount);
    if (isNaN(value) || value < 0) throw new Error('Ongeldig bedrag');
    const month = String(effectiveFromMonth || row.effective_from);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Ongeldige maand');
    const parentId = String(row.budget_id);
    const clash = rows.some(r => r.id !== row.id && String(r.budget_id || r.id) === parentId && String(r.effective_from || '') === month);
    if (clash) throw new Error('Er bestaat al een versie van dit budget voor die maand');
    _track(FB.updateDoc(_ref('budgets', id), { default_amount: value, effective_from: month }));
    return { id, updated: true };
  }

  async function deleteBudgetVersion(id) {
    _need();
    const rows = await _load(_budgetsL());
    const row  = rows.find(r => String(r.id) === String(id));
    if (!row) throw new Error('Budgetversie niet gevonden');
    if (!_isVersion(row)) throw new Error('Dit is geen budgetversie; verwijder het budget zelf');
    _track(FB.deleteDoc(_ref('budgets', id)));
    return { deleted: true };
  }

  // ─── Maandoverschrijvingen ───────────────────────────────────────────────────
  async function setBudgetOverride(budgetId, month, amount) {
    _need();
    const rows = await _load(_overL());
    const existing = rows.find(o => String(o.budget_id) === String(budgetId) && String(o.month) === String(month));
    const id = existing ? existing.id : `${budgetId}__${month}`;
    _track(FB.setDoc(_ref('budget_overrides', id), {
      budget_id: String(budgetId), month: String(month), amount: parseFloat(amount), created_at: _now()
    }));
    return { id };
  }

  async function deleteBudgetOverride(budgetId, month) {
    _need();
    const rows = await _load(_overL());
    const matches = rows.filter(o => String(o.budget_id) === String(budgetId) && String(o.month) === String(month));
    if (!matches.length) throw new Error('Overschrijving niet gevonden');
    _commit(matches.map(o => b => b.delete(_ref('budget_overrides', o.id))));
    return { deleted: true };
  }

  // ─── Sparen ──────────────────────────────────────────────────────────────────
  function _ruleOut(r) {
    return {
      id: r.id, goal_id: r.goal_id, type: r.type,
      amount:       r.amount === undefined ? null : r.amount,
      percentage:   r.percentage === undefined ? null : r.percentage,
      source:       r.source || null,
      day_of_month: r.day_of_month === undefined ? null : r.day_of_month,
      active:       !!r.active,
      notes:        r.notes || null
    };
  }

  async function getSavingsGoals(opts) {
    const q = _q(opts);
    const [goals, rules] = await Promise.all([_load(_goalsL(), q), _load(_rulesL(), q)]);
    _ensureMonthlyJobs().catch(err => console.error('Maandelijkse stortingen aanmaken mislukt', err));
    return goals.filter(g => g.active !== false).map(g => ({
      id: g.id, name: g.name,
      current_balance: parseFloat(g.current_balance) || 0,
      target_amount:   _numOrNull(g.target_amount),
      target_date:     g.target_date || null,
      notes:           g.notes || null,
      active:          true,
      rules: rules.filter(r => String(r.goal_id) === String(g.id)).map(_ruleOut)
    }));
  }

  async function getSavingsJobs(opts) {
    const jobs = await _load(_jobsL(), _q(opts));
    return jobs.filter(j => j.status === 'pending');
  }

  // Maakt per actieve maandelijkse afspraak één storting voor de huidige maand aan als die er nog niet is.
  // De id is vast (afspraak + maand), zodat twee apparaten nooit twee stortingen aanmaken. Er wordt alleen
  // aangemaakt op basis van gegevens die met de server zijn gesynchroniseerd (niet uit een verouderde cache).
  let _ensuring = false;
  async function _ensureMonthlyJobs() {
    if (_ensuring || _readOnly) return;
    _ensuring = true;
    try {
      const JL = _jobsL(), GL = _goalsL(), RL = _rulesL();
      await Promise.all([_load(JL, true), _load(GL, true), _load(RL, true)]);
      if (!(await _whenSynced(JL)) || !GL.rows) return;
      if (!GL.synced) await _whenSynced(GL);
      if (!RL.synced) await _whenSynced(RL);

      const d  = new Date();
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const ops = [];

      RL.rows.filter(r => r.type === 'monthly' && r.active).forEach(rule => {
        const goal = GL.rows.find(g => String(g.id) === String(rule.goal_id) && g.active !== false);
        if (!goal) return;
        const exists = JL.rows.some(j => String(j.rule_id) === String(rule.id) && String(j.scheduled_date).startsWith(ym));
        if (exists) return;
        const day = Math.min(parseInt(rule.day_of_month) || 25, daysInMonth);
        ops.push(b => b.set(_ref('savings_jobs', `${rule.id}__${ym}`), {
          rule_id: String(rule.id), goal_id: String(goal.id), goal_name: String(goal.name),
          scheduled_date: ym + '-' + String(day).padStart(2, '0'), executed_at: '',
          amount: parseFloat(rule.amount) || 0, status: 'pending', created_at: _now()
        }));
      });
      if (ops.length) _commit(ops);
    } finally {
      _ensuring = false;
    }
  }

  function createSavingsGoal({ name, currentBalance, targetAmount, targetDate, notes }) {
    _need();
    const ref = _ref('savings_goals');
    _track(FB.setDoc(ref, {
      name: String(name), current_balance: parseFloat(currentBalance) || 0, target_amount: _numOrNull(targetAmount),
      target_date: String(targetDate || ''), notes: String(notes || ''), active: true, created_at: _now()
    }));
    return Promise.resolve({ id: ref.id });
  }

  function updateSavingsGoal(id, { name, currentBalance, targetAmount, targetDate, notes, active }) {
    _need();
    _track(FB.updateDoc(_ref('savings_goals', id), {
      name: String(name), current_balance: parseFloat(currentBalance) || 0, target_amount: _numOrNull(targetAmount),
      target_date: String(targetDate || ''), notes: String(notes || ''), active: active !== false
    }));
    return Promise.resolve({ id });
  }

  async function deleteSavingsGoal(id) {
    _need();
    const [rules, jobs] = await Promise.all([_load(_rulesL()), _load(_jobsL())]);
    const ops = [b => b.delete(_ref('savings_goals', id))];
    rules.filter(r => String(r.goal_id) === String(id)).forEach(r => ops.push(b => b.delete(_ref('savings_rules', r.id))));
    jobs.filter(j => String(j.goal_id) === String(id)).forEach(j => ops.push(b => b.delete(_ref('savings_jobs', j.id))));
    _commit(ops);
    return { deleted: true };
  }

  // De UI stuurt soms een afspraak in de vorm van de opgehaalde gegevens (goal_id, day_of_month): beide vormen werken
  function _rulePayload(b) {
    const day = b.dayOfMonth !== undefined ? b.dayOfMonth : b.day_of_month;
    const goal = b.goalId !== undefined ? b.goalId : b.goal_id;
    const p = {
      type: String(b.type), amount: _numOrNull(b.amount), percentage: _numOrNull(b.percentage),
      source: String(b.source || ''), day_of_month: _numOrNull(day) === null ? null : parseInt(day),
      active: b.active !== false, notes: String(b.notes || '')
    };
    return { p, goal };
  }

  function createSavingsRule(body) {
    _need();
    const { p, goal } = _rulePayload(body);
    const ref = _ref('savings_rules');
    _track(FB.setDoc(ref, { goal_id: String(goal), ...p, created_at: _now() }));
    return Promise.resolve({ id: ref.id });
  }

  function updateSavingsRule(id, body) {
    _need();
    const { p } = _rulePayload(body);
    _track(FB.updateDoc(_ref('savings_rules', id), p));
    return Promise.resolve({ id });
  }

  function deleteSavingsRule(id) {
    _need();
    _track(FB.deleteDoc(_ref('savings_rules', id)));
    return Promise.resolve({ deleted: true });
  }

  // Categorie voor spaarafschrijvingen: een categorie met "sparen"/"spaar" in de naam (exacte naam "Sparen" eerst).
  // Is er geen te vinden, dan blijft de categorie leeg ("open") en kan de gebruiker die later zelf kiezen.
  async function _savingsCategoryId() {
    const cats = await _load(_catsL());
    const norm = c => String(c.name || '').trim().toLowerCase();
    const hit = cats.find(c => norm(c) === 'sparen') || cats.find(c => /spaar|sparen/.test(norm(c)));
    return hit ? String(hit.id) : '';
  }

  // Een uitgevoerde storting is een afschrijving: positief bedrag, omschrijving = naam van het spaardoel
  function _savingsTxOp(txId, { date, amount, goalName, categoryId }) {
    const now = _now();
    return b => b.set(_ref('transactions', txId), {
      date: String(date), amount: parseFloat(amount) || 0, category_id: categoryId,
      description: String(goalName || ''), created_at: now, updated_at: now, created_by: _uid()
    });
  }

  async function executeSavingsJob(jobId) {
    _need();
    const jobs = await _load(_jobsL());
    const job = jobs.find(j => String(j.id) === String(jobId));
    if (!job) throw new Error('Job niet gevonden');
    if (job.status !== 'pending') throw new Error('Deze storting is al afgehandeld');
    const goals = await _load(_goalsL());
    const goal = goals.find(g => String(g.id) === String(job.goal_id));
    const amount = parseFloat(job.amount) || 0;
    const ops = [b => b.update(_ref('savings_jobs', jobId), { status: 'done', executed_at: _now() })];
    if (goal) {
      ops.push(b => b.update(_ref('savings_goals', job.goal_id), { current_balance: FB.increment(amount) }));
    }
    if (amount > 0) {
      const categoryId = await _savingsCategoryId();
      ops.push(_savingsTxOp('sav_' + jobId, {
        date: todayISO(), amount, goalName: (goal && goal.name) || job.goal_name, categoryId
      }));
    }
    _commit(ops);
    return { done: true };
  }


  function skipSavingsJob(jobId) {
    _need();
    _track(FB.updateDoc(_ref('savings_jobs', jobId), { status: 'skipped' }));
    return Promise.resolve({ skipped: true });
  }

  async function addManualContribution({ goalId, amount, date, notes }) {
    _need();
    const goals = await _load(_goalsL());
    const goal = goals.find(g => String(g.id) === String(goalId));
    if (!goal) throw new Error('Spaardoel niet gevonden');
    const value = parseFloat(amount) || 0;
    const jobRef = _ref('savings_jobs');
    const categoryId = value > 0 ? await _savingsCategoryId() : '';
    const ops = [
      b => b.update(_ref('savings_goals', goalId), { current_balance: FB.increment(value) }),
      b => b.set(jobRef, {
        rule_id: '', goal_id: String(goalId), goal_name: String(goal.name), scheduled_date: String(date),
        executed_at: _now(), amount: value, status: 'done', notes: String(notes || ''), created_at: _now()
      })
    ];
    if (value > 0) ops.push(_savingsTxOp('sav_' + jobRef.id, { date, amount: value, goalName: goal.name, categoryId }));
    _commit(ops);
    return { done: true };
  }

  // ─── Zonnescherm ─────────────────────────────────────────────────────────────
  // Per huishouden aangezet via households/{id}.features.sunscreen = { enabled, script_url, api_key }.
  // De Tuya-sleutels blijven in de Script Properties van het bestaande Apps Script; dit stuurt alleen het commando.
  async function controlSunscreen(command) {
    const cfg = Config.household && Config.household.features && Config.household.features.sunscreen;
    if (!cfg || cfg.enabled !== true || !cfg.script_url || !cfg.api_key) {
      throw new Error('Het zonnescherm is niet ingeschakeld voor dit huishouden.');
    }
    if (!/^https:\/\/script\.google\.com\//.test(cfg.script_url)) {
      throw new Error('Ongeldige script_url in de zonneschermconfiguratie van dit huishouden.');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      // Bewust zonder Content-Type-header: dan is het een "simple request" en voorkomt de browser een CORS-preflight
      const res = await fetch(cfg.script_url, {
        method: 'POST',
        body: JSON.stringify({ apiKey: cfg.api_key, action: 'controlSunscreen', command }),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`Server fout ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Zonnescherm bedienen mislukt');
      return json.data;
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Geen reactie van de zonneschermserver.' : e.message);
    } finally {
      clearTimeout(timer);
    }
  }
  const _noTuya = () => Promise.reject(new Error('De Tuya-instellingen beheer je in de oude app.'));
  const getTuyaConfig = _noTuya, saveTuyaConfig = _noTuya;

  // Compatibiliteit met de oude cache-interface: er valt niets meer met de hand te beheren
  const cache = {
    keys: () => [], get: () => null, replace() {}, markStale() {}, clear() {}, clearAll() { clearCache(); }
  };

  return {
    setHousehold,
    getCategories, getTransactions, getStats, getBudgets, getBudgetStats, refreshMonth, clearCache,
    createTransaction, updateTransaction, deleteTransaction,
    createCategory, updateCategory, deleteCategory,
    createBudget, updateBudget, deleteBudget, updateBudgetVersion, deleteBudgetVersion,
    setBudgetOverride, deleteBudgetOverride, setBudgetEffectiveFrom,
    getSavingsGoals, getSavingsJobs,
    createSavingsGoal, updateSavingsGoal, deleteSavingsGoal,
    createSavingsRule, updateSavingsRule, deleteSavingsRule,
    executeSavingsJob, skipSavingsJob, addManualContribution,
    controlSunscreen, getTuyaConfig, saveTuyaConfig,
    cache, onChange, onBusy, pendingWrites
  };
})();
