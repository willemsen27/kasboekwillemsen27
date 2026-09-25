// js/mutations.js — Wijzigingen doorvoeren: eerst lokaal in de cache (direct zichtbaar), dan naar de server.
//
// Toevoegen en wijzigen van transacties, categorieën en budgetten (ook budgetbedragen per maand of vanaf een
// maand) zijn optimistisch: de cache (lijsten, totalen per categorie en budgetbalken) wordt meteen bijgewerkt en
// het scherm ververst direct. De server-aanroep loopt op de achtergrond. Slaagt die niet, dan wordt de wijziging
// teruggedraaid. Na afloop haalt de app de echte cijfers op de achtergrond op; wijkt er iets af, dan corrigeert
// het scherm zichzelf. Nieuwe items dragen tot de bevestiging een tijdelijk id en de vlag _pending.
//
// Verwijderen van categorieën en budgetten wacht op de server (het raakt transacties en budgetten): de
// aanroeper toont een spinner en de cache wordt daarna gericht bijgewerkt of gewist.

const Mutations = (() => {
  const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const round2  = n => Math.round(n * 100) / 100;
  let _seq = 0;

  // ─── Sleutels en bereiken ────────────────────────────────────────────────────
  function _parseKey(key) {
    const [name, from, to, a, b] = key.split(':');
    return { name, from, to, a, b };
  }

  function _covers(k, date) {
    return RE_DATE.test(k.from) && RE_DATE.test(k.to) && k.from <= date && date <= k.to;
  }

  function _monthOf(date) {
    const y = parseInt(String(date).slice(0, 4), 10);
    const m = parseInt(String(date).slice(5, 7), 10);
    return getMonthRange(y, m);
  }

  function _budgetOfCategory(categoryId) {
    const cats = Api.cache.get('getCategories');
    if (!cats) return undefined;                       // onbekend
    const cat = cats.find(c => String(c.id) === String(categoryId));
    return cat && cat.budget_id ? String(cat.budget_id) : null; // null = geen budget
  }

  // ─── Lokale wijziging van de cache voor één transactie ───────────────────────
  // op: 'add' | 'remove'
  function _patchTx(tx, op) {
    const date   = String(tx.date);
    const amount = parseFloat(tx.amount) || 0;
    const sign   = op === 'add' ? 1 : -1;
    const catId  = String(tx.category_id || '');

    // 1. Transactielijsten
    Api.cache.keys('getTransactions:').forEach(key => {
      const k = _parseKey(key);
      if (!_covers(k, date)) return;
      if (k.a || k.b) { Api.cache.markStale(key); return; } // gefilterde lijst: liever opnieuw ophalen
      let list = (Api.cache.get(key) || []).slice();
      if (op === 'add') {
        const idx = list.findIndex(r => String(r.date) < date);
        if (idx < 0) list.push(tx); else list.splice(idx, 0, tx);
      } else {
        list = list.filter(r => r.id !== tx.id);
      }
      Api.cache.replace(key, list);
    });

    // 2. Totalen per categorie (Dashboard)
    Api.cache.keys('getStats:').forEach(key => {
      const k = _parseKey(key);
      if (!_covers(k, date)) return;
      if (k.a) { Api.cache.markStale(key); return; }
      const arr = (Api.cache.get(key) || []).map(s => ({ ...s }));
      const statKey = catId || '__none__';
      let item = arr.find(s => String(s.category_id) === statKey);
      if (!item) {
        if (op === 'remove') return;
        const cats = Api.cache.get('getCategories') || [];
        const cat  = cats.find(c => String(c.id) === catId);
        item = {
          category_id: statKey, spent: 0, received: 0,
          category_name:  cat ? String(cat.name)  : 'Onbekend',
          category_color: cat ? String(cat.color) : '#cccccc'
        };
        arr.push(item);
      }
      if (amount >= 0) item.spent    = round2(item.spent    + sign * amount);
      else             item.received = round2(item.received + sign * Math.abs(amount));
      const result = arr.filter(s => s.spent > 0.004 || s.received > 0.004);
      Api.cache.replace(key, result);
    });

    // 3. Budgetbalken
    const budgetId = _budgetOfCategory(catId);
    Api.cache.keys('getBudgetStats:').forEach(key => {
      const k = _parseKey(key);
      if (!_covers(k, date)) return;
      if (budgetId === undefined) { Api.cache.markStale(key); return; } // categorieën onbekend
      if (budgetId === null) return;                                     // telt in geen budget
      const arr = (Api.cache.get(key) || []).map(b => ({ ...b }));
      const b = arr.find(x => String(x.budget_id) === budgetId);
      if (!b) { Api.cache.markStale(key); return; }
      if (amount >= 0) b.spent         = round2(b.spent         + sign * amount);
      else             b.contributions = round2(b.contributions + sign * Math.abs(amount));
      b.total_available = round2(b.budget_amount + b.contributions);
      b.remaining       = round2(b.total_available - b.spent);
      Api.cache.replace(key, arr);
    });
  }

  // Bewerk een regel in alle gecachete transactielijsten (id wisselen, "bezig"-vlag weghalen)
  function _mapTx(id, fn) {
    Api.cache.keys('getTransactions:').forEach(key => {
      const list = Api.cache.get(key) || [];
      if (!list.some(r => r.id === id)) return;
      Api.cache.replace(key, list.map(r => (r.id === id ? fn(r) : r)));
    });
  }

  function _confirmTx(id, realId) {
    _mapTx(id, r => {
      const copy = { ...r, id: realId || r.id };
      delete copy._pending;
      return copy;
    });
  }

  // ─── Achtergrondcontrole ─────────────────────────────────────────────────────
  const _todo = new Map();
  let _timer  = null;

  function _reconcile(dates, delay = 1500) {
    dates.forEach(d => { const r = _monthOf(d); _todo.set(r.from, r); });
    clearTimeout(_timer);
    _timer = setTimeout(async function run() {
      if (Api.pendingWrites() > 0) { _timer = setTimeout(run, 1000); return; } // eerst alles wegschrijven
      const ranges = [..._todo.values()];
      _todo.clear();
      for (const r of ranges) { try { await Api.refreshMonth(r.from, r.to); } catch {} }
    }, delay);
  }

  function _refreshView() { if (typeof Router !== 'undefined') Router.refresh(); }

  function _tmpId() { return 'tmp_' + Date.now().toString(36) + '_' + (_seq++); }

  // ─── Transacties ─────────────────────────────────────────────────────────────
  async function addTransaction({ date, amount, categoryId, description }) {
    const now = new Date().toISOString();
    const tmp = {
      id: _tmpId(), date, amount, category_id: categoryId || '', description: description || '',
      created_at: now, updated_at: now, _pending: true
    };
    const range = _monthOf(date);
    const known = new Set((Api.cache.get(`getTransactions:${range.from}:${range.to}::`) || []).map(r => r.id));

    _patchTx(tmp, 'add');
    _refreshView();

    try {
      const res = await Api.createTransaction({ date, amount, categoryId, description }, { invalidate: 'none' });
      _confirmTx(tmp.id, res && res.id);
      showToast('Transactie opgeslagen', 'success');
      _reconcile([date]);
    } catch (err) {
      if (err.ambiguous) {
        // Geen (leesbaar) antwoord: kijk in de sheet of de transactie er toch in staat
        let found = false;
        try {
          const [list] = await Api.refreshMonth(range.from, range.to);
          found = list.some(r =>
            !known.has(r.id) && String(r.date) === String(date) &&
            Math.abs((parseFloat(r.amount) || 0) - amount) < 0.005 &&
            String(r.category_id || '') === String(categoryId || '') &&
            String(r.description || '') === String(description || ''));
        } catch {}
        if (found) {
          showToast('Transactie opgeslagen', 'success');
        } else {
          showToast('Kon niet bevestigen dat de transactie is opgeslagen. Controleer de lijst voordat je hem opnieuw invoert.', 'error');
          _reconcile([date], 8000); // komt hij alsnog binnen, dan verschijnt hij vanzelf
        }
      } else {
        _patchTx(tmp, 'remove');
        showToast('Opslaan mislukt: ' + err.message, 'error');
      }
    }
    _refreshView();
  }

  async function updateTransaction(oldTx, { date, amount, categoryId, description }) {
    const next = {
      ...oldTx, date, amount, category_id: categoryId || '', description: description || '',
      updated_at: new Date().toISOString(), _pending: true
    };
    _patchTx(oldTx, 'remove');
    _patchTx(next, 'add');
    _refreshView();

    try {
      await Api.updateTransaction(oldTx.id, { date, amount, categoryId, description }, { invalidate: 'none' });
      _confirmTx(oldTx.id);
      showToast('Transactie opgeslagen', 'success');
      _reconcile([oldTx.date, date]);
    } catch (err) {
      if (err.ambiguous) {
        showToast('Kon niet bevestigen dat de wijziging is opgeslagen. De actuele gegevens worden opnieuw geladen.', 'error');
        _reconcile([oldTx.date, date], 300);
      } else {
        _patchTx(next, 'remove');
        _patchTx(oldTx, 'add');
        showToast('Opslaan mislukt: ' + err.message, 'error');
      }
    }
    _refreshView();
  }

  async function deleteTransaction(tx) {
    _patchTx(tx, 'remove');
    _refreshView();

    try {
      await Api.deleteTransaction(tx.id, { invalidate: 'none' });
      showToast('Transactie verwijderd', 'success');
      _reconcile([tx.date]);
    } catch (err) {
      if (err.ambiguous) {
        showToast('Kon niet bevestigen dat de transactie is verwijderd. De actuele gegevens worden opnieuw geladen.', 'error');
        _reconcile([tx.date], 300);
      } else {
        _patchTx(tx, 'add');
        showToast('Verwijderen mislukt: ' + err.message, 'error');
      }
    }
    _refreshView();
  }

  // ─── Budget: alleen één maand ("maandoverschrijving") ────────────────────────
  function _patchOverride(budgetId, month, values) {
    Api.cache.keys('getBudgetStats:').forEach(key => {
      const k = _parseKey(key);
      if (!RE_DATE.test(k.from) || k.from.slice(0, 7) !== month) return;
      const arr = (Api.cache.get(key) || []).map(b => ({ ...b }));
      const b = arr.find(x => String(x.budget_id) === String(budgetId));
      if (!b) return;
      Object.assign(b, values);
      b.total_available = round2(b.budget_amount + b.contributions);
      b.remaining       = round2(b.total_available - b.spent);
      Api.cache.replace(key, arr);
    });
  }

  async function setBudgetOverride(stat, month, amount) {
    const before = {
      budget_amount: stat.budget_amount, has_override: stat.has_override, override_amount: stat.override_amount
    };
    _patchOverride(stat.budget_id, month, { budget_amount: amount, has_override: true, override_amount: amount });
    _refreshView();

    try {
      await Api.setBudgetOverride(stat.budget_id, month, amount, { invalidate: 'none' });
      showToast('Budget voor deze maand ingesteld', 'success');
      _reconcile([month + '-01']);
    } catch (err) {
      if (err.ambiguous) {
        showToast('Kon niet bevestigen dat het budget is opgeslagen. De actuele gegevens worden opnieuw geladen.', 'error');
        _reconcile([month + '-01'], 300);
      } else {
        _patchOverride(stat.budget_id, month, before);
        showToast('Opslaan mislukt: ' + err.message, 'error');
      }
    }
    _refreshView();
  }

  // ─── Gedeelde hulpjes voor categorieën en budgetten ──────────────────────────
  const _byName = (a, b) => String(a.name).localeCompare(String(b.name), 'nl');

  function _clean(o) { const c = { ...o }; delete c._pending; return c; }

  function _patchList(key, fn) {
    const list = Api.cache.get(key);
    if (list) Api.cache.replace(key, fn(list.slice()));
  }

  function _mapList(key, id, fn) {
    _patchList(key, l => l.map(x => (x.id === id ? fn(x) : x)));
  }

  function _recalc(b) {
    b.total_available = round2(b.budget_amount + b.contributions);
    b.remaining       = round2(b.total_available - b.spent);
  }

  // Pas de gecachete budgetbalken aan. fn(arr, sleutel) geeft de nieuwe lijst terug (of niets om over te slaan).
  function _mapBudgetStats(fn) {
    Api.cache.keys('getBudgetStats:').forEach(key => {
      const k = _parseKey(key);
      if (!RE_DATE.test(k.from)) return;
      const arr = (Api.cache.get(key) || []).map(b => ({ ...b }));
      const out = fn(arr, k);
      if (out) Api.cache.replace(key, out);
    });
  }

  // Controleer alle maanden waarvan budgetgegevens in de cache staan op de achtergrond opnieuw
  function _reconcileCachedMonths(delay) {
    const dates = Api.cache.keys('getBudgetStats:').map(_parseKey).filter(k => RE_DATE.test(k.from)).map(k => k.from);
    if (dates.length) _reconcile(dates, delay);
  }

  // Bij onduidelijke fouten: de lijst zoals de server hem heeft in de cache zetten
  async function _adoptServerList(key, fetcher) {
    try { Api.cache.replace(key, await fetcher({ force: true })); return true; } catch { return false; }
  }

  // ─── Budget: nieuwe versie (permanent / vanaf een maand) ─────────────────────
  // De nieuwe versie geldt voor alle maanden vanaf de gekozen maand (latere versies worden door de server
  // verwijderd). Een maandoverschrijving blijft winnen van de versie.
  async function setBudgetVersion(stat, amount, month, name, kind) {
    const snaps = [];
    _mapBudgetStats((arr, k) => {
      if (k.from.slice(0, 7) < month) return null;
      const b = arr.find(x => String(x.budget_id) === String(stat.budget_id));
      if (!b) return null;
      snaps.push({ from: k.from, default_amount: b.default_amount, budget_amount: b.budget_amount });
      b.default_amount = amount;
      if (!b.has_override) b.budget_amount = amount;
      _recalc(b);
      return arr;
    });
    _refreshView();

    try {
      await Api.setBudgetEffectiveFrom(stat.budget_id, amount, month, name, { invalidate: 'none' });
      showToast(kind === 'permanent' ? 'Budget permanent aangepast' : 'Budget voor toekomstige maand ingesteld', 'success');
      Api.getBudgets({ force: true }).catch(() => {}); // er is een versie bijgekomen; lijst in Instellingen bijwerken
      _reconcileCachedMonths();
    } catch (err) {
      if (err.ambiguous) {
        showToast('Kon niet bevestigen dat het budget is opgeslagen. De actuele gegevens worden opnieuw geladen.', 'error');
        Api.getBudgets({ force: true }).catch(() => {});
        _reconcileCachedMonths(300);
      } else {
        _mapBudgetStats((arr, k) => {
          const snap = snaps.find(s => s.from === k.from);
          const b = snap && arr.find(x => String(x.budget_id) === String(stat.budget_id));
          if (!b) return null;
          b.default_amount = snap.default_amount; b.budget_amount = snap.budget_amount; _recalc(b);
          return arr;
        });
        showToast('Opslaan mislukt: ' + err.message, 'error');
      }
    }
    _refreshView();
  }

  // ─── Toekomstige budgetversies aanpassen of verwijderen ──────────────────────
  // Het budgetbedrag van een maand volgens de regels van de server: de meest recente versie die op of vóór
  // die maand ingaat (een rij zonder effective_from is het oorspronkelijke bedrag).
  function _effectiveAmount(rows, parentId, month) {
    const mine = rows
      .filter(r => String(r.budget_id || r.id) === String(parentId))
      .sort((a, b) => String(b.effective_from || '').localeCompare(String(a.effective_from || '')));
    const e = mine.find(r => !r.effective_from || String(r.effective_from) <= month);
    return e ? parseFloat(e.default_amount) || 0 : 0;
  }

  // Bereken de bedragen in alle gecachete maanden opnieuw uit de lijst met budgetversies
  function _recomputeBudgetAmounts(parentId) {
    const rows = Api.cache.get('getBudgets');
    if (!rows) { Api.cache.markStale('getBudgetStats:'); return; }
    _mapBudgetStats((arr, k) => {
      const b = arr.find(x => String(x.budget_id) === String(parentId));
      if (!b) return null;
      const eff = _effectiveAmount(rows, parentId, k.from.slice(0, 7));
      b.default_amount = eff;
      if (!b.has_override) b.budget_amount = eff;
      _recalc(b);
      return arr;
    });
  }

  const _byBudget = (a, b) =>
    String(a.name).localeCompare(String(b.name), 'nl') ||
    String(a.effective_from || '').localeCompare(String(b.effective_from || ''));

  async function updateBudgetVersion(row, { amount, month }) {
    const parent = row.budget_id;
    _mapList('getBudgets', row.id, () => ({ ...row, default_amount: amount, effective_from: month, _pending: true }));
    _recomputeBudgetAmounts(parent);
    _refreshView();

    try {
      await Api.updateBudgetVersion(row.id, { amount, effectiveFromMonth: month }, { invalidate: 'none' });
      _mapList('getBudgets', row.id, _clean);
      showToast('Toekomstig budget opgeslagen', 'success');
      _reconcileCachedMonths();
    } catch (err) {
      if (err.ambiguous) {
        showToast('Kon niet bevestigen dat het budget is opgeslagen. De actuele gegevens worden opnieuw geladen.', 'error');
        await _adoptServerList('getBudgets', Api.getBudgets);
        _recomputeBudgetAmounts(parent);
        _reconcileCachedMonths(300);
      } else {
        _mapList('getBudgets', row.id, () => ({ ...row }));
        _recomputeBudgetAmounts(parent);
        showToast('Opslaan mislukt: ' + err.message, 'error');
      }
    }
    _refreshView();
  }

  async function deleteBudgetVersion(row) {
    const parent = row.budget_id;
    _patchList('getBudgets', l => l.filter(b => b.id !== row.id));
    _recomputeBudgetAmounts(parent);
    _refreshView();

    try {
      await Api.deleteBudgetVersion(row.id, { invalidate: 'none' });
      showToast('Toekomstig budget verwijderd', 'success');
      _reconcileCachedMonths();
    } catch (err) {
      if (err.ambiguous) {
        showToast('Kon niet bevestigen dat het budget is verwijderd. De actuele gegevens worden opnieuw geladen.', 'error');
        await _adoptServerList('getBudgets', Api.getBudgets);
        _recomputeBudgetAmounts(parent);
        _reconcileCachedMonths(300);
      } else {
        _patchList('getBudgets', l => [...l, { ...row }].sort(_byBudget));
        _recomputeBudgetAmounts(parent);
        showToast('Verwijderen mislukt: ' + err.message, 'error');
      }
    }
    _refreshView();
  }

  // ─── Categorieën ─────────────────────────────────────────────────────────────
  function _patchStatsMeta(catId, name, color) {
    Api.cache.keys('getStats:').forEach(key => {
      const arr = (Api.cache.get(key) || []).map(s => ({ ...s }));
      const s = arr.find(x => String(x.category_id) === String(catId));
      if (!s) return;
      s.category_name = name; s.category_color = color;
      Api.cache.replace(key, arr);
    });
  }

  // Verplaats de uitgaven/ontvangsten van een categorie naar een ander budget in de gecachete budgetbalken
  function _moveCategoryBudget(catId, fromBudget, toBudget) {
    if (String(fromBudget || '') === String(toBudget || '')) return;
    Api.cache.keys('getBudgetStats:').forEach(key => {
      const k = _parseKey(key);
      if (!RE_DATE.test(k.from)) return;
      const txs = Api.cache.get(`getTransactions:${k.from}:${k.to}::`);
      if (!txs) { Api.cache.markStale(key); return; }   // niet uit te rekenen: opnieuw ophalen
      let spent = 0, contrib = 0;
      txs.filter(t => String(t.category_id) === String(catId)).forEach(t => {
        const a = parseFloat(t.amount) || 0;
        if (a >= 0) spent += a; else contrib += Math.abs(a);
      });
      const arr = (Api.cache.get(key) || []).map(b => ({ ...b }));
      const apply = (budgetId, sign) => {
        if (!budgetId) return true;
        const b = arr.find(x => String(x.budget_id) === String(budgetId));
        if (!b) return false;
        b.spent = round2(b.spent + sign * spent);
        b.contributions = round2(b.contributions + sign * contrib);
        // Een negatief bedrag kan niet: de transactielijst en de budgetbalk zijn dan op verschillende
        // momenten opgehaald. Niet zelf rekenen, maar opnieuw ophalen.
        if (b.spent < -0.004 || b.contributions < -0.004) return false;
        _recalc(b);
        return true;
      };
      if (!apply(fromBudget, -1) || !apply(toBudget, 1)) { Api.cache.markStale(key); return; }
      Api.cache.replace(key, arr);
    });
  }

  async function createCategory({ name, color, budgetId }) {
    const tmp = { id: _tmpId(), name, color, budget_id: budgetId, created_at: new Date().toISOString(), _pending: true };
    _patchList('getCategories', l => [...l, tmp].sort(_byName));
    _refreshView();

    try {
      const res = await Api.createCategory({ name, color, budgetId }, { invalidate: 'none' });
      _mapList('getCategories', tmp.id, c => ({ ..._clean(c), id: res.id }));
      showToast('Categorie toegevoegd', 'success');
    } catch (err) {
      if (err.ambiguous) {
        // Geen (leesbaar) antwoord: kijk in de sheet of de categorie er toch in staat
        let found = false;
        try {
          const list = await Api.getCategories({ force: true });
          Api.cache.replace('getCategories', list);
          found = list.some(c => c.name === name && String(c.budget_id) === String(budgetId));
        } catch { _patchList('getCategories', l => l.filter(c => c.id !== tmp.id)); }
        showToast(found ? 'Categorie toegevoegd'
                        : 'Kon niet bevestigen dat de categorie is opgeslagen. Controleer de lijst voordat je hem opnieuw toevoegt.',
                  found ? 'success' : 'error');
      } else {
        _patchList('getCategories', l => l.filter(c => c.id !== tmp.id));
        showToast('Opslaan mislukt: ' + err.message, 'error');
      }
    }
    _refreshView();
  }

  async function updateCategory(oldCat, { name, color, budgetId }) {
    const oldBudget = oldCat.budget_id || '';
    _mapList('getCategories', oldCat.id, c => ({ ...c, name, color, budget_id: budgetId, _pending: true }));
    _patchList('getCategories', l => l.sort(_byName));
    _patchStatsMeta(oldCat.id, name, color);
    _moveCategoryBudget(oldCat.id, oldBudget, budgetId);
    _refreshView();

    try {
      await Api.updateCategory(oldCat.id, { name, color, budgetId }, { invalidate: 'none' });
      _mapList('getCategories', oldCat.id, _clean);
      showToast('Categorie opgeslagen', 'success');
      _reconcileCachedMonths();
    } catch (err) {
      if (err.ambiguous) {
        showToast('Kon niet bevestigen dat de categorie is opgeslagen. De actuele gegevens worden opnieuw geladen.', 'error');
        await _adoptServerList('getCategories', Api.getCategories);
        _reconcileCachedMonths(300);
      } else {
        _mapList('getCategories', oldCat.id, () => ({ ...oldCat }));
        _patchList('getCategories', l => l.sort(_byName));
        _patchStatsMeta(oldCat.id, oldCat.name, oldCat.color);
        _moveCategoryBudget(oldCat.id, budgetId, oldBudget);
        showToast('Opslaan mislukt: ' + err.message, 'error');
      }
    }
    _refreshView();
  }

  // Verwijderen blijft wachten op de server (het raakt transacties en budgetten)
  async function deleteCategory(id) {
    const res = await Api.deleteCategory(id, { invalidate: 'none' });
    _patchList('getCategories', list => list.filter(c => c.id !== id));
    Api.cache.clear('getTransactions:');
    Api.cache.clear('getStats:');
    Api.cache.clear('getBudgetStats:');
    return res;
  }

  // ─── Budgetten ───────────────────────────────────────────────────────────────
  async function createBudget({ name, defaultAmount }) {
    const tmp = {
      id: _tmpId(), name, default_amount: defaultAmount, created_at: new Date().toISOString(),
      budget_id: '', effective_from: '', _pending: true
    };
    _patchList('getBudgets', l => [...l, tmp].sort(_byName));
    _mapBudgetStats(arr => {
      arr.push({
        budget_id: tmp.id, budget_name: name, default_amount: defaultAmount, budget_amount: defaultAmount,
        has_override: false, override_amount: null, contributions: 0, total_available: defaultAmount,
        spent: 0, remaining: defaultAmount, _pending: true
      });
      return arr;
    });
    _refreshView();

    const dropTmp = () => {
      _patchList('getBudgets', l => l.filter(b => b.id !== tmp.id));
      _mapBudgetStats(arr => arr.filter(b => String(b.budget_id) !== tmp.id));
    };

    try {
      const res = await Api.createBudget({ name, defaultAmount }, { invalidate: 'none' });
      _mapList('getBudgets', tmp.id, b => ({ ..._clean(b), id: res.id }));
      _mapBudgetStats(arr => arr.map(b => (String(b.budget_id) === tmp.id ? { ..._clean(b), budget_id: res.id } : b)));
      showToast('Budget toegevoegd', 'success');
      _reconcileCachedMonths();
    } catch (err) {
      dropTmp();
      if (err.ambiguous) {
        showToast('Kon niet bevestigen dat het budget is opgeslagen. De actuele gegevens worden opnieuw geladen.', 'error');
        await _adoptServerList('getBudgets', Api.getBudgets);
        _reconcileCachedMonths(300);
      } else {
        showToast('Opslaan mislukt: ' + err.message, 'error');
      }
    }
    _refreshView();
  }

  async function deleteBudget(id) {
    const res = await Api.deleteBudget(id, { invalidate: 'none' });
    // Het budget én al zijn versies gaan weg (net als op de server)
    _patchList('getBudgets', list => list.filter(b => b.id !== id && String(b.budget_id || '') !== String(id)));
    _patchList('getCategories', list => list.map(c => (String(c.budget_id) === String(id) ? { ...c, budget_id: '' } : c)));
    Api.cache.clear('getBudgetStats:');
    return res;
  }

  return {
    addTransaction, updateTransaction, deleteTransaction,
    setBudgetOverride, setBudgetVersion, updateBudgetVersion, deleteBudgetVersion,
    createCategory, updateCategory, deleteCategory,
    createBudget, deleteBudget
  };
})();
