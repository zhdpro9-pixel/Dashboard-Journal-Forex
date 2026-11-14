'use strict';

/* ================= Supabase Cloud Sync ================= */
const SUPABASE_URL = 'https://zjijuacfakzahzqdatvw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Ltme65PX9Svhm7lQEXl5rA_NqTroqpt';
let sbClient = null;
let currentUser = null;
let isSyncing = false;
let realtimeChannel = null;

try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }
} catch (e) {
  console.warn('Supabase client failed to initialize:', e);
}

/* ================= util ================= */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const NS = 'http://www.w3.org/2000/svg';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTHS_FULL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const LS_KEY = 'tjd.trades.v1', LS_SET = 'tjd.settings.v1';
const EMPTY_CH = '<div class="chart-empty">Belum ada trade pada periode ini.</div>';

const pad = n => String(n).padStart(2, '0');
const parseISO = s => { const [a, b, c] = s.split('-').map(Number); return new Date(a, b - 1, c) };
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => iso(new Date());
function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d) }
const fmtDate = s => { if (!s) return '—'; const d = parseISO(s); return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
const fmtDateLong = s => { const d = parseISO(s); return `${DAYS[d.getDay()]}, ${fmtDate(s)}` };
const shortDate = s => { const p = fmtDate(s).split(' '); return p[0] + ' ' + p[1] };
const nf = (v, min, max) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: min, maximumFractionDigits: max }).format(v);
function fmtPct(v, dec = 2) { if (v == null || isNaN(v)) return '—'; return (v > 0 ? '+' : '') + nf(v, dec, dec) + '%' }
function fmtPrice(v) { if (v == null || isNaN(v)) return '—'; const dec = Math.abs(v) < 2 ? 5 : 2; return nf(v, dec, dec) }
const fmtInt = v => nf(v, 0, 0);
function fmtAxisPct(v) { const d = Math.abs(v) >= 10 ? 0 : Math.abs(v) >= 1 ? 1 : 2; return (v > 0 ? '+' : '') + new Intl.NumberFormat('id-ID', { maximumFractionDigits: d }).format(v) + '%' }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trunc = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const pcls = v => (v == null || v === 0) ? 'be' : (v > 0 ? 'pos' : 'neg');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }

/* ================= data ================= */
const LS_ACCOUNTS = 'tjd.accounts.v1';
const LS_ACTIVE_USER = 'tjd.active_user.v1';
const LS_INIT_MIGRATED = 'tjd.init_migrated.v1';

function loadAccounts() {
  try { return JSON.parse(localStorage.getItem(LS_ACCOUNTS) || '{}') || {}; }
  catch (e) { return {}; }
}
function saveAccounts(acc) {
  try { localStorage.setItem(LS_ACCOUNTS, JSON.stringify(acc)); } catch (e) {}
}
function getAccountRecord(email) {
  if (!email) return null;
  const acc = loadAccounts();
  return acc[email.toLowerCase()] || null;
}
function upsertAccountRecord(email, patch) {
  if (!email) return null;
  const key = email.toLowerCase();
  const acc = loadAccounts();
  acc[key] = Object.assign({ email: key, id: uid(), pin: '', passHash: '' }, acc[key] || {}, patch);
  saveAccounts(acc);
  return acc[key];
}
function simpleHash(str) {
  let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const LS_DELETED_PREFIX = 'tjd.deleted_trades.u.';
function getDeletedTradeIds(email) {
  if (!email) return new Set();
  try {
    const arr = JSON.parse(localStorage.getItem(LS_DELETED_PREFIX + email.toLowerCase()) || '[]');
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch (_) { return new Set(); }
}
function saveDeletedTradeIds(email, setObj) {
  if (!email) return;
  const arr = [...setObj].slice(-500);
  try { localStorage.setItem(LS_DELETED_PREFIX + email.toLowerCase(), JSON.stringify(arr)); } catch (_) { }
}
function addDeletedTradeId(email, id) {
  if (!email || !id) return;
  const s = getDeletedTradeIds(email);
  s.add(String(id));
  saveDeletedTradeIds(email, s);
}
function removeDeletedTradeId(email, id) {
  if (!email || !id) return;
  const s = getDeletedTradeIds(email);
  if (s.delete(String(id))) {
    saveDeletedTradeIds(email, s);
  }
}
async function syncDeletedIdsToCloud(email) {
  if (!email || !sbClient || !currentUser || currentUser.isLocalOnly) return;
  try {
    const arr = [...getDeletedTradeIds(email)].slice(-300);
    await sbClient.auth.updateUser({ data: { deleted_trades: arr } });
  } catch (_) { }
}
function getUserTradesKey() {
  if (currentUser && currentUser.email) {
    return 'tjd.trades.u.' + currentUser.email.toLowerCase();
  }
  try {
    const active = JSON.parse(localStorage.getItem(LS_ACTIVE_USER) || 'null');
    if (active && active.email) return 'tjd.trades.u.' + active.email.toLowerCase();
  } catch (_) {}
  return LS_KEY;
}
function loadTrades() {
  try {
    const key = getUserTradesKey();
    let raw = localStorage.getItem(key);
    if ((!raw || raw === '[]') && key !== LS_KEY && !localStorage.getItem('tjd.migrated.' + key)) {
      const legacy = localStorage.getItem(LS_KEY);
      if (legacy && legacy !== '[]') {
        localStorage.setItem(key, legacy);
        raw = legacy;
      }
      localStorage.setItem('tjd.migrated.' + key, '1');
    }
    const r = JSON.parse(raw || '[]');
    const deletedSet = getDeletedTradeIds(currentUser?.email);
    return Array.isArray(r)
      ? r.filter(t => t && t.date && t.entry > 0 && t.exit > 0 && !deletedSet.has(String(t.id))).map(t => {
          if (t.lot == null && t.capital != null) t.lot = 0.10;
          return t;
        })
      : [];
  } catch (e) {
    return [];
  }
}
function saveTrades() {
  try {
    const key = getUserTradesKey();
    localStorage.setItem(key, JSON.stringify(trades));
  } catch (e) {}
}
function loadSettings() { try { const s = JSON.parse(localStorage.getItem(LS_SET) || '{}'); if (s.period) state.period = s.period; if (s.cumMethod) state.cumMethod = s.cumMethod } catch (e) { } }
function saveSettings() { try { localStorage.setItem(LS_SET, JSON.stringify({ period: state.period, cumMethod: state.cumMethod })) } catch (e) { } }

/* ================= CAPITAL & EQUITY TRACKING (OPSI B) ================= */
const LS_CAP_FALLBACK = 'tjd.capital.v1';
function getUserCapitalKey() {
  if (currentUser && currentUser.email) {
    return 'tjd.capital.u.' + currentUser.email.toLowerCase();
  }
  try {
    const active = JSON.parse(localStorage.getItem(LS_ACTIVE_USER) || 'null');
    if (active && active.email) return 'tjd.capital.u.' + active.email.toLowerCase();
  } catch (_) {}
  return LS_CAP_FALLBACK;
}
function loadCapitalConfig() {
  try {
    const key = getUserCapitalKey();
    let raw = localStorage.getItem(key);
    if (!raw && key !== LS_CAP_FALLBACK) {
      raw = localStorage.getItem(LS_CAP_FALLBACK);
    }
    const parsed = JSON.parse(raw || 'null');
    if (parsed && typeof parsed === 'object') {
      return {
        initialBalance: isFinite(Number(parsed.initialBalance)) && Number(parsed.initialBalance) >= 0 ? Number(parsed.initialBalance) : 1000,
        autoSyncPs: parsed.autoSyncPs !== false,
        flows: Array.isArray(parsed.flows) ? parsed.flows.filter(f => f && f.amount > 0 && f.date) : [],
        updatedAt: Number(parsed.updatedAt || 0)
      };
    }
  } catch (_) {}
  return { initialBalance: 1000, autoSyncPs: true, flows: [], updatedAt: 0 };
}
let capitalConfig = loadCapitalConfig();

async function syncCapitalToCloud() {
  if (!sbClient || !currentUser || currentUser.isLocalOnly) return;
  try {
    await ensureCloudSession();
    await sbClient.auth.updateUser({ data: { capital_config: capitalConfig } });
  } catch (e) {
    console.warn('Cloud sync capital error:', e);
  }
}

function saveCapitalConfig(syncCloud = true) {
  capitalConfig.updatedAt = Date.now();
  try {
    localStorage.setItem(getUserCapitalKey(), JSON.stringify(capitalConfig));
  } catch (_) {}
  if (syncCloud) syncCapitalToCloud();
}

function calcAccountEquity() {
  const cap = capitalConfig || loadCapitalConfig();
  const initBal = Math.max(0, Number(cap.initialBalance) || 0);
  let runningBalance = initBal;
  let totalDeposit = 0;
  let totalWithdraw = 0;
  let tradingProfitUsd = 0;
  let twrFactor = 1.0;
  const tradePnlMap = new Map();

  // Gabungkan event mutasi modal & trade secara kronologis berdasarkan tanggal
  const events = [];
  (cap.flows || []).forEach(f => {
    const amt = Number(f.amount) || 0;
    if (amt > 0 && f.date) {
      events.push({
        kind: 'flow',
        date: f.date,
        order: 0, // Mutasi modal di tanggal yang sama dihitung sebelum trade hari itu
        createdAt: Number(f.createdAt || 0),
        flow: f
      });
    }
  });
  sorted().forEach(t => {
    events.push({
      kind: 'trade',
      date: t.date || '',
      order: 1,
      createdAt: Number(t.createdAt || 0),
      trade: t
    });
  });

  events.sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') ||
    (a.order - b.order) ||
    (a.createdAt - b.createdAt)
  );

  events.forEach(ev => {
    if (ev.kind === 'flow') {
      const amt = Number(ev.flow.amount) || 0;
      if (ev.flow.type === 'withdraw') {
        runningBalance = Math.max(0, runningBalance - amt);
        totalWithdraw += amt;
      } else {
        runningBalance += amt;
        totalDeposit += amt;
      }
    } else if (ev.kind === 'trade') {
      const t = ev.trade;
      const retPct = tradeRet(t);
      const pnlUsd = runningBalance * (retPct / 100);
      runningBalance = Math.max(0, runningBalance + pnlUsd);
      tradingProfitUsd += pnlUsd;
      twrFactor *= (1 + retPct / 100);
      tradePnlMap.set(String(t.id), { pnlUsd, eqAfter: runningBalance, retPct });
    }
  });

  return {
    initialBalance: initBal,
    totalDeposit,
    totalWithdraw,
    netInjected: initBal + totalDeposit - totalWithdraw,
    tradingProfitUsd,
    currentBalance: runningBalance,
    growthPct: (twrFactor - 1) * 100,
    flowsCount: (cap.flows || []).length,
    tradePnlMap
  };
}
const LS_CUSTOM = 'tjd.custom_pairs.v1';
function loadCustomPairs() { try { return JSON.parse(localStorage.getItem(LS_CUSTOM) || '[]') } catch (e) { return [] } }
function saveCustomPairs(list) { localStorage.setItem(LS_CUSTOM, JSON.stringify(list)) }
const defaultPairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'XAUUSD', 'BTCUSDT'];
function populateAssetSelect(selectedVal = '') {
  const sel = $('#fAsset'), custom = loadCustomPairs(), current = selectedVal || sel.value || 'XAUUSD';
  sel.innerHTML = '';
  const og1 = document.createElement('optgroup'); og1.label = 'Pair Populer';
  defaultPairs.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; og1.appendChild(o) });
  sel.appendChild(og1);
  if (custom.length) {
    const og2 = document.createElement('optgroup'); og2.label = 'Pair Kustom';
    custom.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; og2.appendChild(o) });
    sel.appendChild(og2);
  }
  const oC = document.createElement('option'); oC.value = '__custom__'; oC.textContent = '+ Tambah Pair Lain...'; sel.appendChild(oC);
  if (selectedVal && !defaultPairs.includes(selectedVal) && !custom.includes(selectedVal)) {
    custom.push(selectedVal);
    saveCustomPairs(custom);
    populateAssetSelect(selectedVal);
    return;
  }
  sel.value = current;
  const psSel = $('#psPair');
  if (psSel) {
    const psCur = psSel.value || 'XAUUSD';
    psSel.innerHTML = '';
    const pog1 = document.createElement('optgroup'); pog1.label = 'Pair Populer';
    defaultPairs.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; pog1.appendChild(o) });
    psSel.appendChild(pog1);
    if (custom.length) {
      const pog2 = document.createElement('optgroup'); pog2.label = 'Pair Kustom';
      custom.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; pog2.appendChild(o) });
      psSel.appendChild(pog2);
    }
    if ([...defaultPairs, ...custom].includes(psCur)) psSel.value = psCur;
  }
}
function getPipMultiplier(asset) {
  if (!asset) return 10000; const a = asset.toUpperCase();
  if (a.includes('JPY')) return 100;
  if (a.includes('XAU') || a.includes('GOLD')) return 10;
  if (a.includes('BTC') || a.includes('ETH')) return 1;
  return 10000;
}
function calcPips(asset, pos, entry, exit) {
  if (!entry || !exit) return 0; const diff = pos === 'LONG' ? (exit - entry) : (entry - exit);
  return diff * getPipMultiplier(asset);
}
let trades = loadTrades();
const state = {
  page: 'overview', period: 'all', cFrom: '', cTo: '', cumMethod: 'comp', editingId: null, expanded: null, calCursor: null, selDay: null,
  j: { q: '', pos: 'ALL', from: '', to: '' }
};
let _freshRender = true;
loadSettings();
let formPos = 'LONG';

const tradeRet = t => t.position === 'LONG' ? (t.exit - t.entry) / t.entry * 100 : (t.entry - t.exit) / t.entry * 100;
const sorted = () => [...trades].sort((a, b) => a.date === b.date ? ((a.createdAt || 0) - (b.createdAt || 0)) : (a.date < b.date ? -1 : 1));
function periodRange() {
  const t = todayISO(); switch (state.period) {
    case '7d': return [addDays(t, -6), t]; case '30d': return [addDays(t, -29), t]; case '90d': return [addDays(t, -89), t];
    case 'custom': return [state.cFrom || null, state.cTo || null]; default: return [null, null]
  }
}
const pt = () => { const [f, t] = periodRange(); return sorted().filter(x => (!f || x.date >= f) && (!t || x.date <= t)) };
function periodLabel() {
  return {
    all: 'Semua Waktu', '7d': '7 Hari Terakhir', '30d': '30 Hari Terakhir', '90d': '90 Hari Terakhir',
    custom: `${state.cFrom ? fmtDate(state.cFrom) : '…'} – ${state.cTo ? fmtDate(state.cTo) : '…'}`
  }[state.period]
}

function metrics(arr) {
  const rets = arr.map(tradeRet);
  const wins = rets.filter(r => r > 0).length, losses = rets.filter(r => r < 0).length, be = rets.length - wins - losses;
  const avg = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null;
  const simple = rets.reduce((a, b) => a + b, 0);
  let eq = 100, peak = 100, maxDD = 0, ddDate = null; const eqPts = [100], curve = [0], simpleCurve = []; let s = 0;
  arr.forEach((t, i) => {
    eq *= (1 + rets[i] / 100); eqPts.push(eq); curve.push(eq - 100); s += rets[i]; simpleCurve.push(s);
    if (eq > peak) peak = eq; const dd = (eq / peak - 1) * 100; if (dd < maxDD) { maxDD = dd; ddDate = t.date }
  });
  return { rets, wins, losses, be, total: arr.length, winRate: rets.length ? wins / rets.length * 100 : null, avg, simple, comp: eq - 100, curve, simpleCurve, eqPts, maxDD, ddDate };
}
function drawdownSeries(m) { let peak = 100; return m.eqPts.map(eq => { if (eq > peak) peak = eq; return (eq / peak - 1) * 100 }) }
function sideStats(arr) {
  const mk = () => ({ n: 0, w: 0, sum: 0 }); const L = mk(), S = mk();
  arr.forEach(t => { const r = tradeRet(t), o = t.position === 'LONG' ? L : S; o.n++; o.sum += r; if (r > 0) o.w++ });
  [L, S].forEach(o => { o.avg = o.n ? o.sum / o.n : null; o.wr = o.n ? o.w / o.n * 100 : null }); return { L, S }
}
function streakInfo(arr) {
  let maxW = 0, maxL = 0, cur = 0, type = null;
  arr.forEach(t => {
    const r = tradeRet(t);
    if (r > 0) { cur = type === 'W' ? cur + 1 : 1; type = 'W'; maxW = Math.max(maxW, cur) }
    else if (r < 0) { cur = type === 'L' ? cur + 1 : 1; type = 'L'; maxL = Math.max(maxL, cur) }
    else { type = null; cur = 0 }
  });
  return { maxW, maxL, cur, type }
}

/* ================= svg helpers & tooltip ================= */
function el(n, a = {}, parent) { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); if (parent) parent.appendChild(e); return e }
function mkSvg(box, w, h) { const s = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'chart' }); s.setAttribute('width', '100%'); s.setAttribute('height', h); box.appendChild(s); return s }
function ticks(min, max, n = 4) {
  if (min === max) { min -= 1; max += 1 } const span = max - min, step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0))), norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag; const t0 = Math.ceil(min / step) * step, out = [];
  for (let v = t0; v <= max + 1e-9; v += step)out.push(+v.toFixed(10)); return out
}
const tip = $('#tooltip');
const tipRow = (l, v, c = '') => `<div class="tip-row"><span>${l}</span><b class="${c}">${v}</b></div>`;
function showTip(html, e) { tip.innerHTML = html; tip.classList.add('on'); moveTip(e) }
function moveTip(e) {
  const p = 14; let x = e.clientX + p, y = e.clientY + p; const r = tip.getBoundingClientRect();
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - p; if (y + r.height > innerHeight - 8) y = e.clientY - r.height - p;
  tip.style.left = x + 'px'; tip.style.top = y + 'px'
}
const hideTip = () => tip.classList.remove('on');

