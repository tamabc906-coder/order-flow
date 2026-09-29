// Order Flow — PWA JS thuần. Đọc docs/data/{latest,state}.json, daily/<MÃ>.json, intraday/<ngày>/<MÃ>.json.
// Hàm vẽ chép từ order-flow-lab/template.html (bản người dùng duyệt 26/09/2026). Không đặt biến toàn cục tên `top`.
'use strict';

const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat('vi-VN');
const fmt = v => nf.format(v);
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));
const mil = v => (v / 1e6).toLocaleString('vi-VN', {maximumFractionDigits: 2}) + ' tr';
const smil = v => (v > 0 ? '+' : v < 0 ? '−' : '') + mil(Math.abs(v));
const px = v => v.toLocaleString('vi-VN', {minimumFractionDigits: 1, maximumFractionDigits: 2});
const pct = v => v == null ? '–' : v.toLocaleString('vi-VN', {maximumFractionDigits: 1}) + ' %';
const spt = v => v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('vi-VN', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const dd = s => s.slice(8, 10) + '/' + s.slice(5, 7);
// a so với b, có dấu: vsp(64.7, 65.046) → '−0,53 %'
const vsp = (a, b) => { const v = (a / b - 1) * 100; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('vi-VN', {maximumFractionDigits: 2}) + ' %'; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const SIG = {
  absorb_b: {s: '◆', c: 'var(--buy)', below: true, name: 'Hấp thụ lệnh bán'},
  absorb_s: {s: '◆', c: 'var(--sell)', below: false, name: 'Hấp thụ lệnh mua'},
  fail_b: {s: '✕', c: 'var(--sell)', below: true, name: 'Hấp thụ mua thất bại'},
  fail_s: {s: '✕', c: 'var(--buy)', below: false, name: 'Hấp thụ bán thất bại'},
  div_b: {s: '⚠', c: 'var(--buy)', below: true, name: 'Phân kỳ đáy'},
  div_s: {s: '⚠', c: 'var(--sell)', below: false, name: 'Phân kỳ đỉnh'},
  exh_b: {s: '▽', c: 'var(--buy)', below: true, name: 'Cạn kiệt bán'},
  exh_s: {s: '△', c: 'var(--sell)', below: false, name: 'Cạn kiệt mua'},
  stack_b: {s: '≡', c: 'var(--buy)', below: true, name: 'Imbalance mua xếp chồng'},
  stack_s: {s: '≡', c: 'var(--sell)', below: false, name: 'Imbalance bán xếp chồng'},
};
const sigTag = k => `<b style="color:${SIG[k].c}">${SIG[k].s} ${SIG[k].name}</b>`;

// ---------------------------------------------------------------- dữ liệu
const cache = new Map();
async function getJSON(path) {
  if (cache.has(path)) return cache.get(path);
  const p = fetch('data/' + path, {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  cache.set(path, p);
  p.catch(() => cache.delete(path));
  return p;
}
// LIVE = phiên hôm nay dở dang (lượt 12:05, data/live.json) — chỉ có từ trưa tới khi job 16:00 đưa phiên đủ vào kho
let LATEST = null, STATE = null, LIVE = null;
const S = {tab: 'list', sym: null, day: null, sort: 'rel', src: 'full'};
const LIVE_DAY = 'sang';   // mã ngày trong hash cho phiên dở dang
// Khung nến trong phiên: mặc định 15' (5' nhiều mã chỉ có 2 mức giá/nến — đo 26/09/2026), 5' để phóng to, 30' = kỳ Market Profile.
const TFS = [5, 15, 30];
let TF = 15;
const LS = {get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* riêng tư */ } }};

// ---------------------------------------------------------------- điều hướng
function parseHash() {
  const [tab, sym, day] = location.hash.replace(/^#/, '').split('/');
  return {tab: ['list', 'day', 'days', 'nlkq', 'guide'].includes(tab) ? tab : 'list', sym: sym || null, day: day || null};
}
function go(tab, sym, day) {
  const h = '#' + [tab, sym, day].filter(Boolean).join('/');
  if (location.hash !== h) location.hash = h; else route();
}
window.addEventListener('hashchange', route);
async function route() {
  const h = parseHash();
  S.tab = h.tab;
  if (h.sym) S.sym = h.sym.toUpperCase();
  if (h.day) S.day = h.day;
  document.querySelectorAll('section.tab').forEach(s => s.classList.toggle('on', s.id === 't-' + S.tab));
  document.querySelectorAll('nav.tabs a').forEach(a => {
    a.classList.toggle('on', a.dataset.tab === S.tab);
    a.href = '#' + a.dataset.tab + (S.sym && (a.dataset.tab === 'day' || a.dataset.tab === 'days' || a.dataset.tab === 'nlkq') ? '/' + S.sym : '');
  });
  if (S.sym) LS.set('of.sym', S.sym);
  scrollTo(0, 0);
  try {
    if (S.tab === 'list') renderList();
    else if (S.tab === 'day') await renderDay(h.day);
    else if (S.tab === 'days') await renderDays();
    else if (S.tab === 'nlkq') await renderNLKQ();
    else renderGuide();
  } catch (e) {
    console.error(e);
  }
}

function fillSymSelect(sel) {
  sel.innerHTML = LATEST.items.map(r => `<option value="${r.sym}">${r.sym}</option>`).join('');
  sel.value = S.sym;
}

// ---------------------------------------------------------------- ① Danh mục
const SORTS = [
  ['rel', 'So TB', (a, b) => (a.rel ?? -1e9) - (b.rel ?? -1e9), true],
  ['share', 'Mua CĐ %', (a, b) => (a.share ?? -1) - (b.share ?? -1), true],
  ['delta', 'Delta', (a, b) => a.delta - b.delta, true],
  ['big', 'Lệnh lớn', (a, b) => a.big - b.big, true],
  ['sig', 'Dấu hiệu', (a, b) => nsig(a) - nsig(b), true],
  ['sym', 'A→Z', (a, b) => a.sym.localeCompare(b.sym), false],
];
const nsig = r => Object.values(r.sig).reduce((s, v) => s + v, 0);
let sortDesc = true;

function spark(cv) {
  if (!cv || cv.length < 2) return '<svg viewBox="0 0 100 26"></svg>';
  const lo = Math.min(0, ...cv), hi = Math.max(0, ...cv), r = hi - lo || 1;
  const y = v => (24 - (v - lo) / r * 22).toFixed(1);
  const pts = cv.map((v, i) => `${(i / (cv.length - 1) * 100).toFixed(1)},${y(v)}`).join(' ');
  const col = cv[cv.length - 1] >= 0 ? 'var(--buy)' : 'var(--sell)';
  return `<svg viewBox="0 0 100 26" preserveAspectRatio="none"><line x1="0" x2="100" y1="${y(0)}" y2="${y(0)}" stroke="rgba(169,180,200,.25)" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>` +
    `<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderList() {
  const live = S.src === 'live' && LIVE, L = live ? LIVE : LATEST, it = L.items;
  $('l-src').innerHTML = LIVE ? [['live', `Sáng nay ${dd(LIVE.day)} · tới ${LIVE.upto}`], ['full', `Phiên đủ ${dd(LATEST.day || '----------')}`]]
    .map(([k, n]) => `<button class="chip ${S.src === k ? 'on' : ''}" data-k="${k}" aria-pressed="${S.src === k}">${n}</button>`).join('') : '';
  $('l-src').querySelectorAll('.chip').forEach(b => b.onclick = () => { S.src = b.dataset.k; renderList(); });
  const today = it.filter(r => r.day === L.day);
  const med = a => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const up = today.filter(r => (r.rel ?? 0) > 0).length;
  const bigNet = today.reduce((s, r) => s + r.big, 0);
  const tiles = [
    ['Phiên', dd(L.day || '----------'), live ? `dở dang · tới ${L.upto}` : (L.day || '').slice(0, 4), live ? 'vw' : ''],
    ['Số mã', `${today.length}/${it.length}`, 'có dữ liệu phiên này', ''],
    ['Mua CĐ trung vị', pct(med(today.map(r => r.share))), 'cả danh mục', ''],
    ['Mua mạnh hơn TB', `${up}/${today.length}`, 'mã có so TB > 0', up * 2 >= today.length ? 'pos' : 'neg'],
    ['Lệnh lớn ròng', smil(bigNet), 'cổ phiếu, lệnh ≥ 500 tr đ', bigNet >= 0 ? 'pos' : 'neg'],
  ];
  $('l-tiles').innerHTML = tiles.map(([k, v, n, c]) =>
    `<div class="tile"><div class="k">${k}</div><div class="v ${c}">${v}</div><div class="n">${n}</div></div>`).join('');
  $('l-sort').innerHTML = SORTS.map(([k, n]) =>
    `<button class="chip ${S.sort === k ? 'on' : ''}" data-k="${k}">${n}${S.sort === k && k !== 'sym' ? (sortDesc ? ' ↓' : ' ↑') : ''}</button>`).join('');
  $('l-sort').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    if (S.sort === b.dataset.k) sortDesc = !sortDesc; else { S.sort = b.dataset.k; sortDesc = SORTS.find(s => s[0] === S.sort)[3]; }
    LS.set('of.sort', S.sort);
    renderList();
  });
  const [, name, cmp] = SORTS.find(s => s[0] === S.sort);
  const rows = [...it].sort((a, b) => sortDesc ? cmp(b, a) : cmp(a, b));
  $('l-title').textContent = `Danh mục${live ? ' · PHIÊN SÁNG (chưa xong)' : ''} · xếp theo ${name} · dấu hiệu khung 15'`;
  $('l-list').innerHTML = rows.map(r => {
    const sigs = Object.entries(r.sig).sort().map(([k, n]) => `<span style="color:${SIG[k].c}" title="${SIG[k].name}">${SIG[k].s}${n > 1 ? n : ''}</span>`).join(' ');
    const stale = r.day !== L.day ? `<span class="tag">phiên ${dd(r.day)}</span>` : '';
    const buyW = r.share == null ? 0 : r.share;
    return `<div class="row" data-sym="${r.sym}" role="button" tabindex="0">
      <div class="sym">${r.sym}<small>${r.ex}</small>${stale}</div>
      <div class="px">${px(r.close)}<small class="${r.chg > 0 ? 'pos' : r.chg < 0 ? 'neg' : ''}">${r.chg == null ? '' : spt(r.chg) + ' %'}</small></div>
      <div class="spark">${spark(r.cvd)}<span class="sigs">${sigs}</span></div>
      <div class="meta">
        <span>Mua CĐ <b>${pct(r.share)}</b></span>
        <span class="bar2" title="mua / bán chủ động"><i style="width:${buyW}%"></i></span>
        <span>so TB <span class="rel ${r.rel > 0 ? 'pos' : r.rel < 0 ? 'neg' : ''}">${spt(r.rel)}</span></span>
        <span>Delta <b class="${r.delta >= 0 ? 'pos' : 'neg'}">${smil(r.delta)}</b></span>
        <span>Lớn <b class="${r.big >= 0 ? 'pos' : 'neg'}">${smil(r.big)}</b></span>
        ${r.no_side ? '<span class="tag">nguồn không có bên CĐ</span>' : ''}
      </div></div>`;
  }).join('') || '<p class="empty">Chưa có dữ liệu.</p>';
  $('l-list').querySelectorAll('.row').forEach(d => {
    const open = () => go('day', d.dataset.sym, live ? LIVE_DAY : null);
    d.onclick = open;
    d.onkeydown = e => { if (e.key === 'Enter') open(); };
  });
}

// ---------------------------------------------------------------- ② Trong phiên
let D = null, V = null, sel = 0, chart = null;   // V = khung đang xem: {bars, sigs}
async function renderDay(wantDay) {
  fillSymSelect($('d-sym'));
  $('d-sym').onchange = () => go('day', $('d-sym').value);
  let daily;
  try { daily = await getJSON(`daily/${S.sym}.json`); } catch (e) { $('d-chart').innerHTML = '<p class="empty">Không tải được dữ liệu mã này.</p>'; return; }
  const days = daily.days.filter(d => d.intraday).map(d => d.d).reverse();
  if (LIVE && LIVE.items.some(r => r.sym === S.sym)) days.unshift(LIVE_DAY);
  if (!days.length) {
    $('d-date').innerHTML = ''; $('d-tiles').innerHTML = ''; $('fp').innerHTML = ''; $('fe-sigs').innerHTML = '';
    $('d-chart').innerHTML = '<p class="empty">Mã này chưa có phiên nào đủ tick để vẽ nến 5 phút.</p>';
    return;
  }
  const day = days.includes(wantDay) ? wantDay : days[0];
  S.day = day;
  $('d-date').innerHTML = days.map(d => d === LIVE_DAY ? `<option value="${d}">Sáng ${dd(LIVE.day)} (dở dang, tới ${LIVE.upto})</option>`
    : `<option value="${d}">Phiên ${dd(d)}/${d.slice(0, 4)}</option>`).join('');
  $('d-date').value = day;
  $('d-date').onchange = () => go('day', S.sym, $('d-date').value);
  try { D = await getJSON(day === LIVE_DAY ? `live/${S.sym}.json` : `intraday/${day}/${S.sym}.json`); } catch (e) {
    $('d-chart').innerHTML = '<p class="empty">Phiên này đã quá 60 phiên hoặc chưa tải được.</p>'; return;
  }
  $('d-pill').textContent = (D.partial ? `PHIÊN SÁNG · tới ${D.upto} · ` : '') + `${fmt(D.ticks)} tick · hụt ${fmt(D.gap)} cp`;
  const T = D.tot, cont = T.buy + T.sell || 1;
  const tiles = [
    ['Mua chủ động', mil(T.buy), `${(T.buy / cont * 100).toFixed(0)} % khớp liên tục`, 'pos'],
    ['Bán chủ động', mil(T.sell), `${(T.sell / cont * 100).toFixed(0)} % khớp liên tục`, 'neg'],
    ['Delta phiên', smil(T.buy - T.sell), 'mua − bán chủ động', T.buy >= T.sell ? 'pos' : 'neg'],
    [D.partial ? 'ATO' : 'ATO + ATC', (T.x / (D.total || 1) * 100).toFixed(0) + ' %', mil(T.x) + ', không tính delta', ''],
    ['Lệnh lớn ròng', smil(T.bb - T.bs), 'lệnh ≥ 500 tr đ', T.bb >= T.bs ? 'pos' : 'neg'],
  ];
  const VW = T.vw || {}, lastBar = D.tf['5'].bars[D.tf['5'].bars.length - 1];
  if (VW.cont) tiles.push(['VWAP phiên', px(VW.cont), `${D.partial ? 'giá cuối' : 'đóng cửa'} ${vsp(lastBar.c, VW.cont)} so VWAP` +
    (VW.all ? ` · gồm ATO/ATC ${px(VW.all)}` : ''), 'vw']);
  tiles.push(['Giá vốn cá mập', VW.bb || VW.bs ? `${VW.bb ? px(VW.bb) : '–'} / ${VW.bs ? px(VW.bs) : '–'}` : '–',
    VW.bb || VW.bs ? 'VWAP lệnh lớn mua / bán CĐ' : 'chưa có cho phiên này', '']);
  $('d-tiles').innerHTML = tiles.map(([k, v, n, c]) =>
    `<div class="tile"><div class="k">${k}</div><div class="v ${c}">${v}</div><div class="n">${n}</div></div>`).join('');
  showTF();
}

function showTF() {
  V = D.tf[String(TF)];
  $('d-tfname').textContent = TF + ' phút';
  $('d-tf').innerHTML = TFS.map(t => `<button class="chip ${t === TF ? 'on' : ''}" data-tf="${t}" aria-pressed="${t === TF}">${t}'</button>`).join('');
  $('d-tf').querySelectorAll('.chip').forEach(b => b.onclick = () => {
    const keep = V.bars[sel] && V.bars[sel].t;
    TF = +b.dataset.tf; LS.set('of.tf', TF);
    showTF();
    // giữ mốc giờ đang xem khi đổi khung: chọn nến chứa mốc đó
    if (keep) { const m = mins(keep), i = V.bars.findIndex((x, k) => !x.auction && mins(x.t) <= m && (k + 1 >= V.bars.length || V.bars[k + 1].auction || mins(V.bars[k + 1].t) > m)); if (i >= 0) select(i); }
  });
  drawIntraday();
  FE.prep();
  const first = V.sigs.length ? V.sigs[V.sigs.length - 1].i
    : V.bars.reduce((m, b, i) => Math.abs(b.d) > Math.abs(V.bars[m].d) ? i : m, 0);
  select(first);
}

function drawIntraday() {
  const host = $('d-chart');
  host.innerHTML = '';
  const B = V.bars;
  const W = Math.max(300, Math.min(720, host.clientWidth || 720)), L = 40, R = 6, yTop = 14;
  const HP = W < 500 ? 190 : 210, HD = 64, HC = 74, GAP = 16;
  const yP0 = yTop, yD0 = yP0 + HP + GAP, yC0 = yD0 + HD + GAP, H = yC0 + HC + 22;
  const cw = (W - L - R) / B.length;
  const xc = i => L + cw * (i + .5);
  const VB = B.map((b, i) => [i, b]).filter(([, b]) => !b.auction && b.vw != null);
  let loP = Math.min(...B.map(b => b.l), ...VB.map(([, b]) => b.vw - 2 * b.sd)),
    hiP = Math.max(...B.map(b => b.h), ...VB.map(([, b]) => b.vw + 2 * b.sd));
  const padP = (hiP - loP) * .12 || .5; loP -= padP; hiP += padP;
  const yP = p => yP0 + (hiP - p) / (hiP - loP) * HP;
  const maxD = Math.max(1, ...B.map(b => Math.abs(b.d)));
  const yD = v => yD0 + HD / 2 - v / maxD * (HD / 2);
  const cvs = B.map(b => b.cvd);
  let loC = Math.min(0, ...cvs), hiC = Math.max(0, ...cvs); const padC = (hiC - loC) * .1 || 1; loC -= padC; hiC += padC;
  const yC = v => yC0 + (hiC - v) / (hiC - loC) * HC;
  const svg = el('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Nến 5 phút, delta và CVD'}, host);
  const gSel = el('g', {}, svg);
  const hgrid = (y, label) => { el('line', {x1: L, x2: W - R, y1: y, y2: y, stroke: 'var(--grid)'}, svg); el('text', {x: L - 4, y: y + 3, 'text-anchor': 'end'}, svg, label); };
  const rng = hiP - loP;
  const step = rng > 12 ? 5 : rng > 6 ? 2 : rng > 3 ? 1 : rng > 1.2 ? .5 : rng > .5 ? .2 : .1;
  for (let p = Math.ceil(loP / step) * step; p <= hiP; p += step) hgrid(yP(p), px(+p.toFixed(2)));
  if (D.cf) for (const [v, n] of [[D.cf[0], 'sàn'], [D.cf[1], 'trần']]) if (v > loP && v < hiP) {
    el('line', {x1: L, x2: W - R, y1: yP(v), y2: yP(v), stroke: 'var(--warn)', 'stroke-dasharray': '4 3'}, svg);
    el('text', {x: W - R, y: yP(v) - 3, 'text-anchor': 'end', fill: 'var(--warn)'}, svg, n + ' ' + px(v));
  }
  if (D.ref && D.ref > loP && D.ref < hiP) {
    el('line', {x1: L, x2: W - R, y1: yP(D.ref), y2: yP(D.ref), stroke: 'var(--gold)', 'stroke-dasharray': '2 4', opacity: .7}, svg);
    el('text', {x: W - R, y: yP(D.ref) - 3, 'text-anchor': 'end', style: 'fill:var(--gold)'}, svg, 'TC ' + px(D.ref));
  }
  el('line', {x1: L, x2: W - R, y1: yD(0), y2: yD(0), stroke: 'var(--line)'}, svg);
  el('text', {x: L - 4, y: yD0 + 8, 'text-anchor': 'end'}, svg, 'Delta');
  el('text', {x: L - 4, y: yD0 + HD / 2 + 3, 'text-anchor': 'end'}, svg, '0');
  el('text', {x: L - 4, y: yC0 + 8, 'text-anchor': 'end'}, svg, 'CVD');
  el('line', {x1: L, x2: W - R, y1: yC(0), y2: yC(0), stroke: 'var(--line)'}, svg);
  // VWAP khớp liên tục: dải ±1σ tô nhạt, ±2σ nét đứt, đường VWAP — vẽ dưới nến
  if (VB.length > 1) {
    const pts = f => VB.map(([i, b]) => xc(i).toFixed(1) + ' ' + yP(f(b)).toFixed(1));
    el('path', {d: 'M' + pts(b => b.vw + b.sd).join('L') + 'L' + pts(b => b.vw - b.sd).reverse().join('L') + 'Z', fill: 'var(--vwap-band)'}, svg);
    for (const k of [2, -2]) el('path', {d: 'M' + pts(b => b.vw + k * b.sd).join('L'), fill: 'none', stroke: 'var(--vwap)',
      'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: .6}, svg);
    el('path', {d: 'M' + pts(b => b.vw).join('L'), fill: 'none', stroke: 'var(--vwap)', 'stroke-width': 1.8, 'stroke-linejoin': 'round'}, svg);
    const [li, lb] = VB[VB.length - 1];
    el('text', {x: xc(li) - 4, y: yP(lb.vw + 2 * lb.sd) - 4, 'text-anchor': 'end', style: 'fill:var(--vwap);font-weight:600'}, svg, 'VWAP ' + px(lb.vw));
  }
  B.forEach((b, i) => {
    const col = b.auction ? 'var(--x)' : b.c >= b.o ? 'var(--buy)' : 'var(--sell)';
    el('line', {x1: xc(i), x2: xc(i), y1: yP(b.h), y2: yP(b.l), stroke: col}, svg);
    const bw = Math.max(1.5, cw * .62);
    const y1 = yP(Math.max(b.o, b.c)), y2 = yP(Math.min(b.o, b.c));
    el('rect', {x: xc(i) - bw / 2, y: y1, width: bw, height: Math.max(1.2, y2 - y1), fill: col, rx: .6}, svg);
    if (!b.auction) el('rect', {x: xc(i) - bw / 2, y: Math.min(yD(b.d), yD(0)), width: bw, height: Math.max(.8, Math.abs(yD(b.d) - yD(0))),
      fill: b.d >= 0 ? 'var(--buy)' : 'var(--sell)', rx: .6}, svg);
    else el('rect', {x: xc(i) - bw / 2, y: yD(0) - 1, width: bw, height: 2, fill: 'var(--x)'}, svg);
    let ob = 0, oa = 0;
    for (const k of b.sig) {
      const s = SIG[k];
      const y = s.below ? yP(b.l) + 12 + ob++ * 11 : yP(b.h) - 5 - oa++ * 11;
      el('text', {x: xc(i), y, 'text-anchor': 'middle', style: `fill:${s.c};font-size:11px;font-weight:700`}, svg, s.s);
    }
  });
  el('path', {d: B.map((b, i) => (i ? 'L' : 'M') + xc(i).toFixed(1) + ' ' + yC(b.cvd).toFixed(1)).join(''),
    fill: 'none', stroke: 'var(--gold2)', 'stroke-width': 1.8, 'stroke-linejoin': 'round'}, svg);
  el('text', {x: W - R, y: yC(B[B.length - 1].cvd) - 5, 'text-anchor': 'end', style: 'fill:var(--gold2)'}, svg, smil(B[B.length - 1].cvd));
  B.forEach((b, i) => {
    if (b.auction || (W < 500 && TF === 5 ? /^(10:00|11:00|13:30|14:00)$/ : /^(09:30|10:00|10:30|11:00|13:00|13:30|14:00)$/).test(b.t))
      el('text', {x: xc(i), y: H - 6, 'text-anchor': 'middle'}, svg, b.t);
  });
  const selRect = el('rect', {y: yTop - 6, height: H - 22 - yTop + 6, width: cw, fill: 'var(--sel)', rx: 2}, gSel);
  B.forEach((b, i) => {
    const r = el('rect', {x: L + cw * i, y: 0, width: cw, height: H, fill: 'transparent', style: 'cursor:pointer'}, svg);
    el('title', {}, r, `${b.t} · delta ${sgn(b.d)} · CVD ${sgn(b.cvd)}` + (b.vw != null ? ` · VWAP ${px(b.vw)}` : ''));
    r.addEventListener('click', () => select(i));
  });
  chart = {selRect, L, cw};
}

const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function label(b) {
  if (b.auction) return b.t === 'ATO' ? 'ATO 09:00–09:15' : 'ATC 14:30–14:45';
  // hết khung = mốc đồng hồ kế tiếp (09:15 ở khung 30' → 09:30); nghỉ trưa 11:30, hết khớp liên tục 14:30
  let e = (Math.floor(mins(b.t) / TF) + 1) * TF;
  if (mins(b.t) < 690) e = Math.min(e, 690); else e = Math.min(e, 870);
  return `${b.t}–${String(e / 60 | 0).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
}
function select(i) {
  const B = V.bars;
  sel = Math.max(0, Math.min(B.length - 1, i));
  const b = B[sel];
  if (chart) chart.selRect.setAttribute('x', chart.L + chart.cw * sel);
  $('fp-title').textContent = 'Nến ' + label(b);
  $('fp-ohlc').innerHTML = `M ${px(b.o)} · C ${px(b.h)} · T ${px(b.l)} · Đ ${px(b.c)} · KL ${fmt(b.vol)} · ` +
    (b.auction ? 'khớp định kỳ, không có bên chủ động' : `delta <b class="${b.d >= 0 ? 'pos' : 'neg'}">${sgn(b.d)}</b>`) +
    (b.vw != null ? `<br><span class="vw">VWAP tới nến này ${px(b.vw)} ± ${px(b.sd)}</span> · giá đóng ${vsp(b.c, b.vw)}` : '');
  const near = b.vw == null || !b.lv.length ? null : b.lv.reduce((m, r) => Math.abs(r[0] - b.vw) < Math.abs(m - b.vw) ? r[0] : m, b.lv[0][0]);
  const mx = Math.max(1, ...b.lv.map(r => Math.max(r[1], r[2], r[3])));
  const imb = new Set(b.imb.map(([p, s]) => p + '|' + s));
  let h = '<tr><th style="text-align:left">Giá</th><th style="text-align:right">Bán</th><th style="text-align:center">bán × mua</th><th style="text-align:left">Mua</th><th>Delta</th></tr>';
  for (const [p, s, bu, x] of b.lv) {
    const poc = p === b.poc, iS = imb.has(p + '|s'), iB = imb.has(p + '|b');
    const pair = b.auction ? `<span>${fmt(x)}</span>` : `<span class="s">${fmt(s)}</span> × <span class="b">${fmt(bu)}</span>`;
    const d = bu - s;
    h += `<tr class="${poc ? 'poc' : ''}"><td class="p${p === near ? ' vwr' : ''}"${p === near ? ' title="Mức gần VWAP nhất"' : ''}>${px(p)}${poc ? '<span class="mark">●</span>' : ''}</td>` +
      `<td class="bar ${iS ? 'imbS' : ''}"><div class="bs" style="width:${(b.auction ? 0 : s / mx * 100).toFixed(1)}%"></div></td>` +
      `<td class="pair">${pair}</td>` +
      `<td class="bar ${iB ? 'imbB' : ''}"><div class="bb" style="width:${((b.auction ? x : bu) / mx * 100).toFixed(1)}%;${b.auction ? 'background:var(--x)' : ''}"></div></td>` +
      `<td class="${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${b.auction ? '' : sgn(d)}</td></tr>`;
  }
  $('fp').innerHTML = h;
  const sigs = V.sigs.filter(s => s.i === sel);
  const imbTxt = b.imb.length ? `<li><b>■ ${b.imb.length} ô imbalance</b>: ${b.imb.map(([p, s]) => (s === 'b' ? 'mua ' : 'bán ') + px(p)).join(', ')}</li>` : '';
  $('fp-sigs').innerHTML = sigs.map(s => `<li>${sigTag(s.kind)}: ${esc(s.text)}</li>`).join('') + imbTxt ||
    '<li class="empty">Nến này không có dấu hiệu nào được đánh.</li>';
  $('fp-prev').disabled = sel === 0; $('fp-next').disabled = sel === B.length - 1;
  FE.draw();
}
$('fp-prev').onclick = () => select(sel - 1);
$('fp-next').onclick = () => select(sel + 1);
document.addEventListener('keydown', e => {
  if (S.tab !== 'day' || !D || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowLeft') select(sel - 1);
  if (e.key === 'ArrowRight') select(sel + 1);
});

// ---------------------------------------------------------------- ② Trong phiên: nỗ lực – kết quả & cá mập
// 29/09/2026, chép từ bản mẫu c:\Claude code\footprint-er-lab người dùng duyệt. Gói trong FE để không đụng tên của app.
// Nến đang chọn dùng chung `sel` của app: bấm ở đâu cũng gọi select(i); select() gọi FE.draw().
const FE = (() => {
  const F = {tf: 15, i: null, thr: +LS.get('of.fe.thr') || 15};
  let BARS = [], BASE_SH = 0, AVG_V = 1, EX = 'HOSE';
  const s1 = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('vi-VN', {maximumFractionDigits: 1});
  const tickSize = (p, ex) => (ex || 'HOSE').toUpperCase() !== 'HOSE' ? .1 : p < 10 ? .01 : p < 50 ? .05 : .1;
  const eq = (a, b) => Math.abs(a - b) < 1e-6;

  const LAB = {
    okb:  ['Mua có kết quả', 'var(--buy)', 'Mua chủ động mạnh và giá đóng ở nửa trên nến.'],
    absb: ['Mua bị hấp thụ', 'var(--warn)', 'Mua chủ động mạnh mà giá đóng ở nửa dưới: có người bán đặt chờ chặn phía trên.'],
    oks:  ['Bán có kết quả', 'var(--sell)', 'Bán chủ động mạnh và giá đóng ở nửa dưới nến.'],
    abss: ['Bán bị hấp thụ', 'var(--vwap)', 'Bán chủ động mạnh mà giá đóng ở nửa trên: có người mua đặt chờ nuốt lệnh bán.'],
    free: ['Giá chạy không cần lực', 'var(--free)', 'Delta gần mức thường của phiên nhưng giá đi rõ một chiều.'],
    quiet:['Giằng co', 'var(--quiet)', 'Nỗ lực không nổi bật, giá cũng không đi đâu.'],
  };

  // ---------------------------------------------------------------- tính nỗ lực / kết quả từng nến
  function prep() {
    BARS = D.tf[String(F.tf)].bars.map((b, k) => ({...b, k})).filter(b => !b.auction);
    const act = BARS.reduce((a, b) => a + b.buy + b.sell, 0) || 1;
    BASE_SH = BARS.reduce((a, b) => a + b.d, 0) / act * 100;
    AVG_V = act / (BARS.length || 1);
    for (const b of BARS) {
      const a = b.buy + b.sell;
      b.sh = a ? b.d / a * 100 : 0;
      b.E = b.sh - BASE_SH;                                   // nỗ lực so TB phiên (điểm %)
      b.rel = a / AVG_V;
      b.CL = b.h > b.l ? (b.c - b.l) / (b.h - b.l) * 2 - 1 : 0; // −1 đóng đáy … +1 đóng đỉnh
      b.mv = Math.round((b.c - b.o) / tickSize(b.h, EX));
      const strong = Math.abs(b.E) >= F.thr && b.rel >= .5;
      const rngT = Math.round((b.h - b.l) / tickSize(b.h, EX));
      b.lab = strong ? (b.E > 0 ? (b.CL > 0 ? 'okb' : 'absb') : (b.CL < 0 ? 'oks' : 'abss'))
                     : (rngT >= 2 && Math.abs(b.CL) >= .5 ? 'free' : 'quiet');
      if (strong && b.CL === 0) b.lab = 'quiet';
    }
  }

  // dấu hiệu có mức/vùng + vòng đời (xét các nến sau trong phiên)
  function levels(b) {
    const out = [], step = tickSize(b.h, EX), after = BARS.filter(x => x.k > b.k);
    const lowRow = b.lv[b.lv.length - 1], highRow = b.lv[0];
    const fate = (brk, test) => {
      const j = after.find(brk);
      if (j) return {st: 'bad', txt: `bị phá lúc ${j.t}`, at: j};
      const n = after.filter(test).length;
      return n ? {st: 'ok', txt: `giữ được (test ${n} lần)`} : {st: 'wait', txt: after.length ? 'chưa test lại' : 'nến cuối phiên'};
    };
    for (const kind of b.sig) {
      if (kind === 'absorb_b') {
        const p = lowRow[1] >= .4 * b.vol ? lowRow[0] : b.l;
        out.push({kind, side: 'up', lo: p, hi: p, name: 'Hấp thụ lệnh bán', txt: `Mức đỡ ${px(p)}: bán dồn mà giá không thủng.`,
          f: fate(x => x.l < p - 1e-9, x => x.l <= p + step + 1e-9)});
      } else if (kind === 'absorb_s') {
        const p = highRow[2] >= .4 * b.vol ? highRow[0] : b.h;
        out.push({kind, side: 'down', lo: p, hi: p, name: 'Hấp thụ lệnh mua', txt: `Mức chặn ${px(p)}: mua dồn mà giá không vượt.`,
          f: fate(x => x.h > p + 1e-9, x => x.h >= p - step - 1e-9)});
      } else if (kind === 'stack_b' || kind === 'stack_s') {
        const sd = kind === 'stack_b' ? 'b' : 's';
        const ps = b.imb.filter(r => r[1] === sd).map(r => r[0]).sort((a, c) => a - c);
        let best = [], run = [];
        for (const p of ps) { if (run.length && p - run[run.length - 1] > step + 1e-9) run = []; run.push(p); if (run.length > best.length) best = [...run]; }
        if (best.length < 2) continue;
        const lo = best[0], hi = best[best.length - 1];
        if (sd === 's') {
          const inCandle = b.c > hi + 1e-9;
          out.push({kind, side: 'down', lo, hi, name: `Imbalance bán xếp chồng ${best.length} ô`, txt: `Vùng kháng cự ${px(lo)}–${px(hi)}.`,
            f: inCandle ? {st: 'bad', txt: 'bị vượt ngay trong nến'} : fate(x => x.c > hi + 1e-9, x => x.h >= lo - 1e-9)});
        } else {
          const inCandle = b.c < lo - 1e-9;
          out.push({kind, side: 'up', lo, hi, name: `Imbalance mua xếp chồng ${best.length} ô`, txt: `Vùng hỗ trợ ${px(lo)}–${px(hi)}.`,
            f: inCandle ? {st: 'bad', txt: 'bị thủng ngay trong nến'} : fate(x => x.c < lo - 1e-9, x => x.l <= hi + 1e-9)});
        }
      } else if (kind === 'exh_b') {
        out.push({kind, side: 'up', lo: b.l, hi: b.l, name: 'Cạn kiệt bán', txt: `Đáy ${px(b.l)} gần như không ai bán tiếp.`,
          f: fate(x => x.l < b.l - 1e-9, x => x.l <= b.l + step + 1e-9)});
      } else if (kind === 'exh_s') {
        out.push({kind, side: 'down', lo: b.h, hi: b.h, name: 'Cạn kiệt mua', txt: `Đỉnh ${px(b.h)} gần như không ai mua tiếp.`,
          f: fate(x => x.h > b.h + 1e-9, x => x.h >= b.h - step - 1e-9)});
      } else if (kind === 'fail_b') out.push({kind, side: 'down', name: 'Hấp thụ mua thất bại', txt: 'Giá thủng mức hấp thụ của nến trước: bên đỡ giá đã thua.', f: null});
      else if (kind === 'fail_s') out.push({kind, side: 'up', name: 'Hấp thụ bán thất bại', txt: 'Giá vượt mức chặn của nến trước: bên chặn đã thua.', f: null});
      else if (kind === 'div_b') out.push({kind, side: 'up', name: 'Phân kỳ đáy', txt: 'Giá thủng đáy nhưng CVD cao hơn: lực bán yếu dần.', f: null});
      else if (kind === 'div_s') out.push({kind, side: 'down', name: 'Phân kỳ đỉnh', txt: 'Giá vượt đỉnh nhưng CVD thấp hơn: lực mua yếu dần.', f: null});
    }
    return out;
  }

  // ---------------------------------------------------------------- ③ dải cả phiên
  function drawStrip() {
    const host = $('fe-strip'); host.innerHTML = '';
    const W = Math.max(320, host.clientWidth), n = BARS.length, L = 40, R = 6;
    const HP = 150, HE = 90, T = 8, yp0 = T, ye0 = yp0 + HP + 22, yl0 = ye0 + HE + 20, H = yl0 + 40;
    const cw = (W - L - R) / n;
    const lo = Math.min(...BARS.map(b => b.l)), hi = Math.max(...BARS.map(b => b.h)), pad = (hi - lo) * .08 || .1;
    const yP = p => yp0 + (hi + pad - p) / (hi - lo + 2 * pad) * HP;
    const s = el('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Nến giá, nỗ lực và kết quả từng nến trong phiên'}, host);
    // lưới giá
    const st = tickSize(hi, EX) * Math.max(1, Math.round((hi - lo) / tickSize(hi, EX) / 5));
    for (let p = Math.ceil((lo - pad) / st) * st; p <= hi + pad; p += st) {
      el('line', {x1: L, x2: W - R, y1: yP(p), y2: yP(p), stroke: 'var(--grid)'}, s);
      el('text', {x: L - 4, y: yP(p) + 3, 'text-anchor': 'end'}, s, px(+p.toFixed(2)));
    }
    // VWAP luỹ kế
    const vw = BARS.filter(b => b.vw != null);
    if (vw.length > 1) el('path', {d: vw.map((b, j) => (j ? 'L' : 'M') + (L + cw * (BARS.indexOf(b) + .5)).toFixed(1) + ' ' + yP(b.vw).toFixed(1)).join(''), fill: 'none', stroke: 'var(--vwap)', 'stroke-width': 1.2, 'stroke-dasharray': '4 3', opacity: .8}, s);
    const mE = Math.max(F.thr * 1.5, ...BARS.map(b => Math.abs(b.E)));
    const yE = v => ye0 + HE / 2 - v / mE * HE / 2, yR = v => ye0 + HE / 2 - v * HE / 2;
    el('line', {x1: L, x2: W - R, y1: yE(0), y2: yE(0), stroke: 'var(--line2)'}, s);
    for (const g of [1, -1]) el('line', {x1: L, x2: W - R, y1: yE(g * F.thr), y2: yE(g * F.thr), stroke: 'var(--gold3)', 'stroke-dasharray': '2 4', opacity: .6}, s);
    el('text', {x: L - 4, y: ye0 + 8, 'text-anchor': 'end', style: 'fill:var(--gold2)'}, s, 'nỗ lực');
    el('text', {x: L - 4, y: ye0 + 20, 'text-anchor': 'end', style: 'fill:var(--ink)'}, s, 'kết quả');
    BARS.forEach((b, j) => {
      const cx = L + cw * (j + .5), bw = Math.max(2, Math.min(14, cw * .5)), up = b.c >= b.o, col = up ? 'var(--buy)' : 'var(--sell)';
      const g = el('g', {style: 'cursor:pointer'}, s);
      el('rect', {x: cx - cw / 2, y: T, width: cw, height: H - T, fill: 'transparent'}, g);
      if (b.k === F.i) el('rect', {x: cx - cw / 2 + 1, y: T, width: cw - 2, height: H - T - 2, rx: 6, fill: 'rgba(212,175,106,.10)', stroke: 'var(--gold)', 'stroke-width': 1}, g);
      el('line', {x1: cx, x2: cx, y1: yP(b.h), y2: yP(b.l), stroke: col}, g);
      el('rect', {x: cx - bw / 2, y: yP(Math.max(b.o, b.c)), width: bw, height: Math.max(1.5, Math.abs(yP(b.o) - yP(b.c))), fill: col}, g);
      if (b.lab === 'abss' || b.lab === 'absb') {
        const cy = b.lab === 'abss' ? yP(b.l) + 10 : yP(b.h) - 10;
        el('circle', {cx, cy, r: 6, fill: 'none', stroke: LAB[b.lab][1], 'stroke-width': 2}, g);
      }
      const w2 = Math.max(2, Math.min(10, cw * .28));
      el('rect', {x: cx - w2 - .5, y: Math.min(yE(b.E), yE(0)), width: w2, height: Math.max(1, Math.abs(yE(b.E) - yE(0))), fill: 'var(--gold2)', rx: 1}, g);
      el('rect', {x: cx + .5, y: Math.min(yR(b.CL), yR(0)), width: w2, height: Math.max(1, Math.abs(yR(b.CL) - yR(0))), fill: 'var(--ink)', rx: 1}, g);
      el('rect', {x: cx - cw * .42, y: yl0, width: cw * .84, height: 14, rx: 4, fill: LAB[b.lab][1]}, g);
      if (cw > 34 || j % 2 === 0) el('text', {x: cx, y: yl0 + 30, 'text-anchor': 'middle', style: `font-size:${cw > 40 ? 10.5 : 9}px;fill:${b.k === F.i ? 'var(--gold2)' : 'var(--mute)'};font-weight:${b.k === F.i ? 700 : 400}`}, g, b.t);
      el('title', {}, g, `${b.t} · ${LAB[b.lab][0]}\nnỗ lực ${s1(b.E)} điểm so TB (delta ${s1(b.sh)} % KL)\ngiá đóng ${b.CL >= 0 ? 'nửa trên' : 'nửa dưới'} nến, ${b.mv >= 0 ? '+' : ''}${b.mv} bước`);
      g.addEventListener('click', () => { select(b.k); });
    });
    $('fe-legend').innerHTML = Object.values(LAB).map(([t, c]) => `<span><i style="background:${c}"></i>${t}</span>`).join('') +
      '<span><i style="background:var(--gold2)"></i>nỗ lực</span><span><i style="background:var(--ink)"></i>kết quả</span><span><i style="background:var(--vwap);height:2px;vertical-align:3px"></i>VWAP</span>';
  }

  // ---------------------------------------------------------------- ① phán quyết
  function drawVerdict() {
    const b = BARS.find(x => x.k === F.i);
    if (!b) { $('fe-verdict').innerHTML = '<p class="empty">Nến khớp định kỳ (ATO/ATC): không có bên chủ động, không đánh giá nỗ lực.</p>'; return; }
    const [ln, lc, ld] = LAB[b.lab];
    const tf = F.tf, t2 = (() => { const [h, m] = b.t.split(':').map(Number), x = h * 60 + m + tf; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); })();
    const buyPct = (b.buy / ((b.buy + b.sell) || 1)) * 100;
    const clPct = (b.CL + 1) / 2 * 100;
    const whale = b.bb + b.bs ? `Cá mập (lệnh ≥ 500 tr đ): mua ${fmt(b.bb)} · bán ${fmt(b.bs)} → <b class="${b.bb - b.bs >= 0 ? 'pos' : 'neg'}">${sgn(b.bb - b.bs)}</b> cp.` : 'Không có lệnh cá mập trong nến.';
    const lv = levels(b);
    // sau đó: giá đóng của 1, 2, 4 nến sau
    const idx = BARS.indexOf(b), fut = [1, 2, 4].map(k => BARS[idx + k]).filter(Boolean);
    const aft = fut.map(x => `${x.t}: ${px(x.c)} (${x.c >= b.c ? '+' : ''}${Math.round((x.c - b.c) / tickSize(b.h, EX))} bước)`).join(' · ');
    const key = lv.filter(x => x.f && (x.kind.startsWith('absorb') || x.kind.startsWith('stack') || x.kind.startsWith('exh')));
    const agree = b.lab === 'abss' || b.lab === 'okb' ? 'up' : b.lab === 'absb' || b.lab === 'oks' ? 'down' : null;
    let outcome = '';
    if (agree && fut.length) {
      const last = fut[fut.length - 1], good = agree === 'up' ? last.c > b.c : last.c < b.c;
      outcome = `<li><b>Kết quả sau ${fut.length === 3 ? 4 : fut.length} nến:</b> nến gợi ý giá ${agree === 'up' ? 'lên' : 'xuống'}, thực tế giá ${last.c > b.c ? 'lên' : last.c < b.c ? 'xuống' : 'đứng'} → ` +
        `<span class="stag ${good ? 'sg-ok' : 'sg-bad'}">${good ? '✓ đúng hướng' : '✕ ngược hướng'}</span></li>`;
    }
    $('fe-verdict').innerHTML = `
      <div class="vhead"><span class="t">Nến ${b.t}–${t2}</span>
        <span class="ohlc">Mở ${px(b.o)} · Cao ${px(b.h)} · Thấp ${px(b.l)} · Đóng ${px(b.c)} · KL ${fmt(b.buy + b.sell)} (${b.rel.toFixed(1).replace('.', ',')}× TB nến)</span></div>
      <div class="duel">
        <div class="side">
          <div class="k">Nỗ lực</div>
          <div class="big ${b.d >= 0 ? 'pos' : 'neg'}">${b.d >= 0 ? '▲ MUA' : '▼ BÁN'} ${sgn(b.d)}</div>
          <div class="sub">delta ${s1(b.sh)} % KL · TB phiên ${s1(BASE_SH)} % → <b class="${b.E >= 0 ? 'pos' : 'neg'}">${s1(b.E)} điểm</b> ${Math.abs(b.E) >= F.thr ? '(mạnh)' : '(thường)'}</div>
          <div class="meter" title="Tỷ lệ mua chủ động"><i style="left:0;width:${100 - buyPct}%;background:var(--sell)"></i><i style="right:0;width:${buyPct}%;background:var(--buy)"></i><i class="mid"></i></div>
          <div class="sub" style="margin-top:3px">bán ${Math.round(100 - buyPct)} % · mua ${Math.round(buyPct)} %</div>
        </div>
        <div class="side">
          <div class="k">Kết quả</div>
          <div class="big ${b.c >= b.o ? 'pos' : 'neg'}">${b.c > b.o ? '▲' : b.c < b.o ? '▼' : '■'} ${b.mv >= 0 ? '+' : ''}${b.mv} bước (${s1((b.c / b.o - 1) * 100)} %)</div>
          <div class="sub">giá đóng ở <b>${Math.round(clPct)} %</b> chiều cao nến (${b.CL > .5 ? 'sát đỉnh' : b.CL > 0 ? 'nửa trên' : b.CL < -.5 ? 'sát đáy' : b.CL < 0 ? 'nửa dưới' : 'giữa'})</div>
          <div class="meter" title="Vị trí giá đóng trong nến"><i style="left:0;width:${clPct}%;background:linear-gradient(90deg,rgba(241,230,208,.15),var(--ink))"></i><i class="mid"></i></div>
          <div class="sub" style="margin-top:3px">thấp ${px(b.l)} ← → cao ${px(b.h)}</div>
        </div>
      </div>
      <div class="label" style="background:${lc}">${b.lab === 'abss' || b.lab === 'absb' ? '◆ ' : ''}${ln.toUpperCase()}: nỗ lực và kết quả ${b.lab === 'abss' || b.lab === 'absb' ? 'NGƯỢC CHIỀU' : b.lab === 'okb' || b.lab === 'oks' ? 'CÙNG CHIỀU' : 'không rõ'}<small>${ld}</small></div>
      <ul class="after">
        <li>${whale}</li>
        ${key.map(x => `<li><b>${x.name}</b> ${x.lo != null ? (x.lo === x.hi ? px(x.lo) : px(x.lo) + '–' + px(x.hi)) : ''}: <span class="stag sg-${x.f.st}">${x.f.st === 'ok' ? '✓' : x.f.st === 'bad' ? '✕' : '…'} ${x.f.txt}</span></li>`).join('')}
        ${aft ? `<li>Giá đóng các nến sau: ${aft}</li>` : ''}
        ${outcome}
      </ul>`;
  }

  // ---------------------------------------------------------------- ② thang giá + vòng đời
  function drawLadder() {
    const b = BARS.find(x => x.k === F.i);
    if (!b) { $('fe-ladder').innerHTML = ''; $('fe-lsigs').innerHTML = ''; return; }
    const lv = levels(b), mx = Math.max(1, ...b.lv.map(r => Math.max(r[1], r[2])));
    const imb = new Set(b.imb.map(([p, s]) => s + p.toFixed(3)));
    const statusAt = p => lv.filter(x => x.lo != null && p >= x.lo - 1e-9 && p <= x.hi + 1e-9)
      .map(x => `<span class="stag sg-${x.f.st}" title="${x.name}: ${x.f.txt}">${x.kind.startsWith('absorb') ? '◆' : x.kind.startsWith('stack') ? '≡' : '▽'} ${x.f.st === 'ok' ? '✓ giữ' : x.f.st === 'bad' ? '✕ ' + x.f.txt.replace('bị ', '') : '… chưa test'}</span>`).join(' ');
    const closeP = b.lv.reduce((a, r) => Math.abs(r[0] - b.c) < Math.abs(a - b.c) ? r[0] : a, b.lv[0][0]);
    let h = '<table class="fp"><tr><th style="text-align:left">Giá</th><th>Bán</th><th>bán × mua</th><th style="text-align:left">Mua</th><th>Delta</th><th style="text-align:left">Trạng thái</th></tr>';
    for (const [p, sl, by] of b.lv) {
      const iS = imb.has('s' + p.toFixed(3)), iB = imb.has('b' + p.toFixed(3));
      h += `<tr class="${eq(p, b.poc) ? 'poc' : ''}"><td class="p">${px(p)}${eq(p, closeP) ? ' <span class="gold" title="giá đóng">◀</span>' : ''}${eq(p, b.poc) ? ' •' : ''}</td>` +
        `<td class="bar ${iS ? 'imbS' : ''}"><div class="bs" style="width:${sl / mx * 100}%"></div></td>` +
        `<td><span class="neg">${fmt(sl)}</span> × <span class="pos">${fmt(by)}</span></td>` +
        `<td class="bar ${iB ? 'imbB' : ''}"><div class="bb" style="width:${by / mx * 100}%"></div></td>` +
        `<td class="${by - sl >= 0 ? 'pos' : 'neg'}">${sgn(by - sl)}</td><td class="st">${statusAt(p)}</td></tr>`;
    }
    $('fe-ladder').innerHTML = h + '</table><div class="legend"><span>◀ giá đóng</span><span>• POC</span><span><i style="background:var(--buy-soft)"></i>imbalance mua ≥3×</span><span><i style="background:var(--sell-soft)"></i>imbalance bán ≥3×</span></div>';
    // dấu hiệu tách 2 phe
    const card = x => `<div class="sig"><b>${x.name}</b>${x.txt}${x.f ? `<br><span class="stag sg-${x.f.st}">${x.f.st === 'ok' ? '✓' : x.f.st === 'bad' ? '✕' : '…'} ${x.f.txt}</span>` : ''}</div>`;
    const up = lv.filter(x => x.side === 'up'), dn = lv.filter(x => x.side === 'down');
    const alive = a => a.filter(x => !x.f || x.f.st !== 'bad').length;
    const nu = alive(up), nd = alive(dn);
    const sum = !lv.length ? 'Nến không có dấu hiệu theo mức giá.' :
      `Còn hiệu lực: <b class="pos">${nu} ủng hộ tăng</b> · <b class="neg">${nd} ủng hộ giảm</b> → ` +
      (nu > nd ? '<b class="pos">nghiêng TĂNG</b>' : nd > nu ? '<b class="neg">nghiêng GIẢM</b>' : '<b>cân bằng</b>') +
      (lv.some(x => x.f && x.f.st === 'bad') ? ` (đã loại ${lv.filter(x => x.f && x.f.st === 'bad').length} dấu hiệu bị phá)` : '');
    $('fe-lsigs').innerHTML = `<div class="cols"><div class="col"><h4 class="pos">Ủng hộ tăng</h4>${up.map(card).join('') || '<div class="sig note">không có</div>'}</div>` +
      `<div class="col"><h4 class="neg">Ủng hộ giảm</h4>${dn.map(card).join('') || '<div class="sig note">không có</div>'}</div></div><div class="sum">${sum}</div>`;
  }

  // ---------------------------------------------------------------- ④ ma trận
  function drawQuad() {
    const host = $('fe-quad'); host.innerHTML = '';
    const W = Math.max(320, host.clientWidth), H = Math.round(Math.min(360, Math.max(240, W * .42))), L = 40, R = 10, T = 10, B = 28;
    const mx = Math.max(F.thr * 1.5, ...BARS.map(b => Math.abs(b.E))) * 1.1;
    const X = v => L + (v + mx) / (2 * mx) * (W - L - R), Y = v => T + (1.1 - v) / 2.2 * (H - T - B);
    const s = el('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Ma trận nỗ lực và kết quả các nến'}, host);
    const zone = (x0, x1, y0, y1, c, t, ax, ay, an) => { el('rect', {x: X(x0), y: Y(y1), width: X(x1) - X(x0), height: Y(y0) - Y(y1), fill: c, opacity: .08}, s);
      el('text', {x: ax, y: ay, 'text-anchor': an, style: `fill:${c};font-weight:600;opacity:.9`}, s, t); };
    zone(F.thr, mx, 0, 1.1, 'var(--buy)', 'mua có kết quả', W - R - 4, T + 12, 'end');
    zone(F.thr, mx, -1.1, 0, 'var(--warn)', 'mua bị hấp thụ', W - R - 4, H - B - 5, 'end');
    zone(-mx, -F.thr, 0, 1.1, 'var(--vwap)', 'bán bị hấp thụ', L + 4, T + 12, 'start');
    zone(-mx, -F.thr, -1.1, 0, 'var(--sell)', 'bán có kết quả', L + 4, H - B - 5, 'start');
    el('line', {x1: X(0), x2: X(0), y1: T, y2: H - B, stroke: 'var(--line2)'}, s);
    el('line', {x1: L, x2: W - R, y1: Y(0), y2: Y(0), stroke: 'var(--line2)'}, s);
    for (const v of [-F.thr, F.thr]) el('line', {x1: X(v), x2: X(v), y1: T, y2: H - B, stroke: 'var(--gold3)', 'stroke-dasharray': '2 4'}, s);
    for (const v of [-1, 1]) el('text', {x: L - 4, y: Y(v) + 3, 'text-anchor': 'end'}, s, v > 0 ? 'đỉnh' : 'đáy');
    el('text', {x: W - R, y: H - 4, 'text-anchor': 'end'}, s, 'nỗ lực: delta % KL so TB phiên (điểm) →');
    el('text', {x: X(-F.thr), y: H - B + 12, 'text-anchor': 'middle'}, s, s1(-F.thr));
    el('text', {x: X(F.thr), y: H - B + 12, 'text-anchor': 'middle'}, s, s1(F.thr));
    for (const b of BARS) {
      const on = b.k === F.i, r = 3 + Math.min(6, b.rel * 2.5);
      const g = el('g', {style: 'cursor:pointer'}, s);
      el('circle', {cx: X(b.E), cy: Y(b.CL), r: on ? r + 3 : r, fill: LAB[b.lab][1], stroke: on ? 'var(--gold2)' : '#0B1628', 'stroke-width': on ? 2.5 : 1, opacity: on ? 1 : .85}, g);
      if (on || W > 700) el('text', {x: X(b.E) + r + 3, y: Y(b.CL) - r, style: `fill:${on ? 'var(--gold2)' : 'var(--dim)'};font-size:${on ? 11.5 : 9.5}px;font-weight:${on ? 700 : 400}`}, g, b.t);
      el('title', {}, g, `${b.t}: ${LAB[b.lab][0]} · nỗ lực ${s1(b.E)} · KL ${b.rel.toFixed(1)}× TB`);
      g.addEventListener('click', () => { select(b.k); });
    }
  }

  // ---------------------------------------------------------------- 🐋 cá mập trong phiên
  // phía CHỦ ĐỘNG tạo ra dấu hiệu: xếp chồng bán / hấp thụ lệnh bán / cạn kiệt bán đều do bên bán chủ động
  const AGG = {stack_s: 's', absorb_b: 's', exh_b: 's', stack_b: 'b', absorb_s: 'b', exh_s: 'b'};
  const SN = {absorb_b: ['◆', 'Hấp thụ lệnh bán', 'var(--buy)'], absorb_s: ['◆', 'Hấp thụ lệnh mua', 'var(--sell)'],
    fail_b: ['✕', 'Hấp thụ mua thất bại', 'var(--sell)'], fail_s: ['✕', 'Hấp thụ bán thất bại', 'var(--buy)'],
    div_b: ['⚠', 'Phân kỳ đáy', 'var(--buy)'], div_s: ['⚠', 'Phân kỳ đỉnh', 'var(--sell)'],
    exh_b: ['▽', 'Cạn kiệt bán', 'var(--buy)'], exh_s: ['△', 'Cạn kiệt mua', 'var(--sell)'],
    stack_b: ['≡', 'Imbalance mua xếp chồng', 'var(--buy)'], stack_s: ['≡', 'Imbalance bán xếp chồng', 'var(--sell)']};
  const pc0 = v => Math.round(v) + ' %';

  function whaleZones() {
    const out = [];
    for (const b of BARS) for (const z of levels(b)) {
      if (z.lo == null || !AGG[z.kind]) continue;
      const ag = AGG[z.kind], inZ = p => p >= z.lo - 1e-9 && p <= z.hi + 1e-9;
      let vs = 0, vb = 0;
      for (const [p, s, bu] of b.lv) if (inZ(p)) { vs += s; vb += bu; }
      let ws = null, wb = null;
      if (b.blv) { ws = 0; wb = 0; for (const [p, s, bu] of b.blv) if (inZ(p)) { ws += s; wb += bu; } }
      const av = ag === 's' ? vs : vb, aw = ws == null ? null : ag === 's' ? ws : wb;
      const share = aw == null || !av ? null : aw / av * 100;
      const absorb = z.kind.startsWith('absorb') || z.kind.startsWith('exh');
      const st = z.f.st;
      // kết quả nỗ lực của phía chủ động: vùng xếp chồng còn giữ = thắng; mức hấp thụ/cạn kiệt bị xuyên qua = bên chủ động thắng
      const win = absorb ? (st === 'bad' ? true : z.f.txt === 'nến cuối phiên' ? null : false) : st !== 'bad';
      const endK = z.f.at ? z.f.at.k : st === 'bad' ? b.k : null;
      out.push({...z, k: b.k, t: b.t, ag, vs, vb, ws, wb, av, share, whale: share != null && share >= 50, absorb, win, endK, endT: z.f.at ? z.f.at.t : null});
    }
    return out;
  }

  function drawScore(Z) {
    const host = $('fe-score');
    if (!BARS.some(b => b.bb || b.bs)) { host.innerHTML = '<p class="note">Phiên này không có lệnh cá mập nào (lệnh ≥ 500 tr đ).</p>'; return; }
    if (!BARS.some(b => b.blv)) { host.innerHTML = '<p class="note">Phiên này chưa lưu cá mập theo mức giá (có từ 25/09/2026).</p>'; return; }
    const W = Z.filter(z => z.whale), R = Z.filter(z => !z.whale);
    const cell = z => {
      const side = z.ag === 's' ? 'bán' : 'mua', g = SN[z.kind][0];
      const res = z.win == null ? ['open', '…', 'cuối phiên'] : z.win ? ['win', '✓', z.absorb ? `xuyên qua ${z.endT}` : 'giữ'] : ['lose', '✕', z.absorb ? 'bị đỡ lại' : `phá ${z.endT || 'ngay'}`];
      return `<span class="cell ${res[0]}" title="${SN[z.kind][1]} ${px(z.lo)}${z.hi !== z.lo ? '–' + px(z.hi) : ''} · cá mập ${side} ${pc0(z.share)}"><b>${res[1]} ${g}</b>${z.t}<span>${side} ${pc0(z.share)}</span><span>${res[2]}</span></span>`;
    };
    const half = (lab, arr) => {
      const dec = arr.filter(z => z.win != null), w = dec.filter(z => z.win).length;
      const v = !arr.length ? '<span class="note">cá mập không ra tay</span>' : !dec.length ? '<span class="note">chưa rõ</span>' :
        w / dec.length >= 2 / 3 ? `<span class="sc-v pos">${w}/${dec.length} → nỗ lực ĐẠT</span>` : w / dec.length <= 1 / 3 ? `<span class="sc-v neg">${w}/${dec.length} → KHÔNG ĐẠT</span>` : `<span class="sc-v" style="color:var(--warn)">${w}/${dec.length} → lẫn lộn</span>`;
      return `<div class="sc-row"><span class="lb">${lab}</span>${arr.map(cell).join('')}${v}</div>`;
    };
    const am = W.filter(z => z.t < '12:00'), pm = W.filter(z => z.t >= '12:00');
    const cnt = s => { const a = W.filter(z => z.ag === s), d = a.filter(z => z.win != null); return a.length ? `${a.length} lần: <b class="pos">✓ ${d.filter(z => z.win).length}</b> · <b class="neg">✕ ${d.filter(z => !z.win).length}</b>` : '0 lần'; };
    const losses = W.filter(z => z.win === false && z.endT).map(z => z.endT);
    host.innerHTML = `<div class="big-line">Cá mập <b class="neg">BÁN</b> ra tay ${cnt('s')} &nbsp;·&nbsp; Cá mập <b class="pos">MUA</b> ra tay ${cnt('b')}</div>` +
      half('Sáng', am) + half('Chiều', pm) +
      (losses.length ? `<p class="hint" style="margin:4px 0 0">Vùng cá mập bị phá lúc: <b class="gold">${[...new Set(losses)].sort().join(', ')}</b>: thời điểm cá mập mất kiểm soát giá.</p>` : '') +
      (R.length ? `<div class="sc-row"><span class="lb">Nhỏ lẻ</span>${R.map(cell).join('').replace(/cell (win|lose|open)/g, 'cell retail')}<span class="note">dấu hiệu do nhỏ lẻ (cá mập &lt; 50 %), không tính điểm</span></div>` : '');
  }

  // trục ngang chung của bản đồ và đường nỗ lực: cột theo nến
  function wGeom(host) {
    const W = Math.max(320, host.clientWidth), L = 40, R = 26, cw = (W - L - R) / BARS.length;
    const idx = new Map(BARS.map((b, j) => [b.k, j]));
    return {W, L, R, cw, idx, cx: k => L + cw * (idx.get(k) + .5)};
  }
  function drawZoneMap(Z) {
    const host = $('fe-map'); host.innerHTML = '';
    const g = wGeom(host), {W, L, R, cw, cx} = g, H = 300, T = 8, B = 22;
    const step = tickSize(BARS[0].h, EX);
    const lo = Math.min(...BARS.map(b => b.l)) - step, hi = Math.max(...BARS.map(b => b.h)) + step;
    const y = p => T + (hi - p) / (hi - lo) * (H - T - B);
    const s = el('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Bản đồ vùng dấu hiệu và phần cá mập'}, host);
    const gs = Math.max(1, Math.round((hi - lo) / step / 7)) * step;
    for (let p = Math.ceil(lo / gs) * gs; p <= hi; p += gs) {
      el('line', {x1: L, x2: W - R, y1: y(p), y2: y(p), stroke: 'var(--grid)'}, s);
      el('text', {x: L - 4, y: y(p) + 3, 'text-anchor': 'end'}, s, px(+p.toFixed(2)));
    }
    const pm = BARS.findIndex(b => b.t >= '12:00');
    if (pm > 0) {
      const x = L + cw * pm;
      el('line', {x1: x, x2: x, y1: T, y2: H - B, stroke: 'var(--line2)', 'stroke-dasharray': '4 4'}, s);
      el('text', {x: x - 4, y: T + 10, 'text-anchor': 'end', style: 'fill:var(--gold3)'}, s, 'sáng');
      el('text', {x: x + 4, y: T + 10, style: 'fill:var(--gold3)'}, s, 'chiều');
    }
    // nến nền
    BARS.forEach(b => {
      const x = cx(b.k), col = b.c >= b.o ? 'rgba(61,190,122,.55)' : 'rgba(229,87,92,.55)';
      if (b.k === F.i) el('rect', {x: x - cw / 2, y: T, width: cw, height: H - T - B, fill: 'rgba(212,175,106,.09)'}, s);
      el('line', {x1: x, x2: x, y1: y(b.h), y2: y(b.l), stroke: col}, s);
      el('rect', {x: x - Math.min(5, cw * .18), y: y(Math.max(b.o, b.c)), width: Math.min(10, cw * .36), height: Math.max(1.5, Math.abs(y(b.o) - y(b.c))), fill: col}, s);
      if (cw > 34 || BARS.indexOf(b) % 2 === 0) el('text', {x, y: H - 6, 'text-anchor': 'middle', style: 'font-size:10px'}, s, b.t);
    });
    // dải: vẽ vùng nhỏ lẻ trước, vùng cá mập sau (nằm trên)
    const sorted = [...Z].sort((a, b) => (a.whale ? 1 : 0) - (b.whale ? 1 : 0));
    for (const z of sorted) {
      const col = z.ag === 's' ? 'var(--sell)' : 'var(--buy)';
      const x1 = cx(z.k) - cw * .3, x2 = z.endK != null ? cx(z.endK) : W - R;
      const gz = el('g', {style: 'cursor:pointer'}, s);
      const tip = `${z.t} ${SN[z.kind][1]} ${px(z.lo)}${z.hi !== z.lo ? '–' + px(z.hi) : ''}\n` +
        `KL ở vùng: bán ${fmt(z.vs)} · mua ${fmt(z.vb)}` + (z.ws != null ? `\ncá mập: bán ${fmt(z.ws)} · mua ${fmt(z.wb)} → ${z.ag === 's' ? 'bán' : 'mua'} ${pc0(z.share)}` : '') +
        `\n${z.f.txt}`;
      if (z.lo === z.hi) {
        el('line', {x1, x2, y1: y(z.lo), y2: y(z.lo), stroke: col, 'stroke-width': z.whale ? 2.5 : 1.2, 'stroke-dasharray': z.whale ? '' : '3 3'}, gz);
        el('text', {x: x1 - 2, y: y(z.lo) + 4, 'text-anchor': 'end', style: `fill:${col};font-size:12px`}, gz, SN[z.kind][0]);
      } else {
        const yt = y(z.hi + step / 2), yb = y(z.lo - step / 2);
        el('rect', {x: x1, y: yt, width: Math.max(2, x2 - x1), height: yb - yt, fill: col, 'fill-opacity': z.whale ? .38 : .06,
          stroke: col, 'stroke-opacity': z.whale ? .9 : .7, 'stroke-dasharray': z.whale ? '' : '3 3', rx: 2}, gz);
      }
      const ym = y((z.lo + z.hi) / 2);
      el('text', {x: x1 + 3, y: ym + 3.5, style: 'font-size:10px;font-weight:700;fill:#fff;paint-order:stroke;stroke:#0B1628;stroke-width:3px'}, gz,
        (z.whale ? '🐋' + pc0(z.share).replace(' ', '') : ''));
      if (z.endK != null) el('text', {x: x2, y: ym + 4, 'text-anchor': 'middle', style: 'font-size:13px;font-weight:800;fill:#FFD1D1;paint-order:stroke;stroke:#0B1628;stroke-width:3px'}, gz, '✕');
      else el('text', {x: W - R + 4, y: ym + 4, style: `font-size:12px;font-weight:800;fill:${z.whale ? '#9BF2C2' : 'var(--dim)'}`}, gz, '✓');
      el('title', {}, gz, tip);
      gz.addEventListener('click', () => { select(z.k); });
    }
    // giá đóng nối lại, nằm trên cùng
    el('path', {d: BARS.map((b, j) => (j ? 'L' : 'M') + cx(b.k).toFixed(1) + ' ' + y(b.c).toFixed(1)).join(''), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.4, opacity: .85}, s);
  }

  function drawWhaleVsPrice() {
    const host = $('fe-vp'); host.innerHTML = '';
    if (!BARS.some(b => b.bb || b.bs)) { $('fe-eff').textContent = ''; return; }
    const g = wGeom(host), {W, L, R, cw, cx} = g, H = 190, T = 16, B = 8;
    const act = BARS.reduce((a, b) => a + b.buy + b.sell, 0) || 1, o0 = BARS[0].o;
    let acc = 0;
    const rows = BARS.map((b, j) => {
      const wn = (b.bb - b.bs) / act * 100; acc += wn;
      const prev = j ? BARS[j - 1].c : o0;
      return {b, wn, cv: acc, pp: (b.c / o0 - 1) * 100, dp: b.c - prev};
    });
    // hai thang riêng nhưng cùng neo 0 ở giữa: so được chiều và độ dốc (CVD cá mập thường lớn gấp chục lần % giá)
    const mP = Math.max(.3, ...rows.map(r => Math.abs(r.pp))) * 1.15, mC = Math.max(.5, ...rows.map(r => Math.max(Math.abs(r.cv), Math.abs(r.wn)))) * 1.15;
    const yP = v => T + (mP - v) / (2 * mP) * (H - T - B), y = v => T + (mC - v) / (2 * mC) * (H - T - B);
    const s = el('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'CVD cá mập và giá cùng thang phần trăm'}, host);
    // tô nền lệch pha: cá mập ròng ≥ 1 % KL phiên mà giá nến đi ngược
    const tick = tickSize(BARS[0].h, EX);
    rows.forEach(r => {
      if (Math.abs(r.wn) >= 1 && Math.abs(r.dp) >= tick - 1e-9 && Math.sign(r.dp) !== Math.sign(r.wn))
        el('title', {}, el('rect', {x: cx(r.b.k) - cw / 2, y: T, width: cw, height: H - T - B, fill: 'var(--warn)', opacity: .16}, s),
          `${r.b.t}: cá mập ròng ${s1(r.wn)} % KL phiên nhưng giá ${r.dp > 0 ? 'tăng' : 'giảm'}: lệch pha`);
    });
    el('line', {x1: L, x2: W - R, y1: y(0), y2: y(0), stroke: 'var(--line2)'}, s);
    const gstep = mm => mm > 20 ? 10 : mm > 10 ? 5 : mm > 4 ? 2 : mm > 2 ? 1 : mm > 1 ? .5 : .2;
    const gP = gstep(mP), gC = gstep(mC);
    for (let v = -Math.floor(mP / gP) * gP; v <= mP + 1e-9; v += gP) if (Math.abs(v) > 1e-9) el('text', {x: L - 4, y: yP(v) + 3, 'text-anchor': 'end', style: 'fill:#6CC4FF'}, s, s1(v) + '%');
    for (let v = -Math.floor(mC / gC) * gC; v <= mC + 1e-9; v += gC) if (Math.abs(v) > 1e-9) el('text', {x: W - R + 2, y: y(v) + 3, style: 'fill:var(--gold2);font-size:9.5px'}, s, s1(v));
    rows.forEach(r => {
      const w = Math.min(10, cw * .3);
      el('rect', {x: cx(r.b.k) - w / 2, y: Math.min(y(r.wn), y(0)), width: w, height: Math.max(1, Math.abs(y(r.wn) - y(0))), fill: r.wn >= 0 ? 'var(--buy)' : 'var(--sell)', opacity: .55, rx: 1}, s);
    });
    const path = (a, col, dash, wdt) => el('path', {d: rows.map((r, j) => (j ? 'L' : 'M') + cx(r.b.k).toFixed(1) + ' ' + y(a(r)).toFixed(1)).join(''), fill: 'none', stroke: col, 'stroke-width': wdt, 'stroke-dasharray': dash || ''}, s);
    el('path', {d: rows.map((r, j) => (j ? 'L' : 'M') + cx(r.b.k).toFixed(1) + ' ' + yP(r.pp).toFixed(1)).join(''), fill: 'none', stroke: '#6CC4FF', 'stroke-width': 2, 'stroke-dasharray': '6 4'}, s); path(r => r.cv, 'var(--gold2)', '', 2.2);
    const last = rows[rows.length - 1];
    el('text', {x: cx(last.b.k) - 6, y: yP(last.pp) - 6, 'text-anchor': 'end', style: 'fill:#6CC4FF;font-weight:700;font-size:10.5px;paint-order:stroke;stroke:#0B1628;stroke-width:3px'}, s, `giá ${s1(last.pp)} %`);
    el('text', {x: cx(last.b.k) - 6, y: y(last.cv) + 14, 'text-anchor': 'end', style: 'fill:var(--gold2);font-weight:700;font-size:10.5px;paint-order:stroke;stroke:#0B1628;stroke-width:3px'}, s, `CVD CM ${s1(last.cv)} %`);
    el('text', {x: L + 4, y: T - 3, style: 'fill:var(--mute)'}, s, W < 600 ? '- - giá % (trái, xanh)  — CVD cá mập % (phải)  ▒ lệch pha' : '- - giá % so giá mở (xanh, thang trái)   — CVD cá mập % KL chủ động cả phiên (thang phải)   ▮ cá mập ròng từng nến   ▒ lệch pha');
    const pmI = BARS.findIndex(b => b.t >= '12:00');
    if (pmI > 0) el('line', {x1: L + cw * pmI, x2: L + cw * pmI, y1: T, y2: H - B, stroke: 'var(--line2)', 'stroke-dasharray': '4 4'}, s);
    // hiệu suất từng buổi
    const seg = (a, lab) => {
      if (!a.length) return '';
      const i0 = rows.indexOf(a[0]), p0 = i0 ? rows[i0 - 1].b.c : o0, p1 = a[a.length - 1].b.c;
      const sw = a.reduce((x, r) => x + r.wn, 0), dp = (p1 / p0 - 1) * 100;
      const same = Math.abs(sw) < 1 ? null : Math.abs(dp) < .1 ? 'flat' : Math.sign(sw) === Math.sign(dp);
      return `<b>${lab}</b>: cá mập ${sw >= 0 ? 'mua' : 'bán'} ròng ${Math.abs(sw).toLocaleString('vi-VN', {maximumFractionDigits: 1})} % KL phiên, giá ${s1(dp)} % → ` +
        (same == null ? 'cá mập gần như đứng ngoài' : same === 'flat' ? '<b style="color:var(--warn)">giá không nhúc nhích</b>: nỗ lực bị hấp thụ hết' : same ? `<b class="pos">cùng chiều</b> (${s1(Math.abs(dp / sw))} % giá / 1 % KL)` : `<b class="neg">NGƯỢC chiều</b>: có bên hấp thụ`);
    };
    const am = rows.filter(r => r.b.t < '12:00'), pm = rows.filter(r => r.b.t >= '12:00');
    $('fe-eff').innerHTML = [seg(am, 'Sáng'), seg(pm, 'Chiều')].filter(Boolean).join(' &nbsp;·&nbsp; ');
  }

  function drawSigList(Z) {
    const sigs = D.tf[String(F.tf)].sigs || [];
    if (!sigs.length) { $('fe-sigs').innerHTML = `<p class="note">${D.no_side ? 'Nguồn không có bên chủ động cho mã này — không đánh được dấu hiệu.' : 'Phiên này không có dấu hiệu nào vượt ngưỡng.'}</p>`; return; }
    $('fe-sigs').innerHTML = sigs.map(sg => {
      const [gl, nm, col] = SN[sg.kind] || ['•', sg.kind, 'var(--ink)'];
      const z = Z.find(x => x.k === sg.i && x.kind === sg.kind);
      let chips = '', note = '';
      if (z) {
        const side = z.ag === 's' ? 'bán' : 'mua';
        chips += z.share == null ? '<span class="wchip dim">chưa có dữ liệu cá mập</span>' :
          z.whale ? `<span class="wchip">🐋 ${side} ${pc0(z.share)}</span>` : `<span class="wchip dim">nhỏ lẻ · cá mập ${side} ${pc0(z.share)}</span>`;
        chips += ` <span class="stag sg-${z.f.st}">${z.f.st === 'ok' ? '✓' : z.f.st === 'bad' ? '✕' : '…'} ${z.f.txt}</span>`;
        if (z.absorb && z.whale && z.kind.startsWith('absorb'))
          note = `Bên ${side} chủ động là cá mập (${pc0(z.share)}), bên đỡ là lệnh chờ (thường nhỏ lẻ): đây là cá mập ${side} bị chặn tạm, KHÔNG phải tín hiệu cá mập ${side === 'bán' ? 'mua' : 'bán'}.` +
            (z.win ? ` Kết cục: cá mập thắng, mức bị xuyên lúc ${z.endT}.` : z.win === false ? ' Kết cục: bên đỡ giữ được.' : '');
      }
      return `<div class="wsig"><span class="tm" data-k="${sg.i}">${sg.t}</span><span><b style="color:${col}">${gl} ${nm}</b>. ${esc(sg.text)}</span>` +
        (chips ? `<div class="chips2">${chips}</div>` : '') + (note ? `<div class="wnote">${note}</div>` : '') + '</div>';
    }).join('');
    $('fe-sigs').querySelectorAll('.tm').forEach(t => t.onclick = () => {
      select(+t.dataset.k);
      if (innerWidth <= 860) $('fe-verdict').scrollIntoView({behavior: 'smooth', block: 'start'});
    });
  }

  function drawWhale() {
    const Z = whaleZones();
    drawScore(Z); drawZoneMap(Z); drawWhaleVsPrice(); drawSigList(Z);
  }

  const ready = () => BARS.length > 0;
  return {
    // gọi mỗi khi đổi mã/phiên/khung (showTF), trước select()
    prep() { F.tf = TF; EX = D.ex || 'HOSE'; prep(); },
    draw() {
      F.i = sel;
      $('fe-thr').value = F.thr; $('fe-thr-v').textContent = F.thr;
      if (!ready()) { ['fe-score', 'fe-map', 'fe-vp', 'fe-eff', 'fe-sigs', 'fe-strip', 'fe-legend', 'fe-verdict', 'fe-ladder', 'fe-lsigs', 'fe-quad'].forEach(id => { $(id).innerHTML = ''; }); return; }
      drawWhale(); drawStrip(); drawVerdict(); drawLadder(); drawQuad();
    },
    setThr(v) { F.thr = v; LS.set('of.fe.thr', v); prep(); this.draw(); },
  };
})();
$('fe-thr').oninput = e => FE.setThr(+e.target.value);

// ---------------------------------------------------------------- ③ Nhiều phiên
async function renderDays() {
  fillSymSelect($('m-sym'));
  $('m-sym').onchange = () => go('days', $('m-sym').value);
  const host = $('m-chart');
  host.innerHTML = '';
  $('m-whale').innerHTML = '';
  let data;
  try { data = await getJSON(`daily/${S.sym}.json`); } catch (e) { host.innerHTML = '<p class="empty">Không tải được dữ liệu mã này.</p>'; return; }
  // phiên sáng dở dang (lượt 12:05) = cột cuối, CVD đã nối tiếp các phiên đủ ở job
  let all = data.days;
  if (LIVE && LIVE.items.some(r => r.sym === S.sym)) {
    try { const lv = await getJSON(`live/${S.sym}.json`); if (lv.dayrow) all = [...all, {...lv.dayrow, live: true}]; } catch (e) { /* chỉ phiên đủ */ }
  }
  const Ds = all.slice(-20);
  $('m-pill').textContent = `${Ds.length} phiên gần nhất · ${data.ex}` + (all.length > data.days.length ? ` · gồm phiên sáng tới ${LIVE.upto}` : '');
  if (!Ds.length) { host.innerHTML = '<p class="empty">Chưa có phiên nào.</p>'; $('m-table').innerHTML = ''; return; }
  const W2 = Math.max(300, Math.min(1080, host.clientWidth || 720)), L2 = 40, R2 = 6, H1 = 250, HDl = 60, HCv = 60, G = 18;
  const y10 = 10, yd0 = y10 + H1 + G + 12, yc0 = yd0 + HDl + G + 12, H2 = yc0 + HCv + 10;
  let lo = Infinity, hi = -Infinity, mx = 1;
  for (const d of Ds) for (const [p, s, b] of d.lv) { lo = Math.min(lo, p); hi = Math.max(hi, p); mx = Math.max(mx, s, b); }
  // AVWAP neo từ phiên đầu khung đang xem: cộng dồn VWAP × KL từng phiên (d.vwv = KL dùng tính VWAP)
  let apv = 0, av = 0;
  const AV = Ds.map((d, k) => { if (d.vw != null && d.vwv) { apv += d.vw * d.vwv; av += d.vwv; } return [k, av ? apv / av : null]; }).filter(([, v]) => v != null);
  for (const v of [...Ds.map(d => d.vw), ...AV.map(a => a[1])]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = (hi - lo) * .06 || .5; lo -= pad; hi += pad;
  const y = p => y10 + (hi - p) / (hi - lo) * H1;
  const colW = (W2 - L2 - R2) / Ds.length, half = colW * .44;
  const s2 = el('svg', {viewBox: `0 0 ${W2} ${H2}`, role: 'img', 'aria-label': 'Footprint theo phiên, delta và CVD'}, host);
  const r = hi - lo, st = r > 20 ? 5 : r > 6 ? 2 : r > 3 ? 1 : r > 1.2 ? .5 : .2;
  for (let p = Math.ceil(lo / st) * st; p <= hi; p += st) {
    el('line', {x1: L2, x2: W2 - R2, y1: y(p), y2: y(p), stroke: 'var(--grid)'}, s2);
    el('text', {x: L2 - 4, y: y(p) + 3, 'text-anchor': 'end'}, s2, px(+p.toFixed(2)));
  }
  Ds.forEach((d, k) => {
    const cx = L2 + colW * (k + .5);
    el('line', {x1: cx, x2: cx, y1: y10, y2: y10 + H1, stroke: 'var(--line)'}, s2);
    const ps = d.lv.map(q => q[0]);
    let gapMin = Infinity; for (let j = 1; j < ps.length; j++) gapMin = Math.min(gapMin, ps[j - 1] - ps[j]);
    const th = Math.max(1.5, Math.min(12, (isFinite(gapMin) ? gapMin : .1) / (hi - lo) * H1 * .82));
    for (const [p, s, b] of d.lv) {
      if (s) el('rect', {x: cx - s / mx * half, y: y(p) - th / 2, width: s / mx * half, height: th, fill: 'var(--sell)', opacity: .88}, s2);
      if (b) el('rect', {x: cx, y: y(p) - th / 2, width: b / mx * half, height: th, fill: 'var(--buy)', opacity: .88}, s2);
    }
    el('rect', {x: cx, y: y(d.close) + 2, width: Math.min(1, d.x / mx) * half, height: 5, fill: 'var(--x)'}, s2);
    el('line', {x1: cx - half, x2: cx + half, y1: y(d.close), y2: y(d.close), stroke: 'var(--ink)', 'stroke-width': 1.4}, s2);
    const t = el('text', {x: cx, y: y10 + H1 + 14, 'text-anchor': 'middle', style: `font-weight:600;fill:${d.intraday ? 'var(--gold2)' : 'var(--ink)'};cursor:${d.intraday ? 'pointer' : 'default'}`}, s2, dd(d.d));
    if (d.intraday) t.addEventListener('click', () => go('day', S.sym, d.live ? LIVE_DAY : d.d));
    if (d.live) liveTag(s2, cx, y10 + H1 + 26);
    if (d.vw != null) {
      const vl = el('line', {x1: cx - half, x2: cx - half * .15, y1: y(d.vw), y2: y(d.vw), stroke: 'var(--vwap)', 'stroke-width': 2.4}, s2);
      el('title', {}, vl, `VWAP ${dd(d.d)}: ${px(d.vw)} · đóng cửa ${vsp(d.close, d.vw)}`);
    }
  });
  if (AV.length > 1) {
    el('path', {d: AV.map(([k, v], j) => (j ? 'L' : 'M') + (L2 + colW * (k + .5)).toFixed(1) + ' ' + y(v).toFixed(1)).join(''),
      fill: 'none', stroke: 'var(--vwap)', 'stroke-width': 1.6, 'stroke-dasharray': '5 3'}, s2);
    const [lk, lv] = AV[AV.length - 1];
    el('text', {x: L2 + colW * (lk + .5), y: y(lv) - 5, 'text-anchor': 'end', style: 'fill:var(--vwap);font-weight:600'}, s2, `AVWAP ${Ds.length} phiên ${px(lv)}`);
  }
  const md = Math.max(1, ...Ds.map(d => Math.abs(d.delta)));
  const ydl = v => yd0 + HDl / 2 - v / md * HDl / 2;
  el('text', {x: L2 - 4, y: yd0 + 4, 'text-anchor': 'end'}, s2, 'Delta');
  el('line', {x1: L2, x2: W2 - R2, y1: ydl(0), y2: ydl(0), stroke: 'var(--line)'}, s2);
  Ds.forEach((d, k) => {
    const cx = L2 + colW * (k + .5), w = colW * .36;
    el('rect', {x: cx - w / 2, y: Math.min(ydl(d.delta), ydl(0)), width: w, height: Math.max(1, Math.abs(ydl(d.delta) - ydl(0))),
      fill: d.delta >= 0 ? 'var(--buy)' : 'var(--sell)', rx: 1}, s2);
    if (colW > 28) el('text', {x: cx, y: d.delta >= 0 ? ydl(d.delta) - 3 : ydl(d.delta) + 10, 'text-anchor': 'middle'}, s2, smil(d.delta).replace(' tr', ''));
  });
  const cv = Ds.map(d => d.cvd), cl = Ds.map(d => d.close);
  const sc = (a, v) => { const l = Math.min(...a), h = Math.max(...a); return yc0 + HCv - (h > l ? (v - l) / (h - l) : .5) * HCv; };
  const line = (a, stroke, dash) => el('path', {d: a.map((v, k) => (k ? 'L' : 'M') + (L2 + colW * (k + .5)).toFixed(1) + ' ' + sc(a, v).toFixed(1)).join(''),
    fill: 'none', stroke, 'stroke-width': 1.8, 'stroke-dasharray': dash || ''}, s2);
  line(cl, 'var(--ink)', '4 3'); line(cv, 'var(--gold2)');
  Ds.forEach((d, k) => el('title', {}, el('circle', {cx: L2 + colW * (k + .5), cy: sc(cv, cv[k]), r: 3.5, fill: 'var(--gold2)'}, s2),
    `${dd(d.d)} · delta ${smil(d.delta)} · CVD ${smil(cv[k])} · đóng ${px(d.close)}`));
  if (colW > 28) cv.forEach((v, k) => { const cy = sc(cv, v);
    el('text', {x: L2 + colW * (k + .5), y: cy + (cy > yc0 + HCv / 2 ? -7 : 14), 'text-anchor': 'middle', style: 'fill:var(--gold2);font-weight:600;paint-order:stroke;stroke:#0B1628;stroke-width:3px'}, s2, smil(v).replace(' tr', '')); });
  el('text', {x: L2 - 4, y: yc0 + 8, 'text-anchor': 'end'}, s2, 'CVD');
  el('text', {x: W2 - R2, y: yc0 - 4, 'text-anchor': 'end'}, s2, W2 < 500 ? '— CVD   - - giá' : '— CVD (vàng)   - - giá đóng cửa (mỗi đường một thang riêng)');

  drawWhale(Ds, {W2, L2, R2, H1, lo, hi, colW, half});

  let t = '<tr><th>Phiên</th><th>Đóng cửa</th><th class="vw">VWAP</th><th title="Đóng cửa so với VWAP khớp liên tục của phiên">Đóng/VWAP</th><th>Mua CĐ</th><th>Bán CĐ</th><th>Delta</th><th title="Mua CĐ / (mua CĐ + bán CĐ)">Mua CĐ %</th><th title="So với trung bình tối đa 20 phiên trước của chính mã này">so TB</th><th>CVD</th><th>ATO/ATC</th><th>Lệnh lớn ròng</th></tr>';
  for (const d of [...all].reverse()) t += `<tr><td>${d.intraday ? `<a href="#day/${S.sym}/${d.live ? LIVE_DAY : d.d}" class="gold">${dd(d.d)}</a>` : dd(d.d)}${d.live ? '<span class="tag">sáng</span>' : ''}${d.f !== 1 ? `<span class="tag" title="Giá thô ${px(d.raw)} × ${d.f}">điều chỉnh</span>` : ''}${d.gap ? `<span class="tag">hụt ${fmt(d.gap)}</span>` : ''}</td>` +
    `<td>${px(d.close)}</td><td class="vw">${d.vw == null ? '–' : px(d.vw)}</td>` +
    `<td class="${d.cvw == null ? '' : d.cvw >= 0 ? 'pos' : 'neg'}">${d.cvw == null ? '–' : vsp(d.close, d.vw)}</td><td>${mil(d.buy)}</td><td>${mil(d.sell)}</td><td class="${d.delta >= 0 ? 'pos' : 'neg'}">${smil(d.delta)}</td>` +
    `<td>${pct(d.share)}</td><td class="${d.rel == null ? '' : d.rel >= 0 ? 'pos' : 'neg'}">${spt(d.rel)}</td>` +
    `<td class="${d.cvd >= 0 ? 'pos' : 'neg'}">${smil(d.cvd)}</td><td>${(d.x / ((d.buy + d.sell + d.x) || 1) * 100).toFixed(0)} %</td>` +
    `<td class="${d.big >= 0 ? 'pos' : 'neg'}">${smil(d.big)}</td></tr>`;
  $('m-table').innerHTML = t;
}

// Footprint cá mập (27/09/2026): cùng cột phiên + trục giá với footprint trên (g = hình học của nó), chỉ lệnh ≥ 500 tr đ.
// d.blv = [[giá, bán_lớn, mua_lớn]] đã quy giá điều chỉnh; d.blv_ok = false khi phiên chưa lưu cá mập theo mức giá.
// giá bình quân theo KL của cột i trong blv ([giá, bán_lớn, mua_lớn]): i = 2 mua, 1 bán
const wv = (blv, i) => { let pv = 0, v = 0; for (const r of blv || []) { pv += r[0] * r[i]; v += r[i]; } return v ? pv / v : null; };
// nhãn "sáng" dưới ngày của cột phiên dở dang
const liveTag = (s2, cx, yy) => el('text', {x: cx, y: yy, 'text-anchor': 'middle', style: 'font-size:10px;fill:var(--vwap)'}, s2, `sáng·${LIVE.upto}`);

function drawWhale(Ds, g) {
  const host = $('m-whale');
  host.innerHTML = '';
  const {W2, L2, R2, H1, lo, hi, colW, half} = g;
  const y10 = 10, HDl = 56, HCv = 60, G = 18, yd0 = y10 + H1 + G + 12, yc0 = yd0 + HDl + 22 + G + 8, H2 = yc0 + HCv + 10;
  const y = p => y10 + (hi - p) / (hi - lo) * H1;
  let mx = 1;
  for (const d of Ds) for (const [, s, b] of d.blv || []) mx = Math.max(mx, s, b);
  const s2 = el('svg', {viewBox: `0 0 ${W2} ${H2}`, role: 'img', 'aria-label': 'Footprint cá mập theo phiên, delta cá mập và CVD cá mập'}, host);
  const r = hi - lo, st = r > 20 ? 5 : r > 6 ? 2 : r > 3 ? 1 : r > 1.2 ? .5 : .2;
  for (let p = Math.ceil(lo / st) * st; p <= hi; p += st) {
    el('line', {x1: L2, x2: W2 - R2, y1: y(p), y2: y(p), stroke: 'var(--grid)'}, s2);
    el('text', {x: L2 - 4, y: y(p) + 3, 'text-anchor': 'end'}, s2, px(+p.toFixed(2)));
  }
  Ds.forEach((d, k) => {
    const cx = L2 + colW * (k + .5);
    el('line', {x1: cx, x2: cx, y1: y10, y2: y10 + H1, stroke: 'var(--line)'}, s2);
    el('text', {x: cx, y: y10 + H1 + 14, 'text-anchor': 'middle', style: 'font-weight:600;fill:var(--ink)'}, s2, dd(d.d));
    if (d.live) liveTag(s2, cx, y10 + H1 + 26);
    if (d.blv_ok === false || d.blv == null) {
      el('text', {x: cx, y: y10 + H1 / 2, 'text-anchor': 'middle', style: 'fill:var(--mute)'}, s2, 'chưa có');
      return;
    }
    // độ dày thanh lấy theo bước giá của footprint trên → hai biểu đồ thẳng hàng từng mức giá
    const ps = d.lv.map(q => q[0]);
    let gapMin = Infinity; for (let j = 1; j < ps.length; j++) gapMin = Math.min(gapMin, ps[j - 1] - ps[j]);
    const th = Math.max(1.5, Math.min(12, (isFinite(gapMin) ? gapMin : .1) / (hi - lo) * H1 * .82));
    for (const [p, s, b] of d.blv) {
      if (s) el('title', {}, el('rect', {x: cx - s / mx * half, y: y(p) - th / 2, width: s / mx * half, height: th, fill: 'var(--sell)', opacity: .92}, s2), `${px(p)}: cá mập bán ${mil(s)}`);
      if (b) el('title', {}, el('rect', {x: cx, y: y(p) - th / 2, width: b / mx * half, height: th, fill: 'var(--buy)', opacity: .92}, s2), `${px(p)}: cá mập mua ${mil(b)}`);
    }
    if (!d.blv.length) el('text', {x: cx, y: y10 + H1 / 2, 'text-anchor': 'middle', style: 'fill:var(--mute)'}, s2, 'không có');
    el('line', {x1: cx - half, x2: cx + half, y1: y(d.close), y2: y(d.close), stroke: 'var(--ink)', 'stroke-width': 1.2, opacity: .7}, s2);
    // VWAP cá mập = giá vốn bình quân: mua (vạch xanh, bên phải) và bán (vạch đỏ, bên trái)
    const vb = wv(d.blv, 2), vs = wv(d.blv, 1);
    // viền tối + màu sáng hơn thanh để vạch không chìm vào chính các thanh KL
    const tick = (x1, x2, v, col, tip) => {
      el('line', {x1, x2, y1: y(v), y2: y(v), stroke: '#0B1628', 'stroke-width': 5.5, 'stroke-linecap': 'round'}, s2);
      el('title', {}, el('line', {x1, x2, y1: y(v), y2: y(v), stroke: col, 'stroke-width': 2.6, 'stroke-linecap': 'round'}, s2), tip);
    };
    if (vb != null) tick(cx + half * .15, cx + half, vb, '#9BF2C2', `${dd(d.d)}: cá mập mua bình quân ${px(+vb.toFixed(2))} · đóng cửa ${vsp(d.close, vb)}`);
    if (vs != null) tick(cx - half, cx - half * .15, vs, '#FF9C9C', `${dd(d.d)}: cá mập bán bình quân ${px(+vs.toFixed(2))}`);
  });
  // Giá vốn cá mập mua cộng dồn từ phiên đầu khung (AVWAP chỉ lệnh lớn), bỏ phiên chưa có blv
  let apv = 0, av = 0;
  const AV = Ds.map((d, k) => {
    if (d.blv_ok !== false) for (const [p, , b] of d.blv || []) { apv += p * b; av += b; }
    return [k, av ? apv / av : null];
  }).filter(([, v]) => v != null);
  if (AV.length > 1) {
    el('path', {d: AV.map(([k, v], j) => (j ? 'L' : 'M') + (L2 + colW * (k + .5)).toFixed(1) + ' ' + y(v).toFixed(1)).join(''),
      fill: 'none', stroke: 'var(--gold2)', 'stroke-width': 1.6, 'stroke-dasharray': '5 3'}, s2);
    const [lk, lv] = AV[AV.length - 1];
    el('text', {x: L2 + colW * (lk + .5), y: y(lv) - 5, 'text-anchor': 'end', style: 'fill:var(--gold2);font-weight:600'}, s2,
      `Giá vốn CM ${AV.length} phiên ${px(+lv.toFixed(2))}`);
  }
  const md = Math.max(1, ...Ds.map(d => Math.abs(d.big || 0)));
  const ydl = v => yd0 + HDl / 2 - v / md * HDl / 2;
  el('text', {x: L2 - 4, y: yd0 + 4, 'text-anchor': 'end'}, s2, 'Delta');
  el('text', {x: L2 - 4, y: yd0 + 15, 'text-anchor': 'end'}, s2, 'cá mập');
  el('line', {x1: L2, x2: W2 - R2, y1: ydl(0), y2: ydl(0), stroke: 'var(--line)'}, s2);
  Ds.forEach((d, k) => {
    const cx = L2 + colW * (k + .5), w = colW * .36, v = d.big || 0;
    el('rect', {x: cx - w / 2, y: Math.min(ydl(v), ydl(0)), width: w, height: Math.max(1, Math.abs(ydl(v) - ydl(0))),
      fill: v >= 0 ? 'var(--buy)' : 'var(--sell)', rx: 1}, s2);
    if (colW > 28) el('text', {x: cx, y: v >= 0 ? ydl(v) - 3 : ydl(v) + 10, 'text-anchor': 'middle'}, s2, smil(v).replace(' tr', ''));
    const act = (d.buy || 0) + (d.sell || 0);
    if (colW > 40 && act && d.bb != null) el('text', {x: cx, y: yd0 + HDl + 18, 'text-anchor': 'middle', style: 'fill:var(--mute)'}, s2,
      `CM ${Math.round((d.bb + d.bs) / act * 100)} % KL`);
  });
  // CVD cá mập = cộng dồn delta cá mập từ phiên đầu khung (cùng mốc với đường giá vốn CM); vẽ như hàng CVD của bảng ①
  el('text', {x: L2 - 4, y: yc0 + 8, 'text-anchor': 'end'}, s2, 'CVD');
  el('text', {x: L2 - 4, y: yc0 + 19, 'text-anchor': 'end'}, s2, 'cá mập');
  if (Ds.length < 2) {
    el('text', {x: (L2 + W2 - R2) / 2, y: yc0 + HCv / 2, 'text-anchor': 'middle', style: 'fill:var(--mute)'}, s2, 'cần ≥ 2 phiên');
    return;
  }
  let acc = 0;
  const cv = Ds.map(d => (acc += d.big || 0)), cl = Ds.map(d => d.close);
  const sc = (a, v) => { const l = Math.min(...a), h = Math.max(...a); return yc0 + HCv - (h > l ? (v - l) / (h - l) : .5) * HCv; };
  const xk = k => L2 + colW * (k + .5);
  const line = (a, stroke, dash) => el('path', {d: a.map((v, k) => (k ? 'L' : 'M') + xk(k).toFixed(1) + ' ' + sc(a, v).toFixed(1)).join(''),
    fill: 'none', stroke, 'stroke-width': 1.8, 'stroke-dasharray': dash || ''}, s2);
  line(cl, 'var(--ink)', '4 3'); line(cv, 'var(--gold2)');
  Ds.forEach((d, k) => el('title', {}, el('circle', {cx: xk(k), cy: sc(cv, cv[k]), r: 3.5, fill: 'var(--gold2)'}, s2),
    `${dd(d.d)} · delta CM ${smil(d.big || 0)} · CVD CM ${smil(cv[k])} · đóng ${px(d.close)}`));
  if (colW > 28) cv.forEach((v, k) => { const cy = sc(cv, v);
    el('text', {x: xk(k), y: cy + (cy > yc0 + HCv / 2 ? -7 : 14), 'text-anchor': 'middle', style: 'fill:var(--gold2);font-weight:600;paint-order:stroke;stroke:#0B1628;stroke-width:3px'}, s2, smil(v).replace(' tr', '')); });
  el('text', {x: W2 - R2, y: yc0 - 4, 'text-anchor': 'end'}, s2, W2 < 500 ? '— CVD CM   - - giá' : '— CVD cá mập (vàng)   - - giá đóng cửa (mỗi đường một thang riêng)');
}

// ---------------------------------------------------------------- ⑤ NL & KQ
// Nỗ lực – kết quả của cá mập (28/09/2026, từ bản mẫu effort-result-lab người dùng duyệt). Chỉ mô tả, không phải tín hiệu.
// Nỗ lực E = big / KL chủ động TB/phiên của khung × 100; kết quả R = % giá đóng cửa; phiên đầu khung chỉ làm mốc.
const ER_CLS = {
  okb: ['Nỗ lực mua có kết quả', 'var(--buy)'],
  absb: ['Cầu CM bị hấp thụ', 'var(--warn)'],
  oks: ['Xả có kết quả', 'var(--sell)'],
  abss: ['Cung CM bị đỡ', 'var(--vwap)'],
  free: ['Giá chạy không cần CM', '#8FA3BF'],
  quiet: ['Im lặng', 'rgba(169,180,200,.28)'],
};
const ER = {te: +LS.get('of.er.te') || 3, tr: +LS.get('of.er.tr') || .5, scale: 'one', sort: 'lech', desc: true};
let ER_DATA = null, ER_M = {}, ER_MISS = 0;   // ER_MISS = số mã tải lỗi → lần mở tab sau tải lại
// số % có dấu, 2 chữ số lẻ (1 khi ≥ 10)
const ers = v => {
  if (v == null || !isFinite(v)) return '–';
  if (Math.abs(v) < .005) return '0,00';
  const k = Math.abs(v) >= 10 ? 1 : 2;
  return (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('vi-VN', {minimumFractionDigits: k, maximumFractionDigits: k});
};
const erp = v => ers(v) + ' %';

function erClassify(E, R) {
  const bigE = Math.abs(E) >= ER.te;
  if (bigE && E > 0) return R >= ER.tr ? 'okb' : 'absb';
  if (bigE && E < 0) return R <= -ER.tr ? 'oks' : 'abss';
  return Math.abs(R) >= ER.tr ? 'free' : 'quiet';
}

function erMetrics(days) {
  const adv = days.reduce((a, d) => a + (d.buy || 0) + (d.sell || 0), 0) / days.length || 1;
  const c0 = days[0].close;
  let se = 0;
  const rows = days.map((d, i) => {
    const E = (d.big || 0) / adv * 100, R = i ? (d.close / days[i - 1].close - 1) * 100 : null;
    if (i) se += E;
    return {d: d.d, live: !!d.live, close: d.close, big: d.big || 0, E, R, SE: se, SR: (d.close / c0 - 1) * 100, cls: i ? erClassify(E, R) : null};
  });
  const rr = rows.slice(1), n = rr.length, SE = rows[rows.length - 1].SE, SR = rows[rows.length - 1].SR;
  let beta = null, rho = null;
  if (n >= 10) {
    const sxx = rr.reduce((a, r) => a + r.E * r.E, 0), sxy = rr.reduce((a, r) => a + r.E * r.R, 0);
    beta = sxx ? sxy / sxx : null;
    const mx = rr.reduce((a, r) => a + r.E, 0) / n, my = rr.reduce((a, r) => a + r.R, 0) / n;
    let cxy = 0, cxx = 0, cyy = 0;
    for (const r of rr) { cxy += (r.E - mx) * (r.R - my); cxx += (r.E - mx) ** 2; cyy += (r.R - my) ** 2; }
    rho = cxx && cyy ? cxy / Math.sqrt(cxx * cyy) : null;
  }
  let v;
  if (days.every(d => !d.big)) v = ['quiet', 'KHÔNG CÓ CÁ MẬP: không có lệnh ≥ 500 tr đ'];
  else if (Math.abs(SE) < ER.te) v = Math.abs(SR) >= ER.tr ? ['free', 'GIÁ TỰ ĐI: cá mập không nghiêng hẳn phía nào'] : ['quiet', 'IM LẶNG: cá mập không nghiêng phía nào, giá cũng đứng'];
  else if (Math.sign(SE) === Math.sign(SR) && Math.abs(SR) >= ER.tr) v = [SE > 0 ? 'okb' : 'oks', 'ĐẠT: nỗ lực và giá cùng chiều'];
  else if (Math.abs(SR) >= ER.tr) v = [SE > 0 ? 'absb' : 'abss', 'KHÔNG ĐẠT: giá đi ngược nỗ lực'];
  else v = [SE > 0 ? 'absb' : 'abss', 'CHƯA RA KẾT QUẢ: nỗ lực lớn nhưng giá gần như đứng'];
  return {rows, n, SE, SR, eff: Math.abs(SE) >= ER.te ? SR / SE : null, v, beta, rho,
    lech: rr.filter(r => r.cls === 'absb' || r.cls === 'abss').length, dong: rr.filter(r => r.cls === 'okb' || r.cls === 'oks').length};
}

// tải cả danh mục một lần (getJSON có cache), ghép phiên sáng như tab Nhiều phiên, khung 20 phiên
async function erLoad() {
  if (ER_DATA && !ER_MISS) return ER_DATA;
  const out = {};
  let miss = 0;
  await Promise.all(LATEST.items.map(async ({sym}) => {
    let d;
    try { d = await getJSON(`daily/${sym}.json`); } catch (e) { miss++; return; }
    let all = d.days || [];
    if (LIVE && LIVE.items.some(r => r.sym === sym)) {
      try { const lv = await getJSON(`live/${sym}.json`); if (lv.dayrow) all = [...all, {...lv.dayrow, live: true}]; } catch (e) { /* chỉ phiên đủ */ }
    }
    if (all.length >= 2) out[sym] = {ex: d.ex, days: all.slice(-20)};
  }));
  ER_MISS = miss;
  return (ER_DATA = out);
}
function erCompute() {
  ER_M = {};
  for (const s in ER_DATA) ER_M[s] = erMetrics(ER_DATA[s].days);
  // độ lệch = nỗ lực chuẩn hoá − kết quả chuẩn hoá (theo max |.| cả danh mục): dương = mua mạnh mà giá kém
  const ms = Object.values(ER_M);
  const mE = Math.max(1e-9, ...ms.map(m => Math.abs(m.SE))), mR = Math.max(1e-9, ...ms.map(m => Math.abs(m.SR)));
  for (const s in ER_M) ER_M[s].score = ER_M[s].SE / mE - ER_M[s].SR / mR;
}

async function renderNLKQ() {
  fillSymSelect($('e-sym'));
  $('e-sym').onchange = () => go('nlkq', $('e-sym').value);
  for (const k of ['te', 'tr']) {
    const inp = $('e-' + k);
    inp.value = ER[k];
    inp.oninput = () => { ER[k] = +inp.value; LS.set('of.er.' + k, ER[k]); erCompute(); erDraw(); };
  }
  $('e-scale').innerHTML = [['one', 'Thang riêng mã'], ['all', 'Thang chung danh mục']]
    .map(([k, n]) => `<button class="chip ${ER.scale === k ? 'on' : ''}" data-k="${k}" aria-pressed="${ER.scale === k}">${n}</button>`).join('');
  $('e-scale').onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    ER.scale = b.dataset.k;
    $('e-scale').querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    erDraw();
  };
  if (!ER_DATA) $('e-verdict').innerHTML = '<p class="empty">Đang tải cả danh mục…</p>';
  await erLoad();
  erCompute();
  erDraw();
}
function erDraw() {
  $('e-te-v').textContent = String(ER.te).replace('.', ',') + ' %';
  $('e-tr-v').textContent = String(ER.tr).replace('.', ',') + ' %';
  ['e-traj', 'e-bars', 'e-legend'].forEach(id => { $(id).innerHTML = ''; });
  const m = ER_M[S.sym];
  if (!m) { $('e-verdict').innerHTML = '<p class="empty">Mã này chưa đủ 2 phiên.</p>'; $('e-pill').textContent = ''; erTable(); return; }
  const d = ER_DATA[S.sym];
  $('e-pill').textContent = `${d.days.length} phiên gần nhất · ${d.ex}` + (d.days[d.days.length - 1].live ? ` · gồm phiên sáng tới ${LIVE.upto}` : '') +
    (ER_MISS ? ` · thiếu ${ER_MISS} mã (lỗi mạng)` : '');
  erVerdict(m); erTraj(m); erBars(m); erTable();
}

function erVerdict(m) {
  const [k, txt] = m.v;
  const c = k === 'okb' || k === 'oks' ? 'v-ok' : k === 'absb' || k === 'abss' ? 'v-bad' : 'v-mid';
  const f = m.rows[0], l = m.rows[m.rows.length - 1];
  $('e-verdict').innerHTML =
    // m.n = số phiên so sánh (phiên đầu chỉ làm mốc giá); m.rows.length = số phiên thật của khung
    `<b>${S.sym}</b> · ${m.rows.length} phiên (${dd(f.d)} → ${dd(l.d)}${l.live ? ' sáng' : ''}, phiên ${dd(f.d)} làm mốc): cá mập ${m.SE >= 0 ? 'mua' : 'bán'} ròng <b>${erp(Math.abs(m.SE)).replace(/^\+/, '')}</b> KL/phiên TB, giá <b>${erp(m.SR)}</b>.<br>` +
    `<span class="${c}">${txt}.</span> ` + (m.eff != null ? `Hiệu suất ${ers(m.eff)} % giá cho mỗi 1 % KL mua ròng. ` : '') +
    `Đồng pha ${m.dong}/${m.n} phiên so sánh, lệch pha ${m.lech}/${m.n}. ` +
    (m.n >= 10 ? `Tương quan từng phiên ρ = ${ers(m.rho)}, độ dốc β = ${ers(m.beta)}.` : `<span class="hint">Tương quan và độ dốc cần ≥ 10 phiên so sánh (đang có ${m.n}).</span>`);
}

function erTraj(m) {
  const host = $('e-traj');
  const W = Math.max(300, Math.min(1080, host.clientWidth || 720)), H = Math.round(Math.min(440, Math.max(260, W * .55)));
  const L = 46, R = 12, T = 12, B = 32;
  const src = ER.scale === 'all' ? Object.values(ER_M) : [m];
  const mx = (Math.max(...src.flatMap(q => q.rows.map(r => Math.abs(r.SE)))) || 1) * 1.12;
  const my = (Math.max(...src.flatMap(q => q.rows.map(r => Math.abs(r.SR)))) || 1) * 1.12;
  const X = v => L + (v + mx) / (2 * mx) * (W - L - R), Y = v => T + (my - v) / (2 * my) * (H - T - B);
  const s = el('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Quỹ đạo nỗ lực cộng dồn và giá'}, host);
  // nền 4 góc: sx/sy = +1 phải/trên, −1 trái/dưới
  const q = (sx, sy, c, t) => {
    el('rect', {x: sx > 0 ? X(0) : L, y: sy > 0 ? T : Y(0), width: sx > 0 ? W - R - X(0) : X(0) - L, height: sy > 0 ? Y(0) - T : H - B - Y(0), fill: c, opacity: .07}, s);
    el('text', {x: sx > 0 ? W - R - 4 : L + 4, y: sy > 0 ? T + 13 : H - B - 5, 'text-anchor': sx > 0 ? 'end' : 'start', style: `fill:${c};opacity:.85;font-weight:600`}, s, t);
  };
  q(1, 1, 'var(--buy)', 'mua → giá lên'); q(1, -1, 'var(--warn)', 'mua → giá không lên');
  q(-1, 1, 'var(--vwap)', 'xả → giá vẫn lên'); q(-1, -1, 'var(--sell)', 'xả → giá xuống');
  const step = v => { const r = v * 2 / 5, p = 10 ** Math.floor(Math.log10(r)), k = r / p; return (k > 5 ? 10 : k > 2 ? 5 : k > 1 ? 2 : 1) * p; };
  const sx = step(mx), sy = step(my);
  for (let v = -Math.floor(mx / sx) * sx; v <= mx; v += sx) {
    el('line', {x1: X(v), x2: X(v), y1: T, y2: H - B, stroke: 'var(--grid)'}, s);
    el('text', {x: X(v), y: H - B + 13, 'text-anchor': 'middle'}, s, ers(+v.toFixed(6)));
  }
  for (let v = -Math.floor(my / sy) * sy; v <= my; v += sy) {
    el('line', {x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: 'var(--grid)'}, s);
    el('text', {x: L - 4, y: Y(v) + 3, 'text-anchor': 'end'}, s, ers(+v.toFixed(6)));
  }
  el('line', {x1: X(0), x2: X(0), y1: T, y2: H - B, stroke: 'var(--line2)'}, s);
  el('line', {x1: L, x2: W - R, y1: Y(0), y2: Y(0), stroke: 'var(--line2)'}, s);
  el('text', {x: W - R, y: H - 3, 'text-anchor': 'end'}, s, 'nỗ lực cộng dồn (% KL chủ động TB/phiên) →');
  el('text', {x: L + 4, y: Y(0) - 5}, s, '% giá');
  if (m.beta != null) {
    const yb = v => Y(Math.max(-my, Math.min(my, m.beta * v)));
    el('line', {x1: X(-mx), y1: yb(-mx), x2: X(mx), y2: yb(mx), stroke: 'var(--gold3)', 'stroke-dasharray': '6 4'}, s);
  }
  const mk = el('marker', {id: 'er-ar', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto'}, el('defs', {}, s));
  el('path', {d: 'M0 0L10 5L0 10z', fill: 'var(--gold2)'}, mk);
  const P = m.rows;
  for (let i = 1; i < P.length; i++) {
    const x1 = X(P[i - 1].SE), y1 = Y(P[i - 1].SR), x2 = X(P[i].SE), y2 = Y(P[i].SR);
    const len = Math.hypot(x2 - x1, y2 - y1) || 1, sh = Math.min(7, len / 3);
    el('line', {x1, y1, x2: x2 - (x2 - x1) / len * sh, y2: y2 - (y2 - y1) / len * sh, stroke: 'var(--gold2)', 'stroke-width': 1.8,
      'marker-end': len > 12 ? 'url(#er-ar)' : '', opacity: .35 + .65 * i / (P.length - 1)}, s);
  }
  P.forEach((r, i) => {
    const last = i === P.length - 1, c = i ? ER_CLS[r.cls][1] : 'var(--ink)', cx = X(r.SE), cy = Y(r.SR);
    el('title', {}, el('circle', {cx, cy, r: last ? 6.5 : i ? 4.2 : 3.5, fill: c, stroke: '#0B1628', 'stroke-width': 1.5}, s),
      i ? `${dd(r.d)}: ${ER_CLS[r.cls][0]}\nphiên: nỗ lực ${erp(r.E)}, giá ${erp(r.R)}\ncộng dồn: nỗ lực ${erp(r.SE)}, giá ${erp(r.SR)}` : `${dd(r.d)}: phiên mốc, đóng ${px(r.close)}`);
    const rt = cx > W * .62;   // gần mép phải: nhãn sang trái chấm
    if (i === 0 || last || W > 600) el('text', {x: cx + (rt ? -1 : 1) * (last ? 9 : 6), y: cy + (last && cy < T + 30 ? 18 : -(last ? 8 : 6)),
      'text-anchor': rt ? 'end' : 'start', style: `fill:${last ? 'var(--gold2)' : 'var(--mute)'};font-weight:${last ? 700 : 400};paint-order:stroke;stroke:#0B1628;stroke-width:3px`}, s,
      dd(r.d) + (r.live ? ' sáng' : '') + (last ? `  ${erp(r.SE)} → ${erp(r.SR)}` : ''));
  });
}

function erBars(m) {
  const host = $('e-bars'), rr = m.rows.slice(1);
  const W = Math.max(300, Math.min(1080, host.clientWidth || 720)), L = 44, R = 6, T = 16, HB = 150, H = T + HB + 58;
  const s = el('svg', {viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Nỗ lực và kết quả từng phiên'}, host);
  const mE = Math.max(ER.te, ...rr.map(r => Math.abs(r.E))), mR = Math.max(ER.tr, ...rr.map(r => Math.abs(r.R)));
  const y0 = T + HB / 2, yE = v => y0 - v / mE * HB / 2, yR = v => y0 - v / mR * HB / 2;
  const cw = (W - L - R) / rr.length, bw = Math.min(26, cw * .3);
  el('line', {x1: L, x2: W - R, y1: y0, y2: y0, stroke: 'var(--line2)'}, s);
  for (const g of [1, -1]) el('line', {x1: L, x2: W - R, y1: yE(g * ER.te), y2: yE(g * ER.te), stroke: 'var(--gold3)', 'stroke-dasharray': '2 4', opacity: .6}, s);
  el('text', {x: L - 4, y: T + 4, 'text-anchor': 'end', style: 'fill:var(--gold2)'}, s, ers(mE) + '%');
  el('text', {x: L - 4, y: T + 16, 'text-anchor': 'end', style: 'fill:var(--ink)'}, s, ers(mR) + '%');
  el('text', {x: L - 4, y: y0 + 4, 'text-anchor': 'end'}, s, '0');
  rr.forEach((r, k) => {
    const cx = L + cw * (k + .5);
    const bar = (x, v, yf, c, tip) => el('title', {}, el('rect', {x, y: Math.min(yf(v), y0), width: bw, height: Math.max(1, Math.abs(yf(v) - y0)), fill: c, rx: 2}, s), tip);
    bar(cx - bw - 1, r.E, yE, 'var(--gold2)', `${dd(r.d)} nỗ lực ${erp(r.E)} (${smil(r.big)} cp)`);
    bar(cx + 1, r.R, yR, 'var(--ink)', `${dd(r.d)} giá ${erp(r.R)} → ${px(r.close)}`);
    if (cw > 52) {
      el('text', {x: cx - bw / 2 - 1, y: r.E >= 0 ? yE(r.E) - 3 : yE(r.E) + 11, 'text-anchor': 'middle', style: 'fill:var(--gold2);font-size:10px'}, s, ers(r.E));
      el('text', {x: cx + bw / 2 + 1, y: r.R >= 0 ? yR(r.R) - 3 : yR(r.R) + 11, 'text-anchor': 'middle', style: 'fill:var(--ink);font-size:10px'}, s, ers(r.R));
    }
    el('text', {x: cx, y: T + HB + 16, 'text-anchor': 'middle', style: 'font-weight:600;fill:var(--ink)'}, s, dd(r.d) + (r.live ? '·s' : ''));
    const c = ER_CLS[r.cls];
    el('title', {}, el('rect', {x: cx - cw * .44, y: T + HB + 24, width: cw * .88, height: 22, rx: 5, fill: c[1]}, s), c[0]);
    if (cw > 86) el('text', {x: cx, y: T + HB + 39, 'text-anchor': 'middle', style: 'fill:#0B1628;font-size:10px;font-weight:700'}, s, c[0].replace('Nỗ lực mua', 'Mua'));
  });
  $('e-legend').innerHTML = Object.values(ER_CLS).map(([t, c]) => `<span><i style="background:${c}"></i>${t}</span>`).join('') +
    '<span><i style="background:var(--gold2)"></i>nỗ lực</span><span><i style="background:var(--ink)"></i>kết quả</span>';
}

const ER_COLS = [
  ['sym', 'Mã', m => m.sym], ['SE', 'Nỗ lực', m => m.SE], ['SR', 'Giá', m => m.SR], ['eff', 'Hiệu suất', m => m.eff ?? -Infinity],
  ['v', 'Kết luận', m => m.v[0]], ['lech', 'Độ lệch', m => m.score], ['lp', 'Lệch pha', m => m.lech],
];
function erTable() {
  const col = ER_COLS.find(c => c[0] === ER.sort);
  const list = Object.keys(ER_M).map(s => ({sym: s, ...ER_M[s]}))
    .sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : 0) * (ER.desc ? -1 : 1); });
  let h = '<tr>' + ER_COLS.map(c => `<th data-k="${c[0]}">${c[1]}${c[0] === ER.sort ? (ER.desc ? ' ↓' : ' ↑') : ''}</th>`).join('') + '</tr>';
  for (const m of list) h += `<tr class="er-row${m.sym === S.sym ? ' cur' : ''}" data-s="${m.sym}"><td><b>${m.sym}</b></td>` +
    `<td class="${m.SE >= 0 ? 'pos' : 'neg'}">${erp(m.SE)}</td><td class="${m.SR >= 0 ? 'pos' : 'neg'}">${erp(m.SR)}</td>` +
    `<td>${m.eff == null ? '–' : ers(m.eff)}</td><td><span class="er-chip" style="background:${ER_CLS[m.v[0]][1]}">${m.v[1].split(':')[0]}</span></td>` +
    `<td>${ers(m.score)}</td><td>${m.lech}/${m.n}</td></tr>`;
  $('e-tbl').innerHTML = h;
}
$('e-tbl').addEventListener('click', e => {
  const th = e.target.closest('th');
  if (th) { const k = th.dataset.k; if (ER.sort === k) ER.desc = !ER.desc; else { ER.sort = k; ER.desc = k !== 'sym'; } erTable(); return; }
  const tr = e.target.closest('tr.er-row');
  if (tr) go('nlkq', tr.dataset.s);
});

// ---------------------------------------------------------------- ④ Hướng dẫn
function renderGuide() {
  const s = STATE || {};
  const failed = Object.entries(s.failed || {});
  const li = [
    `Dữ liệu phiên <b>${s.day ? dd(s.day) + '/' + s.day.slice(0, 4) : '–'}</b>, cập nhật lúc ${s.run_at ? s.run_at.replace('T', ' ').slice(0, 16) : '–'}.`,
    `Danh mục: ${s.symbols ?? '–'} mã, nguồn ${s.watchlist === 'kingstock' ? 'KingStock' : s.watchlist === 'cache' ? '<span class="bad">bản chụp (KingStock không trả lời)</span>' : '–'}.`,
    `Lần gom gần nhất: mới ${(s.new || []).length} mã` + (s.unsettled && s.unsettled.length ? ` · ${s.unsettled.length} mã phiên chưa xong` : '') + '.',
    failed.length ? `<span class="bad">Lỗi ${failed.length} mã:</span> ${failed.map(([k, v]) => `${k} (${esc(v)})`).join('; ')}` : '<span class="ok">✓</span> Không có mã lỗi.',
    Object.keys(s.gaps || {}).length ? `Nguồn thiếu tick lẻ: ${Object.entries(s.gaps).map(([k, v]) => `${k} ${fmt(v)} cp`).join(', ')}.` : 'Không mã nào thiếu tick.',
    (s.dnse_missing || []).length ? `<span class="bad">Không có nến DNSE (giá chưa quy điều chỉnh):</span> ${s.dnse_missing.join(', ')}` : 'Nến DNSE đủ cho mọi mã.',
    'Job chạy 16:00 các ngày giao dịch, dự phòng 16:30, 18:30 và 08:15 sáng hôm sau.',
    'Lượt 12:05 (nghỉ trưa) gom phiên sáng để xem sớm: nút <b>Sáng nay</b> ở tab Danh mục và dòng "Sáng … (dở dang)" ở tab Trong phiên. ' +
      'Phiên sáng không lưu kho, không vào tab Nhiều phiên; dấu hiệu và "so TB" có thể đổi khi đủ phiên. Job 16:00 thay bằng phiên đủ.' +
      (LIVE ? ` Hiện có phiên sáng ${dd(LIVE.day)} của ${LIVE.items.length} mã, tới ${LIVE.upto}.` : ''),
  ];
  $('g-state').innerHTML = li.map(x => `<li>${x}</li>`).join('');
}

// ---------------------------------------------------------------- khởi động
(async function boot() {
  try {
    [LATEST, STATE, LIVE] = await Promise.all([getJSON('latest.json'), getJSON('state.json').catch(() => null),
      getJSON('live.json').catch(() => null)]);
    if (LIVE && !(LIVE.day > (LATEST.day || ''))) LIVE = null;   // bản sáng cũ còn sót trong cache: phiên đủ đã có
    if (LIVE) S.src = 'live';
  } catch (e) {
    document.querySelector('.wrap').innerHTML = '<p class="empty">Không tải được dữ liệu. Kiểm tra mạng rồi mở lại.</p>';
    return;
  }
  const saved = LS.get('of.sym');
  S.sym = LATEST.items.some(r => r.sym === saved) ? saved : (LATEST.items[0] || {}).sym;
  const tf = +LS.get('of.tf'); if (TFS.includes(tf)) TF = tf;
  const so = LS.get('of.sort'); if (SORTS.some(s => s[0] === so)) { S.sort = so; sortDesc = SORTS.find(s => s[0] === so)[3]; }
  $('tagline').textContent = `Dòng lệnh chủ động · ${LATEST.items.length} mã KingStock · phiên ${LATEST.day ? dd(LATEST.day) : '–'}`;
  let t;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (S.tab === 'day' && D) { drawIntraday(); select(sel); } else if (S.tab === 'days') renderDays(); else if (S.tab === 'nlkq' && ER_DATA) erDraw(); }, 200); });
  route();
})();
