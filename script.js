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
    return Array.isArray(r)
      ? r.filter(t => t && t.date && t.entry > 0 && t.exit > 0).map(t => {
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

function showUpdateBanner(msg) {
  const banner = $('#syncUpdateBanner');
  if (!banner) return;
  if (msg) {
    const textEl = $('#syncBannerText');
    if (textEl) textEl.textContent = msg;
  }
  banner.hidden = false;
}

function hideUpdateBanner() {
  const banner = $('#syncUpdateBanner');
  if (banner) banner.hidden = true;
}

function computeTradesHash(list) {
  if (!list || !list.length) return 'empty';
  return list.map(t => `${t.id}:${t.entry}:${t.exit}:${t.lot}:${t.date}`).sort().join('|');
}

async function checkForRemoteUpdates() {
  if (!currentUser || !sbClient || currentUser.isLocalOnly || isSyncing) return;
  try {
    const { data, error } = await sbClient
      .from('trades')
      .select('id, date, asset, entry, exit, lot')
      .order('date', { ascending: true });

    if (error || !data) return;

    const cloudHash = computeTradesHash(data);
    const localHash = computeTradesHash(trades);

    if (cloudHash !== localHash) {
      const act = data.length < trades.length ? 'penghapusan' : (data.length > trades.length ? 'penambahan' : 'perubahan');
      showUpdateBanner(`Ada pembaruan data (${act}) dari perangkat lain.`);
      toast(`Terdeteksi pembaruan data (${act}) dari perangkat lain`, 'ok');
    }
  } catch (_) {}
}

async function syncFromCloud(showFeedback = false) {
  if (!currentUser || !sbClient) return;

  // Jika sebelumnya login lokal karena belum jalankan SQL, coba upgrade otomatis ke sesi Cloud
  if (currentUser.isLocalOnly) {
    const rec = getAccountRecord(currentUser.email);
    if (rec && rec.rawPassB64) {
      try {
        const rawPass = decodeURIComponent(escape(atob(rec.rawPassB64)));
        const cloudUser = await tryUpgradeToCloud(currentUser.email, rawPass);
        if (cloudUser) {
          currentUser = { id: cloudUser.id, email: cloudUser.email, isLocalOnly: false };
          setActiveUserSession(currentUser);
          if (cloudUser.user_metadata?.pin && /^\d{4}$/.test(cloudUser.user_metadata.pin)) {
            upsertAccountRecord(currentUser.email, { id: cloudUser.id, pin: cloudUser.user_metadata.pin });
          } else if (rec.pin) {
            sbClient.auth.updateUser({ data: { pin: rec.pin } }).catch(() => {});
          }
        }
      } catch (_) {}
    }
  }

  if (currentUser.isLocalOnly) {
    if (showFeedback) toast('Data tersimpan aman di perangkat (jalankan SQL Supabase untuk sinkron cloud)');
    return;
  }

  isSyncing = true;
  try {
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

    // 2. Ambil trades milik user ini dari Supabase Cloud (Single Source of Truth)
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
      createdAt: Number(t.created_at || t.createdAt || Date.now())
    }));

    const syncInitKey = 'tjd.cloud_init_' + currentUser.id;
    const hasInitialized = localStorage.getItem(syncInitKey) === '1';

    // Migrasi lokal ke Cloud hanya dilakukan SEKALI saat akun baru pertama kali konek dan cloud masih kosong
    if (!hasInitialized && cloudTrades.length === 0 && trades.length > 0) {
      const rowsToUpload = trades.map(t => ({
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
      const { error: insErr } = await sbClient.from('trades').insert(rowsToUpload);
      if (!insErr) {
        localStorage.setItem(syncInitKey, '1');
        if (showFeedback) toast(`${trades.length} trade lokal disimpan ke Cloud`);
      }
    } else {
      // SETELAH INISIALISASI: CLOUD ADALAH SUMBER DATA TUNGGAL
      // Jika di laptop dihapus (cloudTrades kosong), di HP juga otomatis terhapus!
      localStorage.setItem(syncInitKey, '1');
      trades = cloudTrades;
      saveTrades();
      renderAll();
      if (showFeedback) toast('Data tersinkronisasi dengan Cloud');
    }

    hideUpdateBanner();
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
    try { sbClient.removeChannel(realtimeChannel); } catch (_) {}
    realtimeChannel = null;
  }
  try {
    realtimeChannel = sbClient
      .channel('public:trades:' + currentUser.id)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'trades',
        filter: `user_id=eq.${currentUser.id}`
      }, payload => {
        const ev = payload.eventType;
        const act = ev === 'DELETE' ? 'penghapusan' : (ev === 'INSERT' ? 'penambahan' : 'perubahan');
        showUpdateBanner(`Ada pembaruan data (${act}) dari perangkat lain.`);
        toast(`Pembaruan terdeteksi: Ada ${act} data trade. Silakan refresh atau klik Muat Ulang.`, 'ok');
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

      <div style="background:rgba(15,23,42,.6);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
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
  const best = arr.length ? arr.reduce((a, b) => tradeRet(b) > tradeRet(a) ? b : a) : null;
  const days = new Set(arr.map(t => t.date)).size;
  const cumVal = state.cumMethod === 'comp' ? m.comp : m.simple;
  const series = state.cumMethod === 'comp' ? m.curve : [0, ...m.simpleCurve];
  const wrW = m.total ? m.wins / m.total * 100 : 0, wrL = m.total ? m.losses / m.total * 100 : 0;
  box.innerHTML =
    statCard(0, 'Total Trades', `<span id="vTotal"></span>`, `${m.wins}W · ${m.losses}L${m.be ? ` · ${m.be} BE` : ''} · ${days} hari aktif`) +
    statCard(1, 'Win Rate', `<span id="vWR"></span>`, `<div class="wl-bar" style="width:100%"><i class="w" style="width:${wrW}%"></i><i class="l" style="width:${wrL}%"></i></div>`) +
    statCard(2, 'Avg Return / Trade', `<span id="vAvg"></span>`, 'Rata-rata return — hanya trade tercatat') +
    statCard(3, 'Cumulative Return', `<span id="vCum"></span>`, `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px">${sparkSVG(series)}<span>${state.cumMethod === 'comp' ? 'Compounded' : 'Simple'}</span></div>`) +
    statCard(4, 'Best Trade', `<span id="vBest"></span>`, best ? `${esc(best.asset) || '—'} · ${fmtDate(best.date)} · ${best.position}` : '—') +
    statCard(5, 'Max Drawdown', `<span id="vDD"></span>`, 'Compounded · puncak → lembah');
  const set = (id, v, fmt, cls) => {
    const n = $('#' + id); if (v == null) { n.textContent = '—'; n._v = 0; return }
    if (cls) n.classList.add(cls); tween(n, v, fmt)
  };
  set('vTotal', m.total, v => fmtInt(Math.round(v)));
  set('vWR', m.winRate, v => fmtPct(v, 1));
  set('vAvg', m.avg, v => fmtPct(v), pcls(m.avg));
  set('vCum', m.total ? cumVal : null, v => fmtPct(v), pcls(cumVal));
  set('vBest', best ? tradeRet(best) : null, v => fmtPct(v), best ? pcls(tradeRet(best)) : '');
  set('vDD', m.total ? m.maxDD : null, v => fmtPct(v), pcls(m.maxDD));
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
    const rect = el('rect', { x: cx - bw / 2, width: bw, rx: 2.5, class: 'bar ' + (r > 0 ? 'pos' : r < 0 ? 'neg' : 'be') }, svg);
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
  const defs = el('defs', {}, svg);
  const g = el('linearGradient', { id: 'gCum', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el('stop', { offset: '0%', 'stop-color': '#e8b84b', 'stop-opacity': .26 }, g);
  el('stop', { offset: '100%', 'stop-color': '#e8b84b', 'stop-opacity': 0 }, g);
  let d = `M${X(0)},${Y(vals[0])}`; for (let i = 1; i < n; i++)d += `L${X(i)},${Y(vals[i])}`;
  el('path', { d: `${d}L${X(n - 1)},${y0}L${X(0)},${y0}Z`, fill: 'url(#gCum)' }, svg);
  const line = el('path', { d, fill: 'none', stroke: 'var(--gold)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  if (_freshRender && !REDUCED) {
    const len = line.getTotalLength(); line.style.strokeDasharray = len; line.style.strokeDashoffset = len;
    line.getBoundingClientRect(); line.style.transition = 'stroke-dashoffset .8s ease'; line.style.strokeDashoffset = '0'
  }
  for (let i = 0; i < n; i++)el('circle', { cx: X(i), cy: Y(vals[i]), r: 2.6, fill: '#0a0e15', stroke: 'var(--gold)', 'stroke-width': 1.6 }, svg);
  const last = vals[n - 1];
  el('text', { x: X(n - 1) + 8, y: Y(last) + 4, fill: last >= 0 ? 'var(--green)' : 'var(--red)', 'font-weight': '600', 'font-size': '11.5px' }, svg).textContent = fmtPct(last);
  const le = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 70))));
  for (let i = 0; i < n; i++)if (i % le === 0 || i === n - 1)
    el('text', { x: X(i), y: h - 7, 'text-anchor': 'middle' }, svg).textContent = labels[i] === 'Mulai' ? 'Mulai' : shortDate(labels[i]);
  const vline = el('line', { y1: ptp, y2: h - pb, class: 'zero', opacity: 0 }, svg);
  const focus = el('circle', { r: 4.2, fill: 'var(--gold)', opacity: 0 }, svg);
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

function syncRecentHeight() {
  const calCard = $('#calCard'), recentCard = $('#recentCard'), box = $('#recentList');
  if (!calCard || !recentCard || !box) return;
  if (window.innerWidth <= 1120) {
    recentCard.style.height = 'auto';
    box.style.maxHeight = window.innerWidth <= 640 ? '340px' : '380px';
    return;
  }
  const calH = calCard.offsetHeight;
  recentCard.style.height = calH + 'px';
  const headH = recentCard.querySelector('.card-h')?.offsetHeight || 50;
  const targetMax = Math.max(160, calH - headH - 28);
  box.style.maxHeight = targetMax + 'px';
}

function syncJournalHeight() {
  const formCard = $('#formCard'), tableCard = $('#journalTableCard'), tscroll = tableCard?.querySelector('.tscroll');
  if (!formCard || !tableCard || !tscroll) return;
  if (window.innerWidth <= 1120) {
    tableCard.style.height = 'auto';
    tscroll.style.maxHeight = window.innerWidth <= 640 ? '340px' : '380px';
    return;
  }
  const formH = formCard.offsetHeight;
  if (!formH) return;
  tableCard.style.height = formH + 'px';
  const headH = tableCard.querySelector('.card-h')?.offsetHeight || 55;
  const noteH = tableCard.querySelector('.store-note')?.offsetHeight || 35;
  const maxTableH = Math.max(200, formH - headH - noteH);
  tscroll.style.maxHeight = maxTableH + 'px';
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
  let totalTrades = 0, totalWin = 0, totalLoss = 0;
  for (let d = 1; d <= dim; d++) {
    const ds = `${cur.y}-${pad(cur.m + 1)}-${pad(d)}`, dayTrades = grouped.get(ds) || [];
    let cls = '', ttl = fmtDate(ds);
    if (dayTrades.length) {
      const netRet = dayTrades.reduce((s, t) => s + tradeRet(t), 0);
      cls = pcls(netRet) === 'pos' ? 'win' : pcls(netRet) === 'neg' ? 'loss' : 'bee';
      const labels = dayTrades.map(t => `${t.asset || '—'} ${fmtPct(tradeRet(t))}`).join(' | ');
      ttl += ` · ${dayTrades.length} trade${dayTrades.length > 1 ? 's' : ''}: ${labels}`;
      totalTrades += dayTrades.length;
      dayTrades.forEach(t => { const r = tradeRet(t); if (r > 0) totalWin++; else if (r < 0) totalLoss++ });
    }
    const today = ds === todayISO() ? ' today' : '', sel = ds === state.selDay ? ' sel' : '';
    const countBadge = dayTrades.length > 1 ? `<span class="cal-count">${dayTrades.length}</span>` : '';
    cells += `<div class="cal-day ${cls}${today}${sel}" data-d="${ds}" title="${esc(ttl)}">${d}${countBadge}</div>`;
  }
  $('#calGrid').innerHTML = cells;
  $('#calSum').textContent = totalTrades ? `${totalTrades} trade${totalTrades > 1 ? 's' : ''} · ${totalWin} profit · ${totalLoss} loss` : 'Belum ada trade bulan ini';
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

function renderOverview() {
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

function renderTable() {
  const rows = filteredJournal(), tb = $('#tbody');
  $('#tblCount').textContent = `Menampilkan ${rows.length} dari ${trades.length} trade`;
  if (!rows.length) { tb.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--dim);padding:34px">${trades.length ? 'Tidak ada trade yang cocok dengan filter.' : 'Belum ada trade — catat trade pertamamu melalui formulir di samping.'}</td></tr>`; return }
  tb.innerHTML = rows.map(t => {
    const r = tradeRet(t), c = pcls(r);
    const res = r > 0 ? ['win', 'PROFIT'] : r < 0 ? ['loss', 'LOSS'] : ['bee', 'BE'];
    const ex = state.expanded === t.id;
    let html = `<tr class="trow ${c}${ex ? ' open' : ''}" data-id="${t.id}">
      <td class="mono">${fmtDate(t.date)}</td>
      <td>${esc(t.asset) || '<span class="dim">—</span>'}</td>
      <td><span class="badge ${t.position.toLowerCase()}">${t.position === 'LONG' ? '▲' : '▼'} ${t.position}</span></td>
      <td class="mono r">${t.lot != null ? Number(t.lot).toFixed(2) : '<span class="dim">—</span>'}</td>
      <td class="mono r">${fmtPrice(t.entry)}</td>
      <td class="mono r">${fmtPrice(t.exit)}</td>
      <td class="mono r ${c}"><b>${fmtPct(r)}</b></td>
      <td><span class="badge ${res[0]}">${res[1]}</span></td>
      <td class="notes-cell" title="${esc(t.notes || '')}">${t.notes ? esc(trunc(t.notes, 32)) : '<span class="dim">—</span>'} <span class="chev">${ex ? '▴' : '▾'}</span></td></tr>`;
    if (ex) {
      const mv = t.position === 'LONG' ? (t.exit - t.entry) : (t.entry - t.exit);
      html += `<tr class="trow-detail"><td colspan="9"><div class="detail-grid">
        <div><label>Catatan / Trading Journal</label><p>${t.notes ? esc(t.notes) : '<span class="dim">Tidak ada catatan.</span>'}</p></div>
        <div><label>Pergerakan Harga</label><p class="mono">${fmtPrice(t.entry)} → ${fmtPrice(t.exit)}<br><span class="${c}">${mv >= 0 ? '+' : ''}${fmtPrice(Math.abs(mv)).replace(/^/, '')} ${mv >= 0 ? '▲' : '▼'}</span></p></div>
        <div><label>Lot</label><p class="mono">${t.lot != null ? Number(t.lot).toFixed(2) : '<span class="dim">—</span>'}</p></div>
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
  saveTrades(); renderAll(); toast('Trade dihapus');
  if (currentUser && !currentUser.isLocalOnly && sbClient) {
    sbClient.from('trades').delete().eq('id', id).then(({ error }) => {
      if (error) console.error('Cloud delete trade error:', error);
    });
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
    Object.assign(t, { date, asset, position: formPos, entry, exit, lot, notes });
    toast('Perubahan trade disimpan');
    if (currentUser && !currentUser.isLocalOnly && sbClient) {
      sbClient.from('trades').update({
        date, asset, position: formPos, entry, exit, lot, notes
      }).eq('id', t.id).then(({ error }) => {
        if (error) console.error('Cloud update trade error:', error);
      });
    }
  } else {
    const newTrade = { id: uid(), date, asset, position: formPos, entry, exit, lot, notes, createdAt: Date.now() };
    trades.push(newTrade);
    toast('Trade berhasil dicatat');
    if (currentUser && !currentUser.isLocalOnly && sbClient) {
      sbClient.from('trades').insert([{
        id: newTrade.id,
        user_id: currentUser.id,
        date: newTrade.date,
        asset: newTrade.asset,
        position: newTrade.position,
        entry: newTrade.entry,
        exit: newTrade.exit,
        lot: newTrade.lot,
        notes: newTrade.notes,
        created_at: newTrade.createdAt
      }]).then(({ error }) => {
        if (error) console.error('Cloud insert trade error:', error);
      });
    }
  }
  saveTrades(); state.editingId = null; resetForm(); updateFormUI(); renderAll();
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
$('#tFrom').addEventListener('change', e => { state.j.from = e.target.value; renderTable() });
$('#tTo').addEventListener('change', e => { state.j.to = e.target.value; renderTable() });
$('#btnTReset').onclick = () => {
  state.j = { q: '', pos: 'ALL', from: '', to: '' };
  $('#tSearch').value = ''; $('#tPos').value = 'ALL'; $('#tFrom').value = ''; $('#tTo').value = ''; renderTable()
};

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
      x: cx - bwpx / 2, y: ptp + ih - bh, width: bwpx, height: bh, rx: 3,
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
  el('stop', { offset: '0%', 'stop-color': '#f6465d', 'stop-opacity': 0 }, g);
  el('stop', { offset: '100%', 'stop-color': '#f6465d', 'stop-opacity': .3 }, g);
  let d = `M${X(0)},${Y(dd[0])}`; for (let i = 1; i < n; i++)d += `L${X(i)},${Y(dd[i])}`;
  el('path', { d: `${d}L${X(n - 1)},${y0}L${X(0)},${y0}Z`, fill: 'url(#gDD)' }, svg);
  el('path', { d, fill: 'none', stroke: 'var(--red)', 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);
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
    const m = metrics(ts), lab = `${MONTHS_FULL[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
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
$('#psBalance').addEventListener('input', e => {
  psState.balance = parseFloat(e.target.value) || 0;
  savePsSettings(); renderPositionSizing();
});
$('#psBalPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-bal]'); if (!b) return;
  psState.balance = parseFloat(b.dataset.bal);
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
  trades = [];
  saveTrades();
  cancelEdit();
  renderAll();
  toast('Semua data dihapus');
  if (currentUser && !currentUser.isLocalOnly && sbClient) {
    sbClient.from('trades').delete().eq('user_id', currentUser.id).then(({ error }) => {
      if (error) console.error('Cloud clear trades error:', error);
    });
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

/* ================= navigasi & periode ================= */
function setPageMeta() {
  const t = {
    overview: ['Ringkasan Performa', `Pertumbuhan akun & konsistensi — ${periodLabel()}`],
    journal: ['Jurnal Trading', 'Catat, validasi, dan evaluasi setiap trade'],
    sizing: ['Position Sizing', 'Kalkulator ukuran lot ideal sesuai modal, batas risiko, dan jarak Stop Loss'],
    analytics: ['Analitik', `Pola performa, drawdown & perbandingan posisi — ${periodLabel()}`]
  }[state.page];
  $('#pageTitle').textContent = t[0]; $('#pageSub').textContent = t[1];
  $('#periodWrap').hidden = (state.page === 'journal' || state.page === 'sizing');
}
function renderSidebar() {
  $('#navCount').textContent = trades.length;
}
function renderAll() {
  renderSidebar(); setPageMeta(); renderTable();
  if (state.page === 'overview') renderOverview();
  else if (state.page === 'sizing') renderPositionSizing();
  else if (state.page === 'analytics') renderAnalytics();
  requestAnimationFrame(() => {
    if (state.page === 'overview') syncRecentHeight();
    else if (state.page === 'journal') syncJournalHeight();
  });
}
function go(page) {
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
      renderStatCards(m, arr);
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
window.addEventListener('resize', debounce(() => {
  if (state.page === 'overview') { renderOverview(); syncRecentHeight(); }
  else if (state.page === 'journal') syncJournalHeight();
  else if (state.page === 'analytics') renderAnalytics();
}, 180));

/* ---- init ---- */
$('#fDate').value = todayISO();
loadPsSettings();
populateAssetSelect('XAUUSD');
syncPsUI();
renderPositionSizing();
if (!$('#fLot').value) $('#fLot').value = '0.01';
syncPeriodSeg(); syncCumSeg(); syncPosSeg(); updatePreview(); updateFormUI();
renderAll();

if ($('#btnAuth')) $('#btnAuth').onclick = openAuthModal;
if ($('#btnApplyUpdate')) {
  $('#btnApplyUpdate').onclick = async () => {
    const b = $('#btnApplyUpdate');
    b.disabled = true;
    b.textContent = 'Memperbarui...';
    await syncFromCloud(true);
    b.disabled = false;
    b.textContent = 'Muat Ulang Data ↻';
    hideUpdateBanner();
  };
}
if ($('#btnCloseUpdateBanner')) {
  $('#btnCloseUpdateBanner').onclick = hideUpdateBanner;
}

// Cek pembaruan dari perangkat lain saat membuka kembali aplikasi di HP atau fokus layar
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkForRemoteUpdates();
  }
});
window.addEventListener('focus', () => {
  checkForRemoteUpdates();
});

initAuth();