/* ================= toast & modal ================= */
function toast(msg, type = 'ok') {
  const d = document.createElement('div'); d.className = 'toast ' + type;
  d.innerHTML = `<span>${type === 'ok' ? '✔' : '⚠'}</span><span>${msg}</span>`;
  $('#toasts').appendChild(d); setTimeout(() => d.classList.add('out'), 2600); setTimeout(() => d.remove(), 3050)
}
function confirmBox({ title, msg, ok = 'Ya, Lanjutkan', danger = true }) {
  return new Promise(res => {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="overlay"><div class="modal"><h3>${title}</h3><p class="mmsg">${msg}</p>
    <div class="mact"><button class="btn ghost" id="mNo">Batal</button><button class="btn ${danger ? 'danger-solid' : 'primary'}" id="mYes">${ok}</button></div></div></div>`;
    const done = v => { root.innerHTML = ''; document.removeEventListener('keydown', esc); res(v) };
    const esc = e => { if (e.key === 'Escape') done(false) };
    document.addEventListener('keydown', esc);
    $('#mNo').onclick = () => done(false); $('#mYes').onclick = () => done(true);
    root.querySelector('.overlay').addEventListener('click', e => { if (e.target.classList.contains('overlay')) done(false) });
  })
}
function infoBox(title, html) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="overlay"><div class="modal"><h3>${title}</h3>${html}
    <div class="mact"><button class="btn primary" id="mOk">Mengerti</button></div></div></div>`;
  const done = () => { root.innerHTML = ''; document.removeEventListener('keydown', esc) };
  const esc = e => { if (e.key === 'Escape') done() };
  document.addEventListener('keydown', esc);
  $('#mOk').onclick = done;
  root.querySelector('.overlay').addEventListener('click', e => { if (e.target.classList.contains('overlay')) done() });
}

function openAddPairModal(fallbackVal = 'XAUUSD') {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="overlay">
    <div class="modal" style="width:min(440px,94vw)">
      <h3 style="margin-bottom:6px">Tambah Pair Kustom</h3>
      <p class="mmsg" style="margin-bottom:14px">Masukkan nama simbol pair/aset baru (contoh: GBPJPY, ETHUSDT, XAGUSD).</p>
      <div style="margin-bottom:18px">
        <label style="font:600 11px var(--font-b);letter-spacing:.06em;text-transform:uppercase;color:var(--mut);display:block;margin-bottom:6px">Nama Simbol Pair</label>
        <input type="text" id="mCustomPairInput" placeholder="Contoh: GBPJPY" maxlength="20" autofocus style="font-family:var(--font-m);font-weight:600;font-size:15px;letter-spacing:.05em;text-transform:uppercase">
        <div id="mCustomPairErr" style="color:var(--red);font-size:12px;margin-top:6px" hidden></div>
      </div>
      <div class="mact">
        <button type="button" class="btn ghost" id="mCustomCancel">Batal</button>
        <button type="button" class="btn primary" id="mCustomAdd">Tambah Pair ↵</button>
      </div>
    </div>
  </div>`;

  const input = $('#mCustomPairInput'), errDiv = $('#mCustomPairErr');
  setTimeout(() => input.focus(), 60);

  const close = () => {
    root.innerHTML = '';
    document.removeEventListener('keydown', keyHandler);
    if ($('#fAsset') && $('#fAsset').value === '__custom__') {
      $('#fAsset').value = fallbackVal;
      updatePreview();
    }
  };

  const submit = () => {
    const raw = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!raw) {
      errDiv.textContent = 'Nama pair tidak boleh kosong.';
      errDiv.hidden = false;
      input.focus();
      return;
    }
    const custom = loadCustomPairs();
    if (defaultPairs.includes(raw) || custom.includes(raw)) {
      populateAssetSelect(raw);
      root.innerHTML = '';
      document.removeEventListener('keydown', keyHandler);
      updatePreview();
      toast(`Pair ${raw} sudah ada dan telah dipilih`);
      return;
    }
    custom.push(raw);
    saveCustomPairs(custom);
    if (currentUser && !currentUser.isLocalOnly && sbClient) {
      sbClient.from('custom_pairs').upsert({ user_id: currentUser.id, pair: raw }).then(({ error }) => {
        if (error) console.warn('Supabase custom pair insert error:', error);
      });
    }
    populateAssetSelect(raw);
    root.innerHTML = '';
    document.removeEventListener('keydown', keyHandler);
    updatePreview();
    toast(`Pair ${raw} berhasil ditambahkan`);
  };

  const keyHandler = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  document.addEventListener('keydown', keyHandler);
  $('#mCustomCancel').onclick = close;
  $('#mCustomAdd').onclick = submit;
  root.querySelector('.overlay').addEventListener('click', e => {
    if (e.target.classList.contains('overlay')) close();
  });
}

/* ================= Full-Screen Auth Gate, PIN 4 Angka & Cloud Sync ================= */
const SS_PIN_UNLOCKED = 'tjd.pin_unlocked.v1';
const LS_LAST_UNLOAD = 'tjd.last_unload_ts';

function isPageReload() {
  try {
    const navEntries = performance.getEntriesByType && performance.getEntriesByType('navigation');
    if (navEntries && navEntries.length > 0) {
      return navEntries[0].type === 'reload';
    }
    if (window.performance && window.performance.navigation) {
      return window.performance.navigation.type === 1;
    }
  } catch (_) {}
  return false;
}

function markSessionUnlocked(email) {
  try {
    if (email) {
      sessionStorage.setItem(SS_PIN_UNLOCKED, email.toLowerCase());
      localStorage.setItem('tjd.last_unlocked_user', email.toLowerCase());
    } else {
      sessionStorage.removeItem(SS_PIN_UNLOCKED);
    }
  } catch (_) {}
}

function isSessionUnlocked(email) {
  if (!email) return false;
  const em = email.toLowerCase();

  // 1. Cek sessionStorage (standar tab browser aktif)
  try {
    if (sessionStorage.getItem(SS_PIN_UNLOCKED) === em) return true;
  } catch (_) {}

  // 2. Cek apakah ini adalah refresh halaman (F5 / tarik refresh di HP / tombol reload)
  if (isPageReload()) {
    markSessionUnlocked(em);
    return true;
  }

  // 3. Cek jarak waktu unload halaman (< 3.5 detik = proses refresh)
  try {
    const lastUnload = Number(localStorage.getItem(LS_LAST_UNLOAD) || '0');
    if (lastUnload > 0 && (Date.now() - lastUnload) < 3500) {
      markSessionUnlocked(em);
      return true;
    }
  } catch (_) {}

  return false;
}

// Catat waktu unload saat halaman di-refresh atau ditutup
window.addEventListener('beforeunload', () => {
  try { localStorage.setItem(LS_LAST_UNLOAD, String(Date.now())); } catch (_) {}
});
window.addEventListener('pagehide', () => {
  try { localStorage.setItem(LS_LAST_UNLOAD, String(Date.now())); } catch (_) {}
});

let gateState = {
  mode: 'auth', // 'auth' | 'set-pin' | 'enter-pin'
  tab: 'login', // 'login' | 'register'
  pinInput: '',
  fromDashboard: false,
  prefillEmail: ''
};

function getSavedPin(email) {
  if (!email) return '';
  const rec = getAccountRecord(email);
  return (rec && rec.pin && /^\d{4}$/.test(rec.pin)) ? rec.pin : '';
}

function saveUserPin(email, pin) {
  if (!email || !/^\d{4}$/.test(pin)) return;
  upsertAccountRecord(email, { pin });
  if (sbClient && currentUser && !currentUser.isLocalOnly) {
    sbClient.auth.updateUser({ data: { pin } }).catch(() => {});
  }
}

function setActiveUserSession(userObj) {
  currentUser = userObj;
  try {
    if (userObj) {
      localStorage.setItem(LS_ACTIVE_USER, JSON.stringify({
        id: userObj.id,
        email: userObj.email,
        isLocalOnly: !!userObj.isLocalOnly
      }));
    } else {
      localStorage.removeItem(LS_ACTIVE_USER);
    }
  } catch (_) {}
  updateAuthUI();
}

function updateAuthUI() {
  const btn = $('#btnAuth');
  const dot = $('#authDot');
  const txt = $('#authStatusText');
  if (!btn || !dot || !txt) return;

  if (currentUser && currentUser.email) {
    const hasPin = !!getSavedPin(currentUser.email);
    dot.style.background = 'var(--green)';
    dot.style.boxShadow = '0 0 6px var(--green)';
    const emailPrefix = currentUser.email.split('@')[0];
    const shortName = emailPrefix.length > 12 ? emailPrefix.slice(0, 11) + '…' : emailPrefix;
    txt.textContent = `${shortName}${hasPin ? ' · 🔒' : ''}`;
    btn.title = `Akun aktif: ${currentUser.email} (Klik untuk pengaturan PIN & Cloud)`;
  } else {
    dot.style.background = 'var(--dim)';
    dot.style.boxShadow = 'none';
    txt.textContent = 'Masuk / Akun';
    btn.title = 'Masuk atau daftar akun';
  }
}

async function tryUpgradeToCloud(email, rawPass) {
  if (!sbClient || !email || !rawPass) return null;
  try {
    const { error: rpcErr } = await sbClient.rpc('register_trader', {
      p_email: email,
      p_password: rawPass
    });
    if (!rpcErr || (rpcErr.message && rpcErr.message.includes('already registered'))) {
      const { data: signInData } = await sbClient.auth.signInWithPassword({
        email,
        password: rawPass
      });
      if (signInData?.user) return signInData.user;
    }
  } catch (_) {}
  return null;
}

function showUpdateBanner() {
  hideUpdateBanner();
}

function hideUpdateBanner() {
  const banner = $('#syncUpdateBanner');
  if (banner) {
    banner.hidden = true;
    banner.remove();
  }
}
hideUpdateBanner();

function computeTradesHash(list) {
  if (!list || !list.length) return 'empty';
  return list
    .map(t => `${String(t.id)}:${t.date || ''}:${t.asset || ''}:${t.position || ''}:${Number(t.entry)}:${Number(t.exit)}:${Number(t.lot ?? 0.01)}:${(t.notes || '').trim()}`)
    .sort()
    .join('|');
}

async function ensureCloudSession() {
  if (!sbClient || !currentUser || !currentUser.email) return false;
  try {
    const { data: { session } } = await sbClient.auth.getSession();
    if (session?.user) {
      if (currentUser.isLocalOnly || currentUser.id !== session.user.id) {
        currentUser = { id: session.user.id, email: session.user.email.toLowerCase(), isLocalOnly: false };
        setActiveUserSession(currentUser);
      }
      const cloudDeleted = session.user.user_metadata?.deleted_trades;
      if (Array.isArray(cloudDeleted) && cloudDeleted.length) {
        const s = getDeletedTradeIds(currentUser.email);
        cloudDeleted.forEach(id => s.add(String(id)));
        saveDeletedTradeIds(currentUser.email, s);
      }
      return true;
    }
    const rec = getAccountRecord(currentUser.email);
    if (rec && rec.rawPassB64) {
      const rawPass = decodeURIComponent(escape(atob(rec.rawPassB64)));
      const { data: sData, error: sErr } = await sbClient.auth.signInWithPassword({
        email: currentUser.email,
        password: rawPass
      });
      if (!sErr && sData?.user) {
        currentUser = { id: sData.user.id, email: sData.user.email.toLowerCase(), isLocalOnly: false };
        setActiveUserSession(currentUser);
        const cloudDeleted = sData.user.user_metadata?.deleted_trades;
        if (Array.isArray(cloudDeleted) && cloudDeleted.length) {
          const s = getDeletedTradeIds(currentUser.email);
          cloudDeleted.forEach(id => s.add(String(id)));
          saveDeletedTradeIds(currentUser.email, s);
        }
        return true;
      }
      const cloudUser = await tryUpgradeToCloud(currentUser.email, rawPass);
      if (cloudUser) {
        currentUser = { id: cloudUser.id, email: cloudUser.email.toLowerCase(), isLocalOnly: false };
        setActiveUserSession(currentUser);
        return true;
      }
    }
  } catch (e) {
    console.warn('ensureCloudSession error:', e);
  }
  return !currentUser.isLocalOnly;
}

async function checkForRemoteUpdates() {
  if (!currentUser || !sbClient || isSyncing) return;
  if (trades.some(t => t._unsynced)) {
    syncFromCloud(false);
    return;
  }
  try {
    const okSession = await ensureCloudSession();
    if (!okSession || currentUser.isLocalOnly) return;

    const { data, error } = await sbClient
      .from('trades')
      .select('id, date, asset, position, entry, exit, lot, notes')
      .order('date', { ascending: true });

    if (error || !data) return;

    const deletedSet = getDeletedTradeIds(currentUser.email);
    const validRemote = data.filter(t => !deletedSet.has(String(t.id)));

    const cloudHash = computeTradesHash(validRemote);
    const localHash = computeTradesHash(trades);

    if (cloudHash !== localHash) {
      await syncFromCloud(false);
    }
  } catch (_) {}
}

async function syncFromCloud(showFeedback = false) {
  if (!currentUser || !sbClient || isSyncing) return;

  const okSession = await ensureCloudSession();
  if (!okSession || currentUser.isLocalOnly) {
    if (showFeedback) toast('Data tersimpan aman di perangkat (jalankan SQL Supabase untuk sinkron cloud)');
    return;
  }

  isSyncing = true;
  try {
    const emailKey = currentUser.email.toLowerCase();
    const initKey = 'tjd.cloud_init.' + emailKey;
    const wasInitialized = localStorage.getItem(initKey) === '1';
    const prevHash = computeTradesHash(trades);
    const prevCount = trades.length;

    // 0. Sinkronkan daftar deleted_trades & capital_config terbaru dari user_metadata jika ada
    try {
      const { data: uData } = await sbClient.auth.getUser();
      const cloudDeleted = uData?.user?.user_metadata?.deleted_trades;
      if (Array.isArray(cloudDeleted) && cloudDeleted.length) {
        const s = getDeletedTradeIds(emailKey);
        cloudDeleted.forEach(id => s.add(String(id)));
        saveDeletedTradeIds(emailKey, s);
      }
      const cloudCap = uData?.user?.user_metadata?.capital_config;
      if (cloudCap && typeof cloudCap === 'object') {
        const localCap = loadCapitalConfig();
        if (Number(cloudCap.updatedAt || 0) > Number(localCap.updatedAt || 0)) {
          capitalConfig = {
            initialBalance: isFinite(Number(cloudCap.initialBalance)) ? Number(cloudCap.initialBalance) : 1000,
            autoSyncPs: cloudCap.autoSyncPs !== false,
            flows: Array.isArray(cloudCap.flows) ? cloudCap.flows : [],
            updatedAt: Number(cloudCap.updatedAt || Date.now())
          };
          try { localStorage.setItem(getUserCapitalKey(), JSON.stringify(capitalConfig)); } catch (_) {}
        } else if (Number(localCap.updatedAt || 0) > Number(cloudCap.updatedAt || 0)) {
          syncCapitalToCloud();
        }
      }
    } catch (_) {}

    // 1. Ambil custom pairs jika ada
    try {
      const { data: cPairs } = await sbClient.from('custom_pairs').select('pair');
      if (cPairs && Array.isArray(cPairs) && cPairs.length) {
        const local = loadCustomPairs();
        const merged = Array.from(new Set([...local, ...cPairs.map(x => x.pair)]));
        saveCustomPairs(merged);
        populateAssetSelect($('#fAsset')?.value || '');
      }
    } catch (_) {}

    // 2. Ambil trades milik user ini dari Supabase Cloud
    const { data, error } = await sbClient
      .from('trades')
      .select('*')
      .order('date', { ascending: true });

    if (error) throw error;

    const cloudTrades = (data || []).map(t => ({
      id: String(t.id),
      date: t.date,
      asset: t.asset,
      position: t.position,
      entry: Number(t.entry),
      exit: Number(t.exit),
      lot: t.lot != null ? Number(t.lot) : 0.01,
      notes: t.notes || '',
      createdAt: Number(t.created_at || t.createdAt || Date.now()),
      _synced: true
    }));

    const deletedSet = getDeletedTradeIds(emailKey);

    // 3. Hapus dari cloud jika ada trade yang tercatat dihapus tapi masih ada di cloud
    const toDeleteFromCloud = cloudTrades.filter(t => deletedSet.has(String(t.id)));
    if (toDeleteFromCloud.length > 0) {
      await Promise.all(
        toDeleteFromCloud.map(dt => sbClient.from('trades').delete().eq('id', String(dt.id)))
      );
    }

    // Filter trade cloud yang sudah dihapus
    const validCloudTrades = cloudTrades.filter(t => !deletedSet.has(String(t.id)));

    // 4. Hanya unggah trade lokal yang benar-benar baru/diedit (_unsynced === true) atau migrasi pertama kali saat cloud masih kosong
    const isFirstMigration = !wasInitialized && cloudTrades.length === 0 && trades.length > 0;
    const pendingLocalTrades = trades.filter(t =>
      !deletedSet.has(String(t.id)) && (t._unsynced === true || isFirstMigration)
    );

    if (pendingLocalTrades.length > 0) {
      const rowsToUpload = pendingLocalTrades.map(t => ({
        id: String(t.id),
        user_id: currentUser.id,
        date: t.date,
        asset: t.asset,
        position: t.position,
        entry: Number(t.entry),
        exit: Number(t.exit),
        lot: t.lot != null ? Number(t.lot) : 0.01,
        notes: t.notes || '',
        created_at: Number(t.createdAt || Date.now())
      }));
      const { error: upErr } = await sbClient.from('trades').upsert(rowsToUpload);
      if (!upErr) {
        pendingLocalTrades.forEach(t => {
          delete t._unsynced;
          t._synced = true;
        });
      } else {
        console.warn('Sync upload pending trades error:', upErr);
      }
    }

    // 5. Gabungkan: validCloudTrades + pendingLocalTrades (trade lama yang tidak ada di validCloudTrades berarti telah dihapus di perangkat lain!)
    const mergedMap = new Map();
    validCloudTrades.forEach(t => mergedMap.set(String(t.id), t));
    pendingLocalTrades.forEach(t => mergedMap.set(String(t.id), t));
    const finalTrades = Array.from(mergedMap.values());
    finalTrades.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0));

    const newHash = computeTradesHash(finalTrades);
    trades = finalTrades;
    saveTrades();
    try { localStorage.setItem(initKey, '1'); } catch (_) {}
    renderAll();

    if (showFeedback) {
      toast('Data tersinkronisasi dengan Cloud');
      hideUpdateBanner();
    } else if (wasInitialized && prevHash !== newHash) {
      const act = finalTrades.length < prevCount ? 'penghapusan' : (finalTrades.length > prevCount ? 'penambahan' : 'perubahan');
      toast(`Data diperbarui otomatis (${act} dari perangkat lain)`);
      hideUpdateBanner();
    } else {
      hideUpdateBanner();
    }
  } catch (err) {
    console.warn('Sync error:', err);
    if (showFeedback) toast('Gagal sinkron Cloud: ' + (err.message || 'Periksa tabel Supabase'), 'err');
  } finally {
    isSyncing = false;
  }
}

function subscribeRealtime() {
  if (!sbClient || !currentUser || currentUser.isLocalOnly) return;
  if (realtimeChannel) {
    try { sbClient.removeChannel(realtimeChannel); } catch (_) { }
    realtimeChannel = null;
  }
  try {
    realtimeChannel = sbClient
      .channel('public:trades:' + currentUser.id)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'trades'
      }, payload => {
        const ev = payload.eventType;
        if (ev === 'DELETE' && payload.old?.id) {
          addDeletedTradeId(currentUser?.email, payload.old.id);
        }
        checkForRemoteUpdates();
      })
      .subscribe();
  } catch (e) {
    console.warn('Realtime subscription error:', e);
  }
}

function unlockGate() {
  if (currentUser && currentUser.email) {
    markSessionUnlocked(currentUser.email);
  }
  const gate = $('#authGate');
  if (!gate) return;
  gate.classList.add('unlocking');
  setTimeout(() => {
    gate.hidden = true;
    gate.classList.remove('unlocking');
    gate.innerHTML = '';
    trades = loadTrades();
    capitalConfig = loadCapitalConfig();
    if (typeof loadAiConfig === 'function') loadAiConfig();
    renderAll();
    syncFromCloud();
    subscribeRealtime();
  }, 220);
}

function showGate(mode, opts = {}) {
  const gate = $('#authGate');
  if (!gate) return;
  gateState.mode = mode;
  gateState.pinInput = '';
  gateState.fromDashboard = !!opts.fromDashboard;
  gateState.forceNewPin = !!opts.forceNewPin;
  if (opts.tab) gateState.tab = opts.tab;
  if (opts.prefillEmail != null) gateState.prefillEmail = opts.prefillEmail;
  gate.hidden = false;
  gate.classList.remove('unlocking');
  renderAuthGate();
}

function renderAuthGate() {
  const gate = $('#authGate');
  if (!gate || gate.hidden) return;

  const brandHTML = `
    <div class="auth-brand">
      <div class="auth-brand-logo">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M7 3v3M7 16v5" stroke="#16c784" stroke-width="1.8" stroke-linecap="round" />
          <rect x="4.5" y="6" width="5" height="10" rx="1.2" fill="#16c784" />
          <path d="M17 4v4M17 16v4" stroke="#f6465d" stroke-width="1.8" stroke-linecap="round" />
          <rect x="14.5" y="8" width="5" height="8" rx="1.2" fill="#f6465d" />
        </svg>
      </div>
      <div class="auth-brand-txt">
        <b>Trading Journey</b>
        <span>Performance Journal</span>
      </div>
    </div>`;

  // MODE 1: ENTER PIN (4 ANGKA) SAAT SUDAH PERNAH LOGIN
  if (gateState.mode === 'enter-pin' && currentUser) {
    const email = currentUser.email || 'Trader';
    gate.innerHTML = `
      <div class="auth-card" id="gateCard">
        ${brandHTML}
        <div style="text-align:center">
          <div class="auth-user-pill">
            <i style="width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block"></i>
            <span>${esc(email)}</span>
          </div>
        </div>
        <h2 class="auth-title">Masukkan PIN</h2>
        <p class="auth-sub" id="pinSubMsg">Masukkan 4 angka PIN keamanan Anda untuk masuk ke aplikasi.</p>

        <div class="pin-boxes" id="pinBoxes">
          <div class="pin-box active"></div>
          <div class="pin-box"></div>
          <div class="pin-box"></div>
          <div class="pin-box"></div>
        </div>

        <div class="pin-pad" id="pinPad">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" class="pin-btn" data-k="${n}">${n}</button>`).join('')}
          <button type="button" class="pin-btn fn" data-k="clear">Ulang</button>
          <button type="button" class="pin-btn" data-k="0">0</button>
          <button type="button" class="pin-btn fn" data-k="back">⌫</button>
        </div>

        <div class="pin-links">
          <button type="button" class="pin-link" id="btnForgotPin">Lupa PIN? Pakai Password</button>
          <button type="button" class="pin-link danger" id="btnSwitchAcc">Ganti Akun / Logout</button>
        </div>
      </div>`;

    $('#pinPad').onclick = e => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      handlePinKey(b.dataset.k);
    };
    $('#btnForgotPin').onclick = () => {
      showGate('auth', { tab: 'login', prefillEmail: email, forceNewPin: true });
    };
    $('#btnSwitchAcc').onclick = async () => {
      if (sbClient) { try { await sbClient.auth.signOut(); } catch (_) {} }
      markSessionUnlocked(null);
      setActiveUserSession(null);
      showGate('auth', { tab: 'login', prefillEmail: '' });
    };
    return;
  }

  // MODE 2: ATUR PIN 4 ANGKA (SETELAH LOGIN/REGISTER PERTAMA KALI ATAU UBAH PIN)
  if (gateState.mode === 'set-pin' && currentUser) {
    const email = currentUser.email || 'Trader';
    gate.innerHTML = `
      <div class="auth-card" id="gateCard">
        ${brandHTML}
        <div style="text-align:center">
          <div class="auth-user-pill">
            <i style="width:7px;height:7px;border-radius:50%;background:var(--gold);display:inline-block"></i>
            <span>${esc(email)}</span>
          </div>
        </div>
        <h2 class="auth-title">${gateState.fromDashboard ? 'Ubah PIN 4 Angka' : 'Atur PIN 4 Angka'}</h2>
        <p class="auth-sub" id="pinSubMsg">Buat 4 angka PIN agar saat membuka aplikasi berikutnya Anda cukup memasukkan PIN tanpa perlu login ulang.</p>

        <div class="pin-boxes" id="pinBoxes">
          <div class="pin-box active"></div>
          <div class="pin-box"></div>
          <div class="pin-box"></div>
          <div class="pin-box"></div>
        </div>

        <div class="pin-pad" id="pinPad">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" class="pin-btn" data-k="${n}">${n}</button>`).join('')}
          <button type="button" class="pin-btn fn" data-k="clear">Ulang</button>
          <button type="button" class="pin-btn" data-k="0">0</button>
          <button type="button" class="pin-btn fn" data-k="back">⌫</button>
        </div>

        ${gateState.fromDashboard ? `
        <div style="text-align:center;margin-top:8px">
          <button type="button" class="btn ghost sm" id="btnCancelSetPin">Batal</button>
        </div>` : ''}
      </div>`;

    $('#pinPad').onclick = e => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      handlePinKey(b.dataset.k);
    };
    if ($('#btnCancelSetPin')) {
      $('#btnCancelSetPin').onclick = () => unlockGate();
    }
    return;
  }

  // MODE 3: LOGIN & REGISTRASI AWAL MASUK APLIKASI
  const isLogin = gateState.tab === 'login';
  gate.innerHTML = `
    <div class="auth-card" id="gateCard">
      ${brandHTML}
      <h2 class="auth-title">${isLogin ? 'Selamat Datang Kembali' : 'Buat Akun Trader Baru'}</h2>
      <p class="auth-sub">${isLogin
        ? 'Masuk ke akun Anda untuk mengakses dan menyinkronkan jurnal trading di Laptop & HP.'
        : 'Daftarkan email & kata sandi Anda, lalu atur PIN 4 angka untuk akses masuk cepat.'}</p>

      <div class="auth-tabs">
        <button type="button" class="auth-tab ${isLogin ? 'active' : ''}" data-tab="login">Masuk (Login)</button>
        <button type="button" class="auth-tab ${!isLogin ? 'active' : ''}" data-tab="register">Daftar Akun</button>
      </div>

      <div class="auth-err" id="gateErr" hidden></div>

      <form id="gateForm" novalidate>
        <div class="auth-field">
          <label for="gateEmail">Alamat Email</label>
          <input type="email" id="gateEmail" placeholder="contoh: trader@gmail.com" value="${esc(gateState.prefillEmail || '')}" autocomplete="email" required>
        </div>
        <div class="auth-field">
          <label for="gatePass">Kata Sandi</label>
          <div class="pass-wrap">
            <input type="password" id="gatePass" placeholder="Minimal 6 karakter" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required minlength="6">
            <button type="button" class="pass-toggle" id="btnTogglePass">Lihat</button>
          </div>
        </div>

        <button type="submit" class="btn primary full" id="btnGateSubmit" style="margin-top:8px;height:42px;font-size:14px">
          ${isLogin ? 'Masuk ke Aplikasi →' : 'Daftar & Atur PIN →'}
        </button>

        <div class="auth-note">
          <b>🔐 Akses Cepat PIN 4 Angka</b>: Setelah login pertama kali, Anda cukup menggunakan 4 angka PIN setiap kali membuka aplikasi.
        </div>
      </form>
    </div>`;

  $$('#gateCard .auth-tab').forEach(b => {
    b.onclick = () => {
      const emailEl = $('#gateEmail');
      if (emailEl) gateState.prefillEmail = emailEl.value.trim();
      gateState.tab = b.dataset.tab;
      renderAuthGate();
    };
  });

  const passIn = $('#gatePass');
  const toggleBtn = $('#btnTogglePass');
  if (toggleBtn && passIn) {
    toggleBtn.onclick = () => {
      const show = passIn.type === 'password';
      passIn.type = show ? 'text' : 'password';
      toggleBtn.textContent = show ? 'Tutup' : 'Lihat';
    };
  }

  const focusEl = gateState.prefillEmail ? $('#gatePass') : $('#gateEmail');
  if (focusEl) setTimeout(() => focusEl.focus(), 40);

  $('#gateForm').onsubmit = async e => {
    e.preventDefault();
    const email = ($('#gateEmail').value || '').trim().toLowerCase();
    const password = $('#gatePass').value || '';
    const errBox = $('#gateErr');
    const submitBtn = $('#btnGateSubmit');

    errBox.hidden = true;
    if (!email || !email.includes('@') || !email.includes('.')) {
      errBox.textContent = 'Masukkan alamat email yang valid (contoh: nama@gmail.com).';
      errBox.hidden = false;
      $('#gateEmail').focus();
      return;
    }
    if (!password || password.length < 6) {
      errBox.textContent = 'Kata sandi wajib minimal 6 karakter.';
      errBox.hidden = false;
      $('#gatePass').focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Memproses...';

    try {
      const userResult = await performUserAuth(gateState.tab, email, password);
      setActiveUserSession(userResult);
      trades = loadTrades();

      const existingPin = getSavedPin(email);
      if (!existingPin || gateState.forceNewPin) {
        gateState.forceNewPin = false;
        toast(gateState.tab === 'register' ? 'Akun berhasil dibuat! Silakan atur PIN 4 angka' : 'Silakan atur PIN 4 angka baru Anda');
        showGate('set-pin');
      } else {
        toast('Selamat datang kembali!');
        unlockGate();
      }
    } catch (err) {
      errBox.textContent = err.message || 'Gagal memproses autentikasi.';
      errBox.hidden = false;
      $('#gateCard').classList.add('shake');
      setTimeout(() => $('#gateCard')?.classList.remove('shake'), 450);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isLogin ? 'Masuk ke Aplikasi →' : 'Daftar & Atur PIN →';
      }
    }
  };
}

async function performUserAuth(tab, email, password) {
  const passHash = simpleHash(password);
  const rawPassB64 = btoa(unescape(encodeURIComponent(password)));

  if (tab === 'register') {
    // 1. Coba daftar ke Supabase Cloud via fungsi RPC register_trader (bebas limit email)
    if (sbClient) {
      try {
        const { error: rpcErr } = await sbClient.rpc('register_trader', {
          p_email: email,
          p_password: password
        });
        if (!rpcErr) {
          const { data: sData, error: sErr } = await sbClient.auth.signInWithPassword({ email, password });
          if (!sErr && sData?.user) {
            const cloudPin = sData.user.user_metadata?.pin || '';
            upsertAccountRecord(email, { id: sData.user.id, passHash, rawPassB64, pin: cloudPin || getSavedPin(email) });
            return { id: sData.user.id, email, isLocalOnly: false };
          }
        } else if (rpcErr.message && rpcErr.message.includes('already registered')) {
          // Jika akun sudah terdaftar di cloud, coba login langsung bila password cocok
          const { data: sData, error: sErr } = await sbClient.auth.signInWithPassword({ email, password });
          if (!sErr && sData?.user) {
            const cloudPin = sData.user.user_metadata?.pin || '';
            upsertAccountRecord(email, { id: sData.user.id, passHash, rawPassB64, pin: cloudPin || getSavedPin(email) });
            return { id: sData.user.id, email, isLocalOnly: false };
          }
          throw new Error('Email ini sudah terdaftar. Silakan masuk melalui tab "Masuk (Login)".');
        }
      } catch (e) {
        if (e.message && e.message.includes('sudah terdaftar')) throw e;
      }

      // 2. Fallback ke signUp standar jika RPC belum dipasang
      try {
        const { data, error } = await sbClient.auth.signUp({ email, password });
        if (!error && data?.session?.user) {
          upsertAccountRecord(email, { id: data.session.user.id, passHash, rawPassB64 });
          return { id: data.session.user.id, email, isLocalOnly: false };
        }
        if (error && error.message && error.message.includes('User already registered')) {
          const { data: sData, error: sErr } = await sbClient.auth.signInWithPassword({ email, password });
          if (!sErr && sData?.user) {
            upsertAccountRecord(email, { id: sData.user.id, passHash, rawPassB64 });
            return { id: sData.user.id, email, isLocalOnly: false };
          }
          throw new Error('Email sudah terdaftar. Silakan pilih tab "Masuk (Login)".');
        }
      } catch (e) {
        if (e.message && e.message.includes('sudah terdaftar')) throw e;
      }
    }

    // 3. Simpan & aktifkan akun (otomatis sinkron ke cloud begitu SQL RPC aktif)
    const existingLocal = getAccountRecord(email);
    if (existingLocal && existingLocal.passHash && existingLocal.passHash !== passHash) {
      throw new Error('Email ini sudah terdaftar di perangkat ini. Silakan pilih tab "Masuk (Login)".');
    }
    const rec = upsertAccountRecord(email, { passHash, rawPassB64 });
    return { id: rec.id, email, isLocalOnly: true };
  } else {
    // TAB LOGIN
    if (sbClient) {
      // 1. Coba signInWithPassword langsung
      const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
      if (!error && data?.user) {
        const cloudPin = data.user.user_metadata?.pin || '';
        upsertAccountRecord(email, {
          id: data.user.id,
          passHash,
          rawPassB64,
          pin: (/^\d{4}$/.test(cloudPin) ? cloudPin : getSavedPin(email))
        });
        return { id: data.user.id, email, isLocalOnly: false };
      }

      // 2. Jika akun sebelumnya tertahan "Email not confirmed", aktifkan via RPC register_trader lalu login
      try {
        const { data: rpcRes, error: rpcErr } = await sbClient.rpc('register_trader', {
          p_email: email,
          p_password: password
        });
        if (!rpcErr && rpcRes) {
          const { data: retryData, error: retryErr } = await sbClient.auth.signInWithPassword({ email, password });
          if (!retryErr && retryData?.user) {
            const cloudPin = retryData.user.user_metadata?.pin || '';
            upsertAccountRecord(email, {
              id: retryData.user.id,
              passHash,
              rawPassB64,
              pin: (/^\d{4}$/.test(cloudPin) ? cloudPin : getSavedPin(email))
            });
            return { id: retryData.user.id, email, isLocalOnly: false };
          }
        }
      } catch (_) {}
    }

    // 3. Cek akun yang tersimpan di perangkat
    const rec = getAccountRecord(email);
    if (rec && rec.passHash) {
      if (rec.passHash !== passHash) {
        throw new Error('Kata sandi salah. Silakan periksa kembali kata sandi Anda.');
      }
      return { id: rec.id, email, isLocalOnly: true };
    }

    throw new Error('Email belum terdaftar atau kata sandi salah. Jika belum punya akun, silakan klik tab "Daftar Akun".');
  }
}

function handlePinKey(key) {
  if (gateState.mode !== 'enter-pin' && gateState.mode !== 'set-pin') return;
  if (key === 'clear') {
    gateState.pinInput = '';
  } else if (key === 'back') {
    gateState.pinInput = gateState.pinInput.slice(0, -1);
  } else if (/^\d$/.test(key) && gateState.pinInput.length < 4) {
    gateState.pinInput += key;
  } else {
    return;
  }

  const boxes = $$('#pinBoxes .pin-box');
  boxes.forEach((b, i) => {
    const hasChar = i < gateState.pinInput.length;
    b.className = 'pin-box' + (hasChar ? ' filled' : '') + (i === gateState.pinInput.length ? ' active' : '');
    b.textContent = hasChar ? '●' : '';
  });

  if (gateState.pinInput.length === 4) {
    const code = gateState.pinInput;
    if (gateState.mode === 'set-pin') {
      boxes.forEach(b => { b.className = 'pin-box ok'; b.textContent = '✔'; });
      saveUserPin(currentUser.email, code);
      updateAuthUI();
      toast('PIN 4 angka berhasil disimpan!');
      setTimeout(() => unlockGate(), 240);
    } else if (gateState.mode === 'enter-pin') {
      const saved = getSavedPin(currentUser.email);
      if (code === saved) {
        boxes.forEach(b => { b.className = 'pin-box ok'; b.textContent = '✔'; });
        setTimeout(() => unlockGate(), 200);
      } else {
        boxes.forEach(b => { b.className = 'pin-box err'; });
        const sub = $('#pinSubMsg');
        if (sub) {
          sub.textContent = 'PIN tidak sesuai, silakan coba lagi.';
          sub.style.color = 'var(--red)';
        }
        const card = $('#gateCard');
        if (card) {
          card.classList.add('shake');
          setTimeout(() => card.classList.remove('shake'), 450);
        }
        setTimeout(() => {
          gateState.pinInput = '';
          boxes.forEach((b, i) => {
            b.className = 'pin-box' + (i === 0 ? ' active' : '');
            b.textContent = '';
          });
        }, 420);
      }
    }
  }
}

document.addEventListener('keydown', e => {
  const gate = $('#authGate');
  if (!gate || gate.hidden) return;
  if (gateState.mode !== 'enter-pin' && gateState.mode !== 'set-pin') return;
  if (e.key >= '0' && e.key <= '9') {
    e.preventDefault();
    handlePinKey(e.key);
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    handlePinKey('back');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    handlePinKey('clear');
  }
});

async function initAuth() {
  // 1. Cek apakah ada user yang sudah pernah login di perangkat ini
  let savedUser = null;
  try {
    savedUser = JSON.parse(localStorage.getItem(LS_ACTIVE_USER) || 'null');
  } catch (_) {}

  // Jika hanya refresh halaman dalam sesi yang sama (belum keluar/tutup aplikasi), langsung sembunyikan gate tanpa kedip
  const gate = $('#authGate');
  if (savedUser && savedUser.email && getSavedPin(savedUser.email) && isSessionUnlocked(savedUser.email)) {
    currentUser = savedUser;
    if (gate) {
      gate.hidden = true;
      gate.innerHTML = '';
    }
    updateAuthUI();
    trades = loadTrades();
    renderAll();
  }

  if (sbClient) {
    try {
      const { data: { session } } = await sbClient.auth.getSession();
      if (session?.user) {
        const cloudPin = session.user.user_metadata?.pin || '';
        if (/^\d{4}$/.test(cloudPin)) {
          upsertAccountRecord(session.user.email, { id: session.user.id, pin: cloudPin });
        }
        savedUser = {
          id: session.user.id,
          email: session.user.email.toLowerCase(),
          isLocalOnly: false
        };
        setActiveUserSession(savedUser);
      }
    } catch (_) {}
  }

  if (savedUser && savedUser.email) {
    currentUser = savedUser;
    updateAuthUI();
    trades = loadTrades();
    renderAll();
    const pin = getSavedPin(savedUser.email);
    if (pin) {
      if (isSessionUnlocked(savedUser.email)) {
        // Sesi masih aktif (hanya refresh halaman) -> tidak perlu minta PIN lagi
        if (gate) {
          gate.hidden = true;
          gate.innerHTML = '';
        }
        syncFromCloud();
        subscribeRealtime();
      } else {
        // Aplikasi baru dibuka kembali setelah ditutup / dihapus dari multitasking -> minta PIN 4 angka
        showGate('enter-pin');
      }
    } else {
      // Sudah login tapi belum atur PIN -> minta atur PIN 4 angka
      showGate('set-pin');
    }
  } else {
    currentUser = null;
    updateAuthUI();
    showGate('auth', { tab: 'login' });
  }
}

function openAuthModal() {
  if (!currentUser) {
    showGate('auth', { tab: 'login' });
    return;
  }

  const root = $('#modalRoot');
  const email = currentUser.email || 'Trader';
  const initial = email[0].toUpperCase();
  const hasPin = !!getSavedPin(email);

  root.innerHTML = `<div class="overlay">
    <div class="modal" style="width:min(460px,94vw)">
      <h3 style="margin-bottom:6px">Akun & Keamanan PIN</h3>
      <p class="mmsg" style="margin-bottom:14px">Kelola akses PIN 4 angka dan sinkronisasi data antar perangkat.</p>
      
      <div class="auth-user-card">
        <div class="auth-avatar">${initial}</div>
        <div style="flex:1;min-width:0">
          <div style="font:600 14px var(--font-b);color:var(--text);word-break:break-all">${esc(email)}</div>
          <div style="font-size:12px;color:var(--green);display:flex;align-items:center;gap:6px;margin-top:3px">
            <span style="width:6px;height:6px;border-radius:50%;background:var(--green);display:inline-block"></span>
            ${hasPin ? 'PIN 4 Angka Aktif · Tersinkronisasi' : 'Tersinkronisasi'}
          </div>
        </div>
      </div>

      <div style="background:#0d0d10;border:1px solid var(--line);border-radius:4px;padding:12px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--mut);font-size:13px">Total Trade Tercatat:</span>
        <span style="font:700 15px var(--font-m);color:var(--gold)">${trades.length} trade</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:18px">
        <button type="button" class="btn ghost sm" id="mAuthLockNow" style="justify-content:center">🔒 Kunci Layar (PIN)</button>
        <button type="button" class="btn ghost sm" id="mAuthChangePin" style="justify-content:center">🔢 Ubah PIN 4 Angka</button>
      </div>

      <div class="mact" style="justify-content:space-between">
        <button type="button" class="btn danger-solid sm" id="mAuthLogout">Keluar (Logout)</button>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn ghost sm" id="mAuthClose">Tutup</button>
          <button type="button" class="btn primary sm" id="mAuthSync">🔄 Sinkronkan</button>
        </div>
      </div>
    </div>
  </div>`;

  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', keyEsc); };
  const keyEsc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', keyEsc);

  $('#mAuthClose').onclick = close;
  root.querySelector('.overlay').onclick = e => { if (e.target.classList.contains('overlay')) close(); };

  $('#mAuthLockNow').onclick = () => {
    close();
    markSessionUnlocked(null);
    if (getSavedPin(email)) {
      showGate('enter-pin');
    } else {
      showGate('set-pin', { fromDashboard: true });
    }
  };

  $('#mAuthChangePin').onclick = () => {
    close();
    showGate('set-pin', { fromDashboard: true });
  };

  $('#mAuthSync').onclick = async () => {
    const btn = $('#mAuthSync');
    btn.disabled = true;
    btn.textContent = 'Menyinkronkan...';
    await syncFromCloud(true);
    btn.disabled = false;
    btn.textContent = '🔄 Sinkronkan';
    close();
  };

  $('#mAuthLogout').onclick = async () => {
    const ok = await confirmBox({
      title: 'Keluar dari Akun?',
      msg: 'Anda akan keluar dari akun ini dan kembali ke halaman login awal. Data jurnal Anda tetap tersimpan aman.',
      ok: 'Ya, Keluar'
    });
    if (ok) {
      close();
      if (sbClient) { try { await sbClient.auth.signOut(); } catch (_) {} }
      markSessionUnlocked(null);
      setActiveUserSession(null);
      toast('Berhasil keluar dari akun');
      showGate('auth', { tab: 'login' });
    }
  };
}

/* ================= tween angka ================= */
function tween(elm, to, fmt) {
  const from = elm._v ?? 0; elm._v = to;
  if (REDUCED || Math.abs(to - from) < 1e-9) { elm.textContent = fmt(to); return }
  const t0 = performance.now(), dur = 480;
  (function f(t) {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    elm.textContent = fmt(from + (to - from) * e); if (p < 1) requestAnimationFrame(f)
  })(t0)
}

/* ================= OVERVIEW ================= */
const statCard = (i, label, val, sub) => `<div class="card stat${_freshRender ? ' reveal' : ''}" style="--d:${i * 35}ms"><div class="stat-label">${label}</div><div class="stat-value">${val}</div><div class="stat-sub">${sub}</div></div>`;
function sparkSVG(series) {
  if (!series || series.length < 2) return ''; const w = 110, h = 26;
  const lo = Math.min(...series), hi = Math.max(...series), sp = (hi - lo) || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1) * w).toFixed(1)},${(h - 3 - (v - lo) / sp * (h - 6)).toFixed(1)}`).join(' ');
  const up = series[series.length - 1] >= series[0];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="${up ? 'var(--green)' : 'var(--red)'}" stroke-width="1.6"/></svg>`
}

function renderStatCards(m, arr) {
  const box = $('#statCards');
  if (!box) return;
  const best = arr.length ? arr.reduce((a, b) => tradeRet(b) > tradeRet(a) ? b : a) : null;
  const days = new Set(arr.map(t => t.date)).size;
  const cumVal = state.cumMethod === 'comp' ? m.comp : m.simple;
  const series = state.cumMethod === 'comp' ? m.curve : [0, ...m.simpleCurve];
  const wrW = m.total ? m.wins / m.total * 100 : 0, wrL = m.total ? m.losses / m.total * 100 : 0;

  const existingTotal = $('#vTotal');
  const isInitialBuild = !existingTotal || box.children.length === 0;

  if (isInitialBuild) {
    box.innerHTML =
      statCard(0, 'Total Trades', `<span id="vTotal"></span>`, `${m.wins}W · ${m.losses}L${m.be ? ` · ${m.be} BE` : ''} · ${days} hari aktif`) +
      statCard(1, 'Win Rate', `<span id="vWR"></span>`, `<div class="wl-bar" style="width:100%"><i class="w" style="width:${wrW}%"></i><i class="l" style="width:${wrL}%"></i></div>`) +
      statCard(2, 'Avg Return / Trade', `<span id="vAvg"></span>`, 'Rata-rata return — hanya trade tercatat') +
      statCard(3, 'Cumulative Return', `<span id="vCum"></span>`, `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px">${sparkSVG(series)}<span>${state.cumMethod === 'comp' ? 'Compounded' : 'Simple'}</span></div>`) +
      statCard(4, 'Best Trade', `<span id="vBest"></span>`, best ? `${esc(best.asset) || '—'} · ${fmtDate(best.date)} · ${best.position}` : '—') +
      statCard(5, 'Max Drawdown', `<span id="vDD"></span>`, 'Compounded · puncak → lembah');
  }

  if (_freshRender || isInitialBuild) {
    const set = (id, v, fmt, cls) => {
      const n = $('#' + id); if (!n) return;
      if (v == null) { n.textContent = '—'; n._v = 0; return; }
      if (cls) { n.className = ''; n.classList.add(cls); }
      tween(n, v, fmt);
    };
    set('vTotal', m.total, v => fmtInt(Math.round(v)));
    set('vWR', m.winRate, v => fmtPct(v, 1));
    set('vAvg', m.avg, v => fmtPct(v), pcls(m.avg));
    set('vCum', m.total ? cumVal : null, v => fmtPct(v), pcls(cumVal));
    set('vBest', best ? tradeRet(best) : null, v => fmtPct(v), best ? pcls(tradeRet(best)) : '');
    set('vDD', m.total ? m.maxDD : null, v => fmtPct(v), pcls(m.maxDD));
    _freshRender = false;
  } else {
    // Mode stabil: Perbarui angka in-place TANPA animasi tween/muter saat scroll
    const updateVal = (id, v, fmt, cls) => {
      const n = $('#' + id); if (!n) return;
      if (v == null) { n.textContent = '—'; n._v = 0; return; }
      if (cls) { n.className = ''; n.classList.add(cls); }
      n.textContent = fmt(v);
      n._v = v;
    };
    updateVal('vTotal', m.total, v => fmtInt(Math.round(v)));
    updateVal('vWR', m.winRate, v => fmtPct(v, 1));
    updateVal('vAvg', m.avg, v => fmtPct(v), pcls(m.avg));
    updateVal('vCum', m.total ? cumVal : null, v => fmtPct(v), pcls(cumVal));
    updateVal('vBest', best ? tradeRet(best) : null, v => fmtPct(v), best ? pcls(tradeRet(best)) : '');
    updateVal('vDD', m.total ? m.maxDD : null, v => fmtPct(v), pcls(m.maxDD));
  }

  if (!isInitialBuild) {
    const cards = box.querySelectorAll('.card.stat');
    if (cards.length >= 6) {
      const sub0 = cards[0].querySelector('.stat-sub');
      if (sub0) sub0.textContent = `${m.wins}W · ${m.losses}L${m.be ? ` · ${m.be} BE` : ''} · ${days} hari aktif`;
      const barW = cards[1].querySelector('.wl-bar .w'), barL = cards[1].querySelector('.wl-bar .l');
      if (barW) barW.style.width = `${wrW}%`;
      if (barL) barL.style.width = `${wrL}%`;
      const sub3 = cards[3].querySelector('.stat-sub');
      if (sub3) sub3.innerHTML = `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px">${sparkSVG(series)}<span>${state.cumMethod === 'comp' ? 'Compounded' : 'Simple'}</span></div>`;
      const sub4 = cards[4].querySelector('.stat-sub');
      if (sub4) sub4.textContent = best ? `${esc(best.asset) || '—'} · ${fmtDate(best.date)} · ${best.position}` : '—';
    }
  }
}

