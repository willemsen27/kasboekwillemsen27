// js/budgets.js — Budgets view

const Budgets = (() => {
  let _year, _month;

  async function render() {
    const el = document.getElementById('view-budgets');
    if (!_year) {
      const ym = currentYearMonth();
      _year  = ym.year;
      _month = ym.month;
    }

    if (!Config.isConfigured) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">⚙️</div>
        <div class="empty-state-title">Nog niet ingesteld</div>
        <button class="btn btn-secondary" onclick="Router.navigate('settings')">Naar instellingen</button>
      </div>`;
      return;
    }

    el.innerHTML = _buildHeader() + '<div id="budget-content"><div class="loading-state"><div class="spinner"></div><span>Laden…</span></div></div>';
    _bindNav(el);
    await _load(el);
  }

  function _buildHeader() {
    return `
      <div class="page-header" style="padding-top:16px;">
        <button class="month-nav-btn" id="bud-prev">${_chevLeft()}</button>
        <div class="month-nav-title" id="bud-month-label"></div>
        <button class="month-nav-btn" id="bud-next">${_chevRight()}</button>
      </div>`;
  }

  function _bindNav(el) {
    el.querySelector('#bud-month-label').textContent = monthLabel(_year, _month);
    el.querySelector('#bud-prev').addEventListener('click', async () => {
      const pm = prevMonth(_year, _month);
      _year = pm.year; _month = pm.month;
      el.querySelector('#bud-month-label').textContent = monthLabel(_year, _month);
      await _load(el);
    });
    el.querySelector('#bud-next').addEventListener('click', async () => {
      const nm = nextMonth(_year, _month);
      _year = nm.year; _month = nm.month;
      el.querySelector('#bud-month-label').textContent = monthLabel(_year, _month);
      await _load(el);
    });
  }

  async function _load(el) {
    const content = el.querySelector('#budget-content');
    content.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Laden…</span></div>';
    const { from, to } = getMonthRange(_year, _month);

    try {
      const stats = await Api.getBudgetStats(from, to);

      if (stats.length === 0) {
        content.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">💰</div>
          <div class="empty-state-title">Geen budgetten</div>
          <div class="empty-state-text">Voeg budgetten toe via Instellingen → Budgetten.</div>
          <button class="btn btn-secondary" onclick="Router.navigate('settings')">Naar instellingen</button>
        </div>`;
        return;
      }

      // Summary totals
      const totalBudget    = stats.reduce((s, b) => s + b.budget_amount,  0);
      const totalSpent     = stats.reduce((s, b) => s + b.spent,          0);
      const totalRemaining = stats.reduce((s, b) => s + b.remaining,      0);

      const remClass = totalRemaining >= 0 ? 'green' : 'red';

      const summaryHtml = `
        <div class="budget-summary-header">
          <div class="budget-header-cell">
            <div class="budget-header-cell-label">Totaal budget</div>
            <div class="budget-header-cell-value">${formatCurrency(totalBudget)}</div>
          </div>
          <div class="budget-header-cell">
            <div class="budget-header-cell-label">Uitgegeven</div>
            <div class="budget-header-cell-value">${formatCurrency(totalSpent)}</div>
          </div>
          <div class="budget-header-cell">
            <div class="budget-header-cell-label">Resterend</div>
            <div class="budget-header-cell-value ${remClass}">${formatCurrency(totalRemaining)}</div>
          </div>
        </div>`;

      const cardsHtml = stats.map(b => _budgetCard(b)).join('');

      content.innerHTML = summaryHtml + cardsHtml;

      // Bind card clicks (navigate to transactions filtered by this budget)
      content.querySelectorAll('.budget-card[data-budget-id]').forEach(card => {
        card.addEventListener('click', e => {
          if (e.target.closest('.budget-card-edit')) return; // ignore edit button click
          Transactions.renderWithFilter(card.dataset.budgetId, _year, _month);
        });
      });

      // Bind edit buttons
      content.querySelectorAll('[data-action="edit-override"]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const b = stats.find(s => s.budget_id === btn.dataset.id);
          if (b) {
            const monthStr = _year + '-' + String(_month).padStart(2, '0');
            BudgetOverrideForm.open(b, monthStr, b.has_override ? b.override_amount : null);
          }
        });
      });

    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Fout</div>
        <div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
    }
  }

  function _budgetCard(b) {
    const pct         = _pct(b.spent, b.total_available);
    const barColor    = _progressColor(b.spent, b.total_available);
    const contribHtml = b.contributions > 0
      ? `<div class="budget-card-contributions">+ ${formatCurrency(b.contributions)} ontvangen</div>`
      : '';

    return `
      <div class="budget-card" data-budget-id="${escapeHtml(b.budget_id)}">
        <div class="budget-card-header">
          <div class="budget-card-name">${escapeHtml(b.budget_name)}</div>
          <div class="budget-card-edit">
            <button class="btn-icon" data-action="edit-override" data-id="${escapeHtml(b.budget_id)}" title="Budget aanpassen">
              ${_iconEdit()}
            </button>
          </div>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <div class="budget-card-amounts">
          <strong>${formatCurrency(b.spent)}</strong> uitgegeven van ${formatCurrency(b.total_available)}
        </div>
        ${contribHtml}
      </div>`;
  }

  function _pct(spent, available) {
    if (!available || available <= 0) return spent > 0 ? 100 : 0;
    return Math.min(100, Math.round((spent / available) * 100));
  }

  // Groen: < 85% of precies 100%. Oranje: 85% t/m < 100%, of overschrijding
  // tot 5% én max. €50. Rood: overschrijding van meer dan 5% of €50.
  function _progressColor(spent, available) {
    // Rekenen in centen om floating-point-ruis te voorkomen
    const s = Math.round((spent || 0) * 100);
    const a = Math.round((available || 0) * 100);
    if (a <= 0) return s > 0 ? 'var(--color-danger)' : 'var(--color-primary)';
    if (s > a) {
      const over = s - a;
      return over > a * 0.05 || over > 5000 ? 'var(--color-danger)' : 'var(--color-warning)';
    }
    if (s === a) return 'var(--color-success)';
    return s / a >= 0.85 ? 'var(--color-warning)' : 'var(--color-success)';
  }

  function _chevLeft()  { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`; }
  function _chevRight() { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`; }
  function _iconEdit()  { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`; }

  return { render };
})();
