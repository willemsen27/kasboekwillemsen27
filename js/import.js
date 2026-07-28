// js/import.js — Regiobank CSV import

const Import = (() => {
  let _rows        = [];  // parsed CSV rows
  let _categories  = [];
  let _onbekendId  = '';

  async function render() {
    const el = document.getElementById('view-import');
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
      _categories = await Api.getCategories();
      const onbekend = _categories.find(c => String(c.name).toLowerCase() === 'onbekend');
      _onbekendId = onbekend ? onbekend.id : (_categories[0]?.id || '');
    } catch (err) {
      _categories = [];
      _onbekendId = '';
    }

    _renderShell(el);
  }

  // ─── Shell ──────────────────────────────────────────────────────────────────
  function _renderShell(el) {
    el.innerHTML = `
      <div class="page-header" style="padding-top:16px;">
        <div class="page-title">CSV Import</div>
      </div>
      <div id="drop-zone" class="drop-zone">
        <div class="drop-zone-icon">📥</div>
        <div class="drop-zone-text">Sleep een CSV bestand hierheen</div>
        <div class="drop-zone-sub">of klik om een bestand te kiezen</div>
        <input type="file" id="file-input" accept=".csv,text/csv">
      </div>
      <div class="card" style="margin-bottom:12px">
        <div class="card-title">Regiobank CSV formaat</div>
        <div class="settings-info">
          Exporteer je transacties via <strong>Regiobank Online → Betaalrekening → Transacties → Exporteren → CSV</strong>.
          Het bestand heeft kolommen: Datum; Naam; Rekeningnummer; Tegenrekening; Code; Af Bij; Bedrag; Mutatiesoort; Mededelingen.
        </div>
      </div>
      <div id="import-preview"></div>`;

    const dropZone = el.querySelector('#drop-zone');
    const fileInput = el.querySelector('#file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) _handleFile(file, el);
    });

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) _handleFile(file, el);
    });
  }

  // ─── File handling ──────────────────────────────────────────────────────────
  function _handleFile(file, el) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        _rows = _parseRegiobank(e.target.result);
        _renderPreview(el);
      } catch (err) {
        showToast('Fout bij lezen: ' + err.message, 'error');
      }
    };
    reader.readAsText(file, 'UTF-8');
  }

  // ─── Regiobank CSV parser ───────────────────────────────────────────────────
  function _parseCSVLine(line) {
    const result = [];
    let current  = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ';' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  function _parseRegiobank(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('Bestand is leeg of ongeldig.');

    // Skip header row
    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = _parseCSVLine(lines[i]);
      if (cols.length < 7) continue;

      // Column 0: date DD-MM-YYYY → YYYY-MM-DD
      const rawDate = cols[0] || '';
      const dateParts = rawDate.split('-');
      let date = rawDate;
      if (dateParts.length === 3) {
        date = dateParts[2] + '-' + dateParts[1] + '-' + dateParts[0];
      }

      // Column 5: "Af" = expense (positive), "Bij" = received (negative)
      const afBij = (cols[5] || '').trim().toLowerCase();
      const isReceived = afBij === 'bij';

      // Column 6: amount — replace comma with dot
      const amountStr = (cols[6] || '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '');
      let amount = parseFloat(amountStr) || 0;
      if (isReceived) amount = -amount;

      // Column 1: name/description, optionally append column 8 (Mededelingen)
      let description = (cols[1] || '').trim();
      const mededelingen = cols[8] ? cols[8].trim() : '';
      if (mededelingen && mededelingen !== description) {
        description = description ? description + ' — ' + mededelingen : mededelingen;
      }

      parsed.push({
        date,
        amount,
        description,
        categoryId: _onbekendId,
        selected: true
      });
    }

    if (parsed.length === 0) throw new Error('Geen geldige transacties gevonden in het bestand.');
    return parsed;
  }

  // ─── Preview table ──────────────────────────────────────────────────────────
  function _renderPreview(el) {
    const preview = el.querySelector('#import-preview');
    const catOpts = _categories.map(c =>
      `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
    ).join('');

    const selectedCount = _rows.filter(r => r.selected).length;

    preview.innerHTML = `
      <div style="margin-bottom:12px" class="flex-between">
        <div class="import-count">${_rows.length} rijen gevonden</div>
        <button class="btn btn-sm btn-secondary" id="btn-select-all">Alles selecteren</button>
      </div>
      <div style="overflow-x:auto;margin-bottom:16px">
        <table class="import-preview-table">
          <thead>
            <tr>
              <th>✓</th>
              <th>Datum</th>
              <th>Omschrijving</th>
              <th>Bedrag</th>
              <th>Categorie</th>
            </tr>
          </thead>
          <tbody id="import-tbody">
            ${_rows.map((row, i) => _rowHtml(row, i, catOpts)).join('')}
          </tbody>
        </table>
      </div>
      <button class="btn btn-full" id="btn-import">
        Importeer ${selectedCount} transacties
      </button>
      <div id="import-progress" class="import-progress" style="display:none"></div>`;

    // Bind checkboxes
    preview.querySelector('#import-tbody').addEventListener('change', e => {
      if (e.target.type === 'checkbox') {
        const idx = parseInt(e.target.dataset.idx, 10);
        _rows[idx].selected = e.target.checked;
        _updateImportCount(preview);
      }
      if (e.target.tagName === 'SELECT') {
        const idx = parseInt(e.target.dataset.idx, 10);
        _rows[idx].categoryId = e.target.value;
      }
    });

    preview.querySelector('#btn-select-all').addEventListener('click', () => {
      _rows.forEach(r => r.selected = true);
      preview.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
      _updateImportCount(preview);
    });

    preview.querySelector('#btn-import').addEventListener('click', () => _doImport(preview));
  }

  function _rowHtml(row, i, catOpts) {
    const isReceived = parseFloat(row.amount) < 0;
    const catOptsSelected = catOpts.replace(
      `value="${escapeHtml(row.categoryId)}"`,
      `value="${escapeHtml(row.categoryId)}" selected`
    );
    return `
      <tr>
        <td><input type="checkbox" data-idx="${i}" ${row.selected ? 'checked' : ''}></td>
        <td style="white-space:nowrap">${formatDate(row.date)}</td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(row.description)}">${escapeHtml(row.description)}</td>
        <td class="${isReceived ? 'amount-received' : 'amount-positive'}" style="white-space:nowrap">
          ${isReceived ? '−\u00a0' : ''}${formatCurrency(row.amount)}
        </td>
        <td>
          <select class="select" data-idx="${i}" style="min-width:120px">${catOptsSelected}</select>
        </td>
      </tr>`;
  }

  function _updateImportCount(preview) {
    const count = _rows.filter(r => r.selected).length;
    const btn   = preview.querySelector('#btn-import');
    btn.textContent = `Importeer ${count} transacties`;
    btn.disabled    = count === 0;
  }

  // ─── Import ─────────────────────────────────────────────────────────────────
  async function _doImport(preview) {
    const selected  = _rows.filter(r => r.selected);
    if (selected.length === 0) { showToast('Geen rijen geselecteerd.', 'error'); return; }

    const btn      = preview.querySelector('#btn-import');
    const progress = preview.querySelector('#import-progress');
    btn.disabled   = true;
    progress.style.display = 'block';

    let done = 0, failed = 0;
    for (const row of selected) {
      progress.textContent = `${done}/${selected.length} geïmporteerd…`;
      try {
        await Api.createTransaction({
          date:        row.date,
          amount:      row.amount,
          categoryId:  row.categoryId,
          description: row.description
        });
        done++;
      } catch (err) {
        failed++;
      }
    }

    progress.textContent = '';
    btn.disabled = false;
    if (failed === 0) {
      showToast(`${done} transacties geïmporteerd!`, 'success');
    } else {
      showToast(`${done} geïmporteerd, ${failed} mislukt.`, 'error');
    }

    // Reset
    _rows = [];
    const el = document.getElementById('view-import');
    _renderShell(el);
  }

  return { render };
})();
