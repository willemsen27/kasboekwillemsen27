// js/budget-override-form.js — Budget override modal

const BudgetOverrideForm = (() => {
  const MODAL_ID = 'modal-budget-override';

  /**
   * @param {object} budget      - budget stats object from getBudgetStats
   * @param {string} month       - YYYY-MM string
   * @param {number|null} currentAmount - existing override amount, or null
   */
  function open(budget, month, currentAmount) {
    const overlay = document.getElementById(MODAL_ID);
    const modal   = overlay.querySelector('.modal');

    const hasOverride = currentAmount !== null && currentAmount !== undefined;
    const displayMonth = _formatMonth(month);

    modal.innerHTML = `
      <div class="modal-title">Budget overschrijven</div>

      <div class="form-group">
        <label class="form-label">Budget</label>
        <div class="input" style="background:var(--bg-primary);cursor:default">${escapeHtml(budget.budget_name)}</div>
      </div>

      <div class="form-group">
        <label class="form-label">Standaard bedrag</label>
        <div class="input" style="background:var(--bg-primary);cursor:default">${formatCurrency(budget.default_amount)}</div>
      </div>

      <div class="form-group">
        <label class="form-label">Maand</label>
        <div class="input" style="background:var(--bg-primary);cursor:default">${escapeHtml(displayMonth)}</div>
      </div>

      <div class="form-group">
        <label class="form-label" for="bof-amount">Overschrijving bedrag</label>
        <div class="input-prefix-wrap">
          <span class="input-prefix">€</span>
          <input id="bof-amount" class="input" type="number" step="0.01" min="0"
            placeholder="${budget.default_amount}"
            value="${hasOverride ? currentAmount : ''}">
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-full" id="bof-save">Opslaan</button>
        ${hasOverride ? `<button class="btn btn-danger btn-full" id="bof-delete">Verwijder overschrijving</button>` : ''}
        <button class="btn btn-secondary btn-full" id="bof-cancel">Annuleren</button>
      </div>`;

    overlay.classList.remove('hidden');

    modal.querySelector('#bof-cancel').addEventListener('click', () => _close());

    modal.querySelector('#bof-save').addEventListener('click', async () => {
      const raw = parseFloat(modal.querySelector('#bof-amount').value);
      if (isNaN(raw) || raw < 0) { showToast('Voer een geldig bedrag in.', 'error'); return; }
      const btn = modal.querySelector('#bof-save');
      btn.disabled = true; btn.textContent = 'Bezig…';
      try {
        await Api.setBudgetOverride(budget.budget_id, month, raw);
        showToast('Budget overschrijving opgeslagen', 'success');
        _close();
        Budgets.render();
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Opslaan';
      }
    });

    if (hasOverride) {
      modal.querySelector('#bof-delete').addEventListener('click', async () => {
        if (!confirm('Overschrijving verwijderen? Het standaard budgetbedrag wordt dan weer gebruikt.')) return;
        const btn = modal.querySelector('#bof-delete');
        btn.disabled = true; btn.textContent = 'Bezig…';
        try {
          await Api.deleteBudgetOverride(budget.budget_id, month);
          showToast('Overschrijving verwijderd', 'success');
          _close();
          Budgets.render();
        } catch (err) {
          showToast('Fout: ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Verwijder overschrijving';
        }
      });
    }

    overlay.addEventListener('click', e => {
      if (e.target === overlay) _close();
    }, { once: true });
  }

  function _close() {
    document.getElementById(MODAL_ID).classList.add('hidden');
  }

  function _formatMonth(yyyymm) {
    const parts = String(yyyymm).split('-');
    if (parts.length < 2) return yyyymm;
    const idx = parseInt(parts[1], 10) - 1;
    return MONTHS_NL[idx] + ' ' + parts[0];
  }

  return { open };
})();
