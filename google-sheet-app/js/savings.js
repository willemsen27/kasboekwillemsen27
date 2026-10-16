// js/savings.js — Savings goals view

const Savings = (() => {
  let _goals = [];
  let _jobs  = [];

  // ── Public ──────────────────────────────────────────────────────────────────
  async function render() {
    const el = document.getElementById('view-savings');
    el.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Laden…</span></div>';

    if (!Config.isConfigured) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">⚙️</div>
        <div class="empty-state-title">Nog niet ingesteld</div>
        <button class="btn btn-secondary" onclick="Router.navigate('settings')">Naar instellingen</button>
      </div>`;
      return;
    }

    try {
      [_goals, _jobs] = await Promise.all([
        Api.getSavingsGoals(),
        Api.getSavingsJobs().catch(() => [])
      ]);
      _renderAll(el);
    } catch (err) {
      el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Fout</div>
        <div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
    }
  }

  function _renderAll(el) {
    const pendingJobs = _jobs.filter(j => j.status === 'pending');

    let html = `
      <div class="page-header" style="padding-top:16px;">
        <div class="page-title">Spaardoelen</div>
        <button class="btn btn-sm" id="sav-add-btn">+ Nieuw doel</button>
      </div>`;

    if (pendingJobs.length > 0) {
      html += _buildJobsSection(pendingJobs);
    }

    if (_goals.length === 0) {
      html += `<div class="empty-state">
        <div class="empty-state-icon">🐷</div>
        <div class="empty-state-title">Geen spaardoelen</div>
        <div class="empty-state-text">Voeg je eerste spaardoel toe om te beginnen.</div>
      </div>`;
    } else {
      html += _goals.map(g => _buildGoalCard(g)).join('');
    }

    el.innerHTML = html;

    el.querySelector('#sav-add-btn').addEventListener('click', () => _openGoalForm(null));

    el.querySelectorAll('.savings-card[data-goal-id]').forEach(card => {
      card.addEventListener('click', () => {
        const goal = _goals.find(g => g.id === card.dataset.goalId);
        if (goal) _openGoalDetail(goal);
      });
    });

    el.querySelectorAll('[data-action="exec-job"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        await _executeJob(btn.dataset.jobId, btn);
      });
    });

    el.querySelectorAll('[data-action="skip-job"]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        await _skipJob(btn.dataset.jobId, btn);
      });
    });
  }

  // ── Jobs section ────────────────────────────────────────────────────────────
  function _buildJobsSection(jobs) {
    const rows = jobs.map(j => `
      <div class="savings-job-row" data-job-id="${escapeHtml(j.id)}">
        <div class="savings-job-info">
          <div class="savings-job-name">${escapeHtml(j.goal_name)}</div>
          <div class="savings-job-meta">${formatCurrency(j.amount)} · ${formatDate(j.scheduled_date)}</div>
        </div>
        <div class="savings-job-actions">
          <button class="btn btn-sm" data-action="exec-job" data-job-id="${escapeHtml(j.id)}">Uitvoeren</button>
          <button class="btn btn-sm btn-ghost" data-action="skip-job" data-job-id="${escapeHtml(j.id)}">Overslaan</button>
        </div>
      </div>`).join('');

    return `
      <div class="card savings-jobs-card">
        <div class="card-title">Openstaande stortingen</div>
        ${rows}
      </div>`;
  }

  async function _executeJob(jobId, btn) {
    btn.disabled = true;
    try {
      await Api.executeSavingsJob(jobId);
      showToast('Storting uitgevoerd!');
      await render();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
    }
  }

  async function _skipJob(jobId, btn) {
    btn.disabled = true;
    try {
      await Api.skipSavingsJob(jobId);
      showToast('Storting overgeslagen.');
      await render();
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
    }
  }

  // ── Goal cards ───────────────────────────────────────────────────────────────
  function _buildGoalCard(g) {
    const pct = g.target_amount > 0
      ? Math.min(100, Math.round((g.current_balance / g.target_amount) * 100))
      : null;

    const barColor = pct === null ? 'var(--color-primary)'
      : pct >= 100 ? 'var(--color-success)'
      : pct >= 60  ? 'var(--color-primary)'
      : 'var(--color-warning)';

    const progressHtml = pct !== null ? `
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width:${pct}%;background:${barColor}"></div>
      </div>
      <div class="savings-card-progress-label">${pct}% · nog ${formatCurrency(Math.max(0, g.target_amount - g.current_balance))} te gaan</div>
    ` : '';

    const targetBadge = g.target_date
      ? `<span class="savings-card-badge">${formatDate(g.target_date)}</span>`
      : '';

    const activeRules = (g.rules || []).filter(r => r.active);
    const rulesHtml = activeRules.length > 0
      ? `<div class="savings-card-rules">${activeRules.map(r => _ruleLabel(r)).join(' · ')}</div>`
      : '';

    return `
      <div class="savings-card" data-goal-id="${escapeHtml(g.id)}">
        <div class="savings-card-header">
          <div class="savings-card-name">${escapeHtml(g.name)}</div>
          ${targetBadge}
        </div>
        <div class="savings-card-balance">${formatCurrency(g.current_balance)}</div>
        ${progressHtml}
        ${rulesHtml}
      </div>`;
  }

  function _ruleLabel(r) {
    if (r.type === 'monthly')    return `€\u00a0${r.amount}/mnd`;
    if (r.type === 'percentage') return `${r.percentage}% van ${_sourceLabel(r.source)}`;
    if (r.type === 'onetime')    return `Eenmalig\u00a0€\u00a0${r.amount}`;
    return '';
  }

  function _sourceLabel(s) {
    const MAP = {
      vakantiegeld:      'vakantiegeld',
      belastingaangifte: 'belastingaangifte',
      bonus:             'bonus',
      '13e_maand':       '13e maand'
    };
    return MAP[s] || s || '?';
  }

  // ── Goal detail modal ────────────────────────────────────────────────────────
  function _openGoalDetail(goal) {
    const modal = document.getElementById('modal-savings');
    const inner = modal.querySelector('.modal');

    const sortedRules = [
      ...(goal.rules || []).filter(r => r.active),
      ...(goal.rules || []).filter(r => !r.active)
    ];

    const rulesHtml = sortedRules.length === 0
      ? `<div class="savings-empty-rules">Nog geen afspraken ingesteld.</div>`
      : sortedRules.map(r => `
          <div class="savings-rule-row ${r.active ? '' : 'savings-rule-row--inactive'}">
            <div class="savings-rule-text">
              ${_ruleFullLabel(r)}
              ${!r.active ? '<span class="savings-rule-inactive-badge">gestopt</span>' : ''}
            </div>
            <div class="savings-rule-actions">
              <button class="btn-icon" data-action="edit-rule" data-rule-id="${escapeHtml(r.id)}" title="Bewerken">${_iconEdit()}</button>
              <button class="btn-icon" data-action="delete-rule" data-rule-id="${escapeHtml(r.id)}" title="Verwijderen">${_iconTrash()}</button>
            </div>
          </div>`).join('');

    const pct = goal.target_amount > 0
      ? Math.min(100, Math.round((goal.current_balance / goal.target_amount) * 100))
      : null;

    const progressHtml = pct !== null ? `
      <div class="progress-bar-track" style="margin:12px 0 4px;">
        <div class="progress-bar-fill" style="width:${pct}%;background:${pct >= 100 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-primary)' : 'var(--color-warning)'}"></div>
      </div>
      <div class="savings-detail-target">${pct}% · nog ${formatCurrency(Math.max(0, goal.target_amount - goal.current_balance))} te gaan${goal.target_date ? ' · ' + formatDate(goal.target_date) : ''}</div>
    ` : goal.target_amount ? `<div class="savings-detail-target">Doel: ${formatCurrency(goal.target_amount)}${goal.target_date ? ' · ' + formatDate(goal.target_date) : ''}</div>` : '';

    inner.innerHTML = `
      <div class="modal-title">${escapeHtml(goal.name)}</div>

      <div class="savings-detail-balance">
        <div class="savings-detail-balance-label">Huidig saldo</div>
        <div class="savings-detail-balance-amount">${formatCurrency(goal.current_balance)}</div>
        ${progressHtml}
      </div>

      ${goal.notes ? `<div class="savings-detail-notes">${escapeHtml(goal.notes)}</div>` : ''}

      <div class="savings-section-title">Afspraken</div>
      <div id="sav-rules-list">${rulesHtml}</div>
      <button class="btn btn-secondary btn-sm btn-full" id="sav-add-rule-btn" style="margin-top:8px;">+ Afspraak toevoegen</button>

      <div class="modal-actions">
        <button class="btn btn-full" id="sav-contribute-btn">💰 Handmatig aanvullen</button>
        <button class="btn btn-secondary btn-full" id="sav-edit-goal-btn">Doel bewerken</button>
        <button class="btn btn-danger btn-full" id="sav-delete-goal-btn">Doel verwijderen</button>
        <button class="btn btn-ghost btn-full" id="sav-close-btn">Sluiten</button>
      </div>`;

    modal.classList.remove('hidden');

    inner.querySelector('#sav-close-btn').addEventListener('click', _closeModal);
    inner.querySelector('#sav-contribute-btn').addEventListener('click', () => _openContributionForm(goal));
    inner.querySelector('#sav-edit-goal-btn').addEventListener('click', () => _openGoalForm(goal));
    inner.querySelector('#sav-add-rule-btn').addEventListener('click', () => _openRuleForm(goal.id, null, goal));
    inner.querySelector('#sav-delete-goal-btn').addEventListener('click', () => _confirmDeleteGoal(goal));

    inner.querySelectorAll('[data-action="edit-rule"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const rule = (goal.rules || []).find(r => r.id === btn.dataset.ruleId);
        if (rule) _openRuleForm(goal.id, rule, goal);
      });
    });

    inner.querySelectorAll('[data-action="delete-rule"]').forEach(btn => {
      btn.addEventListener('click', () => _confirmDeleteRule(btn.dataset.ruleId, goal));
    });

    modal.addEventListener('click', e => { if (e.target === modal) _closeModal(); }, { once: true });
  }

  function _ruleFullLabel(r) {
    const notesSuffix = r.notes ? ` · ${escapeHtml(r.notes)}` : '';
    if (r.type === 'monthly')    return `${formatCurrency(r.amount)} per maand op dag ${r.day_of_month || 25}${notesSuffix}`;
    if (r.type === 'percentage') return `${r.percentage}% van ${_sourceLabel(r.source)}${notesSuffix}`;
    if (r.type === 'onetime')    return `Eenmalige storting van ${formatCurrency(r.amount)}${notesSuffix}`;
    return '';
  }

  // ── Goal form (create / edit) ────────────────────────────────────────────────
  function _openGoalForm(goal) {
    const modal = document.getElementById('modal-savings');
    const inner = modal.querySelector('.modal');
    const isNew = !goal;

    inner.innerHTML = `
      <div class="modal-title">${isNew ? 'Nieuw spaardoel' : 'Doel bewerken'}</div>
      <div class="form-group">
        <label class="form-label">Naam</label>
        <input id="sav-f-name" class="input" type="text" placeholder="bijv. Vakantie" value="${escapeHtml(goal?.name || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Huidig saldo</label>
        <div class="input-prefix-wrap"><span class="input-prefix">€</span>
          <input id="sav-f-balance" class="input" type="number" step="0.01" min="0" placeholder="0,00" value="${goal?.current_balance ?? ''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Streefbedrag (optioneel)</label>
        <div class="input-prefix-wrap"><span class="input-prefix">€</span>
          <input id="sav-f-target" class="input" type="number" step="0.01" min="0" placeholder="0,00" value="${goal?.target_amount ?? ''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Streefdatum (optioneel)</label>
        <input id="sav-f-date" class="input" type="date" value="${goal?.target_date || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Notities / afspraken</label>
        <textarea id="sav-f-notes" class="textarea" placeholder="Omschrijving of algemene afspraken…">${escapeHtml(goal?.notes || '')}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-full" id="sav-f-save">Opslaan</button>
        <button class="btn btn-ghost btn-full" id="sav-f-cancel">Annuleren</button>
      </div>`;

    modal.classList.remove('hidden');

    inner.querySelector('#sav-f-cancel').addEventListener('click', () => {
      if (goal) _openGoalDetail(goal);
      else _closeModal();
    });

    inner.querySelector('#sav-f-save').addEventListener('click', async () => {
      const name    = inner.querySelector('#sav-f-name').value.trim();
      const balance = parseFloat(inner.querySelector('#sav-f-balance').value) || 0;
      const target  = inner.querySelector('#sav-f-target').value;
      const date    = inner.querySelector('#sav-f-date').value;
      const notes   = inner.querySelector('#sav-f-notes').value.trim();

      if (!name) { showToast('Vul een naam in.', 'error'); return; }

      const saveBtn = inner.querySelector('#sav-f-save');
      saveBtn.disabled = true;

      try {
        if (isNew) {
          await Api.createSavingsGoal({
            name,
            currentBalance: balance,
            targetAmount:   target ? parseFloat(target) : null,
            targetDate:     date   || null,
            notes:          notes  || null
          });
          showToast('Spaardoel aangemaakt!');
        } else {
          await Api.updateSavingsGoal(goal.id, {
            name,
            currentBalance: balance,
            targetAmount:   target ? parseFloat(target) : null,
            targetDate:     date   || null,
            notes:          notes  || null,
            active:         goal.active
          });
          showToast('Spaardoel bijgewerkt!');
        }
        _closeModal();
        await render();
      } catch (err) {
        showToast(err.message, 'error');
        saveBtn.disabled = false;
      }
    });

    modal.addEventListener('click', e => { if (e.target === modal) _closeModal(); }, { once: true });
  }

  // ── Rule form ────────────────────────────────────────────────────────────────
  function _openRuleForm(goalId, rule, parentGoal) {
    const modal = document.getElementById('modal-savings');
    const inner = modal.querySelector('.modal');
    const isNew = !rule;

    inner.innerHTML = `
      <div class="modal-title">${isNew ? 'Afspraak toevoegen' : 'Afspraak bewerken'}</div>
      <div class="form-group">
        <label class="form-label">Type</label>
        <select id="sav-r-type" class="select">
          <option value="monthly"    ${rule?.type === 'monthly'    ? 'selected' : ''}>Maandelijks vast bedrag</option>
          <option value="percentage" ${rule?.type === 'percentage' ? 'selected' : ''}>Percentage van bron</option>
          <option value="onetime"    ${rule?.type === 'onetime'    ? 'selected' : ''}>Eenmalig</option>
        </select>
      </div>
      <div id="sav-r-fields"></div>
      <div class="modal-actions">
        <button class="btn btn-full" id="sav-r-save">Opslaan</button>
        ${!isNew ? `<button class="btn btn-secondary btn-full" id="sav-r-toggle">${rule?.active ? 'Stoppen' : 'Hervatten'}</button>` : ''}
        <button class="btn btn-ghost btn-full" id="sav-r-cancel">Annuleren</button>
      </div>`;

    modal.classList.remove('hidden');

    function _renderFields() {
      const t      = inner.querySelector('#sav-r-type').value;
      const fields = inner.querySelector('#sav-r-fields');
      if (t === 'monthly') {
        fields.innerHTML = `
          <div class="form-group">
            <label class="form-label">Bedrag per maand</label>
            <div class="input-prefix-wrap"><span class="input-prefix">€</span>
              <input id="sav-r-amount" class="input" type="number" step="0.01" min="0" placeholder="0,00" value="${rule?.type === 'monthly' ? (rule?.amount ?? '') : ''}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Dag van de maand</label>
            <input id="sav-r-day" class="input" type="number" min="1" max="28" placeholder="bijv. 25" value="${rule?.type === 'monthly' ? (rule?.day_of_month ?? 25) : 25}">
          </div>
          <div class="form-group">
            <label class="form-label">Notitie (optioneel)</label>
            <input id="sav-r-notes" class="input" type="text" value="${escapeHtml(rule?.notes || '')}">
          </div>`;
      } else if (t === 'percentage') {
        fields.innerHTML = `
          <div class="form-group">
            <label class="form-label">Percentage</label>
            <div class="input-prefix-wrap"><span class="input-prefix">%</span>
              <input id="sav-r-pct" class="input" type="number" step="1" min="1" max="100" placeholder="bijv. 20" value="${rule?.type === 'percentage' ? (rule?.percentage ?? '') : ''}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Bron</label>
            <select id="sav-r-source" class="select">
              <option value="vakantiegeld" ${rule?.source === 'vakantiegeld' ? 'selected' : ''}>Vakantiegeld</option>
              <option value="overig"       ${rule?.source === 'overig' || rule?.source === 'belastingaangifte' || rule?.source === 'bonus' || rule?.source === '13e_maand' ? 'selected' : ''}>Overig (bijv. bonus of 13e maand)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Notitie (optioneel)</label>
            <input id="sav-r-notes" class="input" type="text" value="${escapeHtml(rule?.notes || '')}">
          </div>`;
      } else {
        fields.innerHTML = `
          <div class="form-group">
            <label class="form-label">Bedrag</label>
            <div class="input-prefix-wrap"><span class="input-prefix">€</span>
              <input id="sav-r-amount" class="input" type="number" step="0.01" min="0" placeholder="0,00" value="${rule?.type === 'onetime' ? (rule?.amount ?? '') : ''}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Notitie (optioneel)</label>
            <input id="sav-r-notes" class="input" type="text" value="${escapeHtml(rule?.notes || '')}">
          </div>`;
      }
    }

    _renderFields();
    inner.querySelector('#sav-r-type').addEventListener('change', _renderFields);

    inner.querySelector('#sav-r-cancel').addEventListener('click', () => {
      if (parentGoal) _openGoalDetail(parentGoal);
      else _closeModal();
    });

    if (!isNew) {
      inner.querySelector('#sav-r-toggle').addEventListener('click', async () => {
        try {
          await Api.updateSavingsRule(rule.id, { ...rule, active: !rule.active });
          showToast(rule.active ? 'Afspraak gestopt.' : 'Afspraak hervat.');
          _closeModal();
          await render();
        } catch (err) { showToast(err.message, 'error'); }
      });
    }

    inner.querySelector('#sav-r-save').addEventListener('click', async () => {
      const t     = inner.querySelector('#sav-r-type').value;
      const notes = (inner.querySelector('#sav-r-notes')?.value || '').trim();
      let payload = { goalId, type: t, notes: notes || null, active: rule?.active ?? true };

      if (t === 'monthly') {
        const amount = parseFloat(inner.querySelector('#sav-r-amount')?.value);
        const day    = parseInt(inner.querySelector('#sav-r-day')?.value, 10) || 25;
        if (!amount || amount <= 0) { showToast('Vul een geldig bedrag in.', 'error'); return; }
        payload = { ...payload, amount, dayOfMonth: day };
      } else if (t === 'percentage') {
        const pct    = parseFloat(inner.querySelector('#sav-r-pct')?.value);
        const source = inner.querySelector('#sav-r-source')?.value;
        if (!pct || pct <= 0) { showToast('Vul een geldig percentage in.', 'error'); return; }
        payload = { ...payload, percentage: pct, source };
      } else {
        const amount = parseFloat(inner.querySelector('#sav-r-amount')?.value);
        if (!amount || amount <= 0) { showToast('Vul een geldig bedrag in.', 'error'); return; }
        payload = { ...payload, amount };
      }

      const saveBtn = inner.querySelector('#sav-r-save');
      saveBtn.disabled = true;
      try {
        if (isNew) {
          await Api.createSavingsRule(payload);
          showToast('Afspraak toegevoegd!');
        } else {
          await Api.updateSavingsRule(rule.id, payload);
          showToast('Afspraak bijgewerkt!');
        }
        _closeModal();
        await render();
      } catch (err) {
        showToast(err.message, 'error');
        saveBtn.disabled = false;
      }
    });

    modal.addEventListener('click', e => { if (e.target === modal) _closeModal(); }, { once: true });
  }

  // ── Manual contribution form ─────────────────────────────────────────────────
  function _openContributionForm(goal) {
    const modal = document.getElementById('modal-savings');
    const inner = modal.querySelector('.modal');

    inner.innerHTML = `
      <div class="modal-title">Handmatig aanvullen</div>
      <div class="savings-detail-balance" style="margin-bottom:20px;">
        <div class="savings-detail-balance-label">${escapeHtml(goal.name)}</div>
        <div class="savings-detail-balance-amount">${formatCurrency(goal.current_balance)}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Bedrag</label>
        <div class="input-prefix-wrap"><span class="input-prefix">€</span>
          <input id="sav-c-amount" class="input" type="number" step="0.01" min="0" placeholder="0,00">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Datum</label>
        <input id="sav-c-date" class="input" type="date" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label">Notitie (optioneel)</label>
        <input id="sav-c-notes" class="input" type="text" placeholder="bijv. extra storting">
      </div>
      <div class="modal-actions">
        <button class="btn btn-full" id="sav-c-save">Aanvullen</button>
        <button class="btn btn-ghost btn-full" id="sav-c-cancel">Annuleren</button>
      </div>`;

    modal.classList.remove('hidden');

    inner.querySelector('#sav-c-cancel').addEventListener('click', () => _openGoalDetail(goal));

    inner.querySelector('#sav-c-save').addEventListener('click', async () => {
      const amount = parseFloat(inner.querySelector('#sav-c-amount').value);
      const date   = inner.querySelector('#sav-c-date').value;
      const notes  = inner.querySelector('#sav-c-notes').value.trim();

      if (!amount || amount <= 0) { showToast('Vul een geldig bedrag in.', 'error'); return; }
      if (!date) { showToast('Vul een datum in.', 'error'); return; }

      const saveBtn = inner.querySelector('#sav-c-save');
      saveBtn.disabled = true;

      try {
        await Api.addManualContribution({ goalId: goal.id, amount, date, notes: notes || null });
        showToast('Aangevuld!');
        _closeModal();
        await render();
      } catch (err) {
        showToast(err.message, 'error');
        saveBtn.disabled = false;
      }
    });

    modal.addEventListener('click', e => { if (e.target === modal) _closeModal(); }, { once: true });
  }

  // ── Delete confirmations ─────────────────────────────────────────────────────
  function _confirmDeleteGoal(goal) {
    const modal = document.getElementById('modal-savings');
    const inner = modal.querySelector('.modal');
    inner.innerHTML = `
      <div class="modal-title">Doel verwijderen?</div>
      <p style="margin-bottom:20px;color:var(--color-text-muted);">Weet je zeker dat je <strong>${escapeHtml(goal.name)}</strong> wilt verwijderen? Dit kan niet ongedaan worden gemaakt.</p>
      <div class="modal-actions">
        <button class="btn btn-danger btn-full" id="sav-del-confirm">Ja, verwijderen</button>
        <button class="btn btn-ghost btn-full" id="sav-del-cancel">Annuleren</button>
      </div>`;
    inner.querySelector('#sav-del-cancel').addEventListener('click', () => _openGoalDetail(goal));
    inner.querySelector('#sav-del-confirm').addEventListener('click', async () => {
      try {
        await Api.deleteSavingsGoal(goal.id);
        showToast('Spaardoel verwijderd.');
        _closeModal();
        await render();
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  function _confirmDeleteRule(ruleId, parentGoal) {
    const modal = document.getElementById('modal-savings');
    const inner = modal.querySelector('.modal');
    inner.innerHTML = `
      <div class="modal-title">Afspraak verwijderen?</div>
      <p style="margin-bottom:20px;color:var(--color-text-muted);">Weet je zeker dat je deze afspraak wilt verwijderen?</p>
      <div class="modal-actions">
        <button class="btn btn-danger btn-full" id="sav-rul-confirm">Ja, verwijderen</button>
        <button class="btn btn-ghost btn-full" id="sav-rul-cancel">Annuleren</button>
      </div>`;
    inner.querySelector('#sav-rul-cancel').addEventListener('click', () => _openGoalDetail(parentGoal));
    inner.querySelector('#sav-rul-confirm').addEventListener('click', async () => {
      try {
        await Api.deleteSavingsRule(ruleId);
        showToast('Afspraak verwijderd.');
        _closeModal();
        await render();
      } catch (err) { showToast(err.message, 'error'); }
    });
  }

  function _closeModal() {
    document.getElementById('modal-savings').classList.add('hidden');
  }

  // ── Icons ────────────────────────────────────────────────────────────────────
  function _iconEdit() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
  }

  function _iconTrash() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
  }

  return { render };
})();
