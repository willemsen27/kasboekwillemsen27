// js/sunscreen.js — Standalone sunscreen view

const Sunscreen = (() => {
  async function render() {
    const el = document.getElementById('view-sunscreen');

    if (!Config.isConfigured) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">⚙️</div>
        <div class="empty-state-title">Nog niet ingesteld</div>
        <button class="btn btn-secondary" onclick="Router.navigate('settings')">Naar instellingen</button>
      </div>`;
      return;
    }

    el.innerHTML = `
      <div class="page-header" style="padding-top:16px;">
        <div class="page-title">Zonnescherm</div>
      </div>

      <div class="card settings-app-section">
        <h3>Bediening</h3>
        <div class="sunscreen-controls">
          <button class="sunscreen-btn-open"  id="btn-uitrollen">☀️&nbsp; Uitrollen</button>
          <button class="sunscreen-btn-stop"  id="btn-stop">⏸&nbsp; Stop</button>
          <button class="sunscreen-btn-close" id="btn-oprollen">🍂&nbsp; Oprollen</button>
        </div>
        <div id="sunscreen-status" style="margin-top:12px"></div>
      </div>`;

    const statusEl = el.querySelector('#sunscreen-status');

    async function _sendCmd(command, label) {
      const btns = el.querySelectorAll('.sunscreen-btn-open, .sunscreen-btn-stop, .sunscreen-btn-close');
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

    el.querySelector('#btn-uitrollen').addEventListener('click', () => _sendCmd('close', 'Uitrollen'));
    el.querySelector('#btn-stop')     .addEventListener('click', () => _sendCmd('stop',  'Stop'));
    el.querySelector('#btn-oprollen') .addEventListener('click', () => _sendCmd('open',  'Oprollen'));
  }

  return { render };
})();
