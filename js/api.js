// js/api.js — All API calls to the Google Apps Script Web App

const Api = (() => {

  // ─── Simple in-memory cache with TTL ────────────────────────────────────────
  const _cache = {};
  const _TTL_LONG  = 5 * 60 * 1000; // 5 min — reference data (categories, budgets)
  const _TTL_SHORT = 2 * 60 * 1000; // 2 min — per-month data (transactions, stats)

  function _cacheGet(key) {
    const entry = _cache[key];
    if (!entry) return null;
    if (Date.now() - entry.ts > entry.ttl) { delete _cache[key]; return null; }
    return entry.data;
  }

  function _cacheSet(key, data, ttl) {
    _cache[key] = { data, ts: Date.now(), ttl };
  }

  function _cacheInvalidate() {
    Object.keys(_cache).forEach(k => delete _cache[k]);
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
    const hit = _cacheGet(key);
    if (hit) return hit;
    const data = await get({ action: 'getCategories' });
    _cacheSet(key, data, _TTL_LONG);
    return data;
  }

  async function getTransactions({ from, to, categoryId, budgetId } = {}) {
    const key = `getTransactions:${from}:${to}:${categoryId || ''}:${budgetId || ''}`;
    const hit = _cacheGet(key);
    if (hit) return hit;
    const data = await get({ action: 'getTransactions', from, to, categoryId, budgetId });
    _cacheSet(key, data, _TTL_SHORT);
    return data;
  }

  async function getStats(from, to, budgetId) {
    const key = `getStats:${from}:${to}:${budgetId || ''}`;
    const hit = _cacheGet(key);
    if (hit) return hit;
    const data = await get({ action: 'getStats', from, to, budgetId });
    _cacheSet(key, data, _TTL_SHORT);
    return data;
  }

  async function getBudgets() {
    const key = 'getBudgets';
    const hit = _cacheGet(key);
    if (hit) return hit;
    const data = await get({ action: 'getBudgets' });
    _cacheSet(key, data, _TTL_LONG);
    return data;
  }

  async function getBudgetStats(from, to) {
    const key = `getBudgetStats:${from}:${to}`;
    const hit = _cacheGet(key);
    if (hit) return hit;
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

  return {
    getCategories, getTransactions, getStats, getBudgets, getBudgetStats,
    createTransaction, updateTransaction, deleteTransaction,
    createCategory, updateCategory, deleteCategory,
    createBudget, updateBudget, deleteBudget,
    setBudgetOverride, deleteBudgetOverride
  };
})();
