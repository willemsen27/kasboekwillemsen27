// js/settings.js — Settings view (tabs: Categorieën, Budgetten, App)

const Settings = (() => {
  let _activeTab  = 'categories';
  let _categories = [];
  let _budgets    = [];
  let _catSearch  = '';

  const PASTEL_COLORS = [
    '#b5d5c5','#c5d5b5','#b5c5d5','#d5d5b5',
    '#b5d5d5','#c5b5d5','#d5c5b5','#d5c5d5',
    '#d5b5c5','#c5c5b5','#d5b5d5','#b5b5d5',
    '#d5b5b5','#b5d5b5','#c5c5d5','#d5c5c5'
  ];

  // ─── Public render ──────────────────────────────────────────────────────────
  async function render() {
    const el = document.getElementById('view-settings');
    el.innerHTML = `
      <div class="page-header" style="padding-top:16px;">
        <div class="page-title">Instellingen</div>
      </div>
      <div class="tab-bar">
        <button class="tab-btn ${_activeTab === 'categories' ? 'active' : ''}" data-tab="categories">Categorieën</button>
        <button class="tab-btn ${_activeTab === 'budgets'    ? 'active' : ''}" data-tab="budgets">Budgetten</button>
        <button class="tab-btn ${_activeTab === 'app'        ? 'active' : ''}" data-tab="app">App</button>
        <button class="tab-btn ${_activeTab === 'sunscreen'  ? 'active' : ''}" data-tab="sunscreen">Zonnescherm</button>
      </div>
      <div id="settings-content"></div>`;

    el.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTab = btn.dataset.tab;
        el.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab));
        _renderTab(el);
      });
    });

    await _renderTab(el);
  }

  async function _renderTab(el) {
    const content = el.querySelector('#settings-content');
    if (_activeTab === 'categories') {
      await _renderCategories(content);
    } else if (_activeTab === 'budgets') {
      await _renderBudgets(content);
    } else if (_activeTab === 'sunscreen') {
      _renderSunscreen(content);
    } else {
      _renderApp(content);
    }
  }

  // ─── Tab: Categorieën ───────────────────────────────────────────────────────
  async function _renderCategories(content) {
    content.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Laden…</span></div>';
    try {
      [_categories, _budgets] = await Promise.all([
        Config.isConfigured ? Api.getCategories() : Promise.resolve([]),
        Config.isConfigured ? Api.getBudgets()    : Promise.resolve([])
      ]);
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
      return;
    }
    _renderCategoryList(content);
  }

  function _renderCategoryList(content) {
    const budgetMap = {};
    _budgets.forEach(b => { budgetMap[b.id] = b.name; });

    const filtered = _catSearch
      ? _categories.filter(c => String(c.name).toLowerCase().includes(_catSearch.toLowerCase()))
      : _categories;

    content.innerHTML = `
      <div class="search-input-wrap">
        <span class="search-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg></span>
        <input class="input" id="cat-search" placeholder="Zoeken…" value="${escapeHtml(_catSearch)}">
      </div>
      <div id="cat-list">
        ${filtered.length === 0
          ? '<div class="empty-state"><div class="empty-state-title">Geen categorieën</div></div>'
          : filtered.map(c => {
              const budgetName = c.budget_id && budgetMap[c.budget_id] ? budgetMap[c.budget_id] : '';
              return `
                <div class="category-card">
                  <div class="category-card-swatch" style="background:${escapeHtml(c.color)}"></div>
                  <div class="category-card-info">
                    <div class="category-card-name">${escapeHtml(c.name)}</div>
                    ${budgetName ? `<div class="category-card-budget">${escapeHtml(budgetName)}</div>` : ''}
                  </div>
                  <div class="category-card-actions">
                    <button class="btn-icon" data-action="edit-cat" data-id="${escapeHtml(c.id)}" title="Bewerken">${_iconEdit()}</button>
                    <button class="btn-icon" data-action="del-cat"  data-id="${escapeHtml(c.id)}" title="Verwijderen" style="background:var(--color-danger-lt);color:var(--color-danger)">${_iconDelete()}</button>
                  </div>
                </div>`; }).join('')}
      </div>
      <button class="btn btn-full" style="margin-top:4px" id="btn-add-cat">+ Categorie toevoegen</button>`;

    content.querySelector('#cat-search').addEventListener('input', e => {
      _catSearch = e.target.value;
      _renderCategoryList(content);
    });

    content.querySelectorAll('[data-action="edit-cat"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = _categories.find(c => c.id === btn.dataset.id);
        if (cat) _openCategoryModal(content, cat);
      });
    });

    content.querySelectorAll('[data-action="del-cat"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Categorie verwijderen? Transacties gekoppeld aan deze categorie worden ontkoppeld.')) return;
        try {
          await Api.deleteCategory(btn.dataset.id);
          showToast('Categorie verwijderd', 'success');
          await _renderCategories(content);
        } catch (err) { showToast('Fout: ' + err.message, 'error'); }
      });
    });

    content.querySelector('#btn-add-cat').addEventListener('click', () => _openCategoryModal(content, null));
  }

  function _openCategoryModal(content, existing) {
    const isEdit    = !!existing;
    const selColor  = existing?.color || PASTEL_COLORS[0];
    const selBudget = existing?.budget_id || '';

    const budgetOpts = `<option value="">Geen budget</option>` +
      _budgets.map(b => `<option value="${escapeHtml(b.id)}" ${selBudget === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('');

    const colorSwatches = PASTEL_COLORS.map(c =>
      `<div class="color-swatch ${c === selColor ? 'selected' : ''}" data-color="${escapeHtml(c)}" style="background:${escapeHtml(c)}"></div>`
    ).join('');

    const modal = _injectModal(`
      <div class="modal-title">${isEdit ? 'Categorie bewerken' : 'Categorie toevoegen'}</div>
      <div class="form-group">
        <label class="form-label" for="cm-name">Naam</label>
        <input id="cm-name" class="input" type="text" value="${isEdit ? escapeHtml(existing.name) : ''}" placeholder="Categorie naam">
      </div>
      <div class="form-group">
        <label class="form-label">Kleur</label>
        <div class="color-picker-grid" id="cm-colors">${colorSwatches}</div>
        <input type="hidden" id="cm-color" value="${escapeHtml(selColor)}">
      </div>
      <div class="form-group">
        <label class="form-label" for="cm-budget">Budget</label>
        <select id="cm-budget" class="select">${budgetOpts}</select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-full" id="cm-save">${isEdit ? 'Opslaan' : 'Toevoegen'}</button>
        <button class="btn btn-secondary btn-full" id="cm-cancel">Annuleren</button>
      </div>`);

    let currentColor = selColor;

    modal.querySelectorAll('.color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        currentColor = sw.dataset.color;
        modal.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === currentColor));
        modal.querySelector('#cm-color').value = currentColor;
      });
    });

    modal.querySelector('#cm-cancel').addEventListener('click', () => _removeModal());

    modal.querySelector('#cm-save').addEventListener('click', async () => {
      const name     = modal.querySelector('#cm-name').value.trim();
      const color    = modal.querySelector('#cm-color').value;
      const budgetId = modal.querySelector('#cm-budget').value;
      if (!name) { showToast('Voer een naam in.', 'error'); return; }
      const btn = modal.querySelector('#cm-save');
      btn.disabled = true; btn.textContent = 'Bezig…';
      try {
        if (isEdit) {
          await Api.updateCategory(existing.id, { name, color, budgetId });
          showToast('Categorie opgeslagen', 'success');
        } else {
          await Api.createCategory({ name, color, budgetId });
          showToast('Categorie toegevoegd', 'success');
        }
        _removeModal();
        await _renderCategories(content);
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = isEdit ? 'Opslaan' : 'Toevoegen';
      }
    });
  }

  // ─── Tab: Budgetten ─────────────────────────────────────────────────────────
  async function _renderBudgets(content) {
    content.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Laden…</span></div>';
    try {
      _budgets = Config.isConfigured ? await Api.getBudgets() : [];
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
      return;
    }
    _renderBudgetList(content);
  }

  function _renderBudgetList(content) {
    content.innerHTML = `
      <div id="budget-list">
        ${_budgets.length === 0
          ? '<div class="empty-state"><div class="empty-state-title">Geen budgetten</div></div>'
          : _budgets.map(b => `
              <div class="budget-list-row">
                <div class="budget-list-name">${escapeHtml(b.name)}</div>
                <div class="budget-list-amount">${formatCurrency(b.default_amount)}</div>
                <div class="budget-list-actions">
                  <button class="btn-icon" data-action="edit-bud" data-id="${escapeHtml(b.id)}" title="Bewerken">${_iconEdit()}</button>
                  <button class="btn-icon" data-action="del-bud"  data-id="${escapeHtml(b.id)}" title="Verwijderen" style="background:var(--color-danger-lt);color:var(--color-danger)">${_iconDelete()}</button>
                </div>
              </div>`).join('')}
      </div>
      <button class="btn btn-full" style="margin-top:4px" id="btn-add-bud">+ Budget toevoegen</button>`;

    content.querySelectorAll('[data-action="edit-bud"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const b = _budgets.find(x => x.id === btn.dataset.id);
        if (b) _openBudgetModal(content, b);
      });
    });

    content.querySelectorAll('[data-action="del-bud"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Budget verwijderen? Categorieën gekoppeld aan dit budget worden ontkoppeld.')) return;
        try {
          await Api.deleteBudget(btn.dataset.id);
          showToast('Budget verwijderd', 'success');
          await _renderBudgets(content);
        } catch (err) { showToast('Fout: ' + err.message, 'error'); }
      });
    });

    content.querySelector('#btn-add-bud').addEventListener('click', () => _openBudgetModal(content, null));
  }

  function _openBudgetModal(content, existing) {
    const isEdit = !!existing;

    const modal = _injectModal(`
      <div class="modal-title">${isEdit ? 'Budget bewerken' : 'Budget toevoegen'}</div>
      <div class="form-group">
        <label class="form-label" for="bm-name">Naam</label>
        <input id="bm-name" class="input" type="text" value="${isEdit ? escapeHtml(existing.name) : ''}" placeholder="Budget naam">
      </div>
      <div class="form-group">
        <label class="form-label" for="bm-amount">Standaard maandbedrag</label>
        <div class="input-prefix-wrap">
          <span class="input-prefix">€</span>
          <input id="bm-amount" class="input" type="number" step="0.01" min="0"
            value="${isEdit ? existing.default_amount : '0'}" placeholder="0,00">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-full" id="bm-save">${isEdit ? 'Opslaan' : 'Toevoegen'}</button>
        <button class="btn btn-secondary btn-full" id="bm-cancel">Annuleren</button>
      </div>`);

    modal.querySelector('#bm-cancel').addEventListener('click', () => _removeModal());

    modal.querySelector('#bm-save').addEventListener('click', async () => {
      const name          = modal.querySelector('#bm-name').value.trim();
      const defaultAmount = parseFloat(modal.querySelector('#bm-amount').value) || 0;
      if (!name) { showToast('Voer een naam in.', 'error'); return; }
      const btn = modal.querySelector('#bm-save');
      btn.disabled = true; btn.textContent = 'Bezig…';
      try {
        if (isEdit) {
          await Api.updateBudget(existing.id, { name, defaultAmount });
          showToast('Budget opgeslagen', 'success');
        } else {
          await Api.createBudget({ name, defaultAmount });
          showToast('Budget toegevoegd', 'success');
        }
        _removeModal();
        await _renderBudgets(content);
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = isEdit ? 'Opslaan' : 'Toevoegen';
      }
    });
  }

  // ─── Tab: App ───────────────────────────────────────────────────────────────
  function _renderApp(content) {
    const maskedUrl = Config.scriptUrl
      ? Config.scriptUrl.substring(0, 40) + '…'
      : '(niet ingesteld)';

    content.innerHTML = `
      <div class="card settings-app-section">
        <h3>Verbinding</h3>
        <div class="form-group">
          <label class="form-label" for="app-url">Script URL</label>
          <input id="app-url" class="input" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${escapeHtml(Config.scriptUrl)}">
        </div>
        <div class="form-group">
          <label class="form-label" for="app-key">API Sleutel</label>
          <input id="app-key" class="input" type="password" placeholder="Jouw API sleutel" value="${escapeHtml(Config.apiKey)}">
        </div>
        <button class="btn btn-full" id="app-save" style="margin-bottom:8px">Opslaan</button>
        <button class="btn btn-secondary btn-full" id="app-test">Test verbinding</button>
        <div id="app-status"></div>
      </div>

      <div class="card settings-app-section">
        <h3>Over de app</h3>
        <div class="settings-info">
          <p><strong>Kasboek Willemsen</strong> — Versie 1.0</p>
          <p style="margin-top:8px">Een persoonlijk kasboek voor twee.</p>
          <p style="margin-top:8px">
            <a href="https://github.com" target="_blank" rel="noopener">GitHub repository</a>
          </p>
        </div>
      </div>`;

    content.querySelector('#app-save').addEventListener('click', () => {
      const url = content.querySelector('#app-url').value.trim();
      const key = content.querySelector('#app-key').value.trim();
      Config.scriptUrl = url;
      Config.apiKey    = key;
      showToast('Instellingen opgeslagen', 'success');
    });

    content.querySelector('#app-test').addEventListener('click', async () => {
      const statusEl = content.querySelector('#app-status');
      const btn      = content.querySelector('#app-test');
      btn.disabled   = true;
      btn.textContent = 'Testen…';
      statusEl.innerHTML = '';
      try {
        await Api.getCategories();
        statusEl.innerHTML = '<div class="connection-status ok">✓ Verbinding gelukt!</div>';
      } catch (err) {
        statusEl.innerHTML = `<div class="connection-status error">✗ ${escapeHtml(err.message)}</div>`;
      }
      btn.disabled    = false;
      btn.textContent = 'Test verbinding';
    });
  }

  // ─── Tab: Zonnescherm ─────────────────────────────────────────────────────
  function _renderSunscreen(content) {
    const hasApp = Config.isConfigured;

    content.innerHTML = `
      <div class="card settings-app-section">
        <h3>Bediening</h3>
        ${!hasApp
          ? `<p class="connection-status error" style="margin:0">⚠️ Stel eerst de App-verbinding in (tabblad App).</p>`
          : `<div class="sunscreen-controls">
              <button class="sunscreen-btn-open" id="btn-uitrollen">☀️&nbsp; Uitrollen</button>
              <button class="sunscreen-btn-stop" id="btn-stop">⏸&nbsp; Stop</button>
              <button class="sunscreen-btn-close" id="btn-oprollen">🍂&nbsp; Oprollen</button>
            </div>
            <div id="sunscreen-status" style="margin-top:12px"></div>`}
      </div>`;

    if (hasApp) {
      const statusEl = content.querySelector('#sunscreen-status');

      async function _sendCmd(command, label) {
        const btns = content.querySelectorAll('.sunscreen-btn-open, .sunscreen-btn-stop, .sunscreen-btn-close');
        btns.forEach(b => { b.disabled = true; });
        statusEl.innerHTML = `<div class="connection-status">⏳ ${escapeHtml(label)}…</div>`;
        try {
          await Api.controlSunscreen(command);
          statusEl.innerHTML = `<div class="connection-status ok">✓ ${escapeHtml(label)} gestuurd!</div>`;
        } catch (err) {
          statusEl.innerHTML = `<div class="connection-status error">✗ ${escapeHtml(err.message)}</div>`;
        } finally {
          btns.forEach(b => { b.disabled = false; });
        }
      }

      content.querySelector('#btn-uitrollen').addEventListener('click', () => _sendCmd('close', 'Uitrollen'));
      content.querySelector('#btn-stop')     .addEventListener('click', () => _sendCmd('stop',  'Stop'));
      content.querySelector('#btn-oprollen') .addEventListener('click', () => _sendCmd('open',  'Oprollen'));
    }
  }

  // ─── Modal helpers ──────────────────────────────────────────────────────────
  function _injectModal(html) {
    _removeModal(); // Remove any existing dynamic modal
    const overlay  = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'settings-modal-overlay';
    const modal    = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.getElementById('app').appendChild(overlay);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) _removeModal();
    });

    return modal;
  }

  function _removeModal() {
    const existing = document.getElementById('settings-modal-overlay');
    if (existing) existing.remove();
  }

  function _iconEdit()  { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`; }
  function _iconDelete(){ return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`; }

  return { render };
})();
