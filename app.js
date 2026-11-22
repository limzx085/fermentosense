(() => {
'use strict';

/* =====================================================================
   FermentoSense – logika dashboard
   sensor -> parseLine -> ingest -> aturan (evalReading) -> notifikasi/buzzer/grafik
   ===================================================================== */

/* ---------- util ---------- */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const fmt = (v, d = 1) => isNum(v) ? v.toFixed(d).replace('.', ',') : '--';
const pad = n => String(n).padStart(2, '0');
const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const fmtDT   = ts => { const d = new Date(ts); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtHM   = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtHMS  = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const fmtDur  = ms => {
  const m = Math.max(0, Math.floor(ms / 60000)), h = Math.floor(m / 60), mm = m % 60;
  if (h && mm) return `${h} jam ${mm} mnt`;
  if (h) return `${h} jam`;
  if (mm) return `${mm} mnt`;
  return '0 jam';
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const HOUR = 3600000;

/* ---------- state ---------- */
const KEYS = { settings:'fs.settings.v1', samples:'fs.samples.v1', notifs:'fs.notifs.v1', last:'fs.last.v1' };
const DEFAULTS = {
  batchName:'Fermentasi Tempe', batchId:'T-001', start:Date.now(), durationH:24,
  tempMax:38, humMin:70, humMax:90, phMax:7.5, interval:10, buzzer:true
};
const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set(k, v)  { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k)     { try { localStorage.removeItem(k); } catch {} }
};

let settings = { ...DEFAULTS, ...store.get(KEYS.settings, {}) };
let samples  = store.get(KEYS.samples, []);      // {ts,temp,air,hum,ph}
let notifs   = store.get(KEYS.notifs, []);       // {id,ts,type,param,title,text,read}
let last     = store.get(KEYS.last, null);       // pembacaan terakhir
let alarm    = { temp:'ok', hum:'ok', ph:'ok' }; // status per parameter
let lastRecordTs = samples.length ? samples[samples.length - 1].ts : 0;
let lastSeen = 0;                                // waktu (Date.now) data terakhir masuk
let src = { type:'none', label:'Belum terhubung' };
let muted = false;
let chartRange = '24';
let page = 'dashboard';

if (last) alarm = evalReading(last, settings);

const MAX_SAMPLES = 20000, MAX_NOTIFS = 200;

/* ---------- persistence (ditunda agar ringan) ---------- */
let saveTimer = null;
function scheduleSave() { if (!saveTimer) saveTimer = setTimeout(flushSave, 2000); }
function flushSave() {
  clearTimeout(saveTimer); saveTimer = null;
  store.set(KEYS.settings, settings);
  store.set(KEYS.samples, samples);
  store.set(KEYS.notifs, notifs);
  store.set(KEYS.last, last);
}
window.addEventListener('beforeunload', flushSave);

/* =====================================================================
   1. PARSER – mengubah satu baris teks menjadi pembacaan sensor
   ===================================================================== */
const KEYMAP = {
  t:'temp', suhu:'temp', temp:'temp', temperature:'temp', suhu_media:'temp', media:'temp', tmedia:'temp',
  a:'air', udara:'air', air:'air', suhu_udara:'air', tudara:'air', dht:'air',
  h:'hum', rh:'hum', hum:'hum', humidity:'hum', kelembapan:'hum', kelembaban:'hum',
  ph:'ph'
};
function parseLine(line) {
  line = String(line || '').trim();
  if (!line) return null;
  const out = {};
  if (line[0] === '{') {                                 // JSON
    try {
      const o = JSON.parse(line);
      for (const [k, v] of Object.entries(o)) {
        const key = KEYMAP[k.toLowerCase()]; const n = parseFloat(String(v).replace(',', '.'));
        if (key && Number.isFinite(n)) out[key] = n;
      }
      return Object.keys(out).length ? out : null;
    } catch { /* lanjut ke format lain */ }
  }
  const re = /([A-Za-z_]+)\s*[:=]\s*(-?\d+(?:[.,]\d+)?)/g;   // key=value
  let m;
  while ((m = re.exec(line))) {
    const key = KEYMAP[m[1].toLowerCase()];
    if (key) out[key] = parseFloat(m[2].replace(',', '.'));
  }
  if (Object.keys(out).length) return out;
  const nums = line.split(/[;\t ]+|,(?=\s|\d)/).map(s => Number(s.replace(',', '.')));  // CSV angka
  if (nums.length >= 3 && nums.every(Number.isFinite)) {
    return nums.length === 3
      ? { temp:nums[0], hum:nums[1], ph:nums[2] }
      : { temp:nums[0], air:nums[1], hum:nums[2], ph:nums[3] };
  }
  return null;
}

/* Format Serial prototype Wokwi/ESP32 (beberapa baris per siklus):
     DS18B20 Sensor 1: 27.3 ºC   (x3 -> suhu media = rata-rata ketiga probe)
     DHT22 Humidity: 50.5 %	DHT22 Temperature: 23.1 ºC   (-> kelembapan + suhu udara)
   feedLine mengumpulkan baris-baris itu dan baru mengeluarkan pembacaan saat baris DHT22 tiba.
   Format satu-baris lain tetap lewat parseLine. */
const asm = { ds:{} };
const NUM = '(-?\\d+(?:[.,]\\d+)?)';
function feedLine(line) {
  line = String(line || '');
  const d = new RegExp('DS18B20\\s*Sensor\\s*(\\d+)\\s*:\\s*' + NUM, 'i').exec(line);
  if (d) { asm.ds[d[1]] = parseFloat(d[2].replace(',', '.')); return null; }
  const h = new RegExp('DHT22\\s*Humidity\\s*:\\s*' + NUM + '.*?Temperature\\s*:\\s*' + NUM, 'i').exec(line);
  if (h) {
    const probes = Object.values(asm.ds).filter(v => Number.isFinite(v) && v > -100);   // -127 = probe terputus
    asm.ds = {};
    const r = { hum: parseFloat(h[1].replace(',', '.')), air: parseFloat(h[2].replace(',', '.')) };
    if (probes.length) r.temp = probes.reduce((a, b) => a + b, 0) / probes.length;
    return r;
  }
  if (/DS18B20|DHT22/i.test(line)) return null;      // baris error / judul dari sketch

  /* Format sketch Tinkercad tim (satu blok per siklus):
       ===== HASIL MONITORING =====
       Suhu Media  : 31.20 C
       Suhu Udara  : 29.00 C
       Kelembapan  : 74.00 % RH
       pH          : 5.70
       ALARM: ...  /  STATUS: NORMAL
     Blok baru keluar saat baris pH tiba (baris terakhir berisi angka). */
  const tk = new RegExp('^\\s*(Suhu\\s*Media|Suhu\\s*Udara|Kelembapan|Kelembaban|pH)\\s*:\\s*' + NUM, 'i').exec(line);
  if (tk) {
    const k = tk[1].toLowerCase().replace(/\s+/g, '');
    const v = parseFloat(tk[2].replace(',', '.'));
    asm.tk = asm.tk || {};
    if (k === 'suhumedia') asm.tk.temp = v;
    else if (k === 'suhuudara') asm.tk.air = v;
    else if (k === 'ph') { const r = { ...asm.tk, ph: v }; asm.tk = null; return r; }
    else asm.tk.hum = v;
    return null;
  }
  if (/^\s*(=+\s*HASIL|ALARM|STATUS)/i.test(line)) return null;   // judul, pesan alarm, status
  return parseLine(line);
}

/* =====================================================================
   2. ATURAN – sesuai parameter FermentoSense
      suhu media > 38 °C   -> buzzer + notifikasi
      kelembapan <70 / >90 -> notifikasi
      pH > 7,5             -> notifikasi
   ===================================================================== */
function evalReading(r, th) {
  const s = { temp:'ok', hum:'ok', ph:'ok' };
  if (isNum(r.temp) && r.temp > th.tempMax) s.temp = 'high';
  if (isNum(r.hum)) { if (r.hum < th.humMin) s.hum = 'low'; else if (r.hum > th.humMax) s.hum = 'high'; }
  if (isNum(r.ph) && r.ph > th.phMax) s.ph = 'high';
  return s;
}
const allOk = s => s.temp === 'ok' && s.hum === 'ok' && s.ph === 'ok';

function warnMessage(k, state, r) {
  const th = settings;
  if (k === 'temp') return { title:'Peringatan Suhu', text:`Suhu media mencapai ${fmt(r.temp)} °C (di atas batas ${fmt(th.tempMax)} °C). Buzzer berbunyi.` };
  if (k === 'hum')  return { title:'Kelembapan Tidak Sesuai', text: state === 'low'
      ? `Kelembapan ${fmt(r.hum, 0)} % (di bawah batas ${fmt(th.humMin, 0)} %).`
      : `Kelembapan ${fmt(r.hum, 0)} % (di atas batas ${fmt(th.humMax, 0)} %).` };
  return { title:'Kemungkinan Fermentasi Berlebihan', text:`pH ${fmt(r.ph, 2)} (di atas batas ${fmt(th.phMax)}).` };
}
function okMessage(k, r) {
  const text = k === 'temp' ? `Suhu turun ke ${fmt(r.temp)} °C`
             : k === 'hum'  ? `Kelembapan kembali ke ${fmt(r.hum, 0)} %`
             :                `pH kembali ke ${fmt(r.ph, 2)}`;
  return { title:'Kondisi Kembali Normal', text };
}
function issueList(s, r) {
  const out = [];
  if (s.temp !== 'ok') out.push(`Suhu media terlalu tinggi (${fmt(r.temp)} °C)`);
  if (s.hum === 'low')  out.push(`Kelembapan di bawah ${fmt(settings.humMin, 0)} % (${fmt(r.hum, 0)} %)`);
  if (s.hum === 'high') out.push(`Kelembapan di atas ${fmt(settings.humMax, 0)} % (${fmt(r.hum, 0)} %)`);
  if (s.ph !== 'ok')   out.push(`pH tinggi, kemungkinan fermentasi berlebihan (${fmt(r.ph, 2)})`);
  return out;
}

let notifSeq = notifs.reduce((a, n) => Math.max(a, n.id || 0), 0);
function processAlarms(st, r, ts) {
  let changed = false;
  for (const k of ['temp', 'hum', 'ph']) {
    if (st[k] === alarm[k]) continue;
    const warn = st[k] !== 'ok';
    const msg = warn ? warnMessage(k, st[k], r) : okMessage(k, r);
    notifs.unshift({ id:++notifSeq, ts, type: warn ? 'warn' : 'ok', param:k, title:msg.title, text:msg.text, read:false });
    if (notifs.length > MAX_NOTIFS) notifs.length = MAX_NOTIFS;
    if (k === 'temp' && !warn) muted = false;
    alarm[k] = st[k];
    changed = true;
  }
  return changed;
}

/* =====================================================================
   3. INGEST – pintu masuk semua data sensor
   ===================================================================== */
function ingest(r, opts = {}) {
  const ts = opts.ts ?? Date.now();
  const cur = {
    ts,
    temp: isNum(r.temp) ? r.temp : last?.temp,
    air:  isNum(r.air)  ? r.air  : last?.air,
    hum:  isNum(r.hum)  ? r.hum  : last?.hum,
    ph:   isNum(r.ph)   ? r.ph   : last?.ph
  };
  last = cur;
  if (!opts.silent) lastSeen = Date.now();
  const changed = processAlarms(evalReading(cur, settings), cur, ts);
  if (changed || opts.forceRecord || ts - lastRecordTs >= settings.interval * 1000) {
    samples.push({ ts, temp:cur.temp, air:cur.air, hum:cur.hum, ph:cur.ph });
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
    lastRecordTs = ts;
  }
  scheduleSave();
  scheduleRender();
}

/* =====================================================================
   4. BUZZER (web) – bunyi saat suhu media > batas
   ===================================================================== */
let audioCtx = null;
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}
document.addEventListener('pointerdown', unlockAudio);
document.addEventListener('keydown', unlockAudio);
function beep() {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'square'; o.frequency.value = 1000; g.gain.value = 0.05;
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime + 0.3);
}
const isLive = () => src.type !== 'none' && Date.now() - lastSeen < 15000;
const buzzerRinging = () => alarm.temp === 'high' && isLive();
setInterval(() => { if (buzzerRinging() && settings.buzzer && !muted) beep(); }, 1000);

/* =====================================================================
   5. RENDER
   ===================================================================== */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAll(); });
}

