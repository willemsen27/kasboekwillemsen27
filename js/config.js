// js/config.js — Configuration stored in localStorage

const Config = {
  get scriptUrl() { return localStorage.getItem('kasboek_script_url') || ''; },
  get apiKey()    { return localStorage.getItem('kasboek_api_key')    || ''; },
  set scriptUrl(v){ localStorage.setItem('kasboek_script_url', v); },
  set apiKey(v)   { localStorage.setItem('kasboek_api_key', v);    },
  get isConfigured() { return !!(this.scriptUrl && this.apiKey); }
};

// ─── Global utilities ─────────────────────────────────────────────────────────

const MONTHS_NL = [
  'Januari','Februari','Maart','April','Mei','Juni',
  'Juli','Augustus','September','Oktober','November','December'
];

function formatCurrency(amount) {
  const abs = Math.abs(parseFloat(amount) || 0);
  return '€\u00a0' + abs.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(yyyymmdd) {
  if (!yyyymmdd) return '';
  const s = String(yyyymmdd);
  if (s.length < 10) return s;
  return s.substring(8, 10) + '-' + s.substring(5, 7) + '-' + s.substring(0, 4);
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function getMonthRange(year, month) {
  const from = year + '-' + String(month).padStart(2, '0') + '-01';
  const lastDay = new Date(year, month, 0).getDate();
  const to   = year + '-' + String(month).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
  return { from, to };
}

function monthLabel(year, month) {
  return MONTHS_NL[month - 1] + ' ' + year;
}

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function prevMonth(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function nextMonth(year, month) {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
