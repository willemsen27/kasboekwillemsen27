// js/transactions.js — Transactions view

const Transactions = (() => {
  let _year, _month;
  let _activeCategoryId = '';
  let _activeBudgetId   = '';
  let _categories       = [];
  let _budgets          = [];

  // ─── Public API ─────────────────────────────────────────────────────────────
  async function render() {
    const el = document.getElementById('view-transactions');
    if (!_year) {
      const ym = currentYearMonth();
      _year  = ym.year;
      _month = ym.month;
    }
    el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Laden…</span></div>';

    if (!Config.isConfigured) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">⚙️</div>
        <div class="empty-state-title">Nog niet ingesteld</div>
        <div class="empty-state-text">Ga naar Instellingen.</div>
        <button class="btn btn-secondary" onclick="Router.navigate('settings')">Naar instellingen</button>
      </div>`;
      return;
    }

    try {
      [_categories, _budgets] = await Promise.all([Api.getCategories(), Api.getBudgets()]);
      await _renderAll(el);
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Fout</div>
        <div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
    }
  }

  function renderWithFilter(budgetId) {
    _activeBudgetId   = budgetId || '';
    _activeCategoryId = '';
    Router.navigate('transactions');
  }

  // ─── Private helpers ────────────────────────────────────────────────────────
  async function _renderAll(el) {
    const { from, to } = getMonthRange(_year, _month);

    _buildShell(el, from, to);
    _bindControls(el);
    await _loadTransactions(el, from, to);
  }

  function _buildShell(el, from, to) {
    const budgetOpts = `<option value="">Alle budgetten</option>` +
      _budgets.map(b => `<option value="${escapeHtml(b.id)}" ${_activeBudgetId === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('');

    const visibleCats = _activeBudgetId
      ? _categories.filter(c => c.budget_id === _activeBudgetId)
      : _categories;

    const catOpts = `<option value="">Alle categorieën</option>` +
      visibleCats.map(c => `<option value="${escapeHtml(c.id)}" ${_activeCategoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');

    el.innerHTML = `
      <div class="page-header" style="padding-top:16px;">
        <button class="month-nav-btn" id="tr-prev">${_chevLeft()}</button>
        <div class="month-nav-title" id="tr-month-label">${monthLabel(_year, _month)}</div>
        <button class="month-nav-btn" id="tr-next">${_chevRight()}</button>
      </div>
      <div class="filter-bar">
        <div class="filter-bar-row">
          <select class="select" id="tr-budget-filter">${budgetOpts}</select>
          <select class="select" id="tr-cat-filter">${catOpts}</select>
        </div>
      </div>
      <div id="tr-totals"></div>
      <div id="tr-list"></div>`;
  }

  function _bindControls(el) {
    el.querySelector('#tr-prev').addEventListener('click', async () => {
      const pm = prevMonth(_year, _month);
      _year = pm.year; _month = pm.month;
      el.querySelector('#tr-month-label').textContent = monthLabel(_year, _month);
      const { from, to } = getMonthRange(_year, _month);
      await _loadTransactions(el, from, to);
    });

    el.querySelector('#tr-next').addEventListener('click', async () => {
      const nm = nextMonth(_year, _month);
      _year = nm.year; _month = nm.month;
      el.querySelector('#tr-month-label').textContent = monthLabel(_year, _month);
      const { from, to } = getMonthRange(_year, _month);
      await _loadTransactions(el, from, to);
    });

    el.querySelector('#tr-budget-filter').addEventListener('change', async e => {
      _activeBudgetId   = e.target.value;
      _activeCategoryId = '';
      // Rebuild category dropdown
      const visibleCats = _activeBudgetId
        ? _categories.filter(c => c.budget_id === _activeBudgetId)
        : _categories;
      const catSel = el.querySelector('#tr-cat-filter');
      catSel.innerHTML = `<option value="">Alle categorieën</option>` +
        visibleCats.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
      const { from, to } = getMonthRange(_year, _month);
      await _loadTransactions(el, from, to);
    });

    el.querySelector('#tr-cat-filter').addEventListener('change', async e => {
      _activeCategoryId = e.target.value;
      const { from, to } = getMonthRange(_year, _month);
      await _loadTransactions(el, from, to);
    });
  }

  async function _loadTransactions(el, from, to) {
    const listEl   = el.querySelector('#tr-list');
    const totalsEl = el.querySelector('#tr-totals');
    listEl.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Laden…</span></div>';

    try {
      const transactions = await Api.getTransactions({
        from,
        to,
        categoryId: _activeCategoryId || undefined,
        budgetId:   _activeBudgetId   || undefined
      });

      // Compute totals
      let totalSpent = 0, totalReceived = 0;
      transactions.forEach(t => {
        const a = parseFloat(t.amount) || 0;
        if (a >= 0) totalSpent    += a;
        else        totalReceived += Math.abs(a);
      });
      const netto = totalReceived - totalSpent;
      const nettoClass = netto >= 0 ? 'netto-positive' : 'netto-negative';

      totalsEl.innerHTML = `
        <div class="totals-row">
          <span><span class="totals-item-label">Uitgegeven: </span><span class="totals-item-value">${formatCurrency(totalSpent)}</span></span>
          <span><span class="totals-item-label">Ontvangen: </span><span class="totals-item-value received">${formatCurrency(totalReceived)}</span></span>
          <span><span class="totals-item-label">Netto: </span><span class="totals-item-value ${nettoClass}">${netto < 0 ? '−\u00a0' : ''}${formatCurrency(netto)}</span></span>
        </div>`;

      if (transactions.length === 0) {
        listEl.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">Geen transacties</div>
          <div class="empty-state-text">Er zijn geen transacties gevonden voor de geselecteerde filters.</div>
          <button class="btn" onclick="TransactionForm.openNew()">+ Transactie toevoegen</button>
        </div>`;
        return;
      }

      listEl.innerHTML = transactions.map(t => {
        const isReceived = parseFloat(t.amount) < 0;
        const cat = _categories.find(c => c.id === t.category_id);
        const catHtml = cat
          ? `<span class="chip"><span class="chip-dot" style="background:${escapeHtml(cat.color)}"></span>${escapeHtml(cat.name)}</span>`
          : `<span class="chip">Onbekend</span>`;
        return `
          <div class="transaction-card">
            <div class="transaction-card-left">
              <div class="transaction-card-date">${formatDate(t.date)}</div>
              <div class="transaction-card-desc">${escapeHtml(t.description || '—')}</div>
              <div style="margin-top:4px">${catHtml}</div>
            </div>
            <div class="transaction-card-right">
              <div class="transaction-card-amount ${isReceived ? 'received' : ''}">
                ${isReceived ? '−\u00a0' : ''}${formatCurrency(t.amount)}
              </div>
              <div class="transaction-card-actions">
                <button class="btn-icon" title="Bewerken" data-action="edit" data-id="${escapeHtml(t.id)}">
                  ${_iconEdit()}
                </button>
                <button class="btn-icon" title="Verwijderen" data-action="delete" data-id="${escapeHtml(t.id)}" style="background:var(--color-danger-lt);color:var(--color-danger)">
                  ${_iconDelete()}
                </button>
              </div>
            </div>
          </div>`;
      }).join('');

      // Bind edit / delete
      listEl.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tx = transactions.find(t => t.id === btn.dataset.id);
          if (tx) TransactionForm.openEdit(tx);
        });
      });

      listEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Transactie verwijderen?')) return;
          try {
            await Api.deleteTransaction(btn.dataset.id);
            showToast('Transactie verwijderd', 'success');
            await _loadTransactions(el, from, to);
          } catch (err) {
            showToast('Fout: ' + err.message, 'error');
          }
        });
      });

    } catch (err) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Fout</div>
        <div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
    }
  }

  function _chevLeft()  { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`; }
  function _chevRight() { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`; }
  function _iconEdit()  { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`; }
  function _iconDelete(){ return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`; }

  return { render, renderWithFilter };
})();