function renderAll() {
  renderHeader(); renderCards(); renderStatus(); renderNotifs(); renderTimes(); renderSource();
  if (page === 'dashboard') renderChart();
  if (page === 'riwayat') renderHistory();
  if (page === 'bantuan') renderHelpThresholds();
}

function renderHeader() {
  $('#batchName').textContent = settings.batchName;
  $('#batchId').textContent = settings.batchId;
  $('#hdStart').textContent = fmtDT(settings.start);
  $('#hdDur').textContent = `${settings.durationH} jam (0–${settings.durationH} jam)`;
}

function setCard(id, val, dec, unit, state, range) {
  const has = isNum(val);
  const card = $('#card' + id), chip = $('#chip' + id);
  $('#val' + id).innerHTML = has ? `${fmt(val, dec)}<small>${unit}</small>` : '--';
  card.classList.toggle('warn', has && state !== 'ok');
  card.classList.toggle('nodata', !has);
  if (!has) { chip.className = 'chip idle'; chip.textContent = 'Menunggu data'; return; }
  const ok = state === 'ok';
  chip.className = 'chip ' + (ok ? 'ok' : 'bad');
  const word = ok ? 'Dalam batas' : state === 'low' ? 'Di bawah batas' : 'Di atas batas';
  chip.innerHTML = `<svg class="ic"><use href="#i-${ok ? 'check' : 'alert'}"/></svg><span>${word} (${range})</span>`;
}
function renderCards() {
  const st = last ? evalReading(last, settings) : {};
  const th = settings;
  setCard('Temp', last?.temp, 1, ' °C', st.temp, `≤ ${fmt(th.tempMax)} °C`);
  setCard('Hum',  last?.hum, 0, ' %',  st.hum,  `${fmt(th.humMin, 0)} – ${fmt(th.humMax, 0)} %`);
  setCard('Ph',   last?.ph,  1, '',    st.ph,   `≤ ${fmt(th.phMax)}`);
  $('#subTemp').textContent = isNum(last?.air) ? `Suhu udara: ${fmt(last.air)} °C` : '';
}