function renderDailyChart() {
  const box = $('#chDaily'); box.innerHTML = '';
  const arr = pt(); if (!arr.length) { box.innerHTML = EMPTY_CH; return }
  const w = Math.max(300, box.clientWidth), h = 252, pl = 48, pr = 12, ptp = 16, pb = 26;
  const svg = mkSvg(box, w, h);
  const rets = arr.map(tradeRet);
  let lo = Math.min(0, ...rets), hi = Math.max(0, ...rets);
  if (hi === lo) { hi += 1; lo -= 1 }
  const padV = (hi - lo) * .1; hi += padV; if (lo < 0) lo -= padV;
  const iw = w - pl - pr, ih = h - ptp - pb;
  const Y = v => ptp + (hi - v) / (hi - lo) * ih, y0 = Y(0);
  ticks(lo, hi, 4).forEach(v => {
    el('line', { x1: pl, x2: w - pr, y1: Y(v), y2: Y(v), class: 'grid' }, svg);
    el('text', { x: pl - 7, y: Y(v) + 3.5, 'text-anchor': 'end' }, svg).textContent = fmtAxisPct(v)
  });
  el('line', { x1: pl, x2: w - pr, y1: y0, y2: y0, class: 'zero' }, svg);
  const band = iw / arr.length, bw = Math.max(4, Math.min(26, band * .6));
  const le = Math.max(1, Math.ceil(arr.length / Math.max(1, Math.floor(iw / 58))));
  arr.forEach((t, i) => {
    const r = rets[i], cx = pl + band * i + band / 2;
    const rect = el('rect', { x: cx - bw / 2, width: bw, rx: 1, class: 'bar ' + (r > 0 ? 'pos' : r < 0 ? 'neg' : 'be') }, svg);
    if (r >= 0) { rect.setAttribute('y', Y(r)); rect.setAttribute('height', Math.max(1.5, y0 - Y(r))) }
    else { rect.setAttribute('y', y0); rect.setAttribute('height', Math.max(1.5, Y(r) - y0)) }
    if (_freshRender) { rect.style.transformOrigin = `${cx}px ${y0}px`; rect.style.animation = `barGrow .5s ${i * 16}ms cubic-bezier(.2,.7,.3,1) both` }
    rect.addEventListener('mouseenter', e => {
      rect.classList.add('hot');
      showTip(`<div class="tip-t">${fmtDate(t.date)}</div>${tipRow('Aset', esc(t.asset) || '—')}${tipRow('Posisi', t.position, t.position === 'LONG' ? 'c-l' : 'c-s')}${tipRow('Return', fmtPct(r), pcls(r))}`, e)
    });
    rect.addEventListener('mousemove', moveTip);
    rect.addEventListener('mouseleave', () => { rect.classList.remove('hot'); hideTip() });
    if (i % le === 0) el('text', { x: cx, y: h - 8, 'text-anchor': 'middle' }, svg).textContent = shortDate(t.date);
  });
}

function renderCumChart() {
  const box = $('#chCum'); box.innerHTML = '';
  const arr = pt(); if (!arr.length) { box.innerHTML = EMPTY_CH; return }
  const m = metrics(arr), comp = state.cumMethod === 'comp';
  $('#cumHint').textContent = comp ? 'Compounded: akumulasi return' : 'Simple: akumulasi return';
  const vals = comp ? m.curve : [0, ...m.simpleCurve];
  const labels = ['Mulai', ...arr.map(t => t.date)], n = vals.length;
  const w = Math.max(300, box.clientWidth), h = 252, pl = 54, pr = 58, ptp = 14, pb = 24;
  const svg = mkSvg(box, w, h);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi === lo) { hi += 1; lo -= 1 }
  const padV = (hi - lo) * .12; hi += padV; if (lo < 0) lo -= padV;
  const iw = w - pl - pr, ih = h - ptp - pb;
  const X = i => n > 1 ? pl + iw * i / (n - 1) : pl + iw / 2, Y = v => ptp + (hi - v) / (hi - lo) * ih, y0 = Y(0);
  ticks(lo, hi, 4).forEach(v => {
    el('line', { x1: pl, x2: w - pr, y1: Y(v), y2: Y(v), class: 'grid' }, svg);
    el('text', { x: pl - 7, y: Y(v) + 3.5, 'text-anchor': 'end' }, svg).textContent = fmtAxisPct(v)
  });
  el('line', { x1: pl, x2: w - pr, y1: y0, y2: y0, class: 'zero' }, svg);
  const last = vals[n - 1];
  const curveColor = last >= 0 ? '#10b981' : '#f43f5e';
  const defs = el('defs', {}, svg);
  const g = el('linearGradient', { id: 'gCum', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': curveColor, 'stop-opacity': .16 }, g);
  el('stop', { offset: '100%', 'stop-color': curveColor, 'stop-opacity': 0 }, g);
  let d = `M${X(0)},${Y(vals[0])}`; for (let i = 1; i < n; i++)d += `L${X(i)},${Y(vals[i])}`;
  el('path', { d: `${d}L${X(n - 1)},${y0}L${X(0)},${y0}Z`, fill: 'url(#gCum)' }, svg);
  const line = el('path', { d, fill: 'none', stroke: curveColor, 'stroke-width': 1.75, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  if (_freshRender && !REDUCED) {
    const len = line.getTotalLength(); line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
    line.getBoundingClientRect(); line.style.transition = 'stroke-dashoffset .8s ease'; line.style.strokeDashoffset = '0'
  }
  el('text', { x: X(n - 1) + 8, y: Y(last) + 4, fill: curveColor, 'font-weight': '600', 'font-size': '11.5px' }, svg).textContent = fmtPct(last);
  const le = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 70))));
  for (let i = 0; i < n; i++)if (i % le === 0 || i === n - 1)
    el('text', { x: X(i), y: h - 7, 'text-anchor': 'middle' }, svg).textContent = labels[i] === 'Mulai' ? 'Mulai' : shortDate(labels[i]);
  const vline = el('line', { y1: ptp, y2: h - pb, class: 'zero', opacity: 0 }, svg);
  const focus = el('circle', { r: 4, fill: curveColor, stroke: '#09090b', 'stroke-width': 1.5, opacity: 0 }, svg);
  const ov = el('rect', { x: pl, y: ptp, width: iw, height: ih, fill: 'transparent' }, svg);
  ov.addEventListener('pointermove', e => {
    const bx = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round((e.clientX - bx.left - pl) / (iw || 1) * (n - 1))));
    vline.setAttribute('x1', X(i)); vline.setAttribute('x2', X(i)); vline.setAttribute('opacity', 1);
    focus.setAttribute('cx', X(i)); focus.setAttribute('cy', Y(vals[i])); focus.setAttribute('opacity', 1);
    showTip(`<div class="tip-t">${labels[i] === 'Mulai' ? 'Titik Awal' : fmtDate(labels[i])}</div>${tipRow('Kumulatif (' + (comp ? 'compounded' : 'simple') + ')', fmtPct(vals[i]), pcls(vals[i]))}`, e)
  });
  ov.addEventListener('pointerleave', () => { vline.setAttribute('opacity', 0); focus.setAttribute('opacity', 0); hideTip() });
}

