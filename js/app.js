// js/app.js — Application bootstrap

window.addEventListener('DOMContentLoaded', () => {
  // Register view handlers
  Router.register('dashboard',    () => Dashboard.render());
  Router.register('transactions', () => Transactions.render());
  Router.register('budgets',      () => Budgets.render());
  Router.register('import',       () => Import.render());
  Router.register('settings',     () => Settings.render());

  // Wire up nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => Router.navigate(item.dataset.view));
  });

  // Wire up FAB
  document.getElementById('fab-add').addEventListener('click', () => {
    if (!Config.isConfigured) {
      showToast('Configureer de app eerst via Instellingen.', 'error');
      Router.navigate('settings');
      return;
    }
    TransactionForm.openNew();
  });

  // Init router — will trigger first render
  Router.init();

  // Redirect to settings if not configured
  if (!Config.isConfigured) {
    Router.navigate('settings');
  } else {
    // Preload huidige maand data op de achtergrond zodat de cache al gevuld is
    // vóór de eerste navigatie. Fouten worden stil genegeerd.
    const _ym = currentYearMonth();
    const _r  = getMonthRange(_ym.year, _ym.month);
    Promise.all([
      Api.getCategories(),
      Api.getBudgets(),
      Api.getTransactions({ from: _r.from, to: _r.to }),
      Api.getStats(_r.from, _r.to),
      Api.getBudgetStats(_r.from, _r.to)
    ]).catch(() => {});
  }
});

// ─── Toast ───────────────────────────────────────────────────────────────────
let _toastTimer = null;

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className   = 'toast toast-' + type;
  toast.classList.remove('hidden');

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}
