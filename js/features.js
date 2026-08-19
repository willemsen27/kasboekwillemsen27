// js/features.js — Feature flags persisted in localStorage

const Features = (() => {
  const _KEY      = 'kasboek_features';
  const _DEFAULTS = { savings: false, import: false, sunscreen: false };
  const _OPTIONAL = ['import', 'savings', 'sunscreen'];
  let _wired = false;

  function _load() {
    try {
      const raw = localStorage.getItem(_KEY);
      return raw ? { ..._DEFAULTS, ...JSON.parse(raw) } : { ..._DEFAULTS };
    } catch { return { ..._DEFAULTS }; }
  }

  function get(name) {
    return _load()[name] === true;
  }

  function set(name, value) {
    const current = _load();
    current[name] = !!value;
    localStorage.setItem(_KEY, JSON.stringify(current));
    applyAll();
  }

  function applyAll() {
    const f = _load();
    _apply('savings',   f.savings);
    _apply('import',    f.import);
    _apply('sunscreen', f.sunscreen);
    _applyOverflow();
  }

  function _apply(name, enabled) {
    const navItem = document.querySelector(`.nav-item[data-view="${name}"]`);
    if (navItem) navItem.style.display = enabled ? '' : 'none';
    if (!enabled && typeof Router !== 'undefined' && Router.getCurrent() === name) {
      Router.navigate('dashboard');
    }
  }

  // ─── Overflow: meer dan 5 nav-items → verberg optionele items, toon Meer-knop ──
  function _applyOverflow() {
    const meerBtn      = document.getElementById('nav-meer-btn');
    const meerDrawer   = document.getElementById('nav-meer-drawer');
    const meerBackdrop = document.getElementById('nav-meer-backdrop');
    if (!meerBtn || !meerDrawer || !meerBackdrop) return;

    if (!_wired) {
      _wired = true;
      meerBtn.addEventListener('click', _toggleDrawer);
      meerBackdrop.addEventListener('click', closeDrawer);
    }

    const f = _load();
    const enabled = _OPTIONAL.filter(v => f[v]);

    if (enabled.length >= 2) {
      // Verberg alle optionele items uit de nav, toon Meer-knop
      _OPTIONAL.forEach(v => {
        const el = document.querySelector(`.nav-bar .nav-item[data-view="${v}"]`);
        if (el) el.style.display = 'none';
      });
      meerBtn.style.display = '';

      // Vul de lade met de verborgen items
      meerDrawer.innerHTML = '<div class="nav-meer-handle"></div>' +
        enabled.map(view => {
          const navEl = document.querySelector(`.nav-bar .nav-item[data-view="${view}"]`);
          if (!navEl) return '';
          const svgHtml = (navEl.querySelector('svg') || {}).outerHTML || '';
          const label   = [...navEl.childNodes]
            .filter(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
            .map(n => n.textContent.trim()).join('') || view;
          const active  = typeof Router !== 'undefined' && Router.getCurrent() === view;
          return `<button class="nav-meer-item${active ? ' active' : ''}" data-view="${view}">${svgHtml}<span>${label}</span></button>`;
        }).join('');

      meerDrawer.querySelectorAll('.nav-meer-item').forEach(btn => {
        btn.addEventListener('click', () => {
          closeDrawer();
          if (typeof Router !== 'undefined') Router.navigate(btn.dataset.view);
        });
      });

      // Meer-knop actief als de huidige pagina in de lade zit
      const cur = typeof Router !== 'undefined' ? Router.getCurrent() : '';
      meerBtn.classList.toggle('active', enabled.includes(cur));
    } else {
      // Alles past gewoon in de nav
      _OPTIONAL.forEach(v => {
        const el = document.querySelector(`.nav-bar .nav-item[data-view="${v}"]`);
        if (el) el.style.display = f[v] ? '' : 'none';
      });
      meerBtn.style.display = 'none';
      meerBtn.classList.remove('active');
      closeDrawer();
    }
  }

  function _toggleDrawer() {
    const drawer   = document.getElementById('nav-meer-drawer');
    const backdrop = document.getElementById('nav-meer-backdrop');
    if (!drawer) return;
    const opening = drawer.classList.contains('hidden');
    drawer.classList.toggle('hidden', !opening);
    backdrop.classList.toggle('hidden', !opening);
  }

  function closeDrawer() {
    const drawer   = document.getElementById('nav-meer-drawer');
    const backdrop = document.getElementById('nav-meer-backdrop');
    if (drawer)   drawer.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
  }

  return { get, set, applyAll, closeDrawer };
})();
