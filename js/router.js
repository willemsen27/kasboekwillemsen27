// js/router.js — Hash-based SPA router

const Router = (() => {
  const VIEWS = ['dashboard', 'transactions', 'budgets', 'import', 'settings'];
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

    // Show/hide view panels
    VIEWS.forEach(v => {
      const el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('hidden', v !== view);
    });

    // Update nav item active states
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });

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

  return { register, navigate, init, getCurrent };
})();