function renderRecent() {
  const list = sorted().slice(-15).reverse(), box = $('#recentList');
  if (!list.length) { box.innerHTML = '<p class="hint" style="padding:16px 0;text-align:center">Belum ada riwayat trade.</p>'; return }
  box.innerHTML = list.map(t => {
    const r = tradeRet(t), c = pcls(r);
    const res = r > 0 ? ['win', 'PROFIT'] : r < 0 ? ['loss', 'LOSS'] : ['bee', 'BE'];
    const posIcon = t.position === 'LONG' ? '▲' : '▼';
    const lotStr = t.lot != null ? `${Number(t.lot).toFixed(2)} Lot` : '';
    return `<div class="rrow ${c}" data-id="${t.id}" title="${t.notes ? esc(t.notes) : 'Klik untuk melihat di jurnal'}">
      <div class="rbar"></div>
      <div class="rinfo">
        <div class="rtop">
          <span class="rasset">${esc(t.asset) || '—'} <span class="badge ${t.position.toLowerCase()} sm">${posIcon} ${t.position}</span></span>
          ${lotStr ? `<span class="rlot mono">${lotStr}</span>` : ''}
        </div>
        <div class="rsub mono">
          <span class="rdate">${fmtDate(t.date)}</span>
          <span class="rsep">·</span>
          <span class="rprices">${fmtPrice(t.entry)} → ${fmtPrice(t.exit)}</span>
        </div>
      </div>
      <div class="rright">
        <span class="rret mono ${c}">${fmtPct(r)}</span>
        <span class="badge ${res[0]} sm">${res[1]}</span>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(syncRecentHeight);
}

// Tinggi kartu kini diatur sepenuhnya oleh CSS Grid (align-items: stretch) + flex column.
// Fungsi ini hanya membersihkan sisa inline style lama agar tidak bentrok dengan layout CSS native.
function syncRecentHeight() {
  const recentCard = $('#recentCard'), box = $('#recentList');
  if (recentCard) recentCard.style.height = '';
  if (box) box.style.maxHeight = '';
}

function syncJournalHeight() {
  const tableCard = $('#journalTableCard'), tscroll = tableCard?.querySelector('.tscroll');
  if (tableCard) tableCard.style.height = '';
  if (tscroll) tscroll.style.maxHeight = '';
}

/* ---- Kalender ---- */
function renderCalendar() {
  const now = new Date();
  const cur = state.calCursor || (state.calCursor = { y: now.getFullYear(), m: now.getMonth() });
  $('#calTitle').textContent = `${MONTHS_FULL[cur.m]} ${cur.y}`;
  const first = new Date(cur.y, cur.m, 1), startIdx = (first.getDay() + 6) % 7, dim = new Date(cur.y, cur.m + 1, 0).getDate();
  const grouped = new Map();
  trades.forEach(t => { if (!grouped.has(t.date)) grouped.set(t.date, []); grouped.get(t.date).push(t) });
  let cells = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(d => `<div class="cal-hd">${d}</div>`).join('');
  for (let i = 0; i < startIdx; i++)cells += '<div class="cal-day empty"></div>';
  let totalTrades = 0, totalWin = 0, totalLoss = 0, targetDays = 0;
  for (let d = 1; d <= dim; d++) {
    const ds = `${cur.y}-${pad(cur.m + 1)}-${pad(d)}`, dayTrades = grouped.get(ds) || [];
    let cls = '', ttl = fmtDate(ds);
    if (dayTrades.length) {
      const netRet = dayTrades.reduce((s, t) => s + tradeRet(t), 0);
      cls = pcls(netRet) === 'pos' ? 'win' : pcls(netRet) === 'neg' ? 'loss' : 'bee';
      if (netRet >= 10) { cls += ' target'; targetDays++; }
      const labels = dayTrades.map(t => `${t.asset || '—'} ${fmtPct(tradeRet(t))}`).join(' | ');
      ttl += ` · ${dayTrades.length} trade${dayTrades.length > 1 ? 's' : ''}: ${labels}`;
      if (netRet >= 10) ttl += ` · ★ Target harian ≥10% tercapai (${fmtPct(netRet)})`;
      totalTrades += dayTrades.length;
      dayTrades.forEach(t => { const r = tradeRet(t); if (r > 0) totalWin++; else if (r < 0) totalLoss++ });
    }
    const today = ds === todayISO() ? ' today' : '', sel = ds === state.selDay ? ' sel' : '';
    const countBadge = dayTrades.length > 1 ? `<span class="cal-count">${dayTrades.length}</span>` : '';
    cells += `<div class="cal-day ${cls}${today}${sel}" data-d="${ds}" title="${esc(ttl)}">${d}${countBadge}</div>`;
  }
  $('#calGrid').innerHTML = cells;
  $('#calSum').textContent = totalTrades ? `${totalTrades} trade${totalTrades > 1 ? 's' : ''} · ${totalWin} profit · ${totalLoss} loss${targetDays ? ` · ★ ${targetDays} hari target` : ''}` : 'Belum ada trade bulan ini';
}
function renderCalDetail() {
  const box = $('#calDetail');
  if (!state.selDay) { box.innerHTML = '<div class="cd-empty">Pilih tanggal pada kalender untuk melihat detail trade.</div>'; return }
  const dayTrades = trades.filter(x => x.date === state.selDay).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!dayTrades.length) { box.innerHTML = `<div class="cd-empty"><b>${fmtDateLong(state.selDay)}</b><p>Tidak ada trade. Hari tanpa trade adalah istirahat yang sah — bukan pelanggaran aturan.</p></div>`; return }
  const netRet = dayTrades.reduce((s, t) => s + tradeRet(t), 0);
  const netCls = pcls(netRet);
  let html = `<div class="cd-head"><div><div class="cd-date">${fmtDateLong(dayTrades[0].date)}</div>
    <div class="cd-asset">${dayTrades.length} trade${dayTrades.length > 1 ? 's' : ''} · <span class="badge ${netCls === 'pos' ? 'long' : netCls === 'neg' ? 'short' : ''}">Net ${fmtPct(netRet)}</span></div></div>
    <div class="cd-ret ${netCls}">${fmtPct(netRet)}</div></div><div class="cd-list">`;
  dayTrades.forEach((t, i) => {
    const r = tradeRet(t), c = pcls(r);
    html += `<div class="cd-trade-item">
      <div class="cd-trade-num">Trade #${i + 1}</div>
      <div class="cd-trade-head">
        <div><div class="cd-asset">${esc(t.asset) || 'Tanpa aset'} · <span class="badge ${t.position.toLowerCase()}">${t.position === 'LONG' ? '▲' : '▼'} ${t.position}</span></div></div>
        <div class="cd-ret ${c}" style="font-size:18px">${fmtPct(r)}</div>
      </div>
      <div class="cd-grid mono"><span>Entry <b>${fmtPrice(t.entry)}</b></span><span>Exit <b>${fmtPrice(t.exit)}</b></span>${t.lot != null ? `<span>Lot <b>${Number(t.lot).toFixed(2)}</b></span>` : ''}</div>
      ${t.notes ? `<p class="cd-notes">${esc(t.notes)}</p>` : '<p class="cd-notes dim">Tidak ada catatan.</p>'}
      <div class="cd-actions"><button class="btn sm" data-act="edit" data-id="${t.id}">✎ Edit</button><button class="btn sm danger" data-act="del" data-id="${t.id}">Hapus</button></div>
    </div>`;
  });
  html += `</div>`;
  box.innerHTML = html;
}

function syncEquityToPs() {
  const eq = calcAccountEquity();
  const roundedEq = Math.max(0, Math.round(eq.currentBalance * 100) / 100);
  const btnUse = $('#btnPsUseAccountBal');
  if (btnUse) {
    btnUse.textContent = `⚡ Saldo Akun (${fmtUsd(roundedEq)})`;
  }
  const chipEq = $('#psChipEquity');
  if (chipEq) {
    chipEq.dataset.bal = String(roundedEq);
    chipEq.textContent = `⚡ Saldo (${fmtUsd(roundedEq, 0)})`;
  }
  if (capitalConfig.autoSyncPs !== false && roundedEq > 0) {
    psState.balance = roundedEq;
    const balInp = $('#psBalance');
    if (balInp && document.activeElement !== balInp) {
      balInp.value = roundedEq;
    }
    savePsSettings();
  }
  return eq;
}

function renderEquityStrip() {
  const box = $('#equityStrip');
  if (!box) return;
  const eq = syncEquityToPs();
  const pnlCls = eq.tradingProfitUsd > 1e-6 ? 'pos' : eq.tradingProfitUsd < -1e-6 ? 'neg' : 'be';
  const grCls = eq.growthPct > 1e-6 ? 'pos' : eq.growthPct < -1e-6 ? 'neg' : 'be';
  const pnlSign = eq.tradingProfitUsd > 1e-6 ? '+' : eq.tradingProfitUsd < -1e-6 ? '-' : '';
  const grArrow = eq.growthPct > 1e-6 ? '▲ ' : eq.growthPct < -1e-6 ? '▼ ' : '';

  const flowParts = [`Modal Awal: <b>${fmtUsd(eq.initialBalance)}</b>`];
  if (eq.totalDeposit > 0) flowParts.push(`Top-Up: <b class="pos">+${fmtUsd(eq.totalDeposit)}</b>`);
  if (eq.totalWithdraw > 0) flowParts.push(`Withdraw: <b class="neg">-${fmtUsd(eq.totalWithdraw)}</b>`);

  box.innerHTML = `
    <div class="eq-strip-grid">
      <div class="eq-item eq-main">
        <div class="eq-label">SALDO SAAT INI (SISA MODAL)</div>
        <div class="eq-val mono">${fmtUsd(eq.currentBalance)}</div>
        <div class="eq-sub">${flowParts.join(' · ')}</div>
      </div>
      <div class="eq-item">
        <div class="eq-label">PROFIT / LOSS TRADING ($)</div>
        <div class="eq-val mono ${pnlCls}">${pnlSign}${fmtUsd(Math.abs(eq.tradingProfitUsd))}</div>
        <div class="eq-sub">Murni dari ${trades.length} trade · Opsi B (Compounded)</div>
      </div>
      <div class="eq-item">
        <div class="eq-label">GROWTH MODAL (%)</div>
        <div class="eq-val mono ${grCls}">${grArrow}${fmtPct(eq.growthPct)}</div>
        <div class="eq-sub">Total Modal Bersih: <b class="mono">${fmtUsd(eq.netInjected)}</b></div>
      </div>
      <div class="eq-actions">
        <button type="button" class="btn sm primary" id="btnManageCapital">⚙ Kelola &amp; Tambah Modal</button>
      </div>
    </div>
  `;
  const btn = $('#btnManageCapital');
  if (btn) btn.onclick = () => openCapitalModal();
}

function openCapitalModal() {
  const root = $('#modalRoot');
  let flowMode = 'deposit';

  const renderModalContent = () => {
    const eq = calcAccountEquity();
    const flows = [...(capitalConfig.flows || [])].sort((a, b) =>
      (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0)
    );

    root.innerHTML = `<div class="overlay">
      <div class="modal cap-modal">
        <div class="cap-modal-head">
          <div>
            <h3>Kelola Modal &amp; Mutasi Dana</h3>
            <p class="mmsg" style="margin:2px 0 0">Atur modal awal, catat tambah modal (Top-Up) atau penarikan (Withdraw). Growth (%) dihitung proporsional tanpa terdistorsi Top-Up.</p>
          </div>
          <button type="button" class="sync-banner-close" id="capCloseTop" title="Tutup">✕</button>
        </div>

        <div class="cap-summary-bar">
          <div>
            <span class="cap-sum-l">Saldo Saat Ini</span>
            <b class="cap-sum-v mono">${fmtUsd(eq.currentBalance)}</b>
          </div>
          <div>
            <span class="cap-sum-l">Modal Bersih</span>
            <b class="cap-sum-v mono">${fmtUsd(eq.netInjected)}</b>
          </div>
          <div>
            <span class="cap-sum-l">Net Profit Trading</span>
            <b class="cap-sum-v mono ${pcls(eq.tradingProfitUsd)}">${eq.tradingProfitUsd >= 0 ? '+' : '-'}${fmtUsd(Math.abs(eq.tradingProfitUsd))} (${fmtPct(eq.growthPct)})</b>
          </div>
        </div>

        <div class="cap-section">
          <div class="ps-label-row">
            <label for="capInitInput">1. Modal Awal Akun (Initial Balance $)</label>
            <span class="mono dim" style="font-size:11px">USD ($)</span>
          </div>
          <div class="cap-init-row">
            <input type="number" id="capInitInput" step="any" min="0" value="${capitalConfig.initialBalance}" placeholder="1000" inputmode="decimal">
            <button type="button" class="btn sm primary" id="btnSaveInitCap">Simpan Modal Awal</button>
          </div>
          <div class="ps-presets" id="capInitPresets" style="margin-top:6px">
            <button type="button" class="ps-chip" data-ibal="100">$100</button>
            <button type="button" class="ps-chip" data-ibal="500">$500</button>
            <button type="button" class="ps-chip" data-ibal="1000">$1,000</button>
            <button type="button" class="ps-chip" data-ibal="5000">$5,000</button>
            <button type="button" class="ps-chip" data-ibal="10000">$10,000</button>
          </div>
        </div>

        <div class="cap-section">
          <label style="display:block;margin-bottom:6px">2. Catat Tambah Modal (Top-Up) / Tarik Dana (Withdraw)</label>
          <div class="pos-seg" id="capFlowTypeSeg" style="margin-bottom:10px">
            <button type="button" data-ft="deposit" class="${flowMode === 'deposit' ? 'on' : ''}" data-pos="LONG">+ Tambah Modal (Top-Up)</button>
            <button type="button" data-ft="withdraw" class="${flowMode === 'withdraw' ? 'on' : ''}" data-pos="SHORT">− Tarik Dana (Withdraw)</button>
          </div>
          <div class="cap-flow-grid">
            <div>
              <label for="capFlowDate" style="font-size:10px;color:var(--dim);display:block;margin-bottom:4px">TANGGAL</label>
              <input type="date" id="capFlowDate" value="${todayISO()}">
            </div>
            <div>
              <label for="capFlowAmt" style="font-size:10px;color:var(--dim);display:block;margin-bottom:4px">NOMINAL ($)</label>
              <input type="number" id="capFlowAmt" step="any" min="0.01" placeholder="Contoh: 500" inputmode="decimal">
            </div>
            <div class="cap-flow-note">
              <label for="capFlowNote" style="font-size:10px;color:var(--dim);display:block;margin-bottom:4px">CATATAN (OPSIONAL)</label>
              <input type="text" id="capFlowNote" placeholder="Contoh: Top-up modal bulanan / Tarik profit">
            </div>
          </div>
          <button type="button" class="btn sm primary" id="btnAddCapFlow" style="width:100%;justify-content:center;margin-top:10px;height:36px">
            ${flowMode === 'deposit' ? '+ Tambahkan Top-Up Modal' : '− Catat Penarikan Dana (Withdraw)'}
          </button>
        </div>

        <div class="cap-section">
          <div class="ps-label-row" style="margin-bottom:6px">
            <label>3. Riwayat Mutasi Modal (${flows.length})</label>
          </div>
          <div class="cap-flow-list" id="capFlowList">
            ${flows.length ? flows.map(f => `
              <div class="cap-flow-row">
                <div class="cfr-left">
                  <span class="badge ${f.type === 'withdraw' ? 'loss' : 'win'}">${f.type === 'withdraw' ? '− WITHDRAW' : '+ TOP-UP'}</span>
                  <span class="mono cfr-date">${fmtDate(f.date)}</span>
                  <span class="cfr-note">${f.note ? esc(f.note) : '<span class="dim">Tanpa catatan</span>'}</span>
                </div>
                <div class="cfr-right">
                  <b class="mono ${f.type === 'withdraw' ? 'neg' : 'pos'}">${f.type === 'withdraw' ? '-' : '+'}${fmtUsd(f.amount)}</b>
                  <button type="button" class="cfr-del" data-del-flow="${f.id}" title="Hapus mutasi ini">✕</button>
                </div>
              </div>
            `).join('') : '<div class="dim" style="font-size:12px;padding:10px;text-align:center;border:1px dashed var(--line2);border-radius:4px">Belum ada riwayat Top-Up atau Withdraw tambahan.</div>'}
          </div>
        </div>

        <label class="cap-sync-toggle">
          <input type="checkbox" id="capAutoSyncChk" ${capitalConfig.autoSyncPs !== false ? 'checked' : ''}>
          <span>Otomatis hubungkan <b>Saldo Saat Ini (${fmtUsd(eq.currentBalance)})</b> ke kalkulator <b>Position Sizing</b></span>
        </label>

        <div class="mact" style="margin-top:14px">
          <button type="button" class="btn primary" id="capCloseBtn" style="width:100%;justify-content:center">Selesai</button>
        </div>
      </div>
    </div>`;

    const close = () => {
      root.innerHTML = '';
      document.removeEventListener('keydown', escHandler);
    };
    const escHandler = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    $('#capCloseTop').onclick = close;
    $('#capCloseBtn').onclick = close;
    root.querySelector('.overlay').addEventListener('click', e => {
      if (e.target.classList.contains('overlay')) close();
    });

    $('#btnSaveInitCap').onclick = () => {
      const val = parseFloat($('#capInitInput').value);
      if (!isFinite(val) || val < 0) {
        toast('Masukkan nominal modal awal yang valid', 'err');
        return;
      }
      capitalConfig.initialBalance = val;
      saveCapitalConfig();
      renderAll();
      renderModalContent();
      toast(`Modal awal diperbarui menjadi ${fmtUsd(val)}`);
    };

    $('#capInitPresets').addEventListener('click', e => {
      const b = e.target.closest('[data-ibal]');
      if (!b) return;
      const val = parseFloat(b.dataset.ibal);
      capitalConfig.initialBalance = val;
      saveCapitalConfig();
      renderAll();
      renderModalContent();
      toast(`Modal awal diatur ke ${fmtUsd(val)}`);
    });

    $('#capFlowTypeSeg').addEventListener('click', e => {
      const b = e.target.closest('[data-ft]');
      if (!b) return;
      flowMode = b.dataset.ft;
      $$('#capFlowTypeSeg button').forEach(btn => btn.classList.toggle('on', btn.dataset.ft === flowMode));
      $('#btnAddCapFlow').textContent = flowMode === 'deposit' ? '+ Tambahkan Top-Up Modal' : '− Catat Penarikan Dana (Withdraw)';
    });

    $('#btnAddCapFlow').onclick = () => {
      const date = $('#capFlowDate').value || todayISO();
      const amount = parseFloat($('#capFlowAmt').value);
      const note = ($('#capFlowNote').value || '').trim();
      if (!isFinite(amount) || amount <= 0) {
        toast('Masukkan nominal dolar ($) lebih dari 0', 'err');
        $('#capFlowAmt').focus();
        return;
      }
      if (!Array.isArray(capitalConfig.flows)) capitalConfig.flows = [];
      capitalConfig.flows.push({
        id: uid(),
        date,
        type: flowMode,
        amount,
        note,
        createdAt: Date.now()
      });
      saveCapitalConfig();
      renderAll();
      renderModalContent();
      toast(flowMode === 'deposit' ? `Top-Up +${fmtUsd(amount)} berhasil dicatat` : `Withdraw -${fmtUsd(amount)} berhasil dicatat`);
    };

    $('#capFlowList').addEventListener('click', e => {
      const delBtn = e.target.closest('[data-del-flow]');
      if (!delBtn) return;
      const id = delBtn.dataset.delFlow;
      capitalConfig.flows = (capitalConfig.flows || []).filter(f => String(f.id) !== String(id));
      saveCapitalConfig();
      renderAll();
      renderModalContent();
      toast('Riwayat mutasi modal dihapus');
    });

    $('#capAutoSyncChk').addEventListener('change', e => {
      capitalConfig.autoSyncPs = e.target.checked;
      saveCapitalConfig();
      renderAll();
      toast(capitalConfig.autoSyncPs ? 'Sinkronisasi otomatis ke Position Sizing aktif' : 'Sinkronisasi otomatis ke Position Sizing dimatikan');
    });
  };

  renderModalContent();
}

function renderOverview() {
  renderEquityStrip();
  const has = trades.length > 0;
  $('#ovEmpty').hidden = has; $('#ovBody').hidden = !has;
  if (!has) return;
  const arr = pt(), m = metrics(arr);
  renderStatCards(m, arr); renderDailyChart(); renderCumChart(); renderRecent(); renderCalendar(); renderCalDetail();
  requestAnimationFrame(syncRecentHeight);
  _freshRender = false;
}

/* ================= JOURNAL ================= */
function filteredJournal() {
  const { q, pos, from, to } = state.j;
  return sorted().filter(t => (!q || (t.asset || '').toLowerCase().includes(q)) && (pos === 'ALL' || t.position === pos) && (!from || t.date >= from) && (!to || t.date <= to)).reverse()
}

function syncJournalDateFilterUI(matchCount) {
  const fromEl = $('#tFrom'), toEl = $('#tTo');
  const fromWrap = $('#tFromWrap'), toWrap = $('#tToWrap');
  const fromLbl = $('#tFromLabel'), toLbl = $('#tToLabel');
  const banner = $('#tRangeBanner');
  if (!fromEl || !toEl) return;

  const f = fromEl.value || state.j.from || '';
  const t = toEl.value || state.j.to || '';
  toEl.min = f || '';
  fromEl.max = t || '';

  if (fromWrap && fromLbl) {
    fromWrap.classList.toggle('active', !!f);
    fromWrap.classList.toggle('in-range', !!(f && t));
    fromLbl.innerHTML = f
      ? `<span class="df-tag">Mulai</span><b class="df-val">${fmtDate(f)}</b>`
      : `📅 Tanggal Dimulai`;
  }
  if (toWrap && toLbl) {
    toWrap.classList.toggle('active', !!t);
    toWrap.classList.toggle('in-range', !!(f && t));
    toLbl.innerHTML = t
      ? `<span class="df-tag">Akhir</span><b class="df-val">${fmtDate(t)}</b>`
      : `📅 Tanggal Berakhir`;
  }
  if (banner) {
    if (f || t) {
      banner.hidden = false;
      const startTxt = f ? `<b>${fmtDate(f)}</b>` : `<span class="dim">Awal</span>`;
      const endTxt = t ? `<b>${fmtDate(t)}</b>` : `<span class="dim">Sekarang</span>`;
      let daysSpan = '';
      if (f && t && t >= f) {
        const dCount = Math.round((parseISO(t) - parseISO(f)) / 864e5) + 1;
        daysSpan = ` · ${dCount} hari`;
      }
      banner.innerHTML = `
        <div class="drb-left">
          <span class="drb-dot"></span>
          <span class="drb-label">Rentang Tanggal:</span>
          <span class="drb-dates">${startTxt} <span class="drb-arr">→</span> ${endTxt}</span>
          <span class="drb-badge">${matchCount} trade${daysSpan}</span>
        </div>
        <button type="button" class="drb-clear" id="btnClearDateRange" title="Hapus rentang tanggal">✕ Reset Rentang</button>
      `;
    } else {
      banner.hidden = true;
      banner.innerHTML = '';
    }
  }
}

function renderTable() {
  const rows = filteredJournal(), tb = $('#tbody');
  const hasDateRange = !!(state.j.from || state.j.to);
  const eq = calcAccountEquity();
  syncJournalDateFilterUI(rows.length);
  $('#tblCount').textContent = `Menampilkan ${rows.length} dari ${trades.length} trade`;
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--dim);padding:34px">${trades.length ? 'Tidak ada trade yang cocok dengan filter.' : 'Belum ada trade — catat trade pertamamu melalui formulir di samping.'}</td></tr>`; return }
  tb.innerHTML = rows.map(t => {
    const r = tradeRet(t), c = pcls(r);
    const res = r > 0 ? ['win', 'PROFIT'] : r < 0 ? ['loss', 'LOSS'] : ['bee', 'BE'];
    const ex = state.expanded === t.id;
    const pInfo = eq.tradePnlMap.get(String(t.id));
    let html = `<tr class="trow ${c}${ex ? ' open' : ''}" data-id="${t.id}">
      <td class="mono${hasDateRange ? ' date-range-hit' : ''}">${fmtDate(t.date)}</td>
      <td>${esc(t.asset) || '<span class="dim">—</span>'}</td>
      <td><span class="badge ${t.position.toLowerCase()}">${t.position === 'LONG' ? '▲' : '▼'} ${t.position}</span></td>
      <td class="mono r">${t.lot != null ? Number(t.lot).toFixed(2) : '<span class="dim">—</span>'}</td>
      <td class="mono r">${fmtPrice(t.entry)}</td>
      <td class="mono r">${fmtPrice(t.exit)}</td>
      <td class="mono r ${c}"><div class="ret-cell"><b>${fmtPct(r)}</b><span class="badge sm ${res[0]}">${res[1]}</span></div></td>
      <td class="notes-cell" title="${esc(t.notes || '')}">${t.notes ? esc(trunc(t.notes, 32)) : '<span class="dim">—</span>'} <span class="chev">${ex ? '▴' : '▾'}</span></td></tr>`;
    if (ex) {
      const mv = t.position === 'LONG' ? (t.exit - t.entry) : (t.entry - t.exit);
      const pnlStr = pInfo ? `${pInfo.pnlUsd >= 0 ? '+' : '-'}${fmtUsd(Math.abs(pInfo.pnlUsd))} (Saldo: ${fmtUsd(pInfo.eqAfter)})` : '—';
      html += `<tr class="trow-detail"><td colspan="8"><div class="detail-grid">
        <div><label>Catatan / Trading Journal</label><p>${t.notes ? esc(t.notes) : '<span class="dim">Tidak ada catatan.</span>'}</p></div>
        <div><label>Pergerakan Harga</label><p class="mono">${fmtPrice(t.entry)} → ${fmtPrice(t.exit)}<br><span class="${c}">${mv >= 0 ? '+' : ''}${fmtPrice(Math.abs(mv)).replace(/^/, '')} ${mv >= 0 ? '▲' : '▼'}</span></p></div>
        <div><label>Lot &amp; Dampak Modal (Opsi B)</label><p class="mono">${t.lot != null ? Number(t.lot).toFixed(2) + ' Lot' : '—'}<br><span class="${c}">${pnlStr}</span></p></div>
      </div>
      <div class="detail-actions"><button class="btn sm" data-act="edit" data-id="${t.id}">✎ Edit</button><button class="btn sm danger" data-act="del" data-id="${t.id}">Hapus</button></div></td></tr>`
    }
    return html
  }).join('');
  requestAnimationFrame(syncJournalHeight);
}

/* ---- form ---- */
function syncPosSeg() { $$('#posSeg button').forEach(b => b.classList.toggle('on', b.dataset.pos === formPos)) }
function updatePreview() {
  const e = parseFloat($('#fEntry').value), x = parseFloat($('#fExit').value), box = $('#retPreview');
  const assetVal = $('#fAsset').value;
  const lot = parseFloat($('#fLot').value) || 0.01;
  if (isFinite(e) && e > 0 && isFinite(x) && x > 0) {
    const r = formPos === 'LONG' ? (x - e) / e * 100 : (e - x) / e * 100, c = pcls(r);
    const pips = calcPips(assetVal, formPos, e, x);
    box.innerHTML = `<div class="rp-main ${c}">${r > 0 ? '▲' : r < 0 ? '▼' : '■'} ${fmtPct(r)}</div>
      <div class="rp-sub">Return harga — ${formPos} · ${fmtPrice(e)} → ${fmtPrice(x)} · Lot: ${lot.toFixed(2)} · ${pips > 0 ? '+' : ''}${pips.toFixed(1)} pips</div>
      <div class="rp-note">Return harga dihitung otomatis dari selisih pergerakan harga entry → exit.</div>`;
  } else {
    box.innerHTML = '<div class="rp-main dim">— %</div><div class="rp-sub">Isi posisi, harga entry, dan harga exit — return dihitung otomatis.</div>';
  }
}
function updateFormUI() {
  const ed = !!state.editingId;
  $('#formTitle').textContent = ed ? 'Edit Trade' : 'Catat Trade';
  $('#editBadge').hidden = !ed;
  $('#btnSubmit').textContent = ed ? '✔ Simpan Perubahan' : '+ Simpan Trade';
  $('#btnCancel').hidden = !ed;
  $('#formCard').classList.toggle('editing', ed);
  requestAnimationFrame(syncJournalHeight);
}
function resetForm() {
  $('#tradeForm').reset(); $('#fDate').value = todayISO();
  $('#fLot').value = '0.01'; populateAssetSelect('XAUUSD');
  formPos = 'LONG'; syncPosSeg(); updatePreview(); $('#formErr').hidden = true;
}
function cancelEdit() { state.editingId = null; resetForm(); updateFormUI() }
function startEdit(id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  go('journal'); state.editingId = id;
  $('#fDate').value = t.date; populateAssetSelect(t.asset || 'XAUUSD'); formPos = t.position; syncPosSeg();
  $('#fLot').value = (t.lot != null ? Number(t.lot) : 0.01).toFixed(2);
  $('#fEntry').value = t.entry; $('#fExit').value = t.exit; $('#fNotes').value = t.notes || '';
  updateFormUI(); updatePreview();
  $('#formCard').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
}
async function deleteTrade(id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  const ok = await confirmBox({ title: 'Hapus Trade?', msg: `Trade ${esc(t.asset) || 'tanpa aset'} pada <b>${fmtDate(t.date)}</b> (${fmtPct(tradeRet(t))}) akan dihapus permanen.`, ok: 'Ya, Hapus' });
  if (!ok) return;
  trades = trades.filter(x => x.id !== id);
  if (state.editingId === id) cancelEdit();
  if (state.expanded === id) state.expanded = null;
  addDeletedTradeId(currentUser?.email, id);
  saveTrades(); renderAll(); toast('Trade dihapus');
  if (currentUser && !currentUser.isLocalOnly && sbClient) {
    try {
      await ensureCloudSession();
      const { error } = await sbClient.from('trades').delete().eq('id', String(id));
      if (error) console.error('Cloud delete trade error:', error);
      syncDeletedIdsToCloud(currentUser?.email);
    } catch (err) {
      console.error('Cloud delete exception:', err);
    }
  }
}

$('#tradeForm').addEventListener('submit', e => {
  e.preventDefault();
  const date = $('#fDate').value;
  let asset = $('#fAsset').value;
  const entry = parseFloat($('#fEntry').value), exit = parseFloat($('#fExit').value);
  const lotRaw = $('#fLot').value, lot = parseFloat(lotRaw);
  const notes = $('#fNotes').value.trim(), errs = [];
  if (!date) errs.push('Tanggal entry wajib diisi.');
  if (!asset || asset === '__custom__') errs.push('Aset / Pair wajib dipilih.');
  if (!isFinite(lot) || lot <= 0) errs.push('Lot harus berupa angka lebih dari 0.');
  if (!isFinite(entry) || entry <= 0) errs.push('Harga entry harus berupa angka lebih dari 0.');
  if (!isFinite(exit) || exit <= 0) errs.push('Harga exit harus berupa angka lebih dari 0.');
  const errBox = $('#formErr');
  if (errs.length) {
    errBox.hidden = false; errBox.innerHTML = '<ul>' + errs.map(x => `<li>${x}</li>`).join('') + '</ul>';
    $('#formCard').classList.add('shake'); setTimeout(() => $('#formCard').classList.remove('shake'), 450);
    toast('Periksa kembali formulir', 'err'); return
  }
  errBox.hidden = true;
  if (state.editingId) {
    const t = trades.find(x => x.id === state.editingId);
    Object.assign(t, { date, asset, position: formPos, entry, exit, lot, notes, _unsynced: true });
    saveTrades();
    toast('Perubahan trade disimpan');
    if (currentUser && !currentUser.isLocalOnly && sbClient) {
      (async () => {
        try {
          await ensureCloudSession();
          const { error } = await sbClient.from('trades').upsert([{
            id: String(t.id),
            user_id: currentUser.id,
            date: t.date,
            asset: t.asset,
            position: t.position,
            entry: t.entry,
            exit: t.exit,
            lot: t.lot,
            notes: t.notes,
            created_at: t.createdAt || Date.now()
          }]);
          if (error) console.error('Cloud update trade error:', error);
          else {
            delete t._unsynced;
            t._synced = true;
            saveTrades();
          }
        } catch (err) {
          console.error('Cloud update exception:', err);
        }
      })();
    }
  } else {
    const newTrade = { id: uid(), date, asset, position: formPos, entry, exit, lot, notes, createdAt: Date.now(), _unsynced: true };
    removeDeletedTradeId(currentUser?.email, newTrade.id);
    trades.push(newTrade);
    saveTrades(); // Segera simpan ke localStorage agar tidak hilang saat refresh!
    toast('Trade berhasil dicatat');
    if (currentUser && !currentUser.isLocalOnly && sbClient) {
      (async () => {
        try {
          await ensureCloudSession();
          const { error } = await sbClient.from('trades').upsert([{
            id: String(newTrade.id),
            user_id: currentUser.id,
            date: newTrade.date,
            asset: newTrade.asset,
            position: newTrade.position,
            entry: newTrade.entry,
            exit: newTrade.exit,
            lot: newTrade.lot,
            notes: newTrade.notes,
            created_at: newTrade.createdAt
          }]);
          if (error) console.warn('Cloud insert trade error (tersimpan lokal):', error);
          else {
            delete newTrade._unsynced;
            newTrade._synced = true;
            saveTrades();
          }
          syncDeletedIdsToCloud(currentUser?.email);
        } catch (err) {
          console.warn('Cloud insert exception:', err);
        }
      })();
    }
  }
  state.editingId = null; resetForm(); updateFormUI(); renderAll();
});
$('#btnCancel').onclick = cancelEdit;
$('#posSeg').addEventListener('click', e => { const b = e.target.closest('[data-pos]'); if (!b) return; formPos = b.dataset.pos; syncPosSeg(); updatePreview() });
$('#btnLotPlus').onclick = () => {
  let v = parseFloat($('#fLot').value) || 0; v = Math.round((v + 0.01) * 100) / 100;
  $('#fLot').value = v.toFixed(2); updatePreview();
};
$('#btnLotMinus').onclick = () => {
  let v = parseFloat($('#fLot').value) || 0; v = Math.max(0.01, Math.round((v - 0.01) * 100) / 100);
  $('#fLot').value = v.toFixed(2); updatePreview();
};
let prevAssetVal = 'XAUUSD';
$('#fAsset').addEventListener('focus', () => {
  if ($('#fAsset').value && $('#fAsset').value !== '__custom__') prevAssetVal = $('#fAsset').value;
});
$('#fAsset').addEventListener('change', e => {
  if (e.target.value === '__custom__') {
    openAddPairModal(prevAssetVal);
  } else {
    prevAssetVal = e.target.value;
    updatePreview();
  }
});
['fEntry', 'fExit', 'fLot'].forEach(id => $('#' + id).addEventListener('input', updatePreview));

/* ---- filter tabel ---- */
$('#tSearch').addEventListener('input', e => { state.j.q = e.target.value.trim().toLowerCase(); renderTable() });
$('#tPos').addEventListener('change', e => { state.j.pos = e.target.value; renderTable() });
['tFrom', 'tTo'].forEach(id => {
  const el = $('#' + id);
  if (!el) return;
  el.addEventListener('click', () => {
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); } catch (_) {}
    }
  });
});
$('#tFrom').addEventListener('change', e => {
  state.j.from = e.target.value;
  if (state.j.from && state.j.to && state.j.to < state.j.from) {
    state.j.to = state.j.from;
    $('#tTo').value = state.j.to;
  }
  renderTable();
});
$('#tTo').addEventListener('change', e => {
  state.j.to = e.target.value;
  if (state.j.from && state.j.to && state.j.to < state.j.from) {
    state.j.from = state.j.to;
    $('#tFrom').value = state.j.from;
  }
  renderTable();
});
$('#btnTReset').onclick = () => {
  state.j = { q: '', pos: 'ALL', from: '', to: '' };
  $('#tSearch').value = ''; $('#tPos').value = 'ALL'; $('#tFrom').value = ''; $('#tTo').value = ''; renderTable()
};
if ($('#tRangeBanner')) {
  $('#tRangeBanner').addEventListener('click', e => {
    if (e.target.closest('#btnClearDateRange')) {
      state.j.from = '';
      state.j.to = '';
      $('#tFrom').value = '';
      $('#tTo').value = '';
      renderTable();
    }
  });
}

