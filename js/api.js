// js/api.js — All API calls to the Google Apps Script Web App
//
// Cache-strategie (stale-while-revalidate):
//  • Data jonger dan de TTL wordt direct uit de cache gegeven, zonder netwerk.
//  • Oudere data wordt óók direct gegeven, maar op de achtergrond ververst. Is de nieuwe data
//    anders, dan meldt Api.onChange() dit zodat het scherm zichzelf kan bijwerken.
//  • Schrijfacties lopen via een wachtrij (één tegelijk) en kunnen de cache zelf bijwerken
//    (zie js/mutations.js). Een generatieteller voorkomt dat een ophaalactie die vóór een
//    wijziging is gestart, de cache daarna weer met oude data overschrijft.

const Api = (() => {

  // ─── Cache ───────────────────────────────────────────────────────────────────
  const _cache    = {};
  const _inflight = {};                  // key → { p, gen }
  const _STORE    = 'kasboek_cache_';
  const _DIRTY    = 'kasboek_dirty';     // aanwezig zolang er schrijfacties onderweg zijn
  const _TTL_LONG  = 5 * 60 * 1000;      // 5 min  — referentiedata (categorieën, budgetten, spaardoelen)
  const _TTL_SHORT = 30 * 1000;          // 30 sec — data per maand (transacties, statistieken)
  const _MAX_AGE   = 24 * 60 * 60 * 1000; // ouder dan 24 uur wordt nooit meer getoond
  const _TIMEOUT   = 60 * 1000;
  let _gen = 0;        // verhoogt bij elke bewuste wijziging van de cache
  let _writeSeq = 0;   // verhoogt zodra een schrijfactie begint én zodra hij klaar is

  const _changeListeners = new Set();
  const _busyListeners   = new Set();
  let _reads = 0, _writes = 0;

  // ── localStorage helpers ──
  function _lsLoad(key) {
    try {
      const raw = localStorage.getItem(_STORE + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      // Nog niet bevestigde (optimistische) regels horen niet uit een eerdere sessie te komen
      if (Array.isArray(entry.data)) entry.data = entry.data.filter(r => !(r && r._pending));
      _cache[key] = entry;
      return entry;
    } catch { return null; }
  }

  function _lsSave(key, entry) {
    try { localStorage.setItem(_STORE + key, JSON.stringify(entry)); } catch {}
  }

  function _lsKeys() {
    try {
      return Object.keys(localStorage).filter(k => k.startsWith(_STORE)).map(k => k.slice(_STORE.length));
    } catch { return []; }
  }

  function _lsClear() {
    try { _lsKeys().forEach(k => localStorage.removeItem(_STORE + k)); } catch {}
  }

  // Sessie eerder afgebroken tijdens een schrijfactie? Dan weten we niet zeker wat er is opgeslagen.
  try {
    if (localStorage.getItem(_DIRTY)) { _lsClear(); localStorage.removeItem(_DIRTY); }
  } catch {}

  function _markDirty(on) {
    try { on ? localStorage.setItem(_DIRTY, '1') : localStorage.removeItem(_DIRTY); } catch {}
  }

  // ── entries ──
  function _entry(key) {
    const e = _cache[key] || _lsLoad(key);
    if (!e) return null;
    if (Date.now() - e.ts > _MAX_AGE) { _remove(key); return null; }
    return e;
  }

  function _isFresh(e) { return !e.stale && Date.now() - e.ts <= e.ttl; }

  function _cacheSet(key, data, ttl) {
    const entry = { data, ts: Date.now(), ttl, stale: false };
    _cache[key] = entry;
    _lsSave(key, entry);
  }

  function _remove(key) {
    delete _cache[key];
    try { localStorage.removeItem(_STORE + key); } catch {}
  }

  function _allKeys(prefix) {
    const keys = new Set([...Object.keys(_cache), ..._lsKeys()]);
    return [...keys].filter(k => k.startsWith(prefix));
  }

  function _invalidateAll() {
    _gen++;
    Object.keys(_cache).forEach(k => delete _cache[k]);
    _lsClear();
  }

  // Publieke, bewuste cache-manipulatie (gebruikt door Mutations). Elke wijziging verhoogt _gen.
  const cache = {
    keys:  prefix => _allKeys(prefix || '').filter(k => _entry(k)),
    get:   key => { const e = _entry(key); return e ? e.data : null; },
    replace(key, data) {
      const e = _entry(key);
      if (!e) return;
      _gen++;
      e.data = data;
      _lsSave(key, e);
    },
    // Markeer als verouderd: wordt nog getoond, maar meteen op de achtergrond ververst
    markStale(prefix) {
      _gen++;
      _allKeys(prefix).forEach(k => { const e = _entry(k); if (e) { e.stale = true; _lsSave(k, e); } });
    },
    // Verwijder: het volgende scherm haalt de data opnieuw op (met laadstatus)
    clear(prefix) {
      _gen++;
      _allKeys(prefix).forEach(_remove);
    },
    clearAll() { _invalidateAll(); }
  };

  // ─── Events ──────────────────────────────────────────────────────────────────
  function onChange(fn) { _changeListeners.add(fn); return () => _changeListeners.delete(fn); }
  function onBusy(fn)   { _busyListeners.add(fn);   return () => _busyListeners.delete(fn); }
  function _emitChange(key) { _changeListeners.forEach(fn => { try { fn(key); } catch {} }); }
  function _emitBusy()      { _busyListeners.forEach(fn => { try { fn({ reads: _reads, writes: _writes }); } catch {} }); }
  function pendingWrites()  { return _writes; }

  // ─── Netwerk ─────────────────────────────────────────────────────────────────
  // ambiguous = true: we weten niet of de server de actie heeft uitgevoerd (geen antwoord,
  // time-out, geen leesbaar antwoord). false: de server heeft de actie duidelijk geweigerd.
  function _err(msg, ambiguous) { const e = new Error(msg); e.ambiguous = !!ambiguous; return e; }

  function checkConfig() {
    if (!Config.isConfigured) throw _err('Niet geconfigureerd. Ga naar Instellingen.', false);
  }

  function buildUrl(params) {
    const url = new URL(Config.scriptUrl);
    url.searchParams.set('apiKey', Config.apiKey);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    return url.toString();
  }

  async function _fetch(url, options) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), _TIMEOUT);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } catch (e) {
      throw _err(e.name === 'AbortError'
        ? 'De server reageerde niet op tijd.'
        : 'Geen verbinding met de server.', true);
    } finally {
      clearTimeout(timer);
    }
  }

  async function _readJson(res) {
    if (!res.ok) throw _err(`Server fout: ${res.status} ${res.statusText}`, true);
    let json;
    try { json = await res.json(); }
    catch { throw _err('Ongeldige respons van server (geen JSON)', true); }
    if (!json.success) throw _err(json.error || 'API fout', false);
    return json.data;
  }

  async function get(params) {
    checkConfig();
    _reads++; _emitBusy();
    try {
      return await _readJson(await _fetch(buildUrl(params)));
    } finally {
      _reads--; _emitBusy();
    }
  }

  // Schrijfacties gaan één voor één (Apps Script heeft geen vergrendeling; zo kunnen ze elkaar niet in de weg zitten).
  // opts.invalidate: 'all' (standaard) wist de hele cache na succes; 'none' laat de cache zoals hij is
  // (de aanroeper heeft hem zelf al bijgewerkt).
  let _queue = Promise.resolve();

  function post(body, opts = {}) {
    const invalidate = opts.invalidate === undefined ? 'all' : opts.invalidate;
    _writes++; _writeSeq++; _markDirty(true); _emitBusy();

    const run = async () => {
      try {
        checkConfig();
        // Geen Content-Type header: voorkomt een CORS-preflight bij de Apps Script redirect
        const res  = await _fetch(Config.scriptUrl, {
          method: 'POST',
          body: JSON.stringify({ apiKey: Config.apiKey, ...body })
        });
        const data = await _readJson(res);
        if (invalidate === 'all') _invalidateAll();
        return data;
      } finally {
        _writes--; _writeSeq++;
        if (_writes === 0) _markDirty(false);
        _emitBusy();
      }
    };

    const p = _queue.then(run);
    _queue = p.catch(() => {});
    return p;
  }

  // ─── Cache-gestuurd ophalen ──────────────────────────────────────────────────
  // Haalt op, slaat op (alleen als er sinds de start niets is gewijzigd) en meldt of de data is veranderd.
  //
  // Een antwoord wordt NIET bewaard als
  //  • de cache ondertussen is aangepast (_gen), of
  //  • er tijdens het ophalen een schrijfactie is begonnen of afgelopen (_writeSeq), of
  //  • er nu nog een schrijfactie loopt (_writes).
  // Zo'n antwoord kan van vóór die schrijfactie zijn en zou de optimistisch bijgewerkte cache met oude
  // gegevens overschrijven. De aanroeper krijgt de gegevens wel; ze komen alleen niet in de cache.
  function _fetchAndStore(key, ttl, fetcher) {
    const running = _inflight[key];
    if (running && running.gen === _gen && running.seq === _writeSeq) return running.p;

    const gen = _gen, seq = _writeSeq;
    const p = fetcher().then(data => {
      if (gen === _gen && seq === _writeSeq && _writes === 0) {
        const old = _entry(key);
        const changed = !old || JSON.stringify(old.data) !== JSON.stringify(data);
        _cacheSet(key, data, ttl);
        if (old && changed) _emitChange(key);
      }
      return data;
    }).finally(() => {
      if (_inflight[key] && _inflight[key].p === p) delete _inflight[key];
    });
    _inflight[key] = { p, gen, seq };
    return p;
  }

  // opts.force    : cache negeren en direct ophalen
  // opts.prefetch : alleen ophalen als er nog niets in de cache staat (voor voorladen)
  async function _cached(key, ttl, fetcher, { force = false, prefetch = false } = {}) {
    if (!force) {
      const e = _entry(key);
      if (e) {
        if (!_isFresh(e) && !prefetch) _fetchAndStore(key, ttl, fetcher).catch(() => {});
        return e.data;
      }
    }
    return _fetchAndStore(key, ttl, fetcher);
  }

  // ─── GET ────────────────────────────────────────────────────────────────────
  function getCategories(opts) {
    return _cached('getCategories', _TTL_LONG, () => get({ action: 'getCategories' }), opts);
  }

  function getTransactions({ from, to, categoryId, budgetId } = {}, opts) {
    const key = `getTransactions:${from}:${to}:${categoryId || ''}:${budgetId || ''}`;
    return _cached(key, _TTL_SHORT, () => get({ action: 'getTransactions', from, to, categoryId, budgetId }), opts);
  }

  function getStats(from, to, budgetId, opts) {
    const key = `getStats:${from}:${to}:${budgetId || ''}`;
    return _cached(key, _TTL_SHORT, () => get({ action: 'getStats', from, to, budgetId }), opts);
  }

  function getBudgets(opts) {
    return _cached('getBudgets', _TTL_LONG, () => get({ action: 'getBudgets' }), opts);
  }

  function getBudgetStats(from, to, opts) {
    const key = `getBudgetStats:${from}:${to}`;
    return _cached(key, _TTL_SHORT, () => get({ action: 'getBudgetStats', from, to }), opts);
  }

  // Ververs alles van één maand in één keer (drie aanroepen parallel)
  function refreshMonth(from, to) {
    const force = { force: true };
    return Promise.all([
      getTransactions({ from, to }, force),
      getStats(from, to, undefined, force),
      getBudgetStats(from, to, force)
    ]);
  }

  // Wis de lokale cache en laat de schermen opnieuw laden
  function clearCache() {
    _invalidateAll();
    _emitChange('*');
  }

  // ─── Transactions ────────────────────────────────────────────────────────────
  function createTransaction({ date, amount, categoryId, description }, opts) {
    return post({ action: 'createTransaction', date, amount, categoryId, description }, opts);
  }

  function updateTransaction(id, { date, amount, categoryId, description }, opts) {
    return post({ action: 'updateTransaction', id, date, amount, categoryId, description }, opts);
  }

  function deleteTransaction(id, opts) {
    return post({ action: 'deleteTransaction', id }, opts);
  }

  // ─── Categories ──────────────────────────────────────────────────────────────
  function createCategory({ name, color, budgetId }, opts) {
    return post({ action: 'createCategory', name, color, budgetId }, opts);
  }

  function updateCategory(id, { name, color, budgetId }, opts) {
    return post({ action: 'updateCategory', id, name, color, budgetId }, opts);
  }

  function deleteCategory(id, opts) {
    return post({ action: 'deleteCategory', id }, opts);
  }

  // ─── Budgets ─────────────────────────────────────────────────────────────────
  function createBudget({ name, defaultAmount }, opts) {
    return post({ action: 'createBudget', name, defaultAmount }, opts);
  }

  function updateBudget(id, { name, defaultAmount }, opts) {
    return post({ action: 'updateBudget', id, name, defaultAmount }, opts);
  }

  function deleteBudget(id, opts) {
    return post({ action: 'deleteBudget', id }, opts);
  }

  // Eén toekomstige budgetversie aanpassen of verwijderen (andere versies blijven staan)
  function updateBudgetVersion(id, { amount, effectiveFromMonth }, opts) {
    return post({ action: 'updateBudgetVersion', id, newAmount: amount, effectiveFromMonth }, opts);
  }

  function deleteBudgetVersion(id, opts) {
    return post({ action: 'deleteBudgetVersion', id }, opts);
  }

  // ─── Budget overrides ────────────────────────────────────────────────────────
  function setBudgetOverride(budgetId, month, amount, opts) {
    return post({ action: 'setBudgetOverride', budgetId, month, amount }, opts);
  }

  function deleteBudgetOverride(budgetId, month, opts) {
    return post({ action: 'deleteBudgetOverride', budgetId, month }, opts);
  }

  // ─── Budget versioning ───────────────────────────────────────────────────────
  function setBudgetEffectiveFrom(budgetId, newAmount, effectiveFromMonth, name, opts) {
    return post({ action: 'setBudgetEffectiveFrom', budgetId, newAmount, effectiveFromMonth, name }, opts);
  }

  // ─── Savings goals ───────────────────────────────────────────────────────────
  function getSavingsGoals(opts) {
    return _cached('getSavingsGoals', _TTL_LONG, () => get({ action: 'getSavingsGoals' }), opts);
  }

  function getSavingsJobs(opts) {
    return _cached('getSavingsJobs', _TTL_SHORT, () => get({ action: 'getSavingsJobs' }), opts);
  }

  function createSavingsGoal({ name, currentBalance, targetAmount, targetDate, notes }) {
    return post({ action: 'createSavingsGoal', name, currentBalance, targetAmount, targetDate, notes });
  }

  function updateSavingsGoal(id, { name, currentBalance, targetAmount, targetDate, notes, active }) {
    return post({ action: 'updateSavingsGoal', id, name, currentBalance, targetAmount, targetDate, notes, active });
  }

  function deleteSavingsGoal(id) {
    return post({ action: 'deleteSavingsGoal', id });
  }

  function createSavingsRule({ goalId, type, amount, percentage, source, dayOfMonth, notes, active }) {
    return post({ action: 'createSavingsRule', goalId, type, amount, percentage, source, dayOfMonth, notes, active });
  }

  function updateSavingsRule(id, { goalId, type, amount, percentage, source, dayOfMonth, notes, active }) {
    return post({ action: 'updateSavingsRule', id, goalId, type, amount, percentage, source, dayOfMonth, notes, active });
  }

  function deleteSavingsRule(id) {
    return post({ action: 'deleteSavingsRule', id });
  }

  function executeSavingsJob(jobId) {
    return post({ action: 'executeSavingsJob', jobId });
  }

  function skipSavingsJob(jobId) {
    return post({ action: 'skipSavingsJob', jobId });
  }

  function addManualContribution({ goalId, amount, date, notes }) {
    return post({ action: 'addManualContribution', goalId, amount, date, notes });
  }

  // ─── Zonnescherm ──────────────────────────────────────────────────────────────────
  function controlSunscreen(command) {
    return post({ action: 'controlSunscreen', command }, { invalidate: 'none' });
  }

  function getTuyaConfig() {
    return get({ action: 'getTuyaConfig' });
  }

  function saveTuyaConfig({ tuyaAccessId, tuyaSecret, tuyaDeviceId }) {
    return post({ action: 'saveTuyaConfig', tuyaAccessId, tuyaSecret, tuyaDeviceId }, { invalidate: 'none' });
  }

  return {
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
