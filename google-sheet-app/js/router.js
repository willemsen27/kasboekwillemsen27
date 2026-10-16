// js/router.js — Hash-based SPA router

const Router = (() => {
  const VIEWS = ['dashboard', 'transactions', 'budgets', 'savings', 'sunscreen', 'import', 'settings'];
  const handlers = {};
  let current = null;

  function register(view, fn) {
    handlers[view] = fn;
  }

  function navigate(view) {
    window.location.hash = view;
  }

  function showView(view) {
    if (!VIEWS.includes(view)) view = 'dashboard';

    // Sluit de Meer-lade bij elke navigatie
    if (typeof Features !== 'undefined') Features.closeDrawer();

    // Show/hide view panels
    VIEWS.forEach(v => {
      const el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('hidden', v !== view);
    });

    // Update nav item active states
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });

    // Meer-knop actief als de huidige pagina in de lade zit
    const meerBtn = document.getElementById('nav-meer-btn');
    if (meerBtn && meerBtn.style.display !== 'none') {
      const navItem = document.querySelector(`.nav-bar .nav-item[data-view="${view}"]`);
      meerBtn.classList.toggle('active', !!navItem && navItem.style.display === 'none');
    }

    current = view;

    // Call registered render handler
    if (handlers[view]) {
      try { handlers[view](); }
      catch (err) { console.error('Router render error:', err); }
    }
  }

  function init() {
    function handleHash() {
      const hash = window.location.hash.slice(1);
      showView(VIEWS.includes(hash) ? hash : 'dashboard');
    }
    window.addEventListener('hashchange', handleHash);
    handleHash(); // handle initial hash on load
  }

  function getCurrent() { return current; }

  // Teken het huidige scherm opnieuw (uit de cache, dus meestal direct). Alleen voor schermen
  // die uit gecachete data bestaan; behoudt de scrollpositie. Meerdere aanroepen kort na elkaar
  // worden samengevoegd.
  const REFRESHABLE = ['dashboard', 'transactions', 'budgets', 'settings'];
  let _refreshTimer = null;

  function refresh() {
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => {
      if (!REFRESHABLE.includes(current) || !handlers[current]) return;
      const y = window.scrollY;
      try {
        Promise.resolve(handlers[current]()).finally(() => window.scrollTo(0, y));
      } catch (err) { console.error('Router refresh error:', err); }
    }, 30);
  }

  return { register, navigate, init, getCurrent, refresh };
})();