/* ---- CSV ---- */
function exportCSV(list, name) {
  if (!list.length) { toast('Tidak ada data untuk diekspor', 'err'); return }
  const head = ['Tanggal', 'Aset', 'Posisi', 'Harga Entry', 'Harga Exit', 'Return (%)', 'Lot', 'Catatan', 'Sumber'];
  const q = v => { v = v == null ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v };
  const lines = [head.join(',')];
  list.forEach(t => lines.push([t.date, t.asset || '', t.position, t.entry, t.exit, tradeRet(t).toFixed(4), t.lot != null ? Number(t.lot).toFixed(2) : '', t.notes ?? '', 'REAL'].map(q).join(',')));
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}_${todayISO()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`${list.length} trade diekspor ke CSV`);
}
$('#btnCsv').onclick = () => exportCSV(filteredJournal(), 'trading-journal');
$('#btnExportAll').onclick = () => exportCSV(sorted(), 'trading-journal-semua');

/* ================= ANALYTICS ================= */
function renderVS(arr) {
  const box = $('#vsPanel');
  if (!arr.length) { box.innerHTML = EMPTY_CH; return }
  const { L, S } = sideStats(arr);
  const row = (lab, fa, fb, va, vb) => {
    const mx = Math.max(Math.abs(va ?? 0), Math.abs(vb ?? 0)) || 1;
    const wa = Math.abs(va ?? 0) / mx * 100, wb = Math.abs(vb ?? 0) / mx * 100;
    return `<div class="vs-row"><div class="vs-lab">${lab}</div><div class="vs-bars">
      <div class="vs-half"><span class="vs-val mono ${pcls(va)}">${fa}</span><div class="vs-track"><i class="vs-fill lf" data-w="${wa}%" style="width:0"></i></div></div>
      <div class="vs-half"><div class="vs-track"><i class="vs-fill sf" data-w="${wb}%" style="width:0"></i></div><span class="vs-val mono ${pcls(vb)}">${fb}</span></div>
    </div></div>`};
  box.innerHTML = `<div class="vs-head"><span class="badge long">▲ LONG — ${L.n} trade</span><span class="badge short">▼ SHORT — ${S.n} trade</span></div>`
    + row('Rata-rata Return', fmtPct(L.avg), fmtPct(S.avg), L.avg, S.avg)
    + row('Win Rate', L.n ? fmtPct(L.wr, 1) : '—', S.n ? fmtPct(S.wr, 1) : '—', L.wr, S.wr)
    + row('Total Return (simple)', fmtPct(L.sum), fmtPct(S.sum), L.sum, S.sum);
  requestAnimationFrame(() => box.querySelectorAll('.vs-fill').forEach(f => f.style.width = f.dataset.w));
}
function renderHist() {
  const box = $('#chHist'); box.innerHTML = '';
  const arr = pt(), rets = arr.map(tradeRet);
  if (rets.length < 2) { box.innerHTML = '<div class="chart-empty">Butuh minimal 2 trade untuk distribusi.</div>'; return }
  const lo0 = Math.min(...rets), hi0 = Math.max(...rets);
  let span = hi0 - lo0; if (span < 1e-9) span = 1;
  const raw = span / Math.min(10, Math.max(4, Math.round(rets.length / 2) + 1));
  const bw = [0.1, 0.2, 0.25, 0.5, 1, 1.5, 2, 2.5, 5, 10, 15, 20, 25].find(s => s >= raw) || 50;
  const lo = Math.floor(lo0 / bw) * bw, nb = Math.max(1, Math.ceil((hi0 - lo) / bw - 1e-9));
  const bins = Array.from({ length: nb }, (_, i) => ({ lo: lo + i * bw, hi: lo + (i + 1) * bw, n: 0 }));
  rets.forEach(r => { let i = Math.floor((r - lo) / bw); i = Math.max(0, Math.min(nb - 1, i)); bins[i].n++ });
  const w = Math.max(300, box.clientWidth), h = 212, pl = 34, pr = 10, ptp = 12, pb = 24;
  const svg = mkSvg(box, w, h), maxN = Math.max(...bins.map(b => b.n));
  const iw = w - pl - pr, ih = h - ptp - pb, band = iw / bins.length, bwpx = Math.max(6, Math.min(46, band * .72));
  [1, Math.ceil(maxN / 2), maxN].filter((v, i, a) => a.indexOf(v) === i).forEach(v => {
    const y = ptp + ih - (v / maxN) * ih;
    el('line', { x1: pl, x2: w - pr, y1: y, y2: y, class: 'grid' }, svg);
    el('text', { x: pl - 6, y: y + 3.5, 'text-anchor': 'end' }, svg).textContent = v
  });
  el('line', { x1: pl, x2: w - pr, y1: ptp + ih, y2: ptp + ih, class: 'zero' }, svg);
  bins.forEach((b, i) => {
    if (!b.n) return;
    const bh = (b.n / maxN) * ih, cx = pl + band * i + band / 2;
    const mid = (b.lo + b.hi) / 2;
    const rect = el('rect', {
      x: cx - bwpx / 2, y: ptp + ih - bh, width: bwpx, height: bh, rx: 1,
      class: 'bar ' + (mid > 0 ? 'pos' : mid < 0 ? 'neg' : 'be')
    }, svg);
    rect.style.transformOrigin = `${cx}px ${ptp + ih}px`;
    if (_freshRender) rect.style.animation = `barGrow .5s ${i * 30}ms cubic-bezier(.2,.7,.3,1) both`;
    rect.addEventListener('mouseenter', e => {
      rect.classList.add('hot');
      showTip(`<div class="tip-t">Rentang ${fmtPct(b.lo)} s/d ${fmtPct(b.hi)}</div>${tipRow('Jumlah trade', b.n + ' trade')}`, e)
    });
    rect.addEventListener('mousemove', moveTip);
    rect.addEventListener('mouseleave', () => { rect.classList.remove('hot'); hideTip() });
  });
  el('text', { x: pl, y: h - 6 }, svg).textContent = fmtAxisPct(lo);
  el('text', { x: w - pr, y: h - 6, 'text-anchor': 'end' }, svg).textContent = fmtAxisPct(lo + nb * bw);
}
function renderDDChart() {
  const box = $('#chDD'); box.innerHTML = '';
  const arr = pt(); if (!arr.length) { box.innerHTML = EMPTY_CH; return }
  const dd = drawdownSeries(metrics(arr)), labels = ['Mulai', ...arr.map(t => t.date)], n = dd.length;
  const w = Math.max(300, box.clientWidth), h = 200, pl = 50, pr = 56, ptp = 12, pb = 24;
  const svg = mkSvg(box, w, h);
  let lo = Math.min(...dd, 0), hi = 0;
  if (lo === 0) lo = -1;
  const padV = (hi - lo) * .14; lo -= padV; hi += Math.max(.2, (hi - lo) * .05);
  const iw = w - pl - pr, ih = h - ptp - pb;
  const X = i => n > 1 ? pl + iw * i / (n - 1) : pl + iw / 2, Y = v => ptp + (hi - v) / (hi - lo) * ih, y0 = Y(0);
  ticks(lo, hi, 3).forEach(v => {
    el('line', { x1: pl, x2: w - pr, y1: Y(v), y2: Y(v), class: 'grid' }, svg);
    el('text', { x: pl - 7, y: Y(v) + 3.5, 'text-anchor': 'end' }, svg).textContent = fmtAxisPct(v)
  });
  el('line', { x1: pl, x2: w - pr, y1: y0, y2: y0, class: 'zero' }, svg);
  const defs = el('defs', {}, svg), g = el('linearGradient', { id: 'gDD', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#f43f5e', 'stop-opacity': 0 }, g);
  el('stop', { offset: '100%', 'stop-color': '#f43f5e', 'stop-opacity': .2 }, g);
  let d = `M${X(0)},${Y(dd[0])}`; for (let i = 1; i < n; i++)d += `L${X(i)},${Y(dd[i])}`;
  el('path', { d: `${d}L${X(n - 1)},${y0}L${X(0)},${y0}Z`, fill: 'url(#gDD)' }, svg);
  el('path', { d, fill: 'none', stroke: 'var(--red)', 'stroke-width': 1.75, 'stroke-linejoin': 'round' }, svg);
  let mi = 0; dd.forEach((v, i) => { if (v < dd[mi]) mi = i });
  el('circle', { cx: X(mi), cy: Y(dd[mi]), r: 3.6, fill: 'var(--red)' }, svg);
  el('text', { x: X(mi) + 7, y: Y(dd[mi]) + 4, fill: 'var(--red)', 'font-size': '11px', 'font-weight': '600' }, svg).textContent = fmtPct(dd[mi]);
  const ov = el('rect', { x: pl, y: ptp, width: iw, height: ih, fill: 'transparent' }, svg);
  ov.addEventListener('pointermove', e => {
    const bx = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round((e.clientX - bx.left - pl) / (iw || 1) * (n - 1))));
    showTip(`<div class="tip-t">${labels[i] === 'Mulai' ? 'Titik Awal' : fmtDate(labels[i])}</div>${tipRow('Drawdown', fmtPct(dd[i]), dd[i] < 0 ? 'neg' : 'be')}`, e)
  });
  ov.addEventListener('pointerleave', hideTip);
}
function renderConsist(arr) {
  const box = $('#consistChips');
  if (!arr.length) { box.innerHTML = ''; return }
  const uniq = [...new Set(arr.map(t => t.date))];
  const span = Math.round((parseISO(arr[arr.length - 1].date) - parseISO(arr[0].date)) / 864e5) + 1;
  const st = streakInfo(arr), be = arr.filter(t => tradeRet(t) === 0).length;
  const chips = [
    [uniq.length, 'Hari dengan trade'], [Math.max(0, span - uniq.length), 'Hari tanpa trade (rentang)'],
    [st.maxW, 'Win streak maks.'], [st.maxL, 'Loss streak maks.'], [be, 'Trade break-even']];
  const existing = box.querySelectorAll('.chip-stat');
  if (existing.length === chips.length) {
    chips.forEach(([v, l], i) => { existing[i].querySelector('.cs-v').textContent = fmtInt(v); existing[i].querySelector('.cs-l').textContent = l });
  } else {
    box.innerHTML = chips.map(([v, l], i) => `<div class="chip-stat" style="--d:${i * 40}ms"><div class="cs-v">${fmtInt(v)}</div><div class="cs-l">${l}</div></div>`).join('');
  }
}
function renderMonthly(arr) {
  const box = $('#monthlyTbl');
  if (!arr.length) { box.innerHTML = '<p class="hint" style="padding:10px">Belum ada data.</p>'; return }
  const map = new Map();
  arr.forEach(t => { const k = t.date.slice(0, 7); if (!map.has(k)) map.set(k, []); map.get(k).push(t) });
  const rows = [...map.entries()].sort((a, b) => a[0] < b[0] ? 1 : -1).map(([k, ts]) => {
    const m = metrics(ts);
    const mIdx = +k.slice(5, 7) - 1;
    const yr = k.slice(0, 4);
    const lab = `<span class="m-full">${MONTHS_FULL[mIdx]}</span><span class="m-short">${MONTHS[mIdx]}</span> ${yr}`;
    return `<tr><td class="mono">${lab}</td><td class="mono c">${m.total}</td>
      <td class="mono c">${fmtPct(m.winRate, 1)}</td><td class="mono c ${pcls(m.avg)}">${fmtPct(m.avg)}</td>
      <td class="mono c ${pcls(m.comp)}">${fmtPct(m.comp)}</td></tr>`
  });
  box.innerHTML = `<table class="mini"><thead><tr><th>Bulan</th><th class="c">Trades</th><th class="c">Win Rate</th><th class="c">Avg</th><th class="c">Kumulatif</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
function renderInsights(arr, m) {
  const ul = $('#insights');
  if (!arr.length) { ul.innerHTML = '<li class="dim">Belum ada data pada periode ini.</li>'; return; }
  const out = [];

  // 1. Analisis Performa per Pair (Best & Toxic Pair)
  const pairMap = new Map();
  arr.forEach(t => {
    const p = t.asset || 'Tanpa Aset';
    if (!pairMap.has(p)) pairMap.set(p, { name: p, n: 0, wins: 0, sum: 0 });
    const stat = pairMap.get(p);
    stat.n++;
    const r = tradeRet(t);
    stat.sum += r;
    if (r > 0) stat.wins++;
  });
  const pairs = [...pairMap.values()].map(p => ({ ...p, wr: (p.wins / p.n) * 100 }));
  pairs.sort((a, b) => b.sum - a.sum);
  const bestPair = pairs[0];
  const worstPair = pairs[pairs.length - 1];
  if (pairs.length === 1) {
    out.push(`Fokus pair <b>${esc(bestPair.name)}</b>: akumulasi return <b>${fmtPct(bestPair.sum)}</b> (${bestPair.n} trade · WR ${fmtPct(bestPair.wr, 1)}).`);
  } else if (worstPair && worstPair.sum < 0 && worstPair.name !== bestPair.name) {
    out.push(`Pair terbaik: <b>${esc(bestPair.name)}</b> (${fmtPct(bestPair.sum)} · WR ${fmtPct(bestPair.wr, 1)}) · Paling menguras modal: <b>${esc(worstPair.name)}</b> (${fmtPct(worstPair.sum)} · WR ${fmtPct(worstPair.wr, 1)}).`);
  } else {
    out.push(`Pair paling menguntungkan: <b>${esc(bestPair.name)}</b> menyumbang return <b>${fmtPct(bestPair.sum)}</b> (WR ${fmtPct(bestPair.wr, 1)} dari ${bestPair.n} trade).`);
  }

  // 2. Pola Hari Trading (Day of Week)
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const dayMap = new Map();
  arr.forEach(t => {
    if (!t.date) return;
    const parts = t.date.split('-');
    const dayIdx = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getDay();
    const dName = dayNames[dayIdx];
    if (!dayMap.has(dName)) dayMap.set(dName, { name: dName, n: 0, wins: 0, sum: 0 });
    const stat = dayMap.get(dName);
    stat.n++;
    const r = tradeRet(t);
    stat.sum += r;
    if (r > 0) stat.wins++;
  });
  const days = [...dayMap.values()].map(d => ({ ...d, wr: (d.wins / d.n) * 100 }));
  days.sort((a, b) => b.sum - a.sum);
  if (days.length >= 2) {
    const bestD = days[0];
    const worstD = days[days.length - 1];
    out.push(`Hari paling konsisten: <b>${bestD.name}</b> (${fmtPct(bestD.sum)} · WR ${fmtPct(bestD.wr, 1)})${worstD.sum < 0 ? ` · Waspada hari <b>${worstD.name}</b> (${fmtPct(worstD.sum)} · WR ${fmtPct(worstD.wr, 1)})` : ''}.`);
  } else if (days.length === 1) {
    out.push(`Semua transaksi di periode ini tercatat pada hari <b>${days[0].name}</b> (${fmtPct(days[0].sum)} · WR ${fmtPct(days[0].wr, 1)}).`);
  }

  // 3. Deteksi Revenge Trading & Overtrading
  const dateMap = new Map();
  arr.forEach(t => {
    if (!dateMap.has(t.date)) dateMap.set(t.date, []);
    dateMap.get(t.date).push(t);
  });
  let maxTradesInDay = 0;
  let hasRevenge = false;
  dateMap.forEach(dayTrades => {
    if (dayTrades.length > maxTradesInDay) maxTradesInDay = dayTrades.length;
    for (let i = 1; i < dayTrades.length; i++) {
      const prev = dayTrades[i - 1], curr = dayTrades[i];
      if (tradeRet(prev) < 0 && curr.lot != null && prev.lot != null && curr.lot >= prev.lot * 1.4) {
        hasRevenge = true;
      }
    }
  });
  if (hasRevenge) {
    out.push(`Peringatan disiplin: Terdeteksi indikasi <b>revenge trading</b> (peningkatan lot agresif setelah loss). Disiplinkan batas risiko per trade.`);
  } else if (maxTradesInDay >= 5) {
    out.push(`Peringatan overtrading: Terdeteksi hingga <b>${maxTradesInDay} trade dalam 1 hari</b>. Batasi frekuensi harian untuk mencegah emosi.`);
  } else {
    out.push(`Kontrol emosi & disiplin terjaga: Tidak ada indikasi revenge trading (maksimal <b>${maxTradesInDay} trade/hari</b>), risiko terkendali.`);
  }

  // 4. Evaluasi Rasio Risk-to-Reward / Win vs Loss Nyata
  const wins = arr.filter(t => tradeRet(t) > 0);
  const losses = arr.filter(t => tradeRet(t) < 0);
  if (wins.length && losses.length) {
    const avgWin = wins.reduce((s, t) => s + tradeRet(t), 0) / wins.length;
    const avgLoss = Math.abs(losses.reduce((s, t) => s + tradeRet(t), 0) / losses.length);
    const realRR = avgWin / (avgLoss || 1);
    const verdict = realRR >= 1.5 ? 'sistem trading sangat sehat' : realRR >= 1 ? 'sistem cukup seimbang' : 'perketat Stop Loss';
    out.push(`Rasio Risk-to-Reward riil: <b>1 : ${realRR.toFixed(2)}</b> (avg win <b>${fmtPct(avgWin)}</b> vs loss <b>${fmtPct(-avgLoss)}</b>) · ${verdict}.`);
  } else if (wins.length && !losses.length) {
    out.push(`Rasio performa sempurna: <b>100% win</b> (${wins.length} trade) pada rentang waktu ini tanpa catatan loss.`);
  } else if (!wins.length && losses.length) {
    out.push(`Evaluasi strategi: Belum ada trade profit di periode ini (${losses.length} loss) — tinjau kembali titik entry & konfirmasi teknikal.`);
  } else {
    out.push(`Seluruh trade pada periode ini berakhir Break-Even (BE).`);
  }

  ul.innerHTML = out.map(x => `<li>${x}</li>`).join('');
}
function renderAnalytics() {
  const has = trades.length > 0;
  $('#anEmpty').hidden = has; $('#anBody').hidden = !has;
  if (!has) return;
  const arr = pt(), m = metrics(arr);
  renderVS(arr); renderHist(); renderDDChart(); renderConsist(arr); renderMonthly(arr); renderInsights(arr, m);
  _freshRender = false;
}

/* ================= POSITION SIZING (RISK MANAGEMENT) ================= */
const LS_PS = 'tjd.ps.v1';
const psState = { pair: 'XAUUSD', balance: 1000, riskMode: 'pct', riskVal: 1, slMode: 'pips', slPips: 20, entryPrice: '', slPrice: '', pipVal: 10, customPip: false };

function getDefaultPipValue(asset) {
  const a = (asset || 'XAUUSD').toUpperCase();
  if (a.endsWith('USD') && !a.startsWith('XAU') && !a.startsWith('BTC')) return { val: 10, note: 'Quote USD: $10 / pip per 1.00 lot' };
  if (a.includes('XAU') || a.includes('GOLD')) return { val: 10, note: 'XAUUSD (100 oz): $10 / pip (1 pip = 0.10 poin)' };
  if (a.includes('JPY')) return { val: 6.67, note: 'Pair JPY: ~$6.67 / pip per 1.00 lot (estimasi kurs ~150)' };
  if (a.endsWith('CAD')) return { val: 7.30, note: 'Quote CAD: ~$7.30 / pip per 1.00 lot' };
  if (a.endsWith('CHF')) return { val: 11.30, note: 'Quote CHF: ~$11.30 / pip per 1.00 lot' };
  if (a.includes('BTC')) return { val: 1, note: 'Crypto (1 kontrak): $1 / poin per 1.00 lot' };
  return { val: 10, note: 'Standar $10 / pip per 1.00 lot' };
}

function loadPsSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_PS) || '{}');
    if (s.pair) psState.pair = s.pair;
    if (s.balance > 0) psState.balance = s.balance;
    if (s.riskMode === 'pct' || s.riskMode === 'usd') psState.riskMode = s.riskMode;
    if (s.riskVal > 0) psState.riskVal = s.riskVal;
    if (s.slMode === 'pips' || s.slMode === 'price') psState.slMode = s.slMode;
    if (s.slPips > 0) psState.slPips = s.slPips;
    if (s.entryPrice != null) psState.entryPrice = s.entryPrice;
    if (s.slPrice != null) psState.slPrice = s.slPrice;
    if (s.pipVal > 0) psState.pipVal = s.pipVal;
    if (s.customPip != null) psState.customPip = s.customPip;
  } catch (e) { }
}
function savePsSettings() {
  try { localStorage.setItem(LS_PS, JSON.stringify(psState)) } catch (e) { }
}
const fmtUsd = (v, dec = 2) => '$' + new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(isFinite(v) ? v : 0);

function syncPsUI() {
  const pairSel = $('#psPair');
  if (pairSel && [...pairSel.options].some(o => o.value === psState.pair)) pairSel.value = psState.pair;
  $('#psBalance').value = psState.balance;
  $('#psRiskInput').value = psState.riskVal;
  $('#psSlPips').value = psState.slPips;
  $('#psEntryPrice').value = psState.entryPrice;
  $('#psSlPrice').value = psState.slPrice;
  const defPip = getDefaultPipValue(psState.pair);
  if (!psState.customPip) psState.pipVal = defPip.val;
  $('#psPipVal').value = psState.pipVal;

  $$('#psRiskModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.rm === psState.riskMode));
  $('#psRiskPresets').hidden = psState.riskMode !== 'pct';
  $$('#psSlModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.sm === psState.slMode));
  $('#psSlPipsWrap').hidden = psState.slMode !== 'pips';
  $('#psSlPriceWrap').hidden = psState.slMode !== 'price';
}

function renderPositionSizing() {
  const bal = Math.max(0, parseFloat($('#psBalance').value) || 0);
  const rawRisk = Math.max(0, parseFloat($('#psRiskInput').value) || 0);
  const pipVal = Math.max(0.0001, parseFloat($('#psPipVal').value) || 10);
  const pair = $('#psPair').value || 'EURUSD';

  // Highlight active preset chips
  $$('#psBalPresets .ps-chip').forEach(c => c.classList.toggle('active', Math.abs(parseFloat(c.dataset.bal) - bal) < 1e-6));
  if (psState.riskMode === 'pct') {
    $$('#psRiskPresets .ps-chip').forEach(c => c.classList.toggle('active', Math.abs(parseFloat(c.dataset.rk) - rawRisk) < 1e-6));
  }

  let riskUsd = 0, riskPct = 0;
  if (psState.riskMode === 'pct') {
    riskPct = rawRisk;
    riskUsd = bal * (riskPct / 100);
  } else {
    riskUsd = rawRisk;
    riskPct = bal > 0 ? (riskUsd / bal) * 100 : 0;
  }

  let slPips = 0, slDirText = 'Batas toleransi rugi', entryP = 0, slP = 0, posDir = null;
  if (psState.slMode === 'pips') {
    slPips = Math.max(0, parseFloat($('#psSlPips').value) || 0);
    $$('#psSlPresets .ps-chip').forEach(c => c.classList.toggle('active', Math.abs(parseFloat(c.dataset.sl) - slPips) < 1e-6));
  } else {
    entryP = parseFloat($('#psEntryPrice').value) || 0;
    slP = parseFloat($('#psSlPrice').value) || 0;
    if (entryP > 0 && slP > 0 && entryP !== slP) {
      slPips = Math.abs(entryP - slP) * getPipMultiplier(pair);
      posDir = entryP > slP ? 'LONG' : 'SHORT';
      slDirText = `${posDir} · SL @ ${fmtPrice(slP)}`;
      $('#psPriceCalcHint').innerHTML = `Terdeteksi posisi <b class="${posDir === 'LONG' ? 'c-l' : 'c-s'}">${posDir}</b> dengan jarak SL <b>${nf(slPips, 1, 1)} pips</b>.`;
    } else {
      slPips = 0;
      $('#psPriceCalcHint').textContent = 'Masukkan harga Entry dan harga Stop Loss yang berbeda untuk menghitung jarak pips otomatis.';
    }
  }

  const exactLot = (slPips > 0 && pipVal > 0 && riskUsd > 0) ? (riskUsd / (slPips * pipVal)) : 0;
  const stdLot = Math.floor((exactLot + 1e-9) * 100) / 100; // pembulatan aman ke bawah (step 0.01 lot)
  const displayLot = exactLot >= 0.01 ? stdLot : exactLot;
  $('#psOutLot').innerHTML = `${exactLot >= 0.01 ? stdLot.toFixed(2) : exactLot > 0 ? exactLot.toFixed(4) : '0.00'} <span style="font-size:18px;font-weight:500;color:var(--mut)">Lot</span>`;
  $('#psRoundingNote').textContent = exactLot >= 0.01 ? `Perhitungan presisi: ${exactLot.toFixed(3)} lot (dibulatkan aman ke ${stdLot.toFixed(2)} lot)` : exactLot > 0 ? `Di bawah 0.01 lot standar (${exactLot.toFixed(4)} lot)` : 'Isi parameter untuk menghitung lot';

  const usedLot = exactLot >= 0.01 ? stdLot : (exactLot > 0 ? 0.01 : 0);
  const actualRiskUsd = usedLot * slPips * pipVal;
  const pipDollar = usedLot * pipVal;
  const remBal = Math.max(0, bal - riskUsd);
  const remPct = bal > 0 ? (remBal / bal) * 100 : 0;

  $('#psOutRiskUsd').textContent = '-' + fmtUsd(riskUsd);
  $('#psOutRiskPct').textContent = `${nf(riskPct, 2, 2)}% dari modal ${fmtUsd(bal, 0)}`;
  $('#psOutSlPips').innerHTML = `${nf(slPips, 1, 1)} <span style="font-size:13px;color:var(--mut)">pips</span>`;
  $('#psOutSlDir').textContent = slDirText;
  $('#psOutPipRisk').innerHTML = `${fmtUsd(pipDollar)}<span style="font-size:13px;color:var(--mut)">/pip</span>`;
  $('#psOutActualRisk').textContent = `Risiko riil (${usedLot.toFixed(2)} lot): ${fmtUsd(actualRiskUsd)}`;
  $('#psOutRemBal').textContent = fmtUsd(remBal);
  $('#psOutRemPct').textContent = `${nf(remPct, 2, 2)}% ekuitas bertahan`;
  $('#psSummarySub').textContent = `${pair} · Modal ${fmtUsd(bal)} · Risk ${nf(riskPct, 2, 2)}% (${fmtUsd(riskUsd)}) · SL ${nf(slPips, 1, 1)} pips`;

  // Risk Meter & Badge
  const badge = $('#psRiskBadge'), meterFill = $('#psMeterFill'), meterTxt = $('#psMeterText');
  const pctWidth = Math.min(100, Math.max(2, riskPct * 16));
  meterFill.style.width = pctWidth + '%';
  if (riskPct <= 0) {
    badge.className = 'badge bee'; badge.textContent = 'Belum Diisi';
    meterFill.style.background = 'var(--dim)'; meterTxt.textContent = '0.00% — Masukkan risiko';
  } else if (riskPct <= 1) {
    badge.className = 'badge win'; badge.textContent = 'Konservatif / Aman';
    meterFill.style.background = 'var(--green)'; meterTxt.textContent = `${nf(riskPct, 2, 2)}% — Konservatif (Sangat Aman)`;
  } else if (riskPct <= 2) {
    badge.className = 'badge win'; badge.textContent = 'Risiko Ideal';
    meterFill.style.background = 'var(--green)'; meterTxt.textContent = `${nf(riskPct, 2, 2)}% — Standar Manajemen Risiko Ideal`;
  } else if (riskPct <= 3.5) {
    badge.className = 'badge short'; badge.textContent = 'Moderat / Agresif';
    meterFill.style.background = 'var(--gold)'; meterTxt.textContent = `${nf(riskPct, 2, 2)}% — Moderat / Agresif (Waspada Loss Streak)`;
  } else {
    badge.className = 'badge loss'; badge.textContent = 'Risiko Tinggi!';
    meterFill.style.background = 'var(--red)'; meterTxt.textContent = `${nf(riskPct, 2, 2)}% — Berbahaya / High Risk Over-leverage`;
  }

  // Warnings
  const warns = [];
  if (exactLot > 0 && exactLot < 0.01) {
    const minLotRisk = 0.01 * slPips * pipVal;
    const minLotPct = bal > 0 ? (minLotRisk / bal) * 100 : 0;
    warns.push(`Ukuran lot ideal (<b>${exactLot.toFixed(4)} lot</b>) lebih kecil dari lot minimum broker standar (<b>0.01 lot</b>). Jika Anda tetap memaksakan entry 0.01 lot dengan SL ${nf(slPips, 1, 1)} pips, risiko aktual Anda menjadi <b>${fmtUsd(minLotRisk)} (${nf(minLotPct, 2, 2)}%)</b>. Gunakan akun Cent/Micro atau cari setup dengan SL lebih rapat.`);
  }
  if (riskPct > 3) {
    warns.push(`Risk per trade sebesar <b>${nf(riskPct, 2, 2)}%</b> cukup berisiko. Hanya butuh ${Math.ceil(25 / riskPct)}x loss beruntun untuk menggerus >25% modal Anda. Trader profesional umumnya membatasi risiko di <b>0.5% – 2%</b> per transaksi.`);
  }
  const warnBox = $('#psWarnBox');
  if (warns.length) {
    warnBox.hidden = false;
    warnBox.innerHTML = `<span>⚠</span><div>${warns.join('<br style="margin-bottom:6px">')}</div>`;
  } else {
    warnBox.hidden = true;
  }

  // Risk:Reward Simulation Grid
  const rrs = [1, 1.5, 2, 2.5, 3, 5];
  const mult = getPipMultiplier(pair);
  $('#psRrGrid').innerHTML = rrs.map(rr => {
    const tpPips = slPips * rr;
    const profUsd = riskUsd * rr;
    const profPct = riskPct * rr;
    const pipsStr = (tpPips >= 100 || tpPips % 1 === 0) ? fmtInt(Math.round(tpPips)) : nf(tpPips, 1, 1);
    let tpLine = `<span>+${nf(profPct, 2, 2)}% modal</span><span class="mono">Ekuitas: ${fmtUsd(bal + profUsd, 0)}</span>`;
    if (psState.slMode === 'price' && entryP > 0 && slP > 0 && entryP !== slP) {
      const tpPrice = posDir === 'LONG' ? entryP + (tpPips / mult) : entryP - (tpPips / mult);
      tpLine = `<span>TP @ <b class="mono" style="color:var(--text)">${fmtPrice(tpPrice)}</b></span><span>+${nf(profPct, 2, 2)}%</span>`;
    }
    return `<div class="ps-rr-card${rr === 2 ? ' highlight' : ''}">
      <div class="ps-rr-head">
        <span class="ps-rr-ratio">1 : ${rr}</span>
        <span class="ps-rr-pips mono">+${pipsStr} pips</span>
      </div>
      <div class="ps-rr-profit mono">+${fmtUsd(profUsd)}</div>
      <div class="ps-rr-sub">${tpLine}</div>
    </div>`;
  }).join('');

  // Consecutive Loss Streak Grid
  const streaks = [1, 2, 3, 5, 7, 10];
  $('#psStreakTbl').innerHTML = streaks.map(n => {
    const eqComp = riskPct < 100 ? bal * Math.pow(1 - riskPct / 100, n) : 0;
    const ddComp = bal > 0 ? ((eqComp - bal) / bal) * 100 : 0;
    const eqFix = Math.max(0, bal - riskUsd * n);
    return `<div class="ps-dd-item">
      <div class="ps-dd-top"><b>${n}x Loss</b><span class="neg mono">${fmtPct(ddComp, 1)}</span></div>
      <div class="ps-dd-val mono">${fmtUsd(eqComp)}</div>
      <div class="ps-dd-sub"><span>Tetap:</span><span class="mono">${fmtUsd(eqFix)}</span></div>
    </div>`;
  }).join('');
}

// Event listeners for Position Sizing
$('#psPair').addEventListener('change', e => {
  psState.pair = e.target.value;
  if (!psState.customPip) {
    const d = getDefaultPipValue(psState.pair);
    psState.pipVal = d.val;
    $('#psPipVal').value = d.val;
  }
  savePsSettings(); renderPositionSizing();
});
if ($('#btnPsUseAccountBal')) {
  $('#btnPsUseAccountBal').onclick = () => {
    const eq = calcAccountEquity();
    const roundedEq = Math.max(0, Math.round(eq.currentBalance * 100) / 100);
    psState.balance = roundedEq;
    $('#psBalance').value = roundedEq;
    capitalConfig.autoSyncPs = true;
    saveCapitalConfig();
    savePsSettings();
    renderPositionSizing();
    openCapitalModal();
  };
}
$('#psBalance').addEventListener('input', e => {
  psState.balance = parseFloat(e.target.value) || 0;
  savePsSettings(); renderPositionSizing();
});
$('#psBalPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-bal]'); if (!b) return;
  if (b.id === 'psChipEquity') {
    const eq = calcAccountEquity();
    psState.balance = Math.max(0, Math.round(eq.currentBalance * 100) / 100);
    capitalConfig.autoSyncPs = true;
    saveCapitalConfig();
    toast(`Saldo akun saat ini (${fmtUsd(psState.balance)}) digunakan`);
  } else {
    psState.balance = parseFloat(b.dataset.bal);
  }
  $('#psBalance').value = psState.balance;
  savePsSettings(); renderPositionSizing();
});
$('#psRiskModeSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-rm]'); if (!b || b.dataset.rm === psState.riskMode) return;
  const bal = parseFloat($('#psBalance').value) || 0;
  const cur = parseFloat($('#psRiskInput').value) || 0;
  psState.riskMode = b.dataset.rm;
  if (psState.riskMode === 'usd') {
    psState.riskVal = bal > 0 ? Math.round(bal * (cur / 100) * 100) / 100 : 10;
  } else {
    psState.riskVal = bal > 0 ? Math.round((cur / bal) * 10000) / 100 : 1;
  }
  $('#psRiskInput').value = psState.riskVal;
  syncPsUI(); savePsSettings(); renderPositionSizing();
});
$('#psRiskInput').addEventListener('input', e => {
  psState.riskVal = parseFloat(e.target.value) || 0;
  savePsSettings(); renderPositionSizing();
});
$('#psRiskPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-rk]'); if (!b) return;
  psState.riskMode = 'pct';
  psState.riskVal = parseFloat(b.dataset.rk);
  $('#psRiskInput').value = psState.riskVal;
  syncPsUI(); savePsSettings(); renderPositionSizing();
});
$('#psSlModeSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-sm]'); if (!b || b.dataset.sm === psState.slMode) return;
  psState.slMode = b.dataset.sm;
  syncPsUI(); savePsSettings(); renderPositionSizing();
});
$('#psSlPips').addEventListener('input', e => {
  psState.slPips = parseFloat(e.target.value) || 0;
  savePsSettings(); renderPositionSizing();
});
$('#psSlPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-sl]'); if (!b) return;
  psState.slPips = parseFloat(b.dataset.sl);
  $('#psSlPips').value = psState.slPips;
  savePsSettings(); renderPositionSizing();
});
['psEntryPrice', 'psSlPrice'].forEach(id => $('#' + id).addEventListener('input', () => {
  psState.entryPrice = $('#psEntryPrice').value;
  psState.slPrice = $('#psSlPrice').value;
  savePsSettings(); renderPositionSizing();
}));
$('#psPipVal').addEventListener('input', e => {
  psState.pipVal = parseFloat(e.target.value) || 10;
  psState.customPip = true;
  savePsSettings(); renderPositionSizing();
});
$('#btnPsReset').onclick = () => {
  Object.assign(psState, { pair: 'XAUUSD', balance: 1000, riskMode: 'pct', riskVal: 1, slMode: 'pips', slPips: 20, entryPrice: '', slPrice: '', pipVal: 10, customPip: false });
  syncPsUI(); savePsSettings(); renderPositionSizing();
  toast('Kalkulator direset ke pengaturan standar');
};
$('#btnApplyLotToJournal').onclick = () => {
  const bal = Math.max(0, parseFloat($('#psBalance').value) || 0);
  const rawRisk = Math.max(0, parseFloat($('#psRiskInput').value) || 0);
  const pipVal = Math.max(0.0001, parseFloat($('#psPipVal').value) || 10);
  const pair = $('#psPair').value || 'XAUUSD';
  const riskUsd = psState.riskMode === 'pct' ? bal * (rawRisk / 100) : rawRisk;
  let slPips = 0;
  if (psState.slMode === 'pips') slPips = Math.max(0, parseFloat($('#psSlPips').value) || 0);
  else {
    const ep = parseFloat($('#psEntryPrice').value) || 0, sp = parseFloat($('#psSlPrice').value) || 0;
    if (ep > 0 && sp > 0 && ep !== sp) slPips = Math.abs(ep - sp) * getPipMultiplier(pair);
  }
  if (slPips <= 0 || riskUsd <= 0) {
    toast('Lengkapi modal, risiko, dan jarak SL terlebih dahulu', 'err'); return;
  }
  const exactLot = riskUsd / (slPips * pipVal);
  const finalLot = Math.max(0.01, Math.floor((exactLot + 1e-9) * 100) / 100);
  populateAssetSelect(pair);
  $('#fLot').value = finalLot.toFixed(2);
  if (psState.slMode === 'price') {
    const ep = parseFloat($('#psEntryPrice').value) || 0, sp = parseFloat($('#psSlPrice').value) || 0;
    if (ep > 0 && sp > 0 && ep !== sp) {
      $('#fEntry').value = ep;
      formPos = ep > sp ? 'LONG' : 'SHORT';
      syncPosSeg();
    }
  }
  updatePreview();
  go('journal');
  toast(`Ukuran posisi ${finalLot.toFixed(2)} lot (${pair}) diterapkan ke Jurnal`);
};

/* ================= Kelola data ================= */
$('#btnClearAll').onclick = async () => {
  if (!trades.length) { toast('Belum ada data untuk dihapus', 'err'); return }
  const ok = await confirmBox({
    title: 'Hapus Semua Data?',
    msg: `Seluruh ${trades.length} trade akan dihapus permanen ${currentUser ? 'dari akun cloud & browser ini' : 'dari browser ini'}. Ekspor CSV terlebih dahulu jika ingin backup.`,
    ok: 'Ya, Hapus Semua'
  });
  if (!ok) return;
  trades.forEach(t => addDeletedTradeId(currentUser?.email, t.id));
  trades = [];
  saveTrades();
  cancelEdit();
  renderAll();
  toast('Semua data dihapus');
  if (currentUser && !currentUser.isLocalOnly && sbClient) {
    try {
      await ensureCloudSession();
      const { error } = await sbClient.from('trades').delete().eq('user_id', currentUser.id);
      if (error) console.error('Cloud clear trades error:', error);
      syncDeletedIdsToCloud(currentUser?.email);
    } catch (err) {
      console.error('Cloud clear exception:', err);
    }
  }
};
$('#btnInfo').onclick = () => infoBox('Metrik & Penyimpanan', `
  <dl>
    <dt>Daily Return</dt><dd>Return satu trade pada tanggal tersebut — perubahan harga entry→exit sesuai arah posisi.</dd>
    <dt>Win Rate</dt><dd>Jumlah trade return positif ÷ total trade × 100%.</dd>
    <dt>Average Return</dt><dd>Rata-rata aritmetika return per trade. Hari tanpa trade <b>tidak</b> dihitung sebagai 0%.</dd>
    <dt>Compounded Cumulative</dt><dd>(1+r₁)×(1+r₂)×…×(1+rₙ)−1, dengan r dalam desimal — tiap return diterapkan pada saldo sebelumnya.</dd>
    <dt>Simple Cumulative</dt><dd>Seluruh return dijumlahkan langsung tanpa compounding.</dd>
    <dt>Drawdown</dt><dd>Penurunan dari puncak kumulatif sebelumnya ke titik kumulatif berikutnya (metode compounded).</dd>
  </dl>
  <p class="mmsg">Return perubahan harga <b>bukan</b> return modal aktual — leverage, ukuran posisi, dan biaya membuat hasil nyata berbeda. Dashboard ini tidak mengklaim profit dalam rupiah.</p>
  <dl><dt>Penyimpanan</dt><dd>Data disimpan di <b>localStorage browser</b>: persisten antar refresh, tetapi hanya di perangkat &amp; browser ini, tidak tersinkron, dan ikut terhapus bila data browsing dibersihkan. Gunakan ekspor CSV sebagai backup. Database server dapat dihubungkan kemudian tanpa mengubah struktur data.</dd></dl>`);

/* ================= ANALITIK AI (DESKTOP ONLY · VERIFIED API KEY GATE) ================= */
const LS_AI_FALLBACK = 'tjd.ai.v1';
const GEMINI_PREFERRED_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.8-pro',
  'gemini-2.5-pro',
  'gemini-pro-latest',
  'gemini-3.5-flash',
  'gemini-3.0-flash',
  'gemini-flash-latest'
];

const aiState = {
  provider: 'gemini',
  apiKeyB64: '',
  verified: false,
  model: 'gemini-3.8-flash',
  availableModels: [],
  verifiedAt: 0,
  lastHash: '',
  lastReport: null,
  isRunning: false,
  gateOpen: false
};

function getGeminiHeaders(rawKey, withJson = false) {
  const h = {};
  if (rawKey) h['x-goog-api-key'] = rawKey;
  if (withJson) h['Content-Type'] = 'application/json';
  return h;
}

function getUserAiKey() {
  if (currentUser && currentUser.email) {
    return 'tjd.ai.u.' + currentUser.email.toLowerCase();
  }
  try {
    const active = JSON.parse(localStorage.getItem(LS_ACTIVE_USER) || 'null');
    if (active && active.email) return 'tjd.ai.u.' + active.email.toLowerCase();
  } catch (_) {}
  return LS_AI_FALLBACK;
}

function getDecodedAiKey() {
  if (!aiState.apiKeyB64) return '';
  try {
    return decodeURIComponent(escape(atob(aiState.apiKeyB64)));
  } catch (_) {
    return '';
  }
}

function loadAiConfig() {
  try {
    const raw = localStorage.getItem(getUserAiKey());
    if (!raw) {
      Object.assign(aiState, { provider: 'gemini', apiKeyB64: '', verified: false, model: 'gemini-3.8-flash', verifiedAt: 0, lastHash: '', lastReport: null });
      return;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      aiState.provider = parsed.provider === 'openai' ? 'openai' : 'gemini';
      aiState.apiKeyB64 = parsed.apiKeyB64 || '';
      aiState.verified = !!(parsed.verified && parsed.apiKeyB64);
      aiState.model = parsed.model || (aiState.provider === 'openai' ? 'gpt-4o-mini' : 'gemini-3.8-flash');
      aiState.verifiedAt = Number(parsed.verifiedAt || 0);
      aiState.lastHash = parsed.lastHash || '';
      aiState.lastReport = parsed.lastReport || null;
    }
  } catch (_) {}
}

function saveAiConfig() {
  try {
    localStorage.setItem(getUserAiKey(), JSON.stringify({
      provider: aiState.provider,
      apiKeyB64: aiState.apiKeyB64,
      verified: aiState.verified,
      model: aiState.model,
      verifiedAt: aiState.verifiedAt,
      lastHash: aiState.lastHash,
      lastReport: aiState.lastReport
    }));
  } catch (_) {}
}

function setAiConnStatus(type, html) {
  const box = $('#aiConnStatus');
  if (!box) return;
  if (!html) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.className = 'ai-conn-status ' + (type || 'info');
  box.innerHTML = html;
}

function rankGeminiModels(available) {
  const activeText = (available || []).filter(m =>
    m && !/tts|image|audio|embedding|robotics|computer-use|live|thinking|learnlm|aqa|veo|imagen|gemma|gemini-1\.5|gemini-2\.0|gemini-2\.5-flash(?!-lite)/i.test(m)
  );
  const clean = activeText.length
    ? activeText
    : (available || []).filter(m => m && !/tts|image|audio|embedding|robotics|computer-use|live/i.test(m));
  const pool = clean.length ? clean : (available || []);
  const ordered = [];
  const addUnique = m => { if (m && !ordered.includes(m)) ordered.push(m); };

  // 1. Model Flash utama jika tersedia
  if (pool.includes('gemini-3.8-flash')) addUnique('gemini-3.8-flash');
  // 2. Klaster Flash-Lite (jalur server berbeda & paling jarang high demand)
  GEMINI_PREFERRED_MODELS.filter(p => p.includes('flash-lite') && pool.includes(p)).forEach(addUnique);
  pool.filter(m => m.includes('flash-lite')).forEach(addUnique);
  // 3. Klaster Pro (jalur server berbeda)
  GEMINI_PREFERRED_MODELS.filter(p => p.includes('pro') && pool.includes(p)).forEach(addUnique);
  pool.filter(m => m.includes('pro')).forEach(addUnique);
  // 4. Varian Flash lain & sisa model preferred/pool
  GEMINI_PREFERRED_MODELS.forEach(p => { if (pool.includes(p)) addUnique(p); });
  pool.filter(m => m.includes('flash')).forEach(addUnique);
  pool.filter(m => m.includes('gemini')).forEach(addUnique);
  pool.forEach(addUnique);
  return ordered;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Koneksi ke server AI timeout (> ${Math.round(timeoutMs / 1000)} detik). Periksa internet atau coba lagi.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGeminiAvailableModels(rawKey) {
  const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(rawKey)}`;
  const res = await fetchWithTimeout(listUrl, {
    method: 'GET',
    headers: getGeminiHeaders(rawKey, false)
  }, 6000);
  if (!res.ok) {
    let msg = `Server Google Gemini menolak API Key (HTTP ${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.error?.message) msg = errJson.error.message;
    } catch (_) {}
    throw new Error(msg);
  }
  const data = await res.json();
  const models = (data?.models || [])
    .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''));
  aiState.availableModels = models;
  return models;
}

async function verifyAiServerConnection(provider, rawKey) {
  const key = (rawKey || '').trim();
  if (!key || key.length < 12) {
    return { ok: false, error: 'Masukkan API Key yang valid terlebih dahulu.' };
  }

  if (provider === 'openai') {
    try {
      const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + key }
      }, 6000);
      if (!res.ok) {
        let msg = `Server OpenAI menolak API Key (HTTP ${res.status})`;
        try {
          const errJson = await res.json();
          if (errJson?.error?.message) msg = errJson.error.message;
        } catch (_) {}
        return { ok: false, error: msg };
      }
      const data = await res.json();
      const models = Array.isArray(data?.data) ? data.data.map(m => m.id) : [];
      const chosen = models.find(m => m === 'gpt-4o-mini') || models.find(m => m.startsWith('gpt-4o')) || models.find(m => m.startsWith('gpt-4')) || 'gpt-4o-mini';
      return { ok: true, model: chosen, serverLabel: 'OpenAI API Server' };
    } catch (err) {
      return { ok: false, error: 'Gagal menghubungi server OpenAI: ' + (err.message || 'Periksa koneksi internet Anda') };
    }
  }

  // Default: Google Gemini API Fast Single-Step Verification (GET /v1beta/models sudah memvalidasi keaslian API Key)
  try {
    setAiConnStatus('info', '🔌 Memverifikasi API Key & daftar model ke server Google Gemini...');
    const available = await fetchGeminiAvailableModels(key);
    if (!available.length) {
      return { ok: false, error: 'API Key aktif namun tidak memiliki akses ke model generateContent Gemini.' };
    }

    const ranked = rankGeminiModels(available).filter(m => m !== 'gemini-2.5-flash');
    const chosen = ranked.includes('gemini-3.8-flash')
      ? 'gemini-3.8-flash'
      : (ranked[0] || available.find(m => m !== 'gemini-2.5-flash') || 'gemini-3.8-flash');

    return { ok: true, model: chosen, serverLabel: 'Google Gemini AI Server' };
  } catch (err) {
    return { ok: false, error: 'Gagal menghubungi server Google Gemini: ' + (err.message || 'Periksa koneksi internet Anda') };
  }
}

async function fetchExternalMarketContext() {
  const out = {
    fetchedAt: new Date().toISOString(),
    spotRates: null,
    goldUsd: null
  };
  try {
    const fxRes = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD', {}, 1800);
    if (fxRes.ok) {
      const fxData = await fxRes.json();
      if (fxData?.rates) {
        const r = fxData.rates;
        out.spotRates = {
          EURUSD: r.EUR ? +(1 / r.EUR).toFixed(5) : null,
          GBPUSD: r.GBP ? +(1 / r.GBP).toFixed(5) : null,
          AUDUSD: r.AUD ? +(1 / r.AUD).toFixed(5) : null,
          NZDUSD: r.NZD ? +(1 / r.NZD).toFixed(5) : null,
          USDJPY: r.JPY ? +r.JPY.toFixed(3) : null,
          USDCAD: r.CAD ? +r.CAD.toFixed(5) : null,
          USDCHF: r.CHF ? +r.CHF.toFixed(5) : null
        };
      }
    }
  } catch (_) {}
  return out;
}

function renderLockedPreviewPlaceholders() {
  const jBox = $('#aiJournalInsightBody');
  const mBox = $('#aiMacroGeoBody');
  const fBox = $('#aiFundamentalBiasBody');
  if (jBox && !jBox.innerHTML.trim()) {
    jBox.innerHTML = `
      <div class="ai-exec-box">
        <div class="ai-exec-title">RINGKASAN EVALUASI JURNAL &amp; PSIKOLOGI TRADING</div>
        <p>Menganalisis catatan entry/exit, disiplin ukuran lot, rasio kemenangan, serta pola psikologis berulang pada jurnal Anda...</p>
      </div>
      <div class="ai-insight-list">
        <div class="ai-insight-item">
          <div class="ai-ii-head"><span class="badge win">KEPATUHAN SOP</span><b>Evaluasi Konfirmasi Entry &amp; Manajemen Risiko</b></div>
          <p>Menghubungkan narasi catatan trading Anda dengan hasil profit/loss aktual untuk menemukan setup paling presisi.</p>
        </div>
        <div class="ai-insight-item">
          <div class="ai-ii-head"><span class="badge short">PSIKOLOGI &amp; EMOSI</span><b>Deteksi Bias FOMO, Overtrading &amp; Geser SL</b></div>
          <p>Mengidentifikasi pola emosi dari teks catatan yang berpotensi menggerus ekuitas akun.</p>
        </div>
      </div>`;
  }
  if (mBox && !mBox.innerHTML.trim()) {
    mBox.innerHTML = `
      <div class="ai-macro-grid">
        <div class="ai-macro-box">
          <div class="ai-mb-tag">🇺🇸 EKONOMI AMERIKA SERIKAT &amp; THE FED</div>
          <p>Memantau kebijakan suku bunga FOMC, rilis inflasi CPI/PCE, data NFP, imbal hasil US Treasury, serta kekuatan DXY.</p>
        </div>
        <div class="ai-macro-box">
          <div class="ai-mb-tag">🌍 KONFLIK GEOPOLITIK &amp; ARUS SAFE HAVEN</div>
          <p>Menganalisis dampak eskalasi geopolitik global terhadap lonjakan permintaan aset safe haven (XAUUSD, USD, JPY, CHF).</p>
        </div>
      </div>`;
  }
  if (fBox && !fBox.innerHTML.trim()) {
    const samplePairs = ['XAUUSD', 'WTI', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF'];
    fBox.innerHTML = `<div class="ai-bias-grid">${samplePairs.map(p => `
      <div class="ai-bias-card">
        <div class="ai-bc-top"><b>${p}</b><span class="badge bee">MENUNGGU AI</span></div>
        <div class="ai-bc-driver">Verifikasi API Key untuk membuka arah bias fundamental &amp; katalis makro terkini.</div>
      </div>`).join('')}</div>`;
  }
}

function syncAiGateUI(forceShowModal = false) {
  const stage = $('#aiStage');
  const overlay = $('#aiGateOverlay');
  const cancelBtn = $('#btnCancelAiGate');
  const keyInput = $('#aiApiKeyInput');
  const provSel = $('#aiProviderSelect');
  const helpLink = $('#aiKeyHelpLink');
  const pill = $('#aiServerPill');
  const serverTxt = $('#aiServerText');
  if (!stage || !overlay) return;

  const isVerified = !!(aiState.verified && getDecodedAiKey());
  const showGate = !isVerified || forceShowModal;
  aiState.gateOpen = showGate;

  stage.classList.toggle('locked', showGate);
  overlay.hidden = !showGate;
  if (cancelBtn) cancelBtn.hidden = !isVerified;

  if (provSel) provSel.value = aiState.provider || 'gemini';
  if (helpLink) {
    if ((provSel?.value || aiState.provider) === 'openai') {
      helpLink.href = 'https://platform.openai.com/api-keys';
      helpLink.textContent = '⚡ Buka OpenAI API Keys ↗';
    } else {
      helpLink.href = 'https://aistudio.google.com/app/apikey';
      helpLink.textContent = '⚡ Dapatkan Gemini API Key Gratis ↗';
    }
  }
  if (keyInput && showGate && isVerified && !keyInput.value) {
    keyInput.value = getDecodedAiKey();
  }

  if (pill && serverTxt) {
    pill.classList.toggle('online', isVerified);
    serverTxt.textContent = isVerified
      ? `Server AI Terhubung · ${aiState.provider === 'openai' ? 'OpenAI' : 'Google Gemini'} (${aiState.model})`
      : 'Server AI: Belum Terverifikasi';
  }

  const arr = pt();
  const notesCount = arr.filter(t => t.notes && t.notes.trim()).length;
  const scopeEl = $('#aiScopeInfo');
  if (scopeEl) {
    scopeEl.textContent = `Cakupan (${periodLabel()}): ${arr.length} trade (${notesCount} catatan jurnal) · Bias Fundamental XAUUSD, WTI & Major Pairs · Makro AS & Geopolitik`;
  }

  renderLockedPreviewPlaceholders();
}

function renderAiReportData(rep) {
  if (!rep) return;
  const scoreBadge = $('#aiScoreBadge');
  if (scoreBadge) {
    const sc = Number(rep.disciplineScore) || 0;
    scoreBadge.className = 'badge ' + (sc >= 75 ? 'win' : sc >= 50 ? 'short' : 'loss');
    scoreBadge.textContent = rep.scoreLabel || `Skor Disiplin: ${sc}/100`;
  }

  const regimeBadge = $('#aiRegimeBadge');
  if (regimeBadge && rep.macroSentiment) {
    const reg = String(rep.macroSentiment.regime || 'MIXED');
    const isRiskOff = reg.toUpperCase().includes('OFF') || reg.toUpperCase().includes('SAFE');
    const isRiskOn = reg.toUpperCase().includes('ON');
    regimeBadge.className = 'badge ' + (isRiskOff ? 'short' : isRiskOn ? 'win' : 'long');
    regimeBadge.textContent = reg;
  }

  const updEl = $('#aiLastUpdatedText');
  if (updEl && rep.generatedAt) {
    const d = new Date(rep.generatedAt);
    updEl.textContent = `Diperbarui: ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 1. Render Analisis Catatan & Insight
  const jBox = $('#aiJournalInsightBody');
  if (jBox) {
    const insights = Array.isArray(rep.noteInsights) ? rep.noteInsights : [];
    const actions = Array.isArray(rep.actionPlan) ? rep.actionPlan : [];
    jBox.innerHTML = `
      <div class="ai-exec-box">
        <div class="ai-exec-title">RINGKASAN EKSEKUTIF CATATAN &amp; PERILAKU TRADING</div>
        <p>${esc(rep.executiveSummary || '')}</p>
      </div>
      <div class="ai-insight-list">
        ${insights.map(item => {
          const bCls = item.tone === 'pos' ? 'win' : item.tone === 'neg' ? 'loss' : 'short';
          return `<div class="ai-insight-item">
            <div class="ai-ii-head">
              <span class="badge ${bCls}">${esc(item.badge || 'INSIGHT')}</span>
              <b>${esc(item.title || '')}</b>
            </div>
            <p>${esc(item.detail || '')}</p>
          </div>`;
        }).join('')}
      </div>
      ${actions.length ? `
        <div class="ai-action-box">
          <div class="ai-exec-title">🎯 RENCANA TINDAK LANJUT &amp; EVALUASI DISIPLIN</div>
          <ul class="ai-action-list">
            ${actions.map(a => `<li>${esc(a)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    `;
  }

  // 2. Render Konteks Makro Ekonomi AS & Geopolitik Safe Haven
  const mBox = $('#aiMacroGeoBody');
  if (mBox && rep.macroSentiment) {
    const ms = rep.macroSentiment;
    const cats = Array.isArray(rep.macroCatalysts) ? rep.macroCatalysts : [];
    const sources = Array.isArray(rep.groundingSources) ? rep.groundingSources.slice(0, 4) : [];
    mBox.innerHTML = `
      <div class="ai-macro-grid">
        <div class="ai-macro-box">
          <div class="ai-mb-tag">🇺🇸 EKONOMI AS &amp; KEBIJAKAN THE FED (FOMC / DXY)</div>
          <p>${esc(ms.usEconomySummary || '')}</p>
          ${ms.fedPolicyOutlook ? `<div class="ai-mb-sub"><b>Prospek Suku Bunga &amp; DXY:</b> ${esc(ms.fedPolicyOutlook)}</div>` : ''}
        </div>
        <div class="ai-macro-box safe-haven">
          <div class="ai-mb-tag">🌍 KONFLIK GEOPOLITIK &amp; PERMINTAAN SAFE HAVEN</div>
          <p>${esc(ms.geopoliticalSafeHaven || '')}</p>
          ${ms.portfolioImpact ? `<div class="ai-mb-sub"><b>Dampak ke Jurnal Anda:</b> ${esc(ms.portfolioImpact)}</div>` : ''}
        </div>
      </div>
      ${cats.length ? `
        <div class="ai-cat-section">
          <div class="ai-exec-title">📡 KATALIS EKSTERNAL UTAMA YANG WAJIB DIPANTAU</div>
          <div class="ai-cat-list">
            ${cats.map(c => `
              <div class="ai-cat-row">
                <span class="badge ${String(c.impact).toUpperCase() === 'HIGH' ? 'loss' : 'short'}">${esc(c.category || 'MAKRO')}</span>
                <div class="ai-cat-txt"><b>${esc(c.title || '')}:</b> ${esc(c.summary || '')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${sources.length ? `
        <div class="ai-sources-bar">
          <span class="mono dim" style="font-size:10px">SUMBER DATA EKSTERNAL (LIVE GROUNDING):</span>
          ${sources.map(s => `<a href="${esc(s.uri)}" target="_blank" rel="noopener noreferrer" class="ai-src-chip">${esc(trunc(s.title || s.uri, 34))} ↗</a>`).join('')}
        </div>
      ` : ''}
    `;
  }

  // 3. Render Arah Bias Fundamental Major Pairs & XAUUSD
  const fBox = $('#aiFundamentalBiasBody');
  if (fBox) {
    const biases = Array.isArray(rep.pairBiases) ? rep.pairBiases : [];
    const userPairs = new Set(trades.map(t => (t.asset || '').toUpperCase()));
    fBox.innerHTML = `<div class="ai-bias-grid">
      ${biases.map(b => {
        const pairName = String(b.pair || '').toUpperCase();
        const rawBias = String(b.bias || 'NEUTRAL').toUpperCase();
        const isBull = rawBias.includes('BULL') || rawBias.includes('LONG');
        const isBear = rawBias.includes('BEAR') || rawBias.includes('SHORT');
        const bCls = isBull ? 'win' : isBear ? 'loss' : 'bee';
        const arrow = isBull ? '▲ BULLISH' : isBear ? '▼ BEARISH' : '◆ NEUTRAL';
        const isTraded = userPairs.has(pairName) || (pairName === 'WTI' && (userPairs.has('USOIL') || userPairs.has('XTIUSD') || userPairs.has('WTIUSD')));
        return `<div class="ai-bias-card ${isBull ? 'bull' : isBear ? 'bear' : 'neut'}${isTraded ? ' traded' : ''}">
          <div class="ai-bc-top">
            <div class="ai-bc-pair">
              <b class="mono">${esc(pairName)}</b>
              ${isTraded ? `<span class="ai-traded-tag" title="Pair ini tercatat di jurnal Anda">★ Jurnal Anda</span>` : ''}
            </div>
            <span class="badge ${bCls}">${arrow}</span>
          </div>
          <div class="ai-bc-conv mono">Keyakinan: <b>${esc(b.conviction || 'Moderat')}</b>${b.spotRef ? ` · Ref: ${esc(b.spotRef)}` : ''}</div>
          <p class="ai-bc-driver">${esc(b.drivers || '')}</p>
          ${b.keyContext ? `<div class="ai-bc-ctx"><b>Fokus Makro:</b> ${esc(b.keyContext)}</div>` : ''}
          ${b.userAlignment ? `<div class="ai-bc-align"><b>Evaluasi Posisi Anda:</b> ${esc(b.userAlignment)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }
}

async function runAiAnalytics(forceRefresh = false) {
  syncAiGateUI(false);
  const rawKey = getDecodedAiKey();
  if (!aiState.verified || !rawKey) return;
  if (aiState.isRunning) return;

  const arr = pt();
  const currentHash = `v2-8pairs:${state.period}:${computeTradesHash(arr)}`;
  if (!forceRefresh && aiState.lastReport && aiState.lastHash === currentHash) {
    renderAiReportData(aiState.lastReport);
    return;
  }

  aiState.isRunning = true;
  const runBtn = $('#btnRunAiAnalysis');
  if (runBtn) {
    runBtn.disabled = true;
    runBtn.textContent = '⏳ Menganalisis Catatan & Pasar...';
  }

  const loadingHtml = `<div class="ai-loading-state"><div class="ai-spinner"></div><div><b>Server AI sedang menyusun laporan...</b><p class="hint">Menganalisis catatan jurnal Anda, arah bias fundamental XAUUSD &amp; Major Pairs, serta berita ekonomi AS &amp; geopolitik terkini.</p></div></div>`;
  if (!aiState.lastReport || forceRefresh) {
    if ($('#aiJournalInsightBody')) $('#aiJournalInsightBody').innerHTML = loadingHtml;
    if ($('#aiMacroGeoBody')) $('#aiMacroGeoBody').innerHTML = loadingHtml;
    if ($('#aiFundamentalBiasBody')) $('#aiFundamentalBiasBody').innerHTML = loadingHtml;
  }

  try {
    const extMarket = await fetchExternalMarketContext();
    const m = metrics(arr);
    const eq = calcAccountEquity();

    // Siapkan ringkasan 25 trade terakhir & catatan pengguna secara kompak
    const recentTradesForPrompt = arr.slice(-25).map((t, idx) => ({
      no: idx + 1,
      date: t.date,
      pair: t.asset,
      position: t.position,
      lot: t.lot,
      entry: t.entry,
      exit: t.exit,
      returnPct: +tradeRet(t).toFixed(2),
      notes: (t.notes || '').trim() || '(Tanpa catatan)'
    }));

    const todayStr = todayISO();
    const spots = extMarket.spotRates || {};
    const systemPrompt = `Anda adalah Institutional Forex & Commodity (XAUUSD, WTI) Trading Coach & Global Macro Strategist. Berikan laporan analitik Bahasa Indonesia berbasis: (1) catatan jurnal trader, (2) kondisi fundamental XAUUSD (Gold), WTI (Crude Oil), & 6 Major Pairs (EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF), (3) ekonomi AS (The Fed/FOMC, CPI/PCE, NFP, US Treasury Yield, DXY, inventori EIA AS) & konflik geopolitik safe haven maupun jalur energi (Emas/XAUUSD, Minyak/WTI, USD, JPY, CHF).
PENTING: Tulis setiap nilai string secara padat, tajam, dan ringkas (maksimal 1–2 kalimat per field) agar respons cepat selesai.

Tanggal: ${todayStr} | Spot: ${JSON.stringify(spots)}
Akun (${periodLabel()}): Saldo $${eq.currentBalance.toFixed(2)} (Awal $${eq.initialBalance.toFixed(2)}, Growth ${eq.growthPct.toFixed(2)}%) | Trade: ${m.total} (Win ${m.wins}, Loss ${m.losses}, WR ${(m.winRate || 0).toFixed(1)}%, Avg ${(m.avg || 0).toFixed(2)}%, MaxDD ${(m.maxDD || 0).toFixed(2)}%)
Riwayat & Catatan (maks 25): ${JSON.stringify(recentTradesForPrompt)}

Kembalikan HANYA JSON valid dengan struktur persis ini:
{
  "disciplineScore": 80,
  "scoreLabel": "80/100 · Disiplin Terjaga",
  "executiveSummary": "Ringkasan 2 kalimat evaluasi pola catatan jurnal, eksekusi, & psikologi trader.",
  "noteInsights": [
    {"title": "Temuan Utama Catatan Jurnal", "badge": "POLA CATATAN", "tone": "pos", "detail": "Analisis spesifik mengacu isi notes trader."},
    {"title": "Manajemen Risiko & Lot", "badge": "RISK & LOT", "tone": "warn", "detail": "Evaluasi konsistensi lot & win/loss."},
    {"title": "Korelasi Pair & Eksekusi", "badge": "OPTIMASI PAIR", "tone": "pos", "detail": "Wawasan performa pair di jurnal."}
  ],
  "actionPlan": ["Langkah konkret 1", "Langkah konkret 2", "Langkah konkret 3"],
  "macroSentiment": {
    "regime": "RISK-OFF / SAFE HAVEN FLOW atau MIXED / DATA DEPENDENT atau RISK-ON",
    "usEconomySummary": "Ringkasan ekonomi AS terkini (inflasi, NFP, GDP, DXY).",
    "fedPolicyOutlook": "Prospek suku bunga The Fed (FOMC) & US Treasury Yield.",
    "geopoliticalSafeHaven": "Dampak konflik geopolitik terkini terhadap permintaan safe haven (XAUUSD, USD, JPY, CHF) & risiko pasokan energi WTI.",
    "portfolioImpact": "Dampak makro AS & geopolitik ke pair utama di jurnal trader."
  },
  "macroCatalysts": [
    {"category": "EKONOMI AS / THE FED", "title": "Kebijakan The Fed & Data AS", "impact": "HIGH", "summary": "Dampak rilis data AS ke USD, WTI, & XAUUSD."},
    {"category": "GEOPOLITIK / SAFE HAVEN", "title": "Risiko Geopolitik, Safe Haven & Energi", "impact": "HIGH", "summary": "Dampak ke arus modal safe haven dan pasokan minyak."},
    {"category": "YIELD & DXY", "title": "US Treasury 10Y & Indeks Dolar", "impact": "MEDIUM", "summary": "Dampak ke major pairs."}
  ],
  "pairBiases": [
    {"pair": "XAUUSD", "bias": "BULLISH|BEARISH|NEUTRAL", "conviction": "Tinggi|Moderat", "spotRef": "Gold / Safe Haven", "drivers": "Pemicu fundamental utama.", "keyContext": "Fokus data makro penting.", "userAlignment": "Evaluasi arah posisi jurnal trader."},
    {"pair": "WTI", "bias": "BULLISH|BEARISH|NEUTRAL", "conviction": "Tinggi|Moderat", "spotRef": "Crude Oil / USOIL", "drivers": "Pasokan OPEC+, risiko geopolitik jalur energi, permintaan global, & inventori minyak EIA AS.", "keyContext": "Pantau rilis stok EIA mingguan, keputusan OPEC+, & DXY.", "userAlignment": "Panduan posisi untuk trader pada minyak WTI."},
    {"pair": "EURUSD", "bias": "...", "conviction": "...", "spotRef": "${spots.EURUSD || 'Major'}", "drivers": "...", "keyContext": "...", "userAlignment": "..."},
    {"pair": "GBPUSD", "bias": "...", "conviction": "...", "spotRef": "${spots.GBPUSD || 'Major'}", "drivers": "...", "keyContext": "...", "userAlignment": "..."},
    {"pair": "USDJPY", "bias": "...", "conviction": "...", "spotRef": "${spots.USDJPY || 'Major'}", "drivers": "...", "keyContext": "...", "userAlignment": "..."},
    {"pair": "AUDUSD", "bias": "...", "conviction": "...", "spotRef": "${spots.AUDUSD || 'Major'}", "drivers": "...", "keyContext": "...", "userAlignment": "..."},
    {"pair": "USDCAD", "bias": "...", "conviction": "...", "spotRef": "${spots.USDCAD || 'Major'}", "drivers": "...", "keyContext": "...", "userAlignment": "..."},
    {"pair": "USDCHF", "bias": "...", "conviction": "...", "spotRef": "${spots.USDCHF || 'Major'}", "drivers": "...", "keyContext": "...", "userAlignment": "..."}
  ]
}`;

    let rawText = '';
    let groundingSources = [];

    if (aiState.provider === 'openai') {
      const oRes = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + rawKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: aiState.model || 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are an institutional Forex & Gold macro analyst and trading coach. Always output valid JSON.' },
            { role: 'user', content: systemPrompt }
          ],
          temperature: 0.35
        })
      }, 45000);
      if (!oRes.ok) {
        const errData = await oRes.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `OpenAI HTTP ${oRes.status}`);
      }
      const oJson = await oRes.json();
      rawText = oJson?.choices?.[0]?.message?.content || '';
    } else {
      // Google Gemini API: Fallback lintas klaster (flash -> flash-lite -> pro) saat server utama high demand (503) / timeout
      if (!Array.isArray(aiState.availableModels) || !aiState.availableModels.length) {
        await fetchGeminiAvailableModels(rawKey).catch(() => []);
      }

      const tryModels = [];
      const addModel = m => {
        if (!m || m === 'gemini-2.5-flash' || /^gemini-(1\.5|2\.0)-/i.test(m)) return;
        if (!tryModels.includes(m)) tryModels.push(m);
      };
      addModel('gemini-3.8-flash');
      if (Array.isArray(aiState.availableModels) && aiState.availableModels.length) {
        rankGeminiModels(aiState.availableModels).forEach(addModel);
      }
      GEMINI_PREFERRED_MODELS.forEach(addModel);

      const candidates = tryModels.slice(0, 7);
      const triedModels = [];
      let gJson = null;
      let usedModel = null;
      let lastGeminiErr = 'Gagal menghubungi Gemini API.';

      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (i > 0) {
          const switchMsg = `⏳ Server utama lambat/padat, beralih ke model ${candidate}...`;
          if (runBtn) {
            runBtn.textContent = `⏳ Beralih ke ${candidate.replace(/^gemini-|-preview$/gi, '')}...`;
            runBtn.title = switchMsg;
          }
          document.querySelectorAll('.ai-loading-state b').forEach(el => { el.textContent = switchMsg; });
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate)}:generateContent?key=${encodeURIComponent(rawKey)}`;
        try {
          let gRes = await fetchWithTimeout(url, {
            method: 'POST',
            headers: getGeminiHeaders(rawKey, true),
            body: JSON.stringify({
              contents: [{ parts: [{ text: systemPrompt }] }],
              generationConfig: {
                temperature: 0.25,
                maxOutputTokens: 2048,
                responseMimeType: 'application/json'
              }
            })
          }, 45000);

          if (gRes.status === 400) {
            const bErr = await gRes.json().catch(() => ({}));
            const bMsg = bErr?.error?.message || '';
            if (/JSON|response_mime_type|responseMimeType/i.test(bMsg)) {
              gRes = await fetchWithTimeout(url, {
                method: 'POST',
                headers: getGeminiHeaders(rawKey, true),
                body: JSON.stringify({
                  contents: [{ parts: [{ text: systemPrompt }] }],
                  generationConfig: { temperature: 0.25, maxOutputTokens: 2048 }
                })
              }, 45000);
            } else {
              lastGeminiErr = bMsg || `Gemini HTTP ${gRes.status}`;
              if (/API_KEY_INVALID|API key not valid/i.test(lastGeminiErr)) {
                throw new Error(lastGeminiErr);
              }
              triedModels.push(candidate);
              continue;
            }
          }

          if (gRes.ok) {
            gJson = await gRes.json();
            usedModel = candidate;
            break;
          }

          const errData = await gRes.json().catch(() => ({}));
          lastGeminiErr = errData?.error?.message || `Gemini HTTP ${gRes.status}`;
          if (gRes.status === 401 || gRes.status === 403 || /API_KEY_INVALID|API key not valid/i.test(lastGeminiErr)) {
            throw new Error(lastGeminiErr);
          }
          triedModels.push(candidate);
          if (i < candidates.length - 1 && (gRes.status === 503 || gRes.status === 429 || /high demand|overloaded|unavailable/i.test(lastGeminiErr))) {
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (reqErr) {
          lastGeminiErr = reqErr?.message || `Gagal/timeout pada model ${candidate}`;
          if (/API_KEY_INVALID|API key not valid/i.test(lastGeminiErr)) {
            throw reqErr;
          }
          triedModels.push(candidate);
        }
      }

      if (!gJson || !usedModel) {
        const triedStr = triedModels.length ? ` (Sudah mencoba: ${triedModels.join(', ')})` : '';
        throw new Error(lastGeminiErr + triedStr);
      }

      if (aiState.model !== usedModel) {
        aiState.model = usedModel;
        saveAiConfig();
        syncAiGateUI(false);
      }

      const cand = gJson?.candidates?.[0];
      rawText = (cand?.content?.parts || []).map(p => p.text || '').join('\n');

      // Ekstrak sumber web grounding jika ada
      const chunks = cand?.groundingMetadata?.groundingChunks || [];
      chunks.forEach(ch => {
        if (ch?.web?.uri) {
          groundingSources.push({ title: ch.web.title || ch.web.uri, uri: ch.web.uri });
        }
      });
    }

    // Parse JSON dari respons AI
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error('Format respons AI tidak valid. Silakan klik Perbarui Analisis.');
    }
    const parsedReport = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    parsedReport.generatedAt = Date.now();
    if (groundingSources.length) {
      parsedReport.groundingSources = groundingSources;
    }

    aiState.lastReport = parsedReport;
    aiState.lastHash = currentHash;
    saveAiConfig();
    renderAiReportData(parsedReport);
    if (forceRefresh) toast('Analisis AI berhasil diperbarui');
  } catch (err) {
    console.error('AI Analytics error:', err);
    toast('Gagal menjalankan Analitik AI: ' + (err.message || 'Periksa API Key / kuota'), 'err');
    if (aiState.lastReport) {
      renderAiReportData(aiState.lastReport);
    } else {
      renderLockedPreviewPlaceholders();
    }
  } finally {
    aiState.isRunning = false;
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.textContent = '✨ Perbarui Analisis AI Sekarang';
      runBtn.title = '';
    }
  }
}

function renderAiPage() {
  syncAiGateUI(false);
  if (aiState.verified && getDecodedAiKey()) {
    if (aiState.lastReport) {
      renderAiReportData(aiState.lastReport);
    }
    runAiAnalytics(false);
  }
}

// Event Listeners untuk Analitik AI
if ($('#aiProviderSelect')) {
  $('#aiProviderSelect').addEventListener('change', e => {
    const p = e.target.value;
    const inp = $('#aiApiKeyInput');
    const help = $('#aiKeyHelpLink');
    if (p === 'openai') {
      if (inp) inp.placeholder = 'Masukkan OpenAI API Key (contoh: sk-proj-...)';
      if (help) {
        help.href = 'https://platform.openai.com/api-keys';
        help.textContent = '⚡ Buka OpenAI API Keys ↗';
      }
    } else {
      if (inp) inp.placeholder = 'Masukkan Gemini API Key (contoh: AIzaSy...)';
      if (help) {
        help.href = 'https://aistudio.google.com/app/apikey';
        help.textContent = '⚡ Dapatkan Gemini API Key Gratis ↗';
      }
    }
    setAiConnStatus('', '');
  });
}

if ($('#btnToggleAiKey')) {
  $('#btnToggleAiKey').onclick = () => {
    const inp = $('#aiApiKeyInput');
    if (!inp) return;
    const isPass = inp.type === 'password';
    inp.type = isPass ? 'text' : 'password';
    $('#btnToggleAiKey').textContent = isPass ? 'Sembunyi' : 'Lihat';
  };
}

if ($('#btnVerifyAiKey')) {
  $('#btnVerifyAiKey').onclick = async () => {
    const prov = $('#aiProviderSelect')?.value || 'gemini';
    const rawKey = ($('#aiApiKeyInput')?.value || '').trim();
    const btn = $('#btnVerifyAiKey');

    if (!rawKey) {
      setAiConnStatus('err', '⚠ <b>API Key Kosong:</b> Silakan masukkan API Key Anda terlebih dahulu.');
      $('#aiApiKeyInput')?.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Memverifikasi ke Server AI...';
    setAiConnStatus('info', '🔌 Menghubungi server AI dan memverifikasi keaslian API Key...');

    const res = await verifyAiServerConnection(prov, rawKey);
    btn.disabled = false;
    btn.textContent = '🔌 Verifikasi Koneksi & Buka Analitik AI';

    if (!res.ok) {
      setAiConnStatus('err', `✖ <b>Verifikasi Gagal:</b> ${esc(res.error)}`);
      toast('Verifikasi API Key gagal', 'err');
      return;
    }

    aiState.provider = prov;
    aiState.apiKeyB64 = btoa(unescape(encodeURIComponent(rawKey)));
    aiState.verified = true;
    aiState.model = res.model;
    aiState.verifiedAt = Date.now();
    saveAiConfig();

    setAiConnStatus('ok', `✔ <b>Terhubung ke ${esc(res.serverLabel)}</b> · Model aktif: <b class="mono">${esc(res.model)}</b>`);
    toast(`API Key terverifikasi (${res.model}) — Membuka Analitik AI`);

    setAiConnStatus('', '');
    syncAiGateUI(false);
    runAiAnalytics(true);
  };
}

if ($('#btnManageAiKey')) {
  $('#btnManageAiKey').onclick = () => {
    setAiConnStatus('ok', `✔ <b>Status Saat Ini:</b> Terhubung ke <span class="mono">${esc(aiState.model)}</span>. Anda dapat mengganti API Key di atas.`);
    syncAiGateUI(true);
  };
}

if ($('#btnCancelAiGate')) {
  $('#btnCancelAiGate').onclick = () => {
    setAiConnStatus('', '');
    syncAiGateUI(false);
  };
}

if ($('#btnDisconnectAiKey')) {
  $('#btnDisconnectAiKey').onclick = async () => {
    const ok = await confirmBox({
      title: 'Putuskan & Kunci Analitik AI?',
      msg: 'API Key Anda akan dihapus dari perangkat ini dan halaman Analitik AI akan dikunci kembali hingga Anda memverifikasi API Key baru.',
      ok: 'Ya, Kunci AI'
    });
    if (!ok) return;
    aiState.apiKeyB64 = '';
    aiState.verified = false;
    aiState.lastReport = null;
    aiState.lastHash = '';
    saveAiConfig();
    if ($('#aiApiKeyInput')) $('#aiApiKeyInput').value = '';
    setAiConnStatus('', '');
    syncAiGateUI(true);
    toast('API Key dihapus & Analitik AI dikunci');
  };
}

if ($('#btnRunAiAnalysis')) {
  $('#btnRunAiAnalysis').onclick = () => runAiAnalytics(true);
}

/* ================= navigasi & periode ================= */
function setPageMeta() {
  const t = {
    overview: ['Ringkasan Performa', `Pertumbuhan akun & konsistensi — ${periodLabel()}`],
    journal: ['Jurnal Trading', 'Catat, validasi, dan evaluasi setiap trade'],
    sizing: ['Position Sizing', 'Kalkulator ukuran lot ideal sesuai modal, batas risiko, dan jarak Stop Loss'],
    analytics: ['Analitik', `Pola performa, drawdown & perbandingan posisi — ${periodLabel()}`],
    ai: ['Analitik AI', `Wawasan catatan jurnal, bias fundamental XAUUSD & major pairs, serta makro ekonomi AS & geopolitik — ${periodLabel()}`]
  }[state.page] || ['Ringkasan Performa', ''];
  $('#pageTitle').textContent = t[0]; $('#pageSub').textContent = t[1];
  $('#periodWrap').hidden = (state.page === 'journal' || state.page === 'sizing');
}
function renderSidebar() {
  $('#navCount').textContent = trades.length;
}
function renderAll() {
  syncEquityToPs();
  renderSidebar(); setPageMeta(); renderTable();
  if (state.page === 'overview') renderOverview();
  else if (state.page === 'sizing') renderPositionSizing();
  else if (state.page === 'analytics') renderAnalytics();
  else if (state.page === 'ai') renderAiPage();
  requestAnimationFrame(() => {
    if (state.page === 'overview') syncRecentHeight();
    else if (state.page === 'journal') syncJournalHeight();
  });
}
function go(page) {
  if (page === 'ai' && window.innerWidth <= 920) {
    toast('Fitur Analitik AI khusus untuk tampilan Laptop / Desktop', 'err');
    return;
  }
  if (state.page === page) return; // Jangan re-render jika sudah di halaman yang sama (mencegah animasi berulang saat sentuh nav di HP)
  state.page = page;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
  _freshRender = true; renderAll();
}
function syncPeriodSeg() { $$('#periodSeg [data-p]').forEach(b => b.classList.toggle('active', b.dataset.p === state.period)) }
function syncCumSeg() { $$('#cumSeg [data-m]').forEach(b => b.classList.toggle('active', b.dataset.m === state.cumMethod)) }
function setPeriod(p) {
  if (p === 'custom') {
    const pop = $('#customPop'); pop.hidden = !pop.hidden;
    if (!pop.hidden) { $('#cpFrom').value = state.cFrom || addDays(todayISO(), -29); $('#cpTo').value = state.cTo || todayISO() } return
  }
  $('#customPop').hidden = true; state.period = p; saveSettings(); syncPeriodSeg(); renderAll();
}
$('#btnApplyRange').onclick = () => {
  const f = $('#cpFrom').value, t = $('#cpTo').value;
  if (!f || !t) { toast('Isi kedua tanggal rentang', 'err'); return }
  if (f > t) { toast('Tanggal awal harus sebelum tanggal akhir', 'err'); return }
  state.cFrom = f; state.cTo = t; state.period = 'custom'; saveSettings(); syncPeriodSeg(); $('#customPop').hidden = true; renderAll();
};
document.addEventListener('click', e => {
  const nv = e.target.closest('.nav-item[data-page]'); if (nv) { go(nv.dataset.page); return }
  const gv = e.target.closest('[data-go]'); if (gv) { go(gv.dataset.go); return }
  const pb = e.target.closest('#periodSeg [data-p]'); if (pb) { setPeriod(pb.dataset.p); return }
  const cb = e.target.closest('#cumSeg [data-m]');
  if (cb) {
    if (state.cumMethod === cb.dataset.m) return;
    state.cumMethod = cb.dataset.m;
    saveSettings();
    syncCumSeg();
    if (state.page === 'overview') {
      const arr = pt(), m = metrics(arr);
      _freshRender = true;
      renderStatCards(m, arr);
      _freshRender = false;
      renderCumChart();
    } else {
      renderCumChart();
    }
    return;
  }
  if (!e.target.closest('.period-wrap')) $('#customPop').hidden = true;
});
$('#btnQuickAdd').onclick = () => { go('journal'); setTimeout(() => $('#fDate').focus(), 120) };

/* ---- delegasi tabel, kalender, recent ---- */
$('#tbody').addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (act) { e.stopPropagation(); act.dataset.act === 'edit' ? startEdit(act.dataset.id) : deleteTrade(act.dataset.id); return }
  const tr = e.target.closest('tr.trow');
  if (tr) { const id = tr.dataset.id; state.expanded = state.expanded === id ? null : id; renderTable() }
});
$('#calGrid').addEventListener('click', e => {
  const c = e.target.closest('.cal-day[data-d]'); if (!c) return;
  state.selDay = state.selDay === c.dataset.d ? null : c.dataset.d;
  renderCalendar(); renderCalDetail(); syncRecentHeight();
});
$('#calDetail').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  b.dataset.act === 'edit' ? startEdit(b.dataset.id) : deleteTrade(b.dataset.id);
});
$('#calPrev').onclick = () => { const c = state.calCursor; c.m--; if (c.m < 0) { c.m = 11; c.y-- } renderCalendar(); syncRecentHeight() };
$('#calNext').onclick = () => { const c = state.calCursor; c.m++; if (c.m > 11) { c.m = 0; c.y++ } renderCalendar(); syncRecentHeight() };
$('#recentList').addEventListener('click', e => {
  const r = e.target.closest('.rrow'); if (!r) return;
  state.expanded = r.dataset.id; go('journal');
});

/* ---- jam & resize ---- */
function tickClock() {
  const d = new Date();
  $('#clock').textContent = `${DAYS[d.getDay()]}, ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
tickClock(); setInterval(tickClock, 1000);

let lastInnerWidth = window.innerWidth;
window.addEventListener('resize', debounce(() => {
  if (window.innerWidth <= 920 && state.page === 'ai') {
    go('overview');
    return;
  }
  // Abaikan event resize jika perubahan lebar layar kurang dari 20px (misal: saat scroll di HP yang menyebabkan address bar muncul/hilang atau scrollbar toggle)
  if (Math.abs(window.innerWidth - lastInnerWidth) < 20) return;
  lastInnerWidth = window.innerWidth;

  if (state.page === 'overview') {
    // Cukup render ulang grafik SVG yang responsif terhadap lebar layar tanpa menyentuh kartu KPI
    renderDailyChart();
    renderCumChart();
    syncRecentHeight();
  }
  else if (state.page === 'journal') syncJournalHeight();
  else if (state.page === 'analytics') renderAnalytics();
}, 250));

/* ---- init ---- */
$('#fDate').value = todayISO();
loadPsSettings();
loadAiConfig();
populateAssetSelect('XAUUSD');
syncPsUI();
renderPositionSizing();
if (!$('#fLot').value) $('#fLot').value = '0.01';
syncPeriodSeg(); syncCumSeg(); syncPosSeg(); updatePreview(); updateFormUI();
renderAll();

if ($('#btnAuth')) $('#btnAuth').onclick = openAuthModal;
const btnApply = $('#btnApplyUpdate');
if (btnApply) {
  btnApply.onclick = async function () {
    btnApply.disabled = true;
    btnApply.textContent = 'Memperbarui...';
    try {
      await syncFromCloud(true);
    } finally {
      btnApply.disabled = false;
      btnApply.textContent = 'Muat Ulang Data ↻';
      hideUpdateBanner();
    }
  };
}
if ($('#btnCloseUpdateBanner')) {
  $('#btnCloseUpdateBanner').onclick = hideUpdateBanner;
}

// Cek pembaruan dari perangkat lain saat membuka kembali aplikasi di HP, fokus layar, maupun secara berkala saat halaman aktif
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkForRemoteUpdates();
  }
});
window.addEventListener('focus', () => {
  checkForRemoteUpdates();
});
setInterval(() => {
  if (document.visibilityState === 'visible') {
    checkForRemoteUpdates();
  }
}, 4000);

initAuth();