function renderStatus() {
  const box = $('#statusBox'), title = $('#statusTitle'), text = $('#statusText');
  if (!last) {
    box.className = 'status-box idle';
    title.textContent = 'Menunggu Data';
    text.textContent = 'Salin teks Serial Monitor lalu klik “Tempel Data” atau tekan Ctrl+V di halaman ini.';
  } else {
    const st = evalReading(last, settings);
    if (allOk(st)) {
      box.className = 'status-box';
      title.textContent = 'Kondisi Normal';
      text.textContent = 'Seluruh parameter berada dalam batas yang ditentukan.';
    } else {
      box.className = 'status-box warn';
      title.textContent = 'Perlu Perhatian';
      text.innerHTML = '';
      const ul = document.createElement('ul');
      issueList(st, last).forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
      text.appendChild(ul);
    }
    $('#statusBox .status-icon').innerHTML = `<svg class="ic"><use href="#i-${allOk(st) ? 'check' : 'alert'}"/></svg>`;
  }
  if (!last) $('#statusBox .status-icon').innerHTML = '<svg class="ic"><use href="#i-clock"/></svg>';
  renderStatusMeta();
}
function renderStatusMeta() {
  $('#statusMeta').textContent = last
    ? `Pembaruan terakhir: ${fmtHMS(last.ts)}${isLive() ? '' : ' (tidak langsung)'}`
    : 'Belum ada data';
  const row = $('#buzzerRow');
  const ring = buzzerRinging();
  row.className = 'buzzer' + (ring ? ' on' : '');
  row.innerHTML = `<svg class="ic"><use href="#i-${ring && !muted ? 'volume' : ring ? 'mute' : 'volume'}"/></svg>` +
    (ring ? `Buzzer berbunyi${muted ? ' (dibisukan)' : ''}` : 'Buzzer mati');
  if (ring && !muted) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Bisukan';
    b.onclick = () => { muted = true; renderStatusMeta(); };
    row.appendChild(b);
  }
}

function notifHTML(n, full) {
  const when = full ? fmtDT(n.ts) : 'Jam ' + fmtHM(n.ts);
  return `<div class="notif ${n.type}${n.read ? '' : ' unread'}">
    <svg class="ic"><use href="#i-${n.type === 'warn' ? 'alert' : 'check'}"/></svg>
    <div class="nb"><div class="nt"><b>${esc(n.title)}</b><span>${when}</span></div><p>${esc(n.text)}</p></div></div>`;
}
function renderNotifs() {
  const unread = notifs.filter(n => !n.read).length;
  const badge = $('#navBadge');
  badge.hidden = !unread; badge.textContent = unread > 99 ? '99+' : unread;
  $('#notifPreview').innerHTML = notifs.length
    ? notifs.slice(0, 3).map(n => notifHTML(n, false)).join('')
    : '<div class="empty">Belum ada notifikasi.</div>';
  if (page === 'notifikasi') {
    $('#notifFull').innerHTML = notifs.length ? notifs.map(n => notifHTML(n, true)).join('') : '<div class="empty">Belum ada notifikasi.</div>';
  }
}

