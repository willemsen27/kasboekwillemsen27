// js/budget-override-form.js — Budget versioning modal

const BudgetOverrideForm = (() => {
  const MODAL_ID = 'modal-budget-override';

  let _currentBudget = null;
  let _currentMonth = null;
  let _currentAmountValue = null;
  let _currentNameValue = null;
  let _selectedMode = 'current'; // 'current', 'permanent', 'future'
  let _selectedFutureMonth = null;

  /**
   * @param {object} budget      - budget stats object from getBudgetStats
   * @param {string} month       - YYYY-MM string (current month)
   * @param {number|null} currentAmount - existing override amount, or null
   */
  function open(budget, month, currentAmount) {
    const overlay = document.getElementById(MODAL_ID);
    const modal   = overlay.querySelector('.modal');

    _currentBudget = budget;
    _currentMonth = month;
    _currentAmountValue = currentAmount !== null && currentAmount !== undefined ? currentAmount : budget.default_amount;
    _currentNameValue = budget.budget_name;
    _selectedMode = 'current';
    _selectedFutureMonth = null;

    const displayMonth = _formatMonth(month);
    const [currentYear, currentMonthNum] = month.split('-');

    modal.innerHTML = `
      <div class="modal-title">Budget aanpassen</div>

      <div class="form-group">
        <label class="form-label">Budget</label>
        <div class="input" style="background:var(--bg-primary);cursor:default">${escapeHtml(_currentNameValue)}</div>
      </div>

      <div class="form-group">
        <label class="form-label">Standaard bedrag</label>
        <div class="input" style="background:var(--bg-primary);cursor:default">${formatCurrency(budget.default_amount)}</div>
      </div>

      <div class="form-group">
        <label class="form-label" for="bof-amount">Nieuw bedrag</label>
        <div class="input-prefix-wrap">
          <span class="input-prefix">€</span>
          <input id="bof-amount" class="input" type="number" step="0.01" min="0"
            placeholder="${budget.default_amount}"
            value="${_currentAmountValue}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Geldig vanaf</label>
        <div id="mode-selector" class="mode-selector">
          <label class="mode-option">
            <input type="radio" name="effective-mode" value="current" checked>
            <span>Alleen ${escapeHtml(displayMonth)}</span>
          </label>
          <label class="mode-option">
            <input type="radio" name="effective-mode" value="permanent">
            <span>Vanaf ${escapeHtml(displayMonth)} (permanent)</span>
          </label>
          <label class="mode-option">
            <input type="radio" name="effective-mode" value="future">
            <span>Ander moment…</span>
          </label>
        </div>
      </div>

      <div id="future-month-picker" class="future-month-picker" style="display:none;">
        <div class="month-picker-controls">
          <button class="btn-icon" id="prev-future-month">‹</button>
          <div class="month-picker-display" id="future-month-display"></div>
          <button class="btn-icon" id="next-future-month">›</button>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-full" id="bof-save">Opslaan</button>
        <button class="btn btn-secondary btn-full" id="bof-cancel">Annuleren</button>
      </div>`;

    overlay.classList.remove('hidden');

    // Bind UI events
    const amountInput = modal.querySelector('#bof-amount');
    const modeInputs = modal.querySelectorAll('input[name="effective-mode"]');
    const futureMonthPicker = modal.querySelector('#future-month-picker');
    const futureMonthDisplay = modal.querySelector('#future-month-display');
    const prevBtn = modal.querySelector('#prev-future-month');
    const nextBtn = modal.querySelector('#next-future-month');

    // Store amount when it changes
    amountInput.addEventListener('change', () => {
      const val = parseFloat(amountInput.value);
      if (!isNaN(val)) _currentAmountValue = val;
    });

    // Handle mode changes
    modeInputs.forEach(input => {
      input.addEventListener('change', (e) => {
        const oldAmount = _currentAmountValue;
        _selectedMode = e.target.value;

        if (_selectedMode === 'future' && !_selectedFutureMonth) {
          const nm = nextMonth(parseInt(currentYear), parseInt(currentMonthNum));
          _selectedFutureMonth = nm.year + '-' + String(nm.month).padStart(2, '0');
        }

        futureMonthPicker.style.display = _selectedMode === 'future' ? 'block' : 'none';

        if (_selectedMode === 'future' && _selectedFutureMonth) {
          _updateFutureMonthDisplay(futureMonthDisplay, _selectedFutureMonth);
        }

        // Restore amount value to input
        amountInput.value = oldAmount;
        _currentAmountValue = oldAmount;
      });
    });

    // Future month navigation
    prevBtn.addEventListener('click', () => {
      const parts = _selectedFutureMonth.split('-');
      const pm = prevMonth(parseInt(parts[0]), parseInt(parts[1]));
      const currentMonthStr = currentYear + '-' + String(currentMonthNum).padStart(2, '0');
      const currentMonthObj = { year: parseInt(currentYear), month: parseInt(currentMonthNum) };

      // Only allow months >= current month
      if (pm.year > currentMonthObj.year || (pm.year === currentMonthObj.year && pm.month >= currentMonthObj.month)) {
        _selectedFutureMonth = pm.year + '-' + String(pm.month).padStart(2, '0');
        _updateFutureMonthDisplay(futureMonthDisplay, _selectedFutureMonth);
      }
    });

    nextBtn.addEventListener('click', () => {
      const parts = _selectedFutureMonth.split('-');
      const nm = nextMonth(parseInt(parts[0]), parseInt(parts[1]));
      _selectedFutureMonth = nm.year + '-' + String(nm.month).padStart(2, '0');
      _updateFutureMonthDisplay(futureMonthDisplay, _selectedFutureMonth);
    });

    // Initialize future month display if needed
    if (_selectedMode === 'future' && _selectedFutureMonth) {
      _updateFutureMonthDisplay(futureMonthDisplay, _selectedFutureMonth);
    }

    modal.querySelector('#bof-cancel').addEventListener('click', () => _close());

    modal.querySelector('#bof-save').addEventListener('click', async () => {
      // Update amount from input
      const raw = parseFloat(amountInput.value);
      if (isNaN(raw) || raw < 0) {
        showToast('Voer een geldig bedrag in.', 'error');
        return;
      }

      _currentAmountValue = raw;

      const btn = modal.querySelector('#bof-save');
      btn.disabled = true;
      btn.textContent = 'Bezig…';

      try {
        if (_selectedMode === 'current') {
          // Only this month — use override
          await Api.setBudgetOverride(_currentBudget.budget_id, _currentMonth, _currentAmountValue);
          showToast('Budget voor deze maand ingesteld', 'success');
        } else if (_selectedMode === 'permanent') {
          // From this month onwards — use versioning
          await Api.setBudgetEffectiveFrom(_currentBudget.budget_id, _currentAmountValue, _currentMonth, _currentNameValue);
          showToast('Budget permanent aangepast', 'success');
        } else if (_selectedMode === 'future') {
          // Future date — use versioning
          await Api.setBudgetEffectiveFrom(_currentBudget.budget_id, _currentAmountValue, _selectedFutureMonth, _currentNameValue);
          showToast('Budget voor toekomstige maand ingesteld', 'success');
        }

        _close();
        Budgets.render();
      } catch (err) {
        showToast('Fout: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Opslaan';
      }
    });

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

  function _updateFutureMonthDisplay(el, yyyymm) {
    el.textContent = _formatMonth(yyyymm);
  }

  return { open };
})();
