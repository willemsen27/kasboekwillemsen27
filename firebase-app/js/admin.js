// js/admin.js — Beheer voor admins: alle huishoudens zien en de features per huishouden instellen
//
// Wie admin is, staat in Firestore (collectie "admins", document-id = e-mailadres in kleine letters) en wordt
// alleen via de Console beheerd. De beveiligingsregels laten een admin alle huishoudens lezen, de financiële
// gegevens ervan alleen lezen (meekijken) en alleen het veld "features" wijzigen.

const Admin = (() => {
  let _list = null;      // [{ id, name, members[], member_info, pending_invites, features, created_at }]
  let _loading = false;
  let _error = '';
  let _openIds = new Set();   // huishoudens die uitgeklapt staan (blijft zo na een wijziging)

  const _sun = hh => (hh.features && hh.features.sunscreen) || {};
  const _validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const _msg = err => err && err.code === 'permission-denied'
    ? 'geen toegang (zijn de nieuwste regels gepubliceerd?)'
    : ((err && err.message) || String(err));

  async function _load(el) {
    _loading = true; _error = ''; _draw(el);
    try {
      const snap = await FB.getDocs(FB.collection(FB.db, 'households'));
      _list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'nl'));
    } catch (err) {
      _error = err.code === 'permission-denied'
        ? 'Geen toegang. Controleer of de nieuwste beveiligingsregels zijn gepubliceerd en of je e-mailadres in "admins" staat.'
        : (err.message || String(err));
    }
    _loading = false;
    _draw(el);
  }

  function _row(hh) {
    const sun = _sun(hh);
    const info = hh.member_info || {};
    const myUid = Config.user && Config.user.uid;
    const pending = hh.pending_invites || [];
    const members = (hh.members || []).map(uid => (info[uid] && (info[uid].email || info[uid].name)) || uid);
    const memberRows = (hh.members || []).map(uid => {
      const i = info[uid] || {};
      return `
        <div class="member-row">
          <div class="member-info">
            <div class="member-name">${escapeHtml(i.name || i.email || uid)}${uid === myUid ? ' <span class="member-you">(jij)</span>' : ''}</div>
            ${i.email && i.name ? `<div class="member-email">${escapeHtml(i.email)}</div>` : ''}
          </div>
          ${uid === myUid ? '' : `<button class="btn btn-secondary btn-sm" data-remove="${escapeHtml(uid)}" type="button">Verwijderen</button>`}
        </div>`;
    }).join('');
    const pendingRows = pending.map(e => `
        <div class="member-row">
          <div class="member-info"><div class="member-email">${escapeHtml(e)}</div></div>
          <button class="btn btn-secondary btn-sm" data-cancel="${escapeHtml(e)}" type="button">Intrekken</button>
        </div>`).join('');
    const on = sun.enabled === true;
    const current = Config.household && Config.household.id === hh.id;
    const viewBtn = current
      ? `<p class="settings-info">${Config.readOnly ? 'Je kijkt nu in dit huishouden mee.' : 'Dit is je eigen huishouden.'}</p>`
      : `<button class="btn btn-sm" data-view type="button">Meekijken (alleen lezen)</button>`;
    return `
      <details class="admin-hh" data-hid="${escapeHtml(hh.id)}" ${_openIds.has(hh.id) ? 'open' : ''}>
        <summary>
          <span class="admin-hh-name">${escapeHtml(hh.name || hh.id)}</span>
          <span class="admin-hh-meta">${members.length} ${members.length === 1 ? 'lid' : 'leden'}${on ? ' · zonnescherm aan' : ''}</span>
        </summary>
        <div class="admin-hh-body">
          <div style="margin-bottom:12px">${viewBtn}</div>

          <div class="auth-section-title">Leden</div>
          ${memberRows || '<p class="settings-info">Geen leden</p>'}
          ${pending.length ? `<div class="auth-section-title">Uitgenodigd</div>${pendingRows}` : ''}
          <div class="form-group" style="margin-top:12px">
            <input class="input" type="email" data-f="invite" placeholder="E-mailadres om uit te nodigen" autocomplete="off">
          </div>
          <button class="btn btn-sm" data-invite type="button">Uitnodigen</button>
          <p class="settings-info" style="margin:8px 0 16px">Iemand toevoegen gaat via een uitnodiging: die persoon logt in met dit e-mailadres en kiest "Deelnemen".</p>

          <div class="auth-section-title">Zonnescherm</div>
          <label class="auth-check"><input type="checkbox" data-f="enabled" ${on ? 'checked' : ''}> Zonnescherm beschikbaar voor dit huishouden</label>
          <div class="form-group"><label class="form-label">Script URL</label>
            <input class="input" type="url" data-f="url" placeholder="https://script.google.com/macros/s/…/exec" value="${escapeHtml(sun.script_url || '')}"></div>
          <div class="form-group"><label class="form-label">API-sleutel</label>
            <input class="input" type="password" autocomplete="off" data-f="key" value="${escapeHtml(sun.api_key || '')}"></div>
          <button class="btn btn-sm" data-save type="button">Opslaan</button>
        </div>
      </details>`;
  }

  function _draw(el) {
    if (!el) return;
    if (!Config.isAdmin) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';

    // Welke huishoudens staan nu open? Die blijven open na het opnieuw tekenen
    if (el.querySelector('.admin-hh')) {
      _openIds = new Set([...el.querySelectorAll('.admin-hh[open]')].map(d => d.dataset.hid));
    }

    el.innerHTML = `
      <h3>Beheer (admin)</h3>
      <p class="settings-info" style="margin-bottom:12px">Alle huishoudens. Je kunt er alleen-lezen in meekijken, leden verwijderen, mensen uitnodigen en de features instellen.</p>
      ${_error ? `<div class="auth-message error">${escapeHtml(_error)}</div>` : ''}
      ${_loading && !_list ? '<div class="loading-state"><div class="spinner"></div></div>' : ''}
      ${_list ? (_list.length ? _list.map(_row).join('') : '<p class="settings-info">Nog geen huishoudens.</p>') : ''}
      <button class="btn btn-secondary btn-sm" id="admin-reload" type="button" style="margin-top:12px" ${_loading ? 'disabled' : ''}>Lijst vernieuwen</button>`;

    el.querySelector('#admin-reload').addEventListener('click', () => _load(el));

    el.querySelectorAll('.admin-hh').forEach(box => {
      const find = () => _list.find(h => h.id === box.dataset.hid);
      const hhRef = h => FB.doc(FB.db, 'households', h.id);

      // Lid verwijderen (en de koppeling van het e-mailadres, zodat diegene ergens anders kan aansluiten)
      box.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', async () => {
        const h = find(); if (!h) return;
        const uid = btn.dataset.remove;
        const i = (h.member_info || {})[uid] || {};
        if (!confirm(`${i.name || i.email || 'Dit lid'} uit "${h.name}" verwijderen? Diegene heeft dan geen toegang meer tot de gegevens.`)) return;
        setButtonBusy(btn, true, 'Bezig…');
        try {
          const batch = FB.writeBatch(FB.db);
          batch.update(hhRef(h), { members: FB.arrayRemove(uid), ['member_info.' + uid]: FB.deleteField() });
          if (i.email) batch.delete(FB.doc(FB.db, 'memberships', String(i.email).toLowerCase()));
          await batch.commit();
          h.members = (h.members || []).filter(x => x !== uid);
          if (h.member_info) delete h.member_info[uid];
          showToast('Lid verwijderd', 'success');
          _draw(el);
        } catch (err) {
          setButtonBusy(btn, false);
          showToast('Verwijderen mislukt: ' + _msg(err), 'error');
        }
      }));

      // Uitnodiging intrekken
      box.querySelectorAll('[data-cancel]').forEach(btn => btn.addEventListener('click', async () => {
        const h = find(); if (!h) return;
        const email = btn.dataset.cancel;
        setButtonBusy(btn, true, 'Bezig…');
        try {
          const batch = FB.writeBatch(FB.db);
          batch.delete(FB.doc(FB.db, 'invites', h.id + '__' + email));
          batch.update(hhRef(h), { pending_invites: FB.arrayRemove(email) });
          await batch.commit();
          h.pending_invites = (h.pending_invites || []).filter(x => x !== email);
          _draw(el);
        } catch (err) {
          setButtonBusy(btn, false);
          showToast('Intrekken mislukt: ' + _msg(err), 'error');
        }
      }));

      // Iemand uitnodigen
      const inviteBtn = box.querySelector('[data-invite]');
      inviteBtn.addEventListener('click', async () => {
        const h = find(); if (!h) return;
        const input = box.querySelector('[data-f="invite"]');
        const email = input.value.trim().toLowerCase();
        if (!_validEmail(email)) { showToast('Vul een geldig e-mailadres in.', 'error'); return; }
        const emails = Object.values(h.member_info || {}).map(m => String(m.email || '').toLowerCase());
        if (emails.includes(email)) { showToast('Dit e-mailadres hoort al bij het huishouden.', 'error'); return; }
        if ((h.pending_invites || []).includes(email)) { showToast('Er is al een uitnodiging voor dit adres.', 'error'); return; }
        setButtonBusy(inviteBtn, true, 'Uitnodigen…');
        try {
          const batch = FB.writeBatch(FB.db);
          batch.set(FB.doc(FB.db, 'invites', h.id + '__' + email), {
            household_id: h.id, household_name: h.name, email,
            invited_by: Config.user.uid, created_at: new Date().toISOString()
          });
          batch.update(hhRef(h), { pending_invites: FB.arrayUnion(email) });
          await batch.commit();
          h.pending_invites = [...(h.pending_invites || []), email];
          showToast('Uitnodiging klaargezet voor ' + email, 'success');
          _draw(el);
        } catch (err) {
          setButtonBusy(inviteBtn, false);
          showToast(err.code === 'permission-denied'
            ? 'Uitnodigen niet mogelijk: dit e-mailadres hoort al bij een huishouden (of de regels zijn niet gepubliceerd).'
            : 'Uitnodigen mislukt: ' + _msg(err), 'error');
        }
      });

      const viewBtn = box.querySelector('[data-view]');
      if (viewBtn) viewBtn.addEventListener('click', () => {
        const hh = find();
        if (hh) Auth.viewHousehold(hh);
      });
      box.querySelector('[data-save]').addEventListener('click', async e => {
        const hh = _list.find(h => h.id === box.dataset.hid);
        if (!hh) return;
        const enabled = box.querySelector('[data-f="enabled"]').checked;
        const url = box.querySelector('[data-f="url"]').value.trim();
        const key = box.querySelector('[data-f="key"]').value.trim();
        if (enabled && (!/^https:\/\/script\.google\.com\//.test(url) || !key)) {
          showToast('Vul een geldige Script URL (https://script.google.com/…) en de API-sleutel in.', 'error');
          return;
        }
        const btn = e.currentTarget;
        setButtonBusy(btn, true, 'Opslaan…');
        const sunscreen = { enabled, script_url: url, api_key: key };
        try {
          await FB.updateDoc(FB.doc(FB.db, 'households', hh.id), { 'features.sunscreen': sunscreen });
          hh.features = { ...(hh.features || {}), sunscreen };
          showToast('Opgeslagen', 'success');
          _draw(el);
        } catch (err) {
          setButtonBusy(btn, false);
          showToast('Opslaan mislukt: ' + (err.code === 'permission-denied' ? 'geen toegang (admin?)' : err.message), 'error');
        }
      });
    });
  }

  function renderCard(el) {
    if (!el) return;
    if (!Config.isAdmin) { el.style.display = 'none'; el.innerHTML = ''; return; }
    if (!_list && !_loading) { _load(el); return; }
    _draw(el);
  }

  return { renderCard };
})();