function renderTimes() {
  const total = settings.durationH * HOUR;
  const elapsed = Math.max(0, Date.now() - settings.start);
  $('#elapsed').textContent = fmtDur(elapsed);
  $('#remain').textContent = elapsed >= total ? '0 jam' : fmtDur(total - elapsed);
  $('#eta').textContent = fmtDT(settings.start + total);
}

function renderSource() {
  const live = isLive();
  $('#srcLabel').textContent = src.type === 'none' ? 'Belum terhubung' : `${src.label}${live ? '' : ' · jeda'}`;
  $('#srcDot').className = 'dot' + (src.type === 'none' ? '' : live ? ' live' : ' stale');
}

/* ---------- grafik (SVG buatan sendiri, tanpa library) ---------- */
const COLORS = { temp:'#f28c1a', hum:'#2f86e0', ph:'#8a4fc1' };
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw - 1e-9) return m * p;
  return 10 * p;
}
function makeAxis(defMin, defMax, vals) {
  let lo = defMin, hi = defMax;
  for (const v of vals) { if (v < lo) lo = Math.floor(v); if (v > hi) hi = Math.ceil(v); }
  let step = niceStep((hi - lo) / 5);
  lo = Math.floor(lo / step) * step;
  while (lo + 5 * step < hi - 1e-9) step = niceStep(step * 1.01);
  return { min:lo, max:lo + 5 * step, step };
}
const tickLabel = (v, step) => (step < 1 ? v.toFixed(1) : String(Math.round(v))).replace('.', ',');
const X_STEPS = [1/60, 2/60, 5/60, 10/60, 15/60, 30/60, 1, 2, 3, 4, 6, 12, 24];
function hourLabel(v, step) {
  if (step >= 1) return String(Math.round(v * 100) / 100).replace('.', ',');
  const mins = Math.round(v * 60);
  return `${Math.floor(mins / 60)}:${pad(mins % 60)}`;
}

let chartCtx = null;
function renderChart() {
  const host = $('#chart');
  if (!host.clientWidth) return;
  const W = Math.max(host.clientWidth, 320), H = Math.round(Math.max(300, Math.min(380, W * 0.48)));
  const m = { l:58, r:132, t:14, b:46 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;

  // jendela waktu
  const latest = samples.length ? (samples[samples.length - 1].ts - settings.start) / HOUR : 0;
  let x0, x1;
  if (chartRange === 'all') { x0 = 0; x1 = Math.max(settings.durationH, latest, 1); }
  else { const N = +chartRange; x1 = Math.max(N, latest); x0 = x1 - N; }
  if (x0 < 0) x0 = 0;

  let pts = [];
  for (const s of samples) {
    const x = (s.ts - settings.start) / HOUR;
    if (x >= x0 - 1e-9 && x <= x1 + 1e-9) pts.push({ x, ts:s.ts, temp:s.temp, air:s.air, hum:s.hum, ph:s.ph });
  }
  // kurangi titik (prioritaskan sampel yang melanggar batas agar lonjakan tetap terlihat)
  const MAXP = 300;
  if (pts.length > MAXP) {
    const size = Math.ceil(pts.length / MAXP), out = [];
    for (let i = 0; i < pts.length; i += size) {
      const b = pts.slice(i, i + size);
      out.push(b.find(p => !allOk(evalReading(p, settings))) || b[b.length >> 1]);
    }
    pts = out;
  }

  const col = k => pts.filter(p => isNum(p[k])).map(p => p[k]);
  const th = settings;
  const aT = makeAxis(24, 44, [...col('temp'), th.tempMax]);
  const aH = makeAxis(50, 100, [...col('hum'), th.humMin, th.humMax]);
  const aP = makeAxis(4, 9, [...col('ph'), th.phMax]);
  const X = x => m.l + pw * (x - x0) / (x1 - x0 || 1);
  const Y = (a, v) => m.t + ph * (1 - (v - a.min) / (a.max - a.min));

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Grafik suhu, kelembapan dan pH">`;
  // grid + tick tiga sumbu
  for (let i = 0; i <= 5; i++) {
    const y = m.t + ph * (1 - i / 5);
    s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${y}" y2="${y}" stroke="#e6ece8"/>`;
    s += `<text x="${m.l - 10}" y="${y + 4}" text-anchor="end" font-size="12.5" fill="#44534b">${tickLabel(aT.min + i * aT.step, aT.step)}</text>`;
    s += `<text x="${m.l + pw + 10}" y="${y + 4}" font-size="12.5" fill="#44534b">${tickLabel(aH.min + i * aH.step, aH.step)}</text>`;
    s += `<text x="${m.l + pw + 74}" y="${y + 4}" font-size="12.5" fill="#44534b">${tickLabel(aP.min + i * aP.step, aP.step)}</text>`;
  }
  // sumbu X
  const win = x1 - x0;
  const xs = X_STEPS.find(v => win / v <= 7) || 24;
  for (let v = Math.ceil(x0 / xs - 1e-9) * xs; v <= x1 + 1e-9; v += xs) {
    s += `<text x="${X(v)}" y="${m.t + ph + 20}" text-anchor="middle" font-size="12.5" fill="#44534b">${hourLabel(v, xs)}</text>`;
    s += `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t + ph}" y2="${m.t + ph + 4}" stroke="#9aa8a0"/>`;
  }
  s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="#9aa8a0"/>`;
  s += `<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="#9aa8a0"/>`;
  s += `<line x1="${m.l + pw}" x2="${m.l + pw}" y1="${m.t}" y2="${m.t + ph}" stroke="#9aa8a0"/>`;
  s += `<line x1="${m.l + pw + 66}" x2="${m.l + pw + 66}" y1="${m.t}" y2="${m.t + ph}" stroke="#9aa8a0"/>`;
  // judul sumbu
  s += `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="${COLORS.temp}">Suhu (°C)</text>`;
  s += `<text transform="translate(${m.l + pw + 52} ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="${COLORS.hum}">Kelembapan (%)</text>`;
  s += `<text transform="translate(${m.l + pw + 118} ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="${COLORS.ph}">pH</text>`;
  s += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="13" fill="#2b3a32">Waktu Fermentasi (jam)</text>`;
  // garis batas notifikasi
  const dash = (a, v, c) => (v >= a.min && v <= a.max)
    ? `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(a, v)}" y2="${Y(a, v)}" stroke="${c}" stroke-width="1.2" stroke-dasharray="5 5" opacity=".55"/>` : '';
  s += dash(aT, th.tempMax, COLORS.temp) + dash(aH, th.humMin, COLORS.hum) + dash(aH, th.humMax, COLORS.hum) + dash(aP, th.phMax, COLORS.ph);

  // data
  const series = [['temp', aT], ['hum', aH], ['ph', aP]];
  if (!pts.length) {
    s += `<text x="${m.l + pw / 2}" y="${m.t + ph / 2}" text-anchor="middle" font-size="15" fill="#7b8a82">Belum ada data pada rentang ini. Klik “Sumber Data” untuk memulai.</text>`;
  }
  for (const [k, a] of series) {
    const p = pts.filter(q => isNum(q[k]));
    if (!p.length) continue;
    const d = p.map((q, i) => `${i ? 'L' : 'M'}${X(q.x).toFixed(1)} ${Y(a, q[k]).toFixed(1)}`).join(' ');
    s += `<path d="${d}" fill="none" stroke="${COLORS[k]}" stroke-width="2.2" stroke-linejoin="round"/>`;
    if (p.length <= 60) s += p.map(q => `<circle cx="${X(q.x).toFixed(1)}" cy="${Y(a, q[k]).toFixed(1)}" r="3.6" fill="${COLORS[k]}"/>`).join('');
  }
  s += `<line id="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" stroke="#16261d" stroke-opacity=".35" stroke-dasharray="3 3" visibility="hidden"/>`;
  s += `</svg><div class="tip" id="tip"></div>`;
  host.innerHTML = s;
  chartCtx = { pts, m, pw, W, X, x0, x1 };
}

