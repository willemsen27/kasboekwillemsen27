// js/auth.js — Inloggen, huishouden aanmaken/joinen en ledenbeheer
//
// Volgorde: ingelogd? → e-mail geverifieerd? → lid van een huishouden? → app openen.
// Config.user en Config.household worden hier gevuld; Api krijgt het huishouden via Api.setHousehold().

const Auth = (() => {
  const LS_HOUSEHOLD = 'kasboek_fb_household';

  let _onReady      = () => {};
  let _hhUnsub      = null;
  let _emptyTimer   = null;
  let _activeHid    = null;
  let _hhSig        = null;
  let _busyWriting  = false;     // bezig met aanmaken/joinen: dan nog geen koppeling "herstellen"
  let _viewing      = false;     // admin kijkt mee in een ander huishouden (alleen lezen)
  let _own          = null;      // eigen huishouden tijdens het meekijken
  let _mode         = 'login';   // 'login' | 'register'

  const _email = user => String((user && user.email) || '').toLowerCase();
  const _membershipRef = email => FB.doc(FB.db, 'memberships', email);

  // Voorbeeldbudgetten en -categorieën voor een nieuw huishouden
  const SEED_BUDGETS = [
    { name: 'Wonen',            amount: 1000 },
    { name: 'Energie en water', amount: 200 },
    { name: 'Verzekeringen',    amount: 100 },
    { name: 'Boodschappen',     amount: 400 },
    { name: 'Vrije tijd',       amount: 150 },
    { name: 'Vervoer',          amount: 100 },
    { name: 'Sparen',           amount: 0 }
  ];
  const SEED_CATEGORIES = [
    { name: 'Huur / hypotheek', color: '#b5c5d5', budget: 'Wonen' },
    { name: 'Gas en stroom',    color: '#d5d5b5', budget: 'Energie en water' },
    { name: 'Water',            color: '#b5d5d5', budget: 'Energie en water' },
    { name: 'Verzekeringen',    color: '#c5b5d5', budget: 'Verzekeringen' },
    { name: 'Supermarkt',       color: '#b5d5c5', budget: 'Boodschappen' },
    { name: 'Drogisterij',      color: '#c5d5b5', budget: 'Boodschappen' },
    { name: 'Uit eten',         color: '#d5b5c5', budget: 'Vrije tijd' },
    { name: 'Uitjes',           color: '#d5b5d5', budget: 'Vrije tijd' },
    { name: 'Brandstof / OV',   color: '#c5c5b5', budget: 'Vervoer' },
    { name: 'Sparen',           color: '#c5d5b5', budget: 'Sparen' }
  ];

  // ─── Schermhulpjes ───────────────────────────────────────────────────────────
  const _screen = () => document.getElementById('auth-screen');

  function _open(html) {
    const s = _screen();
    s.innerHTML = `<div class="auth-card">${html}</div>`;
    s.classList.add('open');
    return s;
  }

  function _close() {
    const s = _screen();
    s.classList.remove('open');
    s.innerHTML = '';
  }

  const _brand = subtitle => `
    <div class="auth-brand">Kasboek Willemsen</div>
    <div class="auth-subtitle">${escapeHtml(subtitle)}</div>`;

  function _authError(err) {
    switch (err && err.code) {
      case 'auth/invalid-email':            return 'Dit e-mailadres is ongeldig.';
      case 'auth/missing-password':         return 'Vul een wachtwoord in.';
      case 'auth/weak-password':            return 'Kies een wachtwoord van minimaal 6 tekens.';
      case 'auth/email-already-in-use':     return 'Er bestaat al een account met dit e-mailadres. Log in of gebruik "Wachtwoord vergeten".';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':       return 'E-mailadres of wachtwoord klopt niet.';
      case 'auth/too-many-requests':        return 'Te veel pogingen. Probeer het later opnieuw.';
      case 'auth/network-request-failed':   return 'Geen verbinding. Controleer je internet en probeer opnieuw.';
      case 'auth/unauthorized-domain':      return 'Dit domein is niet toegestaan in Firebase (Authentication > Settings > Authorized domains).';
      case 'auth/operation-not-allowed':    return 'Deze inlogmethode staat uit in Firebase (Authentication > Sign-in method).';
      case 'permission-denied':             return 'Geen toegang. Controleer de beveiligingsregels in Firebase.';
      default: return (err && err.message) || 'Er ging iets mis.';
    }
  }

  const _validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // ─── Inloggen ────────────────────────────────────────────────────────────────
  function _showLogin(message) {
    const reg = _mode === 'register';
    const s = _open(`
      ${_brand(reg ? 'Maak een account' : 'Log in om verder te gaan')}
      ${message ? `<div class="auth-message error">${escapeHtml(message)}</div>` : ''}
      <button class="btn btn-full auth-google" id="auth-google" type="button">
        <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.3-4 6.9-9.9 6.9-17z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.9-6.1C.9 16.4 0 20.100 0 24s.9 7.600 2.600 10.800l7.900-6.100z"/><path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.200-5.600c-2 1.400-4.600 2.200-8.700 2.200-6.300 0-11.600-4.100-13.500-9.800l-7.900 6.100C6.500 42.600 14.600 48 24 48z"/></svg>
        Doorgaan met Google
      </button>
      <div class="auth-divider"><span>of met e-mail</span></div>
      <form id="auth-form" novalidate>
        ${reg ? `<div class="form-group"><label class="form-label" for="auth-name">Naam</label>
          <input id="auth-name" class="input" type="text" autocomplete="name" placeholder="Je naam"></div>` : ''}
        <div class="form-group"><label class="form-label" for="auth-email">E-mailadres</label>
          <input id="auth-email" class="input" type="email" autocomplete="email" placeholder="naam@voorbeeld.nl"></div>
        <div class="form-group"><label class="form-label" for="auth-pass">Wachtwoord</label>
          <input id="auth-pass" class="input" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="Minimaal 6 tekens"></div>
        <button class="btn btn-full" id="auth-submit" type="submit">${reg ? 'Account maken' : 'Inloggen'}</button>
      </form>
      <div class="auth-links">
        <button class="auth-link" id="auth-toggle" type="button">${reg ? 'Ik heb al een account' : 'Nog geen account? Registreer'}</button>
        ${reg ? '' : '<button class="auth-link" id="auth-reset" type="button">Wachtwoord vergeten</button>'}
      </div>`);

    s.querySelector('#auth-google').addEventListener('click', _googleSignIn);
    s.querySelector('#auth-toggle').addEventListener('click', () => { _mode = reg ? 'login' : 'register'; _showLogin(); });

    const reset = s.querySelector('#auth-reset');
    if (reset) reset.addEventListener('click', async () => {
      const email = s.querySelector('#auth-email').value.trim();
      if (!_validEmail(email)) { showToast('Vul eerst je e-mailadres in.', 'error'); return; }
      try {
        await FB.sendPasswordResetEmail(FB.auth, email);
        showToast('Als dit adres bekend is, is er een e-mail gestuurd om je wachtwoord te herstellen.', 'success');
      } catch (err) { showToast(_authError(err), 'error'); }
    });

    s.querySelector('#auth-form').addEventListener('submit', async e => {
      e.preventDefault();
      const email = s.querySelector('#auth-email').value.trim();
      const pass  = s.querySelector('#auth-pass').value;
      const name  = reg ? s.querySelector('#auth-name').value.trim() : '';
      if (!_validEmail(email)) { showToast('Vul een geldig e-mailadres in.', 'error'); return; }
      if (!pass)               { showToast('Vul een wachtwoord in.', 'error'); return; }
      if (reg && !name)        { showToast('Vul je naam in.', 'error'); return; }

      const btn = s.querySelector('#auth-submit');
      setButtonBusy(btn, true, reg ? 'Account maken…' : 'Inloggen…');
      try {
        if (reg) {
          const cred = await FB.createUserWithEmailAndPassword(FB.auth, email, pass);
          await FB.updateProfile(cred.user, { displayName: name });
          try { await FB.sendEmailVerification(cred.user); } catch {}
        } else {
          await FB.signInWithEmailAndPassword(FB.auth, email, pass);
        }
        // onAuthStateChanged neemt het over
      } catch (err) {
        setButtonBusy(btn, false);
        showToast(_authError(err), 'error');
      }
    });
  }

  async function _googleSignIn() {
    const provider = new FB.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await FB.signInWithPopup(FB.auth, provider);
    } catch (err) {
      const code = err && err.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        try { await FB.signInWithRedirect(FB.auth, provider); return; } catch (e2) { err = e2; }
      }
      showToast(_authError(err), 'error');
    }
  }

  // ─── E-mail bevestigen (alleen e-mail/wachtwoord-accounts) ───────────────────
  function _showVerify(user) {
    const s = _open(`
      ${_brand('Bevestig je e-mailadres')}
      <p class="auth-text">We hebben een e-mail gestuurd naar <strong>${escapeHtml(user.email || '')}</strong>.
        Klik op de link in die e-mail en kom dan hier terug.</p>
      <p class="auth-text">Niets ontvangen? Kijk ook in je <strong>spam</strong>-map en kies daar "Geen spam".</p>
      <button class="btn btn-full" id="ver-done" type="button">Ik heb bevestigd</button>
      <button class="btn btn-secondary btn-full" id="ver-resend" type="button" style="margin-top:8px">E-mail opnieuw versturen</button>
      <div class="auth-links"><button class="auth-link" id="ver-out" type="button">Uitloggen</button></div>`);

    s.querySelector('#ver-done').addEventListener('click', async e => {
      const btn = e.currentTarget;
      setButtonBusy(btn, true, 'Controleren…');
      try {
        await user.reload();
        const u = FB.auth.currentUser;
        if (u && u.emailVerified) {
          await u.getIdToken(true);   // nieuw token, zodat de beveiligingsregels de bevestiging zien
          _onUser(u);
          return;
        }
        showToast('Nog niet bevestigd. Klik eerst op de link in de e-mail.', 'error');
      } catch (err) { showToast(_authError(err), 'error'); }
      setButtonBusy(btn, false);
    });

    s.querySelector('#ver-resend').addEventListener('click', async () => {
      try { await FB.sendEmailVerification(user); showToast('E-mail verstuurd', 'success'); }
      catch (err) { showToast(_authError(err), 'error'); }
    });
    s.querySelector('#ver-out').addEventListener('click', signOut);
  }

  // ─── Huishouden kiezen (geen huishouden) ─────────────────────────────────────
  function _showLoading(text) {
    _open(`${_brand(text)}<div class="loading-state"><div class="spinner"></div></div>`);
  }

  function _showOffline() {
    const s = _open(`
      ${_brand('Geen verbinding')}
      <p class="auth-text">De server reageert niet. Controleer je internetverbinding en probeer het opnieuw.</p>
      <button class="btn btn-full" id="off-retry" type="button">Opnieuw proberen</button>
      <div class="auth-links"><button class="auth-link" id="off-out" type="button">Uitloggen</button></div>`);
    s.querySelector('#off-retry').addEventListener('click', () => location.reload());
    s.querySelector('#off-out').addEventListener('click', signOut);
  }

  async function _showOnboarding() {
    const user  = Config.user;
    const email = String(user.email || '').toLowerCase();
    const s = _open(`
      ${_brand('Kies een huishouden')}
      <div id="ob-invites"></div>
      <div class="auth-section-title">Nieuw huishouden</div>
      <form id="ob-form" novalidate>
        <div class="form-group"><label class="form-label" for="ob-name">Naam van het huishouden</label>
          <input id="ob-name" class="input" type="text" maxlength="80" placeholder="Bijv. Familie Jansen"></div>
        <label class="auth-check"><input type="checkbox" id="ob-seed" checked> Voorbeeldbudgetten en -categorieën toevoegen</label>
        <button class="btn btn-full" id="ob-create" type="submit">Huishouden aanmaken</button>
      </form>
      <p class="auth-text small">Wil je aansluiten bij een bestaand huishouden? Laat iemand daaruit je uitnodigen op <strong>${escapeHtml(email)}</strong>; de uitnodiging verschijnt dan hier.</p>
      <div class="auth-links">
        <button class="auth-link" id="ob-refresh" type="button">Uitnodigingen vernieuwen</button>
        <button class="auth-link" id="ob-out" type="button">Uitloggen (${escapeHtml(email)})</button>
      </div>`);

    s.querySelector('#ob-out').addEventListener('click', signOut);
    s.querySelector('#ob-refresh').addEventListener('click', () => _loadInvites(s, email));

    s.querySelector('#ob-form').addEventListener('submit', e => {
      e.preventDefault();
      const name = s.querySelector('#ob-name').value.trim();
      if (!name) { showToast('Geef het huishouden een naam.', 'error'); return; }
      _createHousehold(name, s.querySelector('#ob-seed').checked);
    });

    // Een verouderde koppeling (je bent al uit het huishouden gehaald) zou aanmaken of deelnemen blokkeren: eerst opruimen
    _removeStaleMembership(email).finally(() => _loadInvites(s, email));
  }

  async function _removeStaleMembership(email) {
    try {
      const snap = await FB.getDoc(_membershipRef(email));
      if (snap.exists()) await FB.deleteDoc(_membershipRef(email));
    } catch (err) { console.warn('Koppeling opruimen mislukt', err); }
  }

  // Huishoudens van vóór de koppeling per e-mailadres: alsnog vastleggen (kan alleen als er nog geen koppeling is)
  async function _ensureMembership(hh) {
    if (_busyWriting) return;
    const user = Config.user, email = _email(user);
    if (!user || !email) return;
    try {
      const snap = await FB.getDoc(_membershipRef(email));
      if (snap.exists() || _busyWriting) return;
      await FB.setDoc(_membershipRef(email), {
        household_id: hh.id, uid: user.uid, email, created_at: new Date().toISOString()
      });
    } catch (err) { console.warn('Koppeling vastleggen mislukt', err); }
  }

  async function _loadAdmin(user) {
    let admin = false;
    try { admin = (await FB.getDoc(FB.doc(FB.db, 'admins', _email(user)))).exists(); } catch {}
    if (Config.user !== user || admin === Config.isAdmin) return;
    Config.isAdmin = admin;
    _refreshSettings();
  }

  async function _loadInvites(s, email) {
    const box = s.querySelector('#ob-invites');
    if (!box) return;
    let invites = [];
    try {
      const snap = await FB.getDocs(FB.query(FB.collection(FB.db, 'invites'), FB.where('email', '==', email)));
      invites = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
      box.innerHTML = `<div class="auth-message error">Uitnodigingen ophalen mislukt: ${escapeHtml(_authError(err))}</div>`;
      return;
    }
    if (!invites.length) { box.innerHTML = ''; return; }

    box.innerHTML = `<div class="auth-section-title">Uitnodigingen</div>` + invites.map(inv => `
      <div class="member-row">
        <div class="member-info"><div class="member-name">${escapeHtml(inv.household_name || 'Huishouden')}</div></div>
        <button class="btn btn-sm" data-join="${escapeHtml(inv.id)}" type="button">Deelnemen</button>
      </div>`).join('');

    box.querySelectorAll('[data-join]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const inv = invites.find(i => i.id === btn.dataset.join);
        if (!inv) return;
        setButtonBusy(btn, true, 'Bezig…');
        try { await _joinHousehold(inv); }
        catch (err) { setButtonBusy(btn, false); showToast('Deelnemen mislukt: ' + _authError(err), 'error'); }
      });
    });
  }

  function _createHousehold(name, seed) {
    const user = Config.user;
    const email = String(user.email || '').toLowerCase();
    const ref = FB.doc(FB.collection(FB.db, 'households'));
    const data = {
      name,
      members: [user.uid],
      member_info: { [user.uid]: { name: user.displayName || email, email } },
      pending_invites: [],
      created_at: new Date().toISOString()
    };
    // Huishouden en koppeling van het e-mailadres gaan in één batch: lukt de koppeling niet (adres hoort al bij een
    // ander huishouden), dan wordt ook het huishouden niet aangemaakt. Het huishouden staat meteen lokaal; het scherm
    // schakelt via de luisteraar door. De voorbeeldgegevens volgen zodra de server alles heeft bevestigd.
    const batch = FB.writeBatch(FB.db);
    batch.set(ref, data);
    batch.set(_membershipRef(email), { household_id: ref.id, uid: user.uid, email, created_at: data.created_at });
    _busyWriting = true;
    batch.commit()
      .then(() => seed ? _seed(ref.id) : null)
      .catch(err => showToast(err.code === 'permission-denied'
        ? 'Aanmaken mislukt: dit e-mailadres hoort al bij een huishouden.'
        : 'Aanmaken mislukt: ' + _authError(err), 'error'))
      .finally(() => { _busyWriting = false; });
  }

  function _seed(hid) {
    const batch = FB.writeBatch(FB.db);
    const base = Date.now();
    const ids = {};
    SEED_BUDGETS.forEach((b, i) => {
      const ref = FB.doc(FB.collection(FB.db, 'households', hid, 'budgets'));
      ids[b.name] = ref.id;
      batch.set(ref, {
        name: b.name, default_amount: b.amount, created_at: new Date(base + i).toISOString(),
        budget_id: '', effective_from: ''
      });
    });
    SEED_CATEGORIES.forEach((c, i) => {
      const ref = FB.doc(FB.collection(FB.db, 'households', hid, 'categories'));
      batch.set(ref, {
        name: c.name, color: c.color, budget_id: ids[c.budget] || '', created_at: new Date(base + 100 + i).toISOString()
      });
    });
    return batch.commit();
  }

  async function _joinHousehold(inv) {
    const user  = Config.user;
    const email = String(user.email || '').toLowerCase();
    // Jezelf toevoegen en het e-mailadres aan dit huishouden koppelen (de regels controleren de uitnodiging en dat
    // het adres nog bij geen huishouden hoort), daarna de uitnodiging opruimen
    const batch = FB.writeBatch(FB.db);
    batch.update(FB.doc(FB.db, 'households', inv.household_id), {
      members: FB.arrayUnion(user.uid),
      ['member_info.' + user.uid]: { name: user.displayName || email, email },
      pending_invites: FB.arrayRemove(email)
    });
    batch.set(_membershipRef(email), { household_id: inv.household_id, uid: user.uid, email, created_at: new Date().toISOString() });
    _busyWriting = true;
    try {
      await batch.commit();
    } catch (err) {
      if (err.code === 'permission-denied') throw new Error('Dit e-mailadres hoort al bij een huishouden, of de uitnodiging is niet meer geldig.');
      throw err;
    } finally {
      _busyWriting = false;
    }
    try { await FB.deleteDoc(FB.doc(FB.db, 'invites', inv.id)); } catch (err) { console.warn('Uitnodiging niet verwijderd', err); }
    // De luisteraar op huishoudens ziet het nieuwe lidmaatschap en opent de app
  }

  // ─── Sessie ──────────────────────────────────────────────────────────────────
  function _cleanupHousehold() {
    if (_hhUnsub) { try { _hhUnsub(); } catch {} _hhUnsub = null; }
    clearTimeout(_emptyTimer);
    _activeHid = null;
    _hhSig = null;
    Config.household = null;
    Config.isAdmin = false;
    _viewing = false; _own = null; Config.readOnly = false;
    _renderBanner();
    Api.setHousehold(null);
  }

  function _onUser(user) {
    _cleanupHousehold();

    if (!user) {
      Config.user = null;
      _showLogin();
      return;
    }
    Config.user = user;

    const passwordOnly = user.providerData.length > 0 && user.providerData.every(p => p.providerId === 'password');
    if (passwordOnly && !user.emailVerified) { _showVerify(user); return; }

    _showLoading('Gegevens laden…');
    _watchHousehold(user);
  }

  function _watchHousehold(user) {
    const q = FB.query(FB.collection(FB.db, 'households'), FB.where('members', 'array-contains', user.uid));
    _hhUnsub = FB.onSnapshot(q, { includeMetadataChanges: true }, snap => {
      clearTimeout(_emptyTimer);

      if (snap.empty) {
        // Een lege uitkomst uit de lokale cache zegt niets (nieuw apparaat): wacht op de server
        if (snap.metadata.fromCache) { _emptyTimer = setTimeout(_showOffline, 8000); return; }
        if (_viewing) { _own = null; return; }
        const hadHousehold = !!Config.household;
        Config.household = null; _activeHid = null; _hhSig = null;
        Api.setHousehold(null);
        if (hadHousehold || !document.getElementById('ob-form')) _showOnboarding();
        return;
      }

      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
      const saved = localStorage.getItem(LS_HOUSEHOLD);
      _setHousehold(list.find(h => h.id === saved) || list[0]);
    }, err => {
      console.error('Huishouden laden mislukt', err);
      _open(`${_brand('Laden mislukt')}
        <div class="auth-message error">${escapeHtml(_authError(err))}</div>
        <button class="btn btn-full" id="err-out" type="button">Uitloggen</button>`)
        .querySelector('#err-out').addEventListener('click', signOut);
    });
  }

  function _setHousehold(hh) {
    // Tijdens het meekijken blijft het scherm bij het andere huishouden; het eigen huishouden wordt bewaard
    if (_viewing) { _own = hh; return; }

    const sig = JSON.stringify(hh);
    const docChanged = sig !== _hhSig;
    _hhSig = sig;
    Config.household = hh;
    Features.applyAll();

    if (hh.id !== _activeHid) {
      _activeHid = hh.id;
      localStorage.setItem(LS_HOUSEHOLD, hh.id);
      Api.setHousehold(hh.id);
      _close();
      _onReady();
      _ensureMembership(hh);
      _loadAdmin(Config.user);
    } else if (docChanged) {
      _refreshSettings();
    }
  }

  // ─── Meekijken (alleen admins, alleen lezen) ─────────────────────────────────
  function _renderBanner() {
    document.body.classList.toggle('readonly-mode', _viewing);
    const el = document.getElementById('view-banner');
    if (!el) return;
    if (!_viewing || !Config.household) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.innerHTML = `<span>Je kijkt mee in <strong>${escapeHtml(Config.household.name || '')}</strong> (alleen lezen)</span>
      <button type="button" id="view-stop">Stoppen</button>`;
    el.classList.remove('hidden');
    el.querySelector('#view-stop').addEventListener('click', stopViewing);
  }

  function viewHousehold(hh) {
    if (!Config.isAdmin || !Config.user || !hh || !hh.id) return;
    if (!_viewing) _own = Config.household;
    _viewing = true;
    Config.readOnly = true;
    Config.household = hh;
    _hhSig = null;
    _activeHid = hh.id;
    Api.setHousehold(hh.id, true);
    Features.applyAll();
    _renderBanner();
    window.scrollTo(0, 0);
    Router.navigate('dashboard');
    Router.refresh();
  }

  function stopViewing() {
    if (!_viewing) return;
    const own = _own;
    _viewing = false; _own = null;
    Config.readOnly = false;
    _renderBanner();
    _hhSig = null; _activeHid = null;
    if (own) _setHousehold(own);
    else { Config.household = null; Api.setHousehold(null); _showOnboarding(); }
  }

  // Instellingen opnieuw tekenen als het huishouden is veranderd (niet tijdens het typen)
  function _refreshSettings() {
    if (typeof Router === 'undefined' || Router.getCurrent() !== 'settings') return;
    const a = document.activeElement;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.closest('.view')) return;
    Router.refresh();
  }

  function signOut() {
    return FB.signOut(FB.auth).catch(err => showToast(_authError(err), 'error'));
  }

  function init(onReady) {
    if (onReady) _onReady = onReady;

    if (!window.FB) {
      _open(`${_brand('Firebase kon niet worden geladen')}
        <div class="auth-message error">Controleer je internetverbinding en of je een adblocker gebruikt die gstatic.com blokkeert. Ververs daarna de pagina.</div>`);
      return;
    }

    _showLoading('Laden…');
    FB.getRedirectResult(FB.auth).catch(err => showToast(_authError(err), 'error'));
    FB.onAuthStateChanged(FB.auth, _onUser);
  }

  // ─── Huishoudenkaart in Instellingen ─────────────────────────────────────────
  function renderHouseholdCard(el) {
    const hh   = Config.household;
    const user = Config.user;
    if (!hh || !user) { el.innerHTML = ''; return; }

    const info    = hh.member_info || {};
    const members = (hh.members || []).map(uid => ({ uid, ...(info[uid] || {}) }));
    const pending = hh.pending_invites || [];
    const multi   = members.length > 1;

    if (Config.readOnly) {
      el.innerHTML = `
        <h3>Huishouden</h3>
        <div class="hh-name-row"><div class="hh-name">${escapeHtml(hh.name)}</div></div>
        <p class="settings-info" style="margin-bottom:8px">Je kijkt mee als admin: alleen lezen.</p>
        <div class="auth-section-title">Leden</div>
        ${members.map(m => `
          <div class="member-row"><div class="member-info">
            <div class="member-name">${escapeHtml(m.name || m.email || m.uid)}</div>
            ${m.email ? `<div class="member-email">${escapeHtml(m.email)}</div>` : ''}
          </div></div>`).join('')}
        ${pending.length ? `<div class="auth-section-title">Uitgenodigd</div>` + pending.map(e =>
          `<div class="member-row"><div class="member-info"><div class="member-email">${escapeHtml(e)}</div></div></div>`).join('') : ''}
        <button class="btn btn-full" id="hh-stop-view" type="button" style="margin-top:12px">Stoppen met meekijken</button>
        <div class="auth-section-title">Account</div>
        <p class="settings-info" style="margin-bottom:8px">Ingelogd als ${escapeHtml(user.displayName || '')} (${escapeHtml(user.email || '')})</p>
        <button class="btn btn-secondary btn-full" id="hh-signout" type="button">Uitloggen</button>`;
      el.querySelector('#hh-stop-view').addEventListener('click', stopViewing);
      el.querySelector('#hh-signout').addEventListener('click', signOut);
      return;
    }
    el.innerHTML = `
      <h3>Huishouden</h3>
      <div class="hh-name-row">
        <div class="hh-name">${escapeHtml(hh.name)}</div>
        <button class="btn btn-secondary btn-sm" id="hh-rename" type="button">Naam wijzigen</button>
      </div>

      <div class="auth-section-title">Leden</div>
      ${members.map(m => `
        <div class="member-row">
          <div class="member-info">
            <div class="member-name">${escapeHtml(m.name || m.email || m.uid)}${m.uid === user.uid ? ' <span class="member-you">(jij)</span>' : ''}</div>
            ${m.email ? `<div class="member-email">${escapeHtml(m.email)}</div>` : ''}
          </div>
          ${m.uid === user.uid
            ? (multi ? `<button class="btn btn-secondary btn-sm" data-leave="${escapeHtml(m.uid)}" type="button">Verlaten</button>` : '')
            : `<button class="btn btn-secondary btn-sm" data-remove="${escapeHtml(m.uid)}" type="button">Verwijderen</button>`}
        </div>`).join('')}

      ${pending.length ? `<div class="auth-section-title">Uitgenodigd</div>` + pending.map(e => `
        <div class="member-row">
          <div class="member-info"><div class="member-email">${escapeHtml(e)}</div></div>
          <button class="btn btn-secondary btn-sm" data-cancel="${escapeHtml(e)}" type="button">Intrekken</button>
        </div>`).join('') : ''}

      <div class="auth-section-title">Iemand uitnodigen</div>
      <form id="hh-invite-form" novalidate>
        <div class="form-group">
          <input id="hh-invite-email" class="input" type="email" placeholder="E-mailadres van de ander" autocomplete="off">
        </div>
        <button class="btn btn-full" id="hh-invite-btn" type="submit">Uitnodigen</button>
      </form>
      <p class="settings-info" style="margin-top:8px">De ander maakt een account met dit e-mailadres (of logt in met Google) en kiest dan bij het openen van de app voor "Deelnemen". Het adres moet bevestigd zijn.</p>

      <div class="auth-section-title">Account</div>
      <p class="settings-info" style="margin-bottom:8px">Ingelogd als ${escapeHtml(user.displayName || '')} (${escapeHtml(user.email || '')})</p>
      <button class="btn btn-secondary btn-full" id="hh-signout" type="button">Uitloggen</button>`;

    el.querySelector('#hh-signout').addEventListener('click', signOut);

    el.querySelector('#hh-rename').addEventListener('click', async () => {
      const name = (prompt('Nieuwe naam van het huishouden:', hh.name) || '').trim();
      if (!name || name === hh.name) return;
      if (name.length > 80) { showToast('De naam is te lang (maximaal 80 tekens).', 'error'); return; }
      FB.updateDoc(FB.doc(FB.db, 'households', hh.id), { name })
        .catch(err => showToast('Wijzigen mislukt: ' + _authError(err), 'error'));
    });

    el.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
      const uid = btn.dataset.remove;
      const m = members.find(x => x.uid === uid);
      if (!confirm(`${(m && (m.name || m.email)) || 'Dit lid'} uit het huishouden verwijderen? Diegene heeft dan geen toegang meer tot de gegevens.`)) return;
      _removeMember(hh.id, uid, m && m.email);
    }));

    el.querySelectorAll('[data-leave]').forEach(btn => btn.addEventListener('click', () => {
      if (!confirm('Dit huishouden verlaten? Je hebt daarna geen toegang meer tot de gegevens, tenzij je opnieuw wordt uitgenodigd.')) return;
      _removeMember(hh.id, user.uid, _email(user));
    }));

    el.querySelectorAll('[data-cancel]').forEach(btn => btn.addEventListener('click', () => _cancelInvite(hh, btn.dataset.cancel)));

    el.querySelector('#hh-invite-form').addEventListener('submit', async e => {
      e.preventDefault();
      const input = el.querySelector('#hh-invite-email');
      const email = input.value.trim().toLowerCase();
      if (!_validEmail(email)) { showToast('Vul een geldig e-mailadres in.', 'error'); return; }
      if (members.some(m => String(m.email || '').toLowerCase() === email)) { showToast('Dit e-mailadres hoort al bij het huishouden.', 'error'); return; }
      if (pending.includes(email)) { showToast('Er is al een uitnodiging voor dit adres.', 'error'); return; }
      const btn = el.querySelector('#hh-invite-btn');
      setButtonBusy(btn, true, 'Uitnodigen…');
      try {
        await _invite(hh, email);
        showToast('Uitnodiging klaargezet voor ' + email, 'success');
        input.value = '';
      } catch (err) {
        showToast(err.code === 'permission-denied'
          ? 'Uitnodigen niet mogelijk: dit e-mailadres hoort al bij een huishouden.'
          : 'Uitnodigen mislukt: ' + _authError(err), 'error');
      }
      setButtonBusy(btn, false);
    });
  }

  async function _invite(hh, email) {
    const batch = FB.writeBatch(FB.db);
    batch.set(FB.doc(FB.db, 'invites', hh.id + '__' + email), {
      household_id: hh.id, household_name: hh.name, email,
      invited_by: Config.user.uid, created_at: new Date().toISOString()
    });
    batch.update(FB.doc(FB.db, 'households', hh.id), { pending_invites: FB.arrayUnion(email) });
    await batch.commit();
  }

  function _cancelInvite(hh, email) {
    const batch = FB.writeBatch(FB.db);
    batch.delete(FB.doc(FB.db, 'invites', hh.id + '__' + email));
    batch.update(FB.doc(FB.db, 'households', hh.id), { pending_invites: FB.arrayRemove(email) });
    batch.commit().catch(err => showToast('Intrekken mislukt: ' + _authError(err), 'error'));
  }

  function _removeMember(hid, uid, email) {
    // Ook de koppeling van het e-mailadres weghalen, zodat diegene daarna een ander huishouden kan kiezen
    const batch = FB.writeBatch(FB.db);
    batch.update(FB.doc(FB.db, 'households', hid), {
      members: FB.arrayRemove(uid),
      ['member_info.' + uid]: FB.deleteField()
    });
    if (email) batch.delete(_membershipRef(String(email).toLowerCase()));
    batch.commit().catch(err => showToast('Verwijderen mislukt: ' + _authError(err), 'error'));
  }

  return { init, signOut, renderHouseholdCard, viewHousehold, stopViewing };
})();

