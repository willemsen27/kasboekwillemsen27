// js/app.js — Application bootstrap

window.addEventListener('DOMContentLoaded', () => {
  // Register view handlers
  Router.register('dashboard',    () => Dashboard.render());
  Router.register('transactions', () => Transactions.render());
  Router.register('budgets',      () => Budgets.render());
  Router.register('savings',      () => Savings.render());
  Router.register('sunscreen',    () => Sunscreen.render());
  Router.register('import',       () => Import.render());
  Router.register('settings',     () => Settings.render());

  // Wire up nav items (Meer-knop heeft geen data-view en wordt apart afgehandeld)
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.view) Router.navigate(item.dataset.view);
    });
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

  // Netwerkactiviteit: voortgangsbalk bovenaan + "Opslaan…" zolang er wordt weggeschreven
  const busyBar  = document.getElementById('busy-bar');
  const busyChip = document.getElementById('busy-chip');
  Api.onBusy(({ reads, writes }) => {
    busyBar.classList.toggle('active', reads + writes > 0);
    busyChip.classList.toggle('hidden', writes === 0);
  });

  // Op de achtergrond ververste data die anders is dan wat er getoond wordt: scherm bijwerken.
  // Niet tijdens het typen of kiezen in een veld op de pagina zelf.
  Api.onChange(() => {
    const a = document.activeElement;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.closest('.view')) return;
    Router.refresh();
  });

  // Niet per ongeluk afsluiten terwijl er nog iets wordt opgeslagen
  window.addEventListener('beforeunload', e => {
    if (Api.pendingWrites() > 0) { e.preventDefault(); e.returnValue = ''; }
  });

  // Init router — will trigger first render
  Router.init();

  // Apply feature flags immediately after router init
  Features.applyAll();

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
  // Foutmeldingen blijven langer staan, zodat je ze kunt lezen
  _toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, type === 'error' ? 7000 : 3000);
}
