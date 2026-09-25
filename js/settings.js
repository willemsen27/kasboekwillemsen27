// js/settings.js — Settings view (tabs: Categorieën, Budgetten, App)

const Settings = (() => {
  let _activeTab      = 'categories';
  let _budgetSubTab   = 'current'; // 'current' or 'future'
  let _categories     = [];
  let _budgets        = [];
  let _futureBudgets  = [];
  let _budgetRows     = []; // alle rijen uit het budgets-tabblad (budgetten én versies)
  let _catSearch      = '';

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
                <div class="category-card${c._pending ? ' pending' : ''}">
                  <div class="category-card-swatch" style="background:${escapeHtml(c.color)}"></div>
                  <div class="category-card-info">
                    <div class="category-card-name">${escapeHtml(c.name)}</div>
                    ${budgetName ? `<div class="category-card-budget">${escapeHtml(budgetName)}</div>` : ''}
                  </div>
                  <div class="category-card-actions">
                    ${c._pending
                      ? '<span class="btn-spinner dark" title="Bezig met opslaan…"></span>'
                      : `<button class="btn-icon" data-action="edit-cat" data-id="${escapeHtml(c.id)}" title="Bewerken">${_iconEdit()}</button>
                    <button class="btn-icon" data-action="del-cat"  data-id="${escapeHtml(c.id)}" title="Verwijderen" style="background:var(--color-danger-lt);color:var(--color-danger)">${_iconDelete()}</button>`}
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
        _spinIconButton(btn);
        try {
          await Mutations.deleteCategory(btn.dataset.id);
          showToast('Categorie verwijderd', 'success');
          await _renderCategories(content);
        } catch (err) {
          showToast('Fout: ' + err.message, 'error');
          await _renderCategories(content); // toon de werkelijke stand (ook bij een onduidelijke fout)
        }
      });
    });

    content.querySelector('#btn-add-cat').addEventListener('click', () => _openCategoryModal(content, null));
  }

  function _openCategoryModal(content, existing) {
    const isEdit       = !!existing;
    const selColor     = existing?.color || PASTEL_COLORS[0];
    const selBudget    = existing?.budget_id || '';
    const selColorHex  = /^#[0-9a-fA-F]{6}$/i.test(selColor) ? selColor : PASTEL_COLORS[0];
    const isCustomColor = !PASTEL_COLORS.includes(selColor);

    // Alleen hoofdbudgetten, en geen budget dat nog wordt opgeslagen (de server kent het nog niet)
    const parentBudgets = _budgets.filter(b => !b.budget_id && !b._pending);
    const budgetOpts = `<option value="">-- Kies een budget --</option>` +
      parentBudgets.map(b => `<option value="${escapeHtml(b.id)}" ${selBudget === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('');

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
        <div class="color-custom-row">
          <span class="color-custom-label">Eigen kleur</span>
          <input type="color" id="cm-color-native" class="color-native-picker" value="${escapeHtml(selColorHex)}">
          <input type="text" id="cm-color-hex" class="input color-hex-input" placeholder="#b5d5c5" maxlength="7" value="${isCustomColor ? escapeHtml(selColor) : ''}">
        </div>
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
        modal.querySelector('#cm-color-native').value = currentColor;
        modal.querySelector('#cm-color-hex').value = currentColor;
      });
    });

    const nativePicker = modal.querySelector('#cm-color-native');
    const hexInput     = modal.querySelector('#cm-color-hex');

    // Native OS kleurkiezer → sync hex-veld en currentColor, deselecteer swatches
    nativePicker.addEventListener('input', () => {
      const hex = nativePicker.value;
      hexInput.value = hex;
      currentColor = hex;
      modal.querySelector('#cm-color').value = hex;
      modal.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    });

    // Hex-invoer → sync native picker zodra het een geldige 7-char hex is
    hexInput.addEventListener('input', () => {
      let val = hexInput.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        nativePicker.value = val;
        currentColor = val;
        modal.querySelector('#cm-color').value = val;
        modal.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === val));
      }
    });

    modal.querySelector('#cm-cancel').addEventListener('click', () => _removeModal());

    modal.querySelector('#cm-save').addEventListener('click', () => {
      const name     = modal.querySelector('#cm-name').value.trim();
      const color    = modal.querySelector('#cm-color').value;
      const budgetId = modal.querySelector('#cm-budget').value;
      if (!name)     { showToast('Voer een naam in.', 'error'); return; }
      if (!budgetId) { showToast('Selecteer een budget voor deze categorie.', 'error'); return; }

      // Venster meteen sluiten: de categorie staat direct in de lijst (met een spinner) en wordt op
      // de achtergrond opgeslagen. Mutations ververst de lijst en meldt de uitkomst.
      _removeModal();
      if (isEdit) Mutations.updateCategory(existing, { name, color, budgetId });
      else        Mutations.createCategory({ name, color, budgetId });
    });
  }

  // ─── Tab: Budgetten ─────────────────────────────────────────────────────────
  async function _renderBudgets(content) {
    content.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Laden…</span></div>';
    try {
      _budgetRows = Config.isConfigured ? await Api.getBudgets() : [];

      // Toekomstige versies (ingaand na de huidige maand) apart van wat nu geldt
      const currentYM = currentYearMonth();
      const currentMonth = currentYM.year + '-' + String(currentYM.month).padStart(2, '0');

      _futureBudgets = _budgetRows.filter(b => b.effective_from && String(b.effective_from) > currentMonth);

      // Eén regel per budget: de versie die nu geldt (de meest recente die al is ingegaan)
      const current = new Map();
      _budgetRows.filter(b => !b.effective_from || String(b.effective_from) <= currentMonth).forEach(b => {
        const parent = String(b.budget_id || b.id);
        const seen = current.get(parent);
        if (!seen || String(b.effective_from || '') > String(seen.effective_from || '')) current.set(parent, b);
      });
      _budgets = [...current.values()];
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
      return;
    }

    // Blijf op het tabblad waar je was, tenzij er geen toekomstige budgetten meer zijn
    if (_budgetSubTab === 'future' && _futureBudgets.length === 0) _budgetSubTab = 'current';
    _renderBudgetContent(content);
  }

  function _renderBudgetContent(content) {
    const hasFutureBudgets = _futureBudgets.length > 0;

    const subTabsHtml = hasFutureBudgets
      ? `<div class="sub-tab-bar">
           <button class="sub-tab-btn ${_budgetSubTab === 'current' ? 'active' : ''}" data-subtab="current">Huiswaarden</button>
           <button class="sub-tab-btn ${_budgetSubTab === 'future' ? 'active' : ''}" data-subtab="future">Toekomstige budgetten (${_futureBudgets.length})</button>
         </div>`
      : '';

    content.innerHTML = subTabsHtml + '<div id="budget-content"></div>';

    if (hasFutureBudgets) {
      content.querySelectorAll('.sub-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          _budgetSubTab = btn.dataset.subtab;
          content.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.subtab === _budgetSubTab));
          const budgetContent = content.querySelector('#budget-content');
          if (_budgetSubTab === 'current') {
            _renderBudgetList(budgetContent, _budgets, false);
          } else {
            _renderBudgetList(budgetContent, _futureBudgets, true);
          }
        });
      });
    }

    const budgetContent = content.querySelector('#budget-content');
    if (_budgetSubTab === 'current') {
      _renderBudgetList(budgetContent, _budgets, false);
    } else {
      _renderBudgetList(budgetContent, _futureBudgets, true);
    }
  }

  function _renderBudgetList(content, budgets, isFuture) {
    content.innerHTML = `
      <div id="budget-list">
        ${budgets.length === 0
          ? '<div class="empty-state"><div class="empty-state-title">' + (isFuture ? 'Geen toekomstige budgetten' : 'Geen budgetten') + '</div></div>'
          : budgets.map(b => `
              <div class="budget-list-row${b._pending ? ' pending' : ''}">
                <div style="flex: 1;">
                  <div class="budget-list-name">${escapeHtml(b.name)}</div>
                  ${isFuture && b.effective_from ? `<div class="budget-list-effective">Geldig vanaf ${_formatYearMonth(b.effective_from)}</div>` : ''}
                </div>
                <div class="budget-list-amount">${formatCurrency(b.default_amount)}</div>
                <div class="budget-list-actions">
                  ${b._pending
                    ? '<span class="btn-spinner dark" title="Bezig met opslaan…"></span>'
                    : `<button class="btn-icon" data-action="edit-bud" data-id="${escapeHtml(b.id)}" title="Bewerken">${_iconEdit()}</button>
                  <button class="btn-icon" data-action="del-bud"  data-id="${escapeHtml(b.id)}" title="Verwijderen" style="background:var(--color-danger-lt);color:var(--color-danger)">${_iconDelete()}</button>`}
                </div>
              </div>`).join('')}
      </div>
      ${!isFuture ? `<button class="btn btn-full" style="margin-top:4px" id="btn-add-bud">+ Budget toevoegen</button>` : ''}`;

    content.querySelectorAll('[data-action="edit-bud"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const b = budgets.find(x => x.id === btn.dataset.id);
        if (b && isFuture) { _openFutureBudgetModal(b); return; }
        if (b) {
          try {
            // Get current year-month for budget stats
            const ym = currentYearMonth();
            const monthStr = ym.year + '-' + String(ym.month).padStart(2, '0');
            const { from, to } = getMonthRange(ym.year, ym.month);

            // Get budget stats to get the full budget object with override info.
            // Een versierij heeft een eigen id; de statistieken staan onder het oorspronkelijke budget.
            const stats = await Api.getBudgetStats(from, to);
            const budgetStats = stats.find(s => s.budget_id === (b.budget_id || b.id));

            if (budgetStats) {
              BudgetOverrideForm.open(budgetStats, monthStr, budgetStats.has_override ? budgetStats.override_amount : null);
            } else {
              showToast('Budget stats niet gevonden', 'error');
            }
          } catch (err) {
            showToast('Fout: ' + err.message, 'error');
          }
        }
      });
    });

    content.querySelectorAll('[data-action="del-bud"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const b = budgets.find(x => x.id === btn.dataset.id);
        if (!b) return;

        // Toekomstige versie: alleen die ene versie verwijderen. Het budget zelf en de andere versies blijven.
        if (isFuture) {
          if (!confirm(`Toekomstig budget (vanaf ${_formatYearMonth(b.effective_from)}) verwijderen? Daarna geldt weer het bedrag van daarvoor.`)) return;
          Mutations.deleteBudgetVersion(b); // direct uit de lijst; wordt teruggezet als opslaan mislukt
          return;
        }

        // Het budget zelf (de regel kan een versie zijn: verwijder dan het oorspronkelijke budget)
        const parentId = b.budget_id || b.id;
        const hasFuture = _futureBudgets.some(f => String(f.budget_id) === String(parentId));
        if (!confirm('Budget verwijderen? Categorieën gekoppeld aan dit budget worden ontkoppeld.' +
                     (hasFuture ? ' Ook de toekomstige aanpassingen van dit budget worden verwijderd.' : ''))) return;
        const host = content.closest('#settings-content');
        _spinIconButton(btn);
        try {
          await Mutations.deleteBudget(parentId);
          showToast('Budget verwijderd', 'success');
        } catch (err) {
          showToast('Fout: ' + err.message, 'error');
          Api.cache.clear('getBudgets');
          Api.cache.clear('getCategories');
        }
        await _renderBudgets(host);
      });
    });

    const addBtn = content.querySelector('#btn-add-bud');
    if (addBtn) {
      addBtn.addEventListener('click', () => _openBudgetAddModal(content));
    }
  }

  // Een toekomstige budgetversie aanpassen: bedrag en/of de maand waarop het ingaat.
  function _openFutureBudgetModal(b) {
    const cur   = currentYearMonth();
    const first = nextMonth(cur.year, cur.month);            // vroegste toegestane maand: de volgende
    const minIdx = first.year * 12 + (first.month - 1);
    const [y0, m0] = String(b.effective_from).slice(0, 7).split('-').map(Number);
    let idx = y0 * 12 + (m0 - 1);
    const fmt = i => {
      const yy = Math.floor(i / 12), mm = i % 12;
      return { ym: yy + '-' + String(mm + 1).padStart(2, '0'), label: MONTHS_NL[mm] + ' ' + yy };
    };

    const modal = _injectModal(`
      <div class="modal-title">Toekomstig budget aanpassen</div>
      <div class="form-group">
        <label class="form-label">Budget</label>
        <div class="input" style="background:var(--bg-primary);cursor:default">${escapeHtml(b.name)}</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="fb-amount">Bedrag</label>
        <div class="input-prefix-wrap">
          <span class="input-prefix">€</span>
          <input id="fb-amount" class="input" type="number" step="0.01" min="0" value="${escapeHtml(b.default_amount)}" placeholder="0,00">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Geldig vanaf</label>
        <div class="future-month-picker" style="margin-bottom:0">
          <div class="month-picker-controls">
            <button class="btn-icon" id="fb-prev" type="button">‹</button>
            <div class="month-picker-display" id="fb-month"></div>
            <button class="btn-icon" id="fb-next" type="button">›</button>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-full" id="fb-save">Opslaan</button>
        <button class="btn btn-secondary btn-full" id="fb-cancel">Annuleren</button>
      </div>`);

    const show = () => {
      modal.querySelector('#fb-month').textContent = fmt(idx).label;
      modal.querySelector('#fb-prev').disabled = idx <= minIdx;   // niet naar het verleden of de huidige maand
    };
    show();

    modal.querySelector('#fb-prev').addEventListener('click', () => { if (idx > minIdx) { idx--; show(); } });
    modal.querySelector('#fb-next').addEventListener('click', () => { idx++; show(); });
    modal.querySelector('#fb-cancel').addEventListener('click', () => _removeModal());

    modal.querySelector('#fb-save').addEventListener('click', () => {
      const amount = parseFloat(modal.querySelector('#fb-amount').value);
      if (isNaN(amount) || amount < 0) { showToast('Voer een geldig bedrag in.', 'error'); return; }
      const month = fmt(idx).ym;

      // Er kan maar één versie per maand zijn
      const clash = _budgetRows.some(r => r.id !== b.id &&
        String(r.budget_id || r.id) === String(b.budget_id) && String(r.effective_from) === month);
      if (clash) { showToast('Er bestaat al een versie van dit budget voor die maand.', 'error'); return; }

      _removeModal();
      if (amount === parseFloat(b.default_amount) && month === String(b.effective_from)) return; // niets veranderd
      // Direct zichtbaar in lijst en overzichten; opslaan gebeurt op de achtergrond
      Mutations.updateBudgetVersion(b, { amount, month });
    });
  }

  function _openBudgetAddModal(content) {
    const modal = _injectModal(`
      <div class="modal-title">Budget toevoegen</div>
      <div class="form-group">
        <label class="form-label" for="bm-name">Naam</label>
        <input id="bm-name" class="input" type="text" placeholder="Budget naam">
      </div>
      <div class="form-group">
        <label class="form-label" for="bm-amount">Standaard maandbedrag</label>
        <div class="input-prefix-wrap">
          <span class="input-prefix">€</span>
          <input id="bm-amount" class="input" type="number" step="0.01" min="0"
            value="0" placeholder="0,00">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-full" id="bm-save">Toevoegen</button>
        <button class="btn btn-secondary btn-full" id="bm-cancel">Annuleren</button>
      </div>`);

    modal.querySelector('#bm-cancel').addEventListener('click', () => _removeModal());

    modal.querySelector('#bm-save').addEventListener('click', () => {
      const name          = modal.querySelector('#bm-name').value.trim();
      const defaultAmount = parseFloat(modal.querySelector('#bm-amount').value) || 0;
      if (!name) { showToast('Voer een naam in.', 'error'); return; }

      // Venster meteen sluiten: het budget staat direct in de lijst (met een spinner) en wordt op de
      // achtergrond opgeslagen. Mutations ververst de lijst en meldt de uitkomst.
      _removeModal();
      Mutations.createBudget({ name, defaultAmount });
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
        <h3>Gegevens</h3>
        <p class="settings-info" style="margin-bottom:12px">De app onthoudt gegevens op dit apparaat zodat schermen snel openen. Zie je iets dat niet klopt, of heb je iets in de Google Sheet zelf aangepast? Vernieuw dan hier alles.</p>
        <button class="btn btn-secondary btn-full" id="app-refresh">Gegevens vernieuwen</button>
      </div>

      <div class="card settings-app-section">
        <h3>Features</h3>
        <p class="settings-info" style="margin-bottom:12px">Zet extra functies aan of uit. Wijzigingen worden direct toegepast.</p>
        <div class="feature-toggle-row">
          <div class="feature-toggle-info">
            <div class="feature-toggle-name">Sparen</div>
            <div class="feature-toggle-desc">Spaardoelen bijhouden</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="ft-savings" ${Features.get('savings') ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="feature-toggle-row">
          <div class="feature-toggle-info">
            <div class="feature-toggle-name">CSV Import</div>
            <div class="feature-toggle-desc">Transacties importeren via CSV</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="ft-import" ${Features.get('import') ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="feature-toggle-row">
          <div class="feature-toggle-info">
            <div class="feature-toggle-name">Zonnescherm</div>
            <div class="feature-toggle-desc">Zonnescherm bedienen via Tuya</div>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="ft-sunscreen" ${Features.get('sunscreen') ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
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
      const changed = url !== Config.scriptUrl || key !== Config.apiKey;
      Config.scriptUrl = url;
      Config.apiKey    = key;
      if (changed) Api.clearCache(); // gegevens uit een andere sheet horen hier niet meer te staan
      showToast('Instellingen opgeslagen', 'success');
    });

    content.querySelector('#app-refresh').addEventListener('click', () => {
      Api.clearCache();
      showToast('Gegevens worden opnieuw geladen', 'success');
    });

    content.querySelector('#app-test').addEventListener('click', async () => {
      const statusEl = content.querySelector('#app-status');
      const btn      = content.querySelector('#app-test');
      btn.disabled   = true;
      btn.textContent = 'Testen…';
      statusEl.innerHTML = '';
      try {
        await Api.getCategories({ force: true }); // echt de server vragen, niet de cache
        statusEl.innerHTML = '<div class="connection-status ok">✓ Verbinding gelukt!</div>';
      } catch (err) {
        statusEl.innerHTML = `<div class="connection-status error">✗ ${escapeHtml(err.message)}</div>`;
      }
      btn.disabled    = false;
      btn.textContent = 'Test verbinding';
    });

    ['savings', 'import', 'sunscreen'].forEach(name => {
      content.querySelector(`#ft-${name}`).addEventListener('change', e => {
        Features.set(name, e.target.checked);
        showToast(e.target.checked ? 'Feature ingeschakeld' : 'Feature uitgeschakeld', 'success');
      });
    });
  }

  // Vervangt het icoon van een kleine icoonknop door een spinner (tijdens het wachten op de server)
  function _spinIconButton(btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner dark" style="margin:0"></span>';
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

  function _formatYearMonth(yyyymm) {
    const parts = String(yyyymm).split('-');
    if (parts.length < 2) return yyyymm;
    const idx = parseInt(parts[1], 10) - 1;
    return MONTHS_NL[idx] + ' ' + parts[0];
  }

  return { render };
})();