(function bindChartHover() {
  const host = $('#chart');
  host.addEventListener('pointermove', e => {
    const c = chartCtx; if (!c || !c.pts.length) return;
    const rect = host.getBoundingClientRect(), px = e.clientX - rect.left;
    if (px < c.m.l - 4 || px > c.m.l + c.pw + 4) return hideTip();
    const xv = c.x0 + (px - c.m.l) / c.pw * (c.x1 - c.x0);
    let best = c.pts[0];
    for (const p of c.pts) if (Math.abs(p.x - xv) < Math.abs(best.x - xv)) best = p;
    const xh = $('#xh'), tip = $('#tip'); if (!xh || !tip) return;
    const cx = c.X(best.x);
    xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>Jam ke-${fmt(best.x, 2)} · ${fmtHMS(best.ts)}</b>` +
      `<i style="background:${COLORS.temp}"></i>Suhu media: ${fmt(best.temp)} °C<br>` +
      (isNum(best.air) ? `<i style="background:#c9a66b"></i>Suhu udara: ${fmt(best.air)} °C<br>` : '') +
      `<i style="background:${COLORS.hum}"></i>Kelembapan: ${fmt(best.hum, 0)} %<br>` +
      `<i style="background:${COLORS.ph}"></i>pH: ${fmt(best.ph, 2)}`;
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    tip.style.left = (cx + 14 + tw > c.W ? cx - tw - 14 : cx + 14) + 'px';
    tip.style.top = '24px';
  });
  const hideTip = () => { const xh = $('#xh'), tip = $('#tip'); if (xh) xh.setAttribute('visibility', 'hidden'); if (tip) tip.style.display = 'none'; };
  host.addEventListener('pointerleave', hideTip);
  new ResizeObserver(() => { if (page === 'dashboard') renderChart(); }).observe(host);
})();

/* ---------- riwayat ---------- */
function renderHistory() {
  const stat = (key, label, dec, unit, icon) => {
    const v = samples.map(s => s[key]).filter(isNum);
    const body = v.length
      ? `<dt>Terendah</dt><dd>${fmt(Math.min(...v), dec)}${unit}</dd><dt>Tertinggi</dt><dd>${fmt(Math.max(...v), dec)}${unit}</dd><dt>Rata-rata</dt><dd>${fmt(v.reduce((a, b) => a + b, 0) / v.length, dec)}${unit}</dd><dt>Jumlah sampel</dt><dd>${v.length}</dd>`
      : '<dt>Belum ada data</dt><dd></dd>';
    return `<section class="card stat"><h3><svg class="ic green"><use href="#i-${icon}"/></svg>${label}</h3><dl>${body}</dl></section>`;
  };
  $('#statGrid').innerHTML = stat('temp', 'Suhu Media', 1, ' °C', 'thermo') + stat('hum', 'Kelembapan', 0, ' %', 'drop') + stat('ph', 'pH', 2, '', 'flask');

  const rows = samples.slice(-200).reverse();
  $('#histCount').textContent = samples.length ? `Menampilkan ${rows.length} dari ${samples.length} data` : '';
  $('#histTable tbody').innerHTML = rows.length ? rows.map(s => {
    const st = evalReading(s, settings), ok = allOk(st);
    return `<tr class="${ok ? '' : 'bad'}"><td>${fmtDT(s.ts)}:${pad(new Date(s.ts).getSeconds())}</td><td class="num">${fmt((s.ts - settings.start) / HOUR, 2)}</td>` +
      `<td class="num">${fmt(s.temp)}</td><td class="num">${fmt(s.air)}</td><td class="num">${fmt(s.hum, 0)}</td><td class="num">${fmt(s.ph, 2)}</td>` +
      `<td><span class="tag ${ok ? 'ok' : 'bad'}">${ok ? 'Normal' : 'Perlu perhatian'}</span></td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">Belum ada data.</td></tr>';
}

function renderHelpThresholds() {
  const map = { tempMax:[settings.tempMax, 1], humMin:[settings.humMin, 0], humMax:[settings.humMax, 0], phMax:[settings.phMax, 1] };
  $$('[data-th]').forEach(el => { const [v, d] = map[el.dataset.th]; el.textContent = fmt(v, d); });
}

/* ---------- ekspor CSV ---------- */
function downloadCSV() {
  if (!samples.length) return toast('Belum ada data untuk diunduh.');
  const head = ['waktu', 'jam_ke', 'suhu_media_C', 'suhu_udara_C', 'kelembapan_persen', 'pH', 'status'];
  const val = v => isNum(v) ? v : '';
  const rows = samples.map(s => {
    const st = evalReading(s, settings);
    const d = new Date(s.ts);
    const t = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${fmtHMS(s.ts)}`;
    return [t, ((s.ts - settings.start) / HOUR).toFixed(3), val(s.temp), val(s.air), val(s.hum), val(s.ph),
      allOk(st) ? 'Normal' : issueList(st, s).join(' | ')].map(c => /[",\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c).join(',');
  });
  const blob = new Blob(['﻿' + [head.join(','), ...rows].join('\r\n')], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `laporan-fermentosense-${settings.batchId}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Laporan CSV diunduh.');
}

/* =====================================================================
   6. SUMBER DATA: simulator, tempel serial monitor, USB serial
   ===================================================================== */
function setSource(type, label) { src = { type, label }; renderSource(); }

/* --- simulator --- */
const sim = { temp:31.2, air:29, hum:74, ph:5.7, timer:null };
const rnd = a => (Math.random() * 2 - 1) * a;
function simSend() {
  const n = $('#simNoise').checked;
  ingest({
    temp: sim.temp + (n ? rnd(0.15) : 0), air: sim.air + (n ? rnd(0.15) : 0),
    hum: Math.min(100, Math.max(0, sim.hum + (n ? rnd(0.6) : 0))),
    ph: Math.max(0, sim.ph + (n ? rnd(0.02) : 0))
  });
}
function simStart() {
  if (sim.timer) return;
  setSource('sim', 'Simulator');
  simSend(); sim.timer = setInterval(simSend, 1000);
  $('#simToggle').textContent = 'Hentikan Simulator';
}
function simStop() {
  clearInterval(sim.timer); sim.timer = null;
  if (src.type === 'sim') setSource('none');
  $('#simToggle').textContent = 'Mulai Simulator';
}
const PRESETS = {
  normal:{temp:31.2, air:29, hum:74, ph:5.7}, hot:{temp:39.5, air:30, hum:74, ph:5.7},
  dry:{temp:32, air:29, hum:62, ph:5.8}, wet:{temp:32, air:29, hum:93, ph:5.8}, acid:{temp:32, air:29, hum:75, ph:7.9}
};
function syncSliders() {
  $('#simTemp').value = sim.temp; $('#simAir').value = sim.air; $('#simHum').value = sim.hum; $('#simPh').value = sim.ph;
  $('#oTemp').textContent = fmt(sim.temp) + ' °C'; $('#oAir').textContent = fmt(sim.air) + ' °C';
  $('#oHum').textContent = fmt(sim.hum, 0) + ' %'; $('#oPh').textContent = fmt(sim.ph);
}
[['simTemp','temp'], ['simAir','air'], ['simHum','hum'], ['simPh','ph']].forEach(([id, k]) =>
  $('#' + id).addEventListener('input', e => { sim[k] = +e.target.value; syncSliders(); if (sim.timer) simSend(); }));
$$('[data-preset]').forEach(b => b.addEventListener('click', () => { Object.assign(sim, PRESETS[b.dataset.preset]); syncSliders(); if (sim.timer) simSend(); }));
$('#simToggle').addEventListener('click', () => sim.timer ? simStop() : simStart());
$('#simOnce').addEventListener('click', () => { if (!sim.timer) setSource('sim', 'Simulator (manual)'); simSend(); });

/* --- tempel dari Serial Monitor Tinkercad --- */
/* Satu pintu untuk semua cara menempel (tombol Tempel Data, Ctrl+V, kotak di jendela Sumber Data).
   Mengembalikan jumlah pembacaan yang berhasil dikenali. */
function importText(text) {
  const gap = Math.max(1, +$('#pasteGap').value || 1) * 1000;
  asm.ds = {}; asm.tk = null;
  const parsed = String(text || '').split(/\r?\n/).map(feedLine).filter(Boolean);
  if (!parsed.length) return 0;
  const first = Date.now() - (parsed.length - 1) * gap;
  if (first < settings.start) { settings.start = first; fillSettingsForm(); }   // data lebih awal dari waktu mulai batch
  setSource('paste', 'Input manual');
  parsed.forEach((r, i) => ingest(r, { ts: first + i * gap, forceRecord:true }));
  return parsed.length;
}
const NO_DATA_MSG = 'Tidak ada data sensor yang dikenali. Salin teks dari Serial Monitor (blok “HASIL MONITORING” atau baris T=…;A=…;H=…;PH=…).';

$('#pasteGo').addEventListener('click', () => {
  const n = importText($('#pasteArea').value);
  $('#pasteResult').textContent = n ? `${n} pembacaan berhasil diproses.` : NO_DATA_MSG;
  if (n) { $('#pasteArea').value = ''; toast(`${n} pembacaan masuk ke dashboard.`); }
});

/* Tombol “Tempel Data”: baca clipboard lalu langsung proses. Jika izin clipboard ditolak,
   buka kotak tempel manual. */
async function quickPaste() {
  let text;
  try { text = await navigator.clipboard.readText(); }
  catch {
    openModal(); showTab('paste'); $('#pasteArea').focus();
    toast('Browser tidak mengizinkan membaca clipboard. Tempel manual (Ctrl+V) di kotak ini.');
    return;
  }
  const n = importText(text);
  toast(n ? `${n} pembacaan masuk dari clipboard.` : NO_DATA_MSG);
}
$('#btnQuickPaste').addEventListener('click', quickPaste);

/* Pintasan: Ctrl+V di mana saja pada dashboard (selain saat mengetik di kolom isian). */
document.addEventListener('paste', e => {
  const t = e.target;
  if (t && (t.matches?.('input, textarea, select') || t.isContentEditable)) return;
  const text = e.clipboardData?.getData('text');
  if (!text) return;
  e.preventDefault();
  const n = importText(text);
  toast(n ? `${n} pembacaan masuk dari clipboard.` : NO_DATA_MSG);
});

/* --- USB serial (Web Serial API) --- */
const usb = { port:null, reader:null, closed:null };
const usbMsg = t => { $('#usbStatus').textContent = t; };
async function usbConnect() {
  if (!('serial' in navigator)) return usbMsg('Browser ini tidak mendukung Web Serial. Gunakan Chrome atau Edge versi desktop.');
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: +$('#baud').value || 9600 });
    usb.port = port;
    const dec = new TextDecoderStream();
    usb.closed = port.readable.pipeTo(dec.writable).catch(() => {});
    usb.reader = dec.readable.getReader();
    setSource('serial', 'USB Serial');
    $('#usbConnect').disabled = true; $('#usbDisconnect').disabled = false;
    usbMsg('Terhubung. Menunggu data…');
    usbLoop();
  } catch (e) { usbMsg('Gagal menghubungkan: ' + e.message); }
}
async function usbLoop() {
  let buf = '';
  try {
    while (true) {
      const { value, done } = await usb.reader.read();
      if (done) break;
      buf += value;
      const parts = buf.split(/\r?\n/); buf = parts.pop();
      parts.forEach(l => { const r = feedLine(l); if (r) ingest(r); });
    }
  } catch {}
  usbCleanup();
}
async function usbDisconnect() {
  try { await usb.reader?.cancel(); await usb.closed; await usb.port?.close(); } catch {}
  usbCleanup();
}
function usbCleanup() {
  usb.port = usb.reader = usb.closed = null;
  if (src.type === 'serial') setSource('none');
  $('#usbConnect').disabled = false; $('#usbDisconnect').disabled = true;
  usbMsg('Belum terhubung.');
}
$('#usbConnect').addEventListener('click', usbConnect);
$('#usbDisconnect').addEventListener('click', usbDisconnect);

/* --- modal --- */
const modal = $('#srcModal');
const openModal = () => { syncSliders(); modal.showModal(); };
$('#sourcePill').addEventListener('click', openModal);
$('#btnOpenSource').addEventListener('click', openModal);
$('#srcClose').addEventListener('click', () => modal.close());
modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
function showTab(name) {
  $$('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
  $$('.tab-body').forEach(b => b.hidden = b.id !== 'tab-' + name);
}
$$('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

/* =====================================================================
   7. PENGATURAN & AKSI DATA
   ===================================================================== */
const toLocalInput = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function fillSettingsForm() {
  $('#setBatchName').value = settings.batchName; $('#setBatchId').value = settings.batchId;
  $('#setStart').value = toLocalInput(settings.start); $('#setDuration').value = settings.durationH;
  $('#setTempMax').value = settings.tempMax; $('#setPhMax').value = settings.phMax;
  $('#setHumMin').value = settings.humMin; $('#setHumMax').value = settings.humMax;
  $('#setInterval').value = settings.interval; $('#setBuzzer').checked = settings.buzzer;
}
$('#settingsForm').addEventListener('submit', e => {
  e.preventDefault();
  const n = id => parseFloat($('#' + id).value);
  const next = {
    batchName: $('#setBatchName').value.trim() || DEFAULTS.batchName,
    batchId: $('#setBatchId').value.trim() || DEFAULTS.batchId,
    start: new Date($('#setStart').value).getTime(),
    durationH: n('setDuration'), tempMax: n('setTempMax'), phMax: n('setPhMax'),
    humMin: n('setHumMin'), humMax: n('setHumMax'), interval: Math.round(n('setInterval')),
    buzzer: $('#setBuzzer').checked
  };
  if (![next.start, next.durationH, next.tempMax, next.phMax, next.humMin, next.humMax, next.interval].every(Number.isFinite)) return toast('Periksa kembali isian: ada nilai yang tidak valid.');
  if (next.humMin >= next.humMax) return toast('Batas kelembapan minimum harus lebih kecil dari maksimum.');
  if (next.durationH < 1 || next.interval < 1) return toast('Durasi dan interval minimal 1.');
  settings = { ...settings, ...next };
  if (last) { alarm = evalReading(last, settings); }
  flushSave(); renderAll(); toast('Pengaturan disimpan.');
});
$('#btnDefaults').addEventListener('click', () => {
  Object.assign(settings, { tempMax:DEFAULTS.tempMax, humMin:DEFAULTS.humMin, humMax:DEFAULTS.humMax, phMax:DEFAULTS.phMax });
  fillSettingsForm(); if (last) alarm = evalReading(last, settings); flushSave(); renderAll(); toast('Batas dikembalikan ke default.');
});

function resetData() {
  samples = []; notifs = []; last = null; lastRecordTs = 0; lastSeen = 0;
  alarm = { temp:'ok', hum:'ok', ph:'ok' }; muted = false;
}
$('#btnNewBatch').addEventListener('click', () => {
  if (!confirm('Mulai batch baru? Riwayat dan notifikasi batch ini akan dihapus.')) return;
  resetData(); settings.start = Date.now(); fillSettingsForm(); flushSave(); renderAll(); toast('Batch baru dimulai.');
});
$('#btnWipe').addEventListener('click', () => {
  if (!confirm('Hapus SEMUA data, notifikasi, dan pengaturan di browser ini?')) return;
  simStop(); resetData(); settings = { ...DEFAULTS, start:Date.now() };
  Object.values(KEYS).forEach(store.del); fillSettingsForm(); renderAll(); toast('Semua data dihapus.');
});
$('#btnClearHist').addEventListener('click', () => {
  if (!confirm('Hapus seluruh riwayat data sensor?')) return;
  samples = []; lastRecordTs = 0; flushSave(); renderAll();
});
$('#btnCsv').addEventListener('click', downloadCSV);
$('#btnReport').addEventListener('click', downloadCSV);
$('#btnReadAll').addEventListener('click', () => { notifs.forEach(n => n.read = true); flushSave(); renderAll(); });
$('#btnClearNotif').addEventListener('click', () => {
  if (!notifs.length || !confirm('Hapus semua notifikasi?')) return;
  notifs = []; flushSave(); renderAll();
});

/* --- data contoh 12 jam (mencakup lonjakan suhu & kelembapan awal rendah) --- */
$('#btnSeed').addEventListener('click', () => {
  if (samples.length && !confirm('Data yang ada akan diganti dengan data contoh. Lanjutkan?')) return;
  simStop(); resetData();
  const now = Date.now(), hours = 12, stepMs = 5 * 60000;
  settings.start = now - hours * HOUR;
  for (let ts = settings.start; ts <= now + 1; ts += stepMs) {
    const t = (ts - settings.start) / HOUR;
    let temp = 27.3 + 6.2 * (1 - Math.exp(-t / 4)) + rnd(0.15);
    if (t >= 7.5 && t <= 8.6) temp += 6.2 * Math.sin(Math.PI * (t - 7.5) / 1.1);
    ingest({
      temp,
      air: 27 + 3 * (1 - Math.exp(-t / 5)) + rnd(0.2),
      hum: 65 + 12 * (1 - Math.exp(-t / 3)) + rnd(0.6),
      ph: 6.4 - 0.5 * (1 - Math.exp(-t / 6)) + rnd(0.02)
    }, { ts: Math.min(ts, now), silent:true, forceRecord:true });
  }
  fillSettingsForm(); flushSave(); renderAll();
  toast('Data contoh dimuat. Buka “Sumber Data” untuk melanjutkan secara langsung.');
});

/* =====================================================================
   8. BANTUAN: kode Arduino
   ===================================================================== */
const SKETCH = `/*
  FermentoSense - versi Tinkercad Circuits (Arduino Uno)

  A0 : TMP36 pertama   -> suhu media    (pengganti DS18B20)
  A1 : TMP36 kedua     -> suhu udara    (pengganti suhu DHT22)
  A2 : Potensiometer 1 -> kelembapan    (pengganti kelembapan DHT22), 0-100 %
  A3 : Potensiometer 2 -> pH            (pengganti sensor pH),        0-14
  D8 : Piezo buzzer    -> bunyi jika suhu media > SUHU_MAX

  Keluaran Serial (9600 baud), satu baris per detik:
  T=31.2;A=29.0;H=74.0;PH=5.70
*/

const int PIN_SUHU_MEDIA = A0;
const int PIN_SUHU_UDARA = A1;
const int PIN_RH         = A2;
const int PIN_PH         = A3;
const int PIN_BUZZER     = 8;

const float SUHU_MAX = 38.0;   // batas suhu media (derajat C)

// Baca TMP36 dan ubah ke derajat Celsius (rata-rata 10 kali agar stabil)
float bacaTMP36(int pin) {
  long total = 0;
  for (int i = 0; i < 10; i++) {
    total += analogRead(pin);
    delay(2);
  }
  float volt = (total / 10.0) * 5.0 / 1023.0;
  return (volt - 0.5) * 100.0;
}

void setup() {
  Serial.begin(9600);
  pinMode(PIN_BUZZER, OUTPUT);
}

void loop() {
  float suhuMedia  = bacaTMP36(PIN_SUHU_MEDIA);
  float suhuUdara  = bacaTMP36(PIN_SUHU_UDARA);
  float kelembapan = analogRead(PIN_RH) * 100.0 / 1023.0;
  float ph         = analogRead(PIN_PH) * 14.0 / 1023.0;

  // Buzzer: berbunyi saat suhu media > 38 C
  if (suhuMedia > SUHU_MAX) {
    tone(PIN_BUZZER, 1000);
  } else {
    noTone(PIN_BUZZER);
  }

  Serial.print("T=");   Serial.print(suhuMedia, 1);
  Serial.print(";A=");  Serial.print(suhuUdara, 1);
  Serial.print(";H=");  Serial.print(kelembapan, 1);
  Serial.print(";PH="); Serial.println(ph, 2);

  delay(1000);
}
`;
$('#sketch').textContent = SKETCH;
$('#btnCopySketch').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(SKETCH); toast('Kode disalin.'); }
  catch { const r = document.createRange(); r.selectNodeContents($('#sketch')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Tekan Ctrl+C untuk menyalin.'); }
});

/* =====================================================================
   9. NAVIGASI, TOAST, TICK
   ===================================================================== */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function showPage() {
  const id = (location.hash || '#dashboard').slice(1);
  page = $('#page-' + id) ? id : 'dashboard';
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  $$('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  if (page === 'pengaturan') fillSettingsForm();
  renderAll();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', showPage);
$('#rangeSel').addEventListener('change', e => { chartRange = e.target.value; renderChart(); });

// Membuka halaman Notifikasi menandai semua sebagai dibaca setelah sebentar
let readTimer = null;
window.addEventListener('hashchange', () => {
  clearTimeout(readTimer);
  if (page === 'notifikasi') readTimer = setTimeout(() => { notifs.forEach(n => n.read = true); scheduleSave(); renderNotifs(); }, 2500);
});

setInterval(() => { renderTimes(); renderSource(); renderStatusMeta(); }, 1000);
showPage();

})();
