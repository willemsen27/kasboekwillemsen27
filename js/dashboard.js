// js/dashboard.js — Dashboard view

const Dashboard = (() => {
  let _year, _month;
  let _activeBudgetId = '';
  let _chart  = null;
  let _chart2 = null;
  let _hiddenBudgets = new Set(); // bijhouden welke budgetten verborgen zijn in het staafdiagram
  let _budgets = [];
  let _categories = [];

  // ─── Public render ──────────────────────────────────────────────────────────
  async function render() {
    const el = document.getElementById('view-dashboard');
    if (!_year) {
      const ym = currentYearMonth();
      _year  = ym.year;
      _month = ym.month;
    }
    el.innerHTML = _buildSkeleton();
    _bindNav(el);

    if (!Config.isConfigured) {
      el.querySelector('#dash-content').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚙️</div>
          <div class="empty-state-title">Nog niet ingesteld</div>
          <div class="empty-state-text">Ga naar Instellingen om de app te configureren.</div>
          <button class="btn btn-secondary" onclick="Router.navigate('settings')">Naar instellingen</button>
        </div>`;
      return;
    }

    try {
      // Laad budgetten én categorieën samen (categorieën nodig voor client-side budgetfilter)
      if (_budgets.length === 0 || _categories.length === 0) {
        [_budgets, _categories] = await Promise.all([Api.getBudgets(), Api.getCategories()]);
      }
      _renderFilterBar(el);
      await _loadAndRender(el);
    } catch (err) {
      el.querySelector('#dash-content').innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Fout bij laden</div>
        <div class="empty-state-text">${escapeHtml(err.message)}</div>
      </div>`;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────
  function _buildSkeleton() {
    return `
      <div class="page-header" style="padding-top:16px;">
        <button class="month-nav-btn" id="dash-prev">${_iconChevronLeft()}</button>
        <div class="month-nav-title" id="dash-month-label"></div>
        <button class="month-nav-btn" id="dash-next">${_iconChevronRight()}</button>
      </div>
      <div id="dash-filter-bar" class="dashboard-filter-bar"></div>
      <div id="dash-content">
        <div class="loading-state"><div class="spinner"></div><span>Laden…</span></div>
      </div>`;
  }

  function _bindNav(el) {
    el.querySelector('#dash-month-label').textContent = monthLabel(_year, _month);
    el.querySelector('#dash-prev').addEventListener('click', () => {
      const pm = prevMonth(_year, _month);
      _year = pm.year; _month = pm.month;
      el.querySelector('#dash-month-label').textContent = monthLabel(_year, _month);
      _loadAndRender(el);
    });
    el.querySelector('#dash-next').addEventListener('click', () => {
      const nm = nextMonth(_year, _month);
      _year = nm.year; _month = nm.month;
      el.querySelector('#dash-month-label').textContent = monthLabel(_year, _month);
      _loadAndRender(el);
    });
  }

  function _renderFilterBar(el) {
    const bar = el.querySelector('#dash-filter-bar');
    let opts = `<option value="">Alle budgetten</option>` +
      _budgets.map(b => `<option value="${escapeHtml(b.id)}" ${_activeBudgetId === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('');
    bar.innerHTML = `<select class="select" id="dash-budget-filter">${opts}</select>`;
    bar.querySelector('#dash-budget-filter').addEventListener('change', e => {
      _activeBudgetId = e.target.value;
      _loadAndRender(el);
    });
  }

  async function _loadAndRender(el) {
    const content = el.querySelector('#dash-content');
    content.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Laden…</span></div>';

    const { from, to } = getMonthRange(_year, _month);
    const monthStr = _year + '-' + String(_month).padStart(2, '0');

    // Haal alles ongefilterd op — zelfde cache-sleutel ongeacht het budgetfilter.
    // Client-side filteren is instant; server-side filteren per budgetwisseling duurde 4–5s.
    const [allStats, allTransactions, budgetStats] = await Promise.all([
      Api.getStats(from, to),
      Api.getTransactions({ from, to }),
      Api.getBudgetStats(from, to)
    ]);

    // Client-side filter op actief budget
    const stats = _activeBudgetId
      ? allStats.filter(s => {
          const cat = _categories.find(c => c.id === s.category_id || c.name === s.category_name);
          return cat && cat.budget_id === _activeBudgetId;
        })
      : allStats;

    const transactions = _activeBudgetId
      ? allTransactions.filter(t => {
          const cat = _categories.find(c => c.id === t.category_id);
          return cat && cat.budget_id === _activeBudgetId;
        })
      : allTransactions;

    // Destroy old charts
    if (_chart)  { _chart.destroy();  _chart  = null; }
    if (_chart2) { _chart2.destroy(); _chart2 = null; }

    // Totals
    const totalSpent    = stats.reduce((s, c) => s + (c.spent    || 0), 0);
    const totalReceived = stats.reduce((s, c) => s + (c.received || 0), 0);
    const netto         = totalReceived - totalSpent;

    // Budget info (if filter active)
    let budgetCardHtml = '';
    if (_activeBudgetId && budgetStats) {
      const bs = budgetStats.find(b => b.budget_id === _activeBudgetId);
      if (bs) {
        const remClass = bs.remaining >= 0 ? 'remaining-positive' : 'remaining-negative';
        budgetCardHtml = `
          <div class="card budget-summary-card">
            <div class="budget-summary-name">${escapeHtml(bs.budget_name)}</div>
            <div class="progress-bar-track">
              <div class="progress-bar-fill" style="width:${_pct(bs.spent, bs.total_available)}%;background:${_progressColor(bs.spent, bs.total_available)}"></div>
            </div>
            <div class="budget-summary-grid">
              <div class="budget-summary-cell">
                <div class="budget-summary-cell-label">Budget</div>
                <div class="budget-summary-cell-value">${formatCurrency(bs.budget_amount)}</div>
              </div>
              <div class="budget-summary-cell">
                <div class="budget-summary-cell-label">Uitgegeven</div>
                <div class="budget-summary-cell-value">${formatCurrency(bs.spent)}</div>
              </div>
              <div class="budget-summary-cell">
                <div class="budget-summary-cell-label">Resterend</div>
                <div class="budget-summary-cell-value ${remClass}">${formatCurrency(bs.remaining)}</div>
              </div>
            </div>
          </div>`;
      }
    }

    // Summary amount card
    let summaryHtml = '';
    if (!_activeBudgetId) {
      summaryHtml = `
        <div class="card">
          <div class="dashboard-summary">
            <div class="dashboard-summary-label">Uitgegeven deze maand</div>
            <div class="dashboard-summary-amount">${formatCurrency(totalSpent)}</div>
            ${totalReceived > 0 ? `<div class="text-sm text-muted mt-12">Ontvangen: <strong>${formatCurrency(totalReceived)}</strong></div>` : ''}
          </div>
        </div>`;
    }

    // Donut chart data — only spent > 0
    const chartData = stats.filter(c => (c.spent || 0) > 0).sort((a, b) => b.spent - a.spent);

    // Top-3 categories
    const top3Html = chartData.slice(0, 3).map(c => `
      <div class="top-category-row">
        <div class="chip">
          <span class="chip-dot" style="background:${escapeHtml(c.category_color)}"></span>
          ${escapeHtml(c.category_name)}
        </div>
        <div class="top-category-amount">${formatCurrency(c.spent)}</div>
      </div>`).join('') || '<div class="text-sm text-muted" style="padding:8px 0">Geen uitgaven</div>';

    // Last 5 transactions
    const last5Html = transactions.slice(0, 5).map(t => {
      const isReceived = parseFloat(t.amount) < 0;
      return `
        <div class="transaction-card">
          <div class="transaction-card-left">
            <div class="transaction-card-date">${formatDate(t.date)}</div>
            <div class="transaction-card-desc">${escapeHtml(t.description || '—')}</div>
          </div>
          <div class="transaction-card-right">
            <div class="transaction-card-amount ${isReceived ? 'received' : ''}">
              ${isReceived ? '−\u00a0' : ''}${formatCurrency(t.amount)}
            </div>
          </div>
        </div>`;
    }).join('') || '<div class="empty-state" style="padding:24px"><div class="empty-state-text">Nog geen transacties.</div></div>';

    content.innerHTML = `
      ${summaryHtml}
      ${budgetCardHtml}
      ${chartData.length > 0 ? `
        <div class="card">
          <div class="card-title">Uitgaven per categorie</div>
          <div class="chart-container">
            <canvas id="dash-chart"></canvas>
          </div>
        </div>` : ''}
      <div class="card">
        <div class="card-title">Top categorieën</div>
        <div class="top-categories-list">${top3Html}</div>
      </div>
      ${budgetStats.length > 0 ? `
        <div class="card budget-bar-card">
          <div class="card-title">Budget vs Uitgegeven</div>
          <div class="budget-toggle-chips">
            ${budgetStats.map(b => `<button class="budget-toggle-btn${_hiddenBudgets.has(b.budget_id) ? ' inactive' : ''}" data-bid="${escapeHtml(b.budget_id)}"><span class="budget-toggle-dot" style="background:${_barColor(b.spent, b.total_available)}"></span>${escapeHtml(b.budget_name)}</button>`).join('')}
          </div>
          <div class="budget-bar-container">
            <div id="dash-budget-empty" class="text-sm text-muted" style="display:none;text-align:center;padding:32px 0">Alle budgetten zijn verborgen — klik een label hierboven om ze terug te tonen.</div>
            <canvas id="dash-budget-chart"></canvas>
          </div>
        </div>` : ''}
      <div class="flex-between mb-8">
        <div class="card-title" style="margin:0">Recente transacties</div>
        <button class="btn btn-ghost btn-sm" onclick="Router.navigate('transactions')">Alle →</button>
      </div>
      ${last5Html}`;

    // Draw chart
    if (chartData.length > 0) {
      const ctx = document.getElementById('dash-chart');
      if (ctx) {
        _chart = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels:   chartData.map(c => c.category_name),
            datasets: [{
              data:            chartData.map(c => c.spent),
              backgroundColor: chartData.map(c => c.category_color),
              borderWidth: 2,
              borderColor: '#ffffff'
            }]
          },
          options: {
            // aspectRatio < 1 makes the canvas taller than wide, giving the
            // bottom legend more room so items are never clipped.
            aspectRatio: 0.8,
            plugins: { legend: { position: 'bottom', labels: { font: { size: 12 }, boxWidth: 12, padding: 12 } } },
            cutout: '65%'
          }
        });
      }
    }

    // Teken het budget staafdiagram en koppel de toggle-chips
    _drawBudgetChart(budgetStats);
    content.querySelectorAll('.budget-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const bid = btn.dataset.bid;
        if (_hiddenBudgets.has(bid)) {
          _hiddenBudgets.delete(bid);
          btn.classList.remove('inactive');
        } else {
          _hiddenBudgets.add(bid);
          btn.classList.add('inactive');
        }
        _drawBudgetChart(budgetStats);
      });
    });

    // Prefetch aangrenzende maanden op de achtergrond voor instant navigatie
    const _pm = prevMonth(_year, _month), _nm = nextMonth(_year, _month);
    [_pm, _nm].forEach(ym => {
      const r = getMonthRange(ym.year, ym.month);
      Api.getStats(r.from, r.to).catch(() => {});
      Api.getTransactions(r).catch(() => {});
      Api.getBudgetStats(r.from, r.to).catch(() => {});
    });
  }

  function _pct(spent, available) {
    if (!available || available <= 0) return 0;
    return Math.min(100, Math.round((spent / available) * 100));
  }

  function _progressColor(spent, available) {
    if (!available || available <= 0) return 'var(--color-primary)';
    const r = spent / available;
    if (r >= 1.0) return 'var(--color-danger)';
    if (r >= 0.75) return 'var(--color-warning)';
    return 'var(--color-success)';
  }

  function _drawBudgetChart(budgetStats) {
    if (_chart2) { _chart2.destroy(); _chart2 = null; }
    const canvas = document.getElementById('dash-budget-chart');
    if (!canvas) return;

    const visible = budgetStats.filter(b => !_hiddenBudgets.has(b.budget_id));
    const emptyEl = document.getElementById('dash-budget-empty');

    if (visible.length === 0) {
      canvas.style.display = 'none';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    canvas.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';

    _chart2 = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: visible.map(b => b.budget_name),
        datasets: [
          {
            label: 'Budget',
            data: visible.map(b => b.total_available),
            backgroundColor: 'rgba(106,158,122,1)',
            borderColor: 'rgba(106,158,122,1)',
            borderWidth: 0,
            borderRadius: 6,
            borderSkipped: false
          },
          {
            label: 'Uitgegeven',
            data: visible.map(b => b.spent),
            backgroundColor: 'rgba(229,115,115,0.9)',
            borderColor: 'rgba(229,115,115,0.9)',
            borderWidth: 0,
            borderRadius: 6,
            borderSkipped: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { font: { size: 12 }, boxWidth: 12, padding: 10 } },
          tooltip: {
            callbacks: {
              label: c => ` ${c.dataset.label}: ${formatCurrency(c.raw)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { font: { size: 11 }, callback: v => '\u20ac\u00a0' + v.toLocaleString('nl-NL') }
          }
        }
      }
    });
  }

  // Geeft een rgba-kleur op basis van budget-benutting (voor Chart.js, geen CSS vars)
  function _barColor(spent, available) {
    if (!available || available <= 0) return spent > 0 ? 'rgba(229,115,115,0.85)' : 'rgba(129,199,132,0.85)';
    const r = spent / available;
    if (r >= 1.0)  return 'rgba(229,115,115,0.85)'; // rood — over budget
    if (r >= 0.75) return 'rgba(255,183,77,0.85)';  // oranje — bijna op
    return 'rgba(129,199,132,0.85)';                  // groen — ruimte over
  }

  function _iconChevronLeft() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>`;
  }

  function _iconChevronRight() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`;
  }

  return { render };
})();
