// js/features.js — Feature flags persisted in localStorage

const Features = (() => {
  const _KEY      = 'kasboek_features';
  const _DEFAULTS = { savings: false, import: false, sunscreen: false };

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
  }

  function _apply(name, enabled) {
    const navItem = document.querySelector(`.nav-item[data-view="${name}"]`);
    if (navItem) navItem.style.display = enabled ? '' : 'none';
    if (!enabled && typeof Router !== 'undefined' && Router.getCurrent() === name) {
      Router.navigate('dashboard');
    }
  }

  return { get, set, applyAll };
})();
