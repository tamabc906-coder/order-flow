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
  return {tab: ['list', 'day', 'days', 'guide'].includes(tab) ? tab : 'list', sym: sym || null, day: day || null};
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
    a.href = '#' + a.dataset.tab + (S.sym && (a.dataset.tab === 'day' || a.dataset.tab === 'days') ? '/' + S.sym : '');
  });
  if (S.sym) LS.set('of.sym', S.sym);
  scrollTo(0, 0);
  try {
    if (S.tab === 'list') renderList();
    else if (S.tab === 'day') await renderDay(h.day);
    else if (S.tab === 'days') await renderDays();
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
    $('d-date').innerHTML = ''; $('d-tiles').innerHTML = ''; $('fp').innerHTML = ''; $('d-sigs').innerHTML = '';
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
  $('d-sigs').innerHTML = V.sigs.length ? V.sigs.map(s =>
    `<li><button data-i="${s.i}">${s.t}</button>${sigTag(s.kind)}. ${esc(s.text)}</li>`).join('')
    : `<li class="empty">${D.no_side ? 'Nguồn không có bên chủ động cho mã này — không đánh được dấu hiệu.' : 'Phiên này không có dấu hiệu nào vượt ngưỡng.'}</li>`;
  $('d-sigs').querySelectorAll('button').forEach(b => b.onclick = () => {
    select(+b.dataset.i);
    if (innerWidth <= 860) $('fpcard').scrollIntoView({behavior: 'smooth', block: 'start'});
  });
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
}
$('fp-prev').onclick = () => select(sel - 1);
$('fp-next').onclick = () => select(sel + 1);
document.addEventListener('keydown', e => {
  if (S.tab !== 'day' || !D || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowLeft') select(sel - 1);
  if (e.key === 'ArrowRight') select(sel + 1);
});

// ---------------------------------------------------------------- ③ Nhiều phiên
async function renderDays() {
  fillSymSelect($('m-sym'));
  $('m-sym').onchange = () => go('days', $('m-sym').value);
  const host = $('m-chart');
  host.innerHTML = '';
  $('m-whale').innerHTML = '';
  let data;
  try { data = await getJSON(`daily/${S.sym}.json`); } catch (e) { host.innerHTML = '<p class="empty">Không tải được dữ liệu mã này.</p>'; return; }
  const Ds = data.days.slice(-20);
  $('m-pill').textContent = `${Ds.length} phiên gần nhất · ${data.ex}`;
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
    if (d.intraday) t.addEventListener('click', () => go('day', S.sym, d.d));
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
  for (const d of [...data.days].reverse()) t += `<tr><td>${d.intraday ? `<a href="#day/${S.sym}/${d.d}" class="gold">${dd(d.d)}</a>` : dd(d.d)}${d.f !== 1 ? `<span class="tag" title="Giá thô ${px(d.raw)} × ${d.f}">điều chỉnh</span>` : ''}${d.gap ? `<span class="tag">hụt ${fmt(d.gap)}</span>` : ''}</td>` +
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
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (S.tab === 'day' && D) { drawIntraday(); select(sel); } else if (S.tab === 'days') renderDays(); }, 200); });
  route();
})();
