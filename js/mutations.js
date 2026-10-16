// js/mutations.js — Wijzigingen doorvoeren met een melding voor de gebruiker.
//
// De optimistische lokale bijwerking wordt door Firestore zelf gedaan (lokale cache + luisteraars in Api):
// een wijziging is direct zichtbaar en het scherm ververst via Api.onChange. Foutmeldingen van de server
// (bij het wegschrijven op de achtergrond) toont Api zelf; hier worden alleen fouten van de voorbereiding
// (bijv. een ongeldige budgetversie) afgevangen.

const Mutations = (() => {

  async function _run(action, okMessage, failPrefix) {
    try {
      const res = await action();
      if (okMessage) showToast(okMessage, 'success');
      return res;
    } catch (err) {
      showToast(failPrefix + ': ' + ((err && err.message) || 'onbekende fout'), 'error');
    }
  }

  // ─── Transacties ─────────────────────────────────────────────────────────────
  const addTransaction = ({ date, amount, categoryId, description }) =>
    _run(() => Api.createTransaction({ date, amount, categoryId, description }), 'Transactie opgeslagen', 'Opslaan mislukt');

  const updateTransaction = (oldTx, { date, amount, categoryId, description }) =>
    _run(() => Api.updateTransaction(oldTx.id, { date, amount, categoryId, description }), 'Transactie opgeslagen', 'Opslaan mislukt');

  const deleteTransaction = tx =>
    _run(() => Api.deleteTransaction(tx.id), 'Transactie verwijderd', 'Verwijderen mislukt');

  // ─── Budget ──────────────────────────────────────────────────────────────────
  const setBudgetOverride = (stat, month, amount) =>
    _run(() => Api.setBudgetOverride(stat.budget_id, month, amount), 'Budget voor deze maand ingesteld', 'Opslaan mislukt');

  const setBudgetVersion = (stat, amount, month, name, kind) =>
    _run(() => Api.setBudgetEffectiveFrom(stat.budget_id, amount, month, name),
         kind === 'permanent' ? 'Budget permanent aangepast' : 'Budget voor toekomstige maand ingesteld',
         'Opslaan mislukt');

  const updateBudgetVersion = (row, { amount, month }) =>
    _run(() => Api.updateBudgetVersion(row.id, { amount, effectiveFromMonth: month }), 'Toekomstig budget opgeslagen', 'Opslaan mislukt');

  const deleteBudgetVersion = row =>
    _run(() => Api.deleteBudgetVersion(row.id), 'Toekomstig budget verwijderd', 'Verwijderen mislukt');

  // ─── Categorieën ─────────────────────────────────────────────────────────────
  const createCategory = ({ name, color, budgetId }) =>
    _run(() => Api.createCategory({ name, color, budgetId }), 'Categorie toegevoegd', 'Opslaan mislukt');

  const updateCategory = (oldCat, { name, color, budgetId }) =>
    _run(() => Api.updateCategory(oldCat.id, { name, color, budgetId }), 'Categorie opgeslagen', 'Opslaan mislukt');

  // Verwijderen: de aanroeper (Instellingen) toont een spinner en vangt fouten zelf af
  const deleteCategory = id => Api.deleteCategory(id);

  // ─── Budgetten ───────────────────────────────────────────────────────────────
  const createBudget = ({ name, defaultAmount }) =>
    _run(() => Api.createBudget({ name, defaultAmount }), 'Budget toegevoegd', 'Opslaan mislukt');

  const deleteBudget = id => Api.deleteBudget(id);

  return {
    addTransaction, updateTransaction, deleteTransaction,
    setBudgetOverride, setBudgetVersion, updateBudgetVersion, deleteBudgetVersion,
    createCategory, updateCategory, deleteCategory,
    createBudget, deleteBudget
  };
})();
