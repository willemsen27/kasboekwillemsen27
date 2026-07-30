// js/api.js — All API calls to the Google Apps Script Web App

const Api = (() => {

  // ─── Cache: in-memory + localStorage, stale-while-revalidate ─────────────────
  // TTL recommendation: reference data (categories/budgets) rarely changes → 30 min.
  // Transaction data can change after you add/edit an entry, but the cache is
  // invalidated immediately on every write, so 10 min is a safe background-refresh
  // interval when no mutations occur.
  const _cache = {};
  const _STORE     = 'kasboek_cache_';
  const _TTL_LONG  = 30 * 60 * 1000; // 30 min — reference data (categories, budgets)
  const _TTL_SHORT = 10 * 60 * 1000; // 10 min — per-month data (transactions, stats)

  // ── localStorage helpers ──
  function _lsLoad(key) {
    try {
      const raw = localStorage.getItem(_STORE + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      _cache[key] = entry; // promote to in-memory
      return entry;
    } catch { return null; }
  }

  function _lsSave(key, entry) {
    try { localStorage.setItem(_STORE + key, JSON.stringify(entry)); } catch {}
  }

  function _lsClear() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(_STORE))
        .forEach(k => localStorage.removeItem(k));
    } catch {}
  }

  // Returns data only if still within TTL
  function _cacheGet(key) {
    const entry = _cache[key] || _lsLoad(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > entry.ttl) {
      delete _cache[key];
      try { localStorage.removeItem(_STORE + key); } catch {}
      return null;
    }
    return entry.data;
  }

  // Returns data even when stale (for stale-while-revalidate)
  function _cacheGetStale(key) {
    const entry = _cache[key] || _lsLoad(key);
    return entry ? entry.data : null;
  }

  function _isFresh(key) {
    const entry = _cache[key] || _lsLoad(key);
    return !!(entry && Date.now() - entry.ts <= entry.ttl);
  }

  function _cacheSet(key, data, ttl) {
    const entry = { data, ts: Date.now(), ttl };
    _cache[key] = entry;
    _lsSave(key, entry);
  }

  function _cacheInvalidate() {
    Object.keys(_cache).forEach(k => delete _cache[k]);
    _lsClear();
  }

  // Fire-and-forget background refresh — stale data is returned immediately,
  // cache is silently updated so the next navigation gets fresh data.
  function _bgRefresh(key, fetcher, ttl) {
    fetcher().then(data => _cacheSet(key, data, ttl)).catch(() => {});
  }

  // ─── Core fetch helpers ─────────────────────────────────────────────────────
  function checkConfig() {
    if (!Config.isConfigured) throw new Error('Niet geconfigureerd. Ga naar Instellingen.');
  }

  function buildUrl(params) {
    const url = new URL(Config.scriptUrl);
    url.searchParams.set('apiKey', Config.apiKey);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    });
    return url.toString();
  }

  async function get(params) {
    checkConfig();
    const res  = await fetch(buildUrl(params));
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API fout');
    return json.data;
  }

  async function post(body) {
    checkConfig();
    // NO Content-Type header — avoids CORS preflight on Apps Script redirect
    const res  = await fetch(Config.scriptUrl, {
      method: 'POST',
      body: JSON.stringify({ apiKey: Config.apiKey, ...body })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API fout');
    _cacheInvalidate(); // Invalidate all cache after any write operation
    return json.data;
  }

  // ─── GET ────────────────────────────────────────────────────────────────────
  async function getCategories() {
    const key = 'getCategories';
    if (_isFresh(key)) return _cacheGet(key);
    const stale = _cacheGetStale(key);
    if (stale) { _bgRefresh(key, () => get({ action: 'getCategories' }), _TTL_LONG); return stale; }
    const data = await get({ action: 'getCategories' });
    _cacheSet(key, data, _TTL_LONG);
    return data;
  }

  async function getTransactions({ from, to, categoryId, budgetId } = {}) {
    const key = `getTransactions:${from}:${to}:${categoryId || ''}:${budgetId || ''}`;
    if (_isFresh(key)) return _cacheGet(key);
    const stale = _cacheGetStale(key);
    if (stale) { _bgRefresh(key, () => get({ action: 'getTransactions', from, to, categoryId, budgetId }), _TTL_SHORT); return stale; }
    const data = await get({ action: 'getTransactions', from, to, categoryId, budgetId });
    _cacheSet(key, data, _TTL_SHORT);
    return data;
  }

  async function getStats(from, to, budgetId) {
    const key = `getStats:${from}:${to}:${budgetId || ''}`;
    if (_isFresh(key)) return _cacheGet(key);
    const stale = _cacheGetStale(key);
    if (stale) { _bgRefresh(key, () => get({ action: 'getStats', from, to, budgetId }), _TTL_SHORT); return stale; }
    const data = await get({ action: 'getStats', from, to, budgetId });
    _cacheSet(key, data, _TTL_SHORT);
    return data;
  }

  async function getBudgets() {
    const key = 'getBudgets';
    if (_isFresh(key)) return _cacheGet(key);
    const stale = _cacheGetStale(key);
    if (stale) { _bgRefresh(key, () => get({ action: 'getBudgets' }), _TTL_LONG); return stale; }
    const data = await get({ action: 'getBudgets' });
    _cacheSet(key, data, _TTL_LONG);
    return data;
  }

  async function getBudgetStats(from, to) {
    const key = `getBudgetStats:${from}:${to}`;
    if (_isFresh(key)) return _cacheGet(key);
    const stale = _cacheGetStale(key);
    if (stale) { _bgRefresh(key, () => get({ action: 'getBudgetStats', from, to }), _TTL_SHORT); return stale; }
    const data = await get({ action: 'getBudgetStats', from, to });
    _cacheSet(key, data, _TTL_SHORT);
    return data;
  }

  // ─── Transactions ────────────────────────────────────────────────────────────
  async function createTransaction({ date, amount, categoryId, description }) {
    return post({ action: 'createTransaction', date, amount, categoryId, description });
  }

  async function updateTransaction(id, { date, amount, categoryId, description }) {
    return post({ action: 'updateTransaction', id, date, amount, categoryId, description });
  }

  async function deleteTransaction(id) {
    return post({ action: 'deleteTransaction', id });
  }

  // ─── Categories ──────────────────────────────────────────────────────────────
  async function createCategory({ name, color, budgetId }) {
    return post({ action: 'createCategory', name, color, budgetId });
  }

  async function updateCategory(id, { name, color, budgetId }) {
    return post({ action: 'updateCategory', id, name, color, budgetId });
  }

  async function deleteCategory(id) {
    return post({ action: 'deleteCategory', id });
  }

  // ─── Budgets ─────────────────────────────────────────────────────────────────
  async function createBudget({ name, defaultAmount }) {
    return post({ action: 'createBudget', name, defaultAmount });
  }

  async function updateBudget(id, { name, defaultAmount }) {
    return post({ action: 'updateBudget', id, name, defaultAmount });
  }

  async function deleteBudget(id) {
    return post({ action: 'deleteBudget', id });
  }

  // ─── Budget overrides ────────────────────────────────────────────────────────
  async function setBudgetOverride(budgetId, month, amount) {
    return post({ action: 'setBudgetOverride', budgetId, month, amount });
  }

  async function deleteBudgetOverride(budgetId, month) {
    return post({ action: 'deleteBudgetOverride', budgetId, month });
  }

  // ─── Zonnescherm ──────────────────────────────────────────────────────────────────
  async function controlSunscreen(command) {
    return post({ action: 'controlSunscreen', command });
  }

  async function getTuyaConfig() {
    return get({ action: 'getTuyaConfig' });
  }

  async function saveTuyaConfig({ tuyaAccessId, tuyaSecret, tuyaDeviceId }) {
    return post({ action: 'saveTuyaConfig', tuyaAccessId, tuyaSecret, tuyaDeviceId });
  }

  return {
    getCategories, getTransactions, getStats, getBudgets, getBudgetStats,
    createTransaction, updateTransaction, deleteTransaction,
    createCategory, updateCategory, deleteCategory,
    createBudget, updateBudget, deleteBudget,
    setBudgetOverride, deleteBudgetOverride,
    controlSunscreen, getTuyaConfig, saveTuyaConfig
  };
})();
