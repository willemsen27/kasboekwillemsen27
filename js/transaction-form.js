// js/transaction-form.js — Add / Edit transaction modal

const TransactionForm = (() => {
  let _editingId  = null;
  let _type       = 'uitgave'; // 'uitgave' | 'ontvangen'
  let _categories = [];

  const MODAL_ID = 'modal-transaction';

  // ─── Public API ─────────────────────────────────────────────────────────────
  async function openNew() {
    _editingId = null;
    _type      = 'uitgave';
    await _open({
      date: todayISO(),
      amount: '',
      categoryId: '',
      description: ''
    });
  }

  async function openEdit(transaction) {
    _editingId = transaction.id;
    const isReceived = parseFloat(transaction.amount) < 0;
    _type = isReceived ? 'ontvangen' : 'uitgave';
    await _open({
      date:        String(transaction.date),
      amount:      String(Math.abs(parseFloat(transaction.amount) || 0)),
      categoryId:  String(transaction.category_id || ''),
      description: String(transaction.description || '')
    });
  }

  function close() {
    const overlay = document.getElementById(MODAL_ID);
    if (overlay) overlay.classList.add('hidden');
  }

  // ─── Private ────────────────────────────────────────────────────────────────
  async function _open(prefill) {
    const overlay = document.getElementById(MODAL_ID);
    const modal   = overlay.querySelector('.modal');
    modal.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
    overlay.classList.remove('hidden');

    try {
      _categories = await Api.getCategories();
      const budgets = await Api.getBudgets();
      _renderForm(modal, prefill, budgets);
    } catch (err) {
      modal.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
        <div class="empty-state-text">${escapeHtml(err.message)}</div>
        <button class="btn btn-secondary" onclick="TransactionForm.close()">Sluiten</button></div>`;
    }
  }

  function _renderForm(modal, prefill, budgets) {
    // Build category options grouped by budget
    const budgetMap = {};
    budgets.forEach(b => { budgetMap[b.id] = b.name; });

    // Sort categories by budget name then category name
    const sorted = [..._categories].sort((a, b) => {
      const ba = budgetMap[a.budget_id] || 'zzz';
      const bb = budgetMap[b.budget_id] || 'zzz';
      if (ba !== bb) return ba.localeCompare(bb, 'nl');
      return String(a.name).localeCompare(String(b.name), 'nl');
    });

    const catOptions = sorted.map(c => {
      const budgetName = c.budget_id && budgetMap[c.budget_id] ? ` — ${budgetMap[c.budget_id]}` : '';
      return `<option value="${escapeHtml(c.id)}" ${prefill.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}${escapeHtml(budgetName)}</option>`;
    }).join('');

    modal.innerHTML = `
      <div class="modal-title">${_editingId ? 'Transactie bewerken' : 'Transactie toevoegen'}</div>

      <div class="form-group">
        <label class="form-label">Type</label>
        <div class="type-toggle">
          <button type="button" class="type-toggle-btn" id="btn-uitgave">💸 Uitgave</button>
          <button type="button" class="type-toggle-btn" id="btn-ontvangen">💚 Ontvangen</button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="tf-date">Datum</label>
        <div class="date-input-wrap">
          <input id="tf-date" class="input" type="text" inputmode="numeric"
                 placeholder="dd-mm-yyyy" maxlength="10"
                 value="${escapeHtml(_isoToDisplay(prefill.date))}">
          <input id="tf-date-picker" type="date" class="date-hidden-picker" tabindex="-1">
          <button type="button" class="date-picker-btn" id="tf-date-cal" title="Kalender openen">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>
          </button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="tf-amount">Bedrag</label>
        <div class="input-prefix-wrap">
          <span class="input-prefix">€</span>
          <input id="tf-amount" class="input" type="number" step="0.01" min="0.01" placeholder="0,00" value="${escapeHtml(prefill.amount)}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="tf-category">Categorie</label>
        <select id="tf-category" class="select">
          <option value="">Kies een categorie…</option>
          ${catOptions}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="tf-desc">Omschrijving</label>
        <input id="tf-desc" class="input" type="text" placeholder="Optioneel" value="${escapeHtml(prefill.description)}">
      </div>

      <div class="modal-actions">
        <button class="btn btn-full" id="tf-submit">${_editingId ? 'Opslaan' : 'Toevoegen'}</button>
        <button class="btn btn-secondary btn-full" id="tf-cancel">Annuleren</button>
      </div>`;

    _setTypeUI(modal);

    // Auto-format datum naar dd-mm-yyyy tijdens typen (streepjes worden automatisch ingevoegd)
    modal.querySelector('#tf-date').addEventListener('input', e => {
      const raw = e.target.value.replace(/\D/g, '').slice(0, 8);
      let fmt = raw;
      if (raw.length >= 3) fmt = raw.slice(0, 2) + '-' + raw.slice(2);
      if (raw.length >= 5) fmt = raw.slice(0, 2) + '-' + raw.slice(2, 4) + '-' + raw.slice(4);
      e.target.value = fmt;
    });

    // Kalender-knop opent native datumkiezer; resultaat wordt gesynchroniseerd naar het tekstveld
    modal.querySelector('#tf-date-cal').addEventListener('click', () => {
      const picker = modal.querySelector('#tf-date-picker');
      const iso = _displayToIso(modal.querySelector('#tf-date').value.trim());
      if (iso) picker.value = iso;
      try { picker.showPicker(); } catch { picker.click(); }
    });
    modal.querySelector('#tf-date-picker').addEventListener('change', e => {
      if (e.target.value) modal.querySelector('#tf-date').value = _isoToDisplay(e.target.value);
    });

    modal.querySelector('#btn-uitgave').addEventListener('click',   () => { _type = 'uitgave';   _setTypeUI(modal); });
    modal.querySelector('#btn-ontvangen').addEventListener('click', () => { _type = 'ontvangen'; _setTypeUI(modal); });
    modal.querySelector('#tf-cancel').addEventListener('click',     () => close());

    // Close on overlay click
    document.getElementById(MODAL_ID).addEventListener('click', e => {
      if (e.target === document.getElementById(MODAL_ID)) close();
    });

    modal.querySelector('#tf-submit').addEventListener('click', () => _submit(modal));
  }

  function _setTypeUI(modal) {
    const btnU = modal.querySelector('#btn-uitgave');
    const btnO = modal.querySelector('#btn-ontvangen');
    btnU.className = 'type-toggle-btn' + (_type === 'uitgave'   ? ' active-uitgave'   : '');
    btnO.className = 'type-toggle-btn' + (_type === 'ontvangen' ? ' active-ontvangen' : '');
  }

  async function _submit(modal) {
    const dateDisplay = modal.querySelector('#tf-date').value.trim();
    const date        = _displayToIso(dateDisplay);
    const amountRaw   = parseFloat(modal.querySelector('#tf-amount').value);
    const categoryId  = modal.querySelector('#tf-category').value;
    const description = modal.querySelector('#tf-desc').value.trim();

    if (!date)              { showToast('Voer een geldige datum in (dd-mm-yyyy).', 'error'); return; }
    if (!(amountRaw > 0))   { showToast('Voer een bedrag in.',   'error'); return; }
    if (!categoryId)        { showToast('Kies een categorie.',   'error'); return; }

    const amount = _type === 'ontvangen' ? -amountRaw : amountRaw;

    const btn = modal.querySelector('#tf-submit');
    btn.disabled   = true;
    btn.textContent = 'Bezig…';

    try {
      if (_editingId) {
        await Api.updateTransaction(_editingId, { date, amount, categoryId, description });
        showToast('Transactie opgeslagen', 'success');
      } else {
        await Api.createTransaction({ date, amount, categoryId, description });
        showToast('Transactie toegevoegd', 'success');
      }
      close();
      // Refresh current view
      const cur = Router.getCurrent();
      if (cur === 'dashboard')    Dashboard.render();
      if (cur === 'transactions') Transactions.render();
    } catch (err) {
      showToast('Fout: ' + err.message, 'error');
      btn.disabled    = false;
      btn.textContent = _editingId ? 'Opslaan' : 'Toevoegen';
    }
  }

  // yyyy-mm-dd  →  dd-mm-yyyy  (voor weergave in het formulier)
  function _isoToDisplay(iso) {
    if (!iso || iso.length < 10) return '';
    return iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4);
  }

  // dd-mm-yyyy  →  yyyy-mm-dd  (voor de API)
  function _displayToIso(display) {
    if (!display) return '';
    const m = display.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) return '';
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  return { openNew, openEdit, close };
})();
