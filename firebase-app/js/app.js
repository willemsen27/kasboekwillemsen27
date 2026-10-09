// js/app.js — Application bootstrap

let _started = false;

// Wordt door Auth aangeroepen zodra er een ingelogde gebruiker met een huishouden is
function startApp() {
  if (_started) {
    // Opnieuw ingelogd of ander huishouden: scherm opnieuw opbouwen uit de nieuwe data
    Router.refresh();
    return;
  }
  _started = true;

  Router.init();
  Features.applyAll();

  // Preload huidige maand op de achtergrond; de luisteraars vullen de cache al voor de eerste navigatie
  const ym = currentYearMonth();
  const r  = getMonthRange(ym.year, ym.month);
  Promise.all([
    Api.getCategories({ prefetch: true }),
    Api.getBudgets({ prefetch: true }),
    Api.getTransactions({ from: r.from, to: r.to }, { prefetch: true })
  ]).catch(() => {});
}

window.addEventListener('DOMContentLoaded', () => {
  Router.register('dashboard',    () => Dashboard.render());
  Router.register('transactions', () => Transactions.render());
  Router.register('budgets',      () => Budgets.render());
  Router.register('savings',      () => Savings.render());
  Router.register('import',       () => Import.render());
  Router.register('sunscreen',    () => Sunscreen.render());
  Router.register('settings',     () => Settings.render());

  // Meer-knop heeft geen data-view en wordt apart afgehandeld
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.view) Router.navigate(item.dataset.view);
    });
  });

  document.getElementById('fab-add').addEventListener('click', () => {
    if (!Config.isConfigured) return;
    TransactionForm.openNew();
  });

  // Netwerkactiviteit: voortgangsbalk bovenaan + "Opslaan…" zolang er wordt weggeschreven
  const busyBar  = document.getElementById('busy-bar');
  const busyChip = document.getElementById('busy-chip');
  Api.onBusy(({ reads, writes }) => {
    busyBar.classList.toggle('active', reads + writes > 0);
    busyChip.classList.toggle('hidden', writes === 0);
  });

  // Data die op de achtergrond veranderd is: scherm bijwerken, behalve tijdens het typen in een veld
  Api.onChange(() => {
    if (!Config.isConfigured) return;
    const a = document.activeElement;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.closest('.view')) return;
    Router.refresh();
  });

  // Niet per ongeluk afsluiten terwijl er nog iets wordt opgeslagen
  window.addEventListener('beforeunload', e => {
    if (Api.pendingWrites() > 0) { e.preventDefault(); e.returnValue = ''; }
  });

  Auth.init(startApp);
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
