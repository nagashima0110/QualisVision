// =============================================
// QualisBug - SVG チャートレンダラー
// =============================================

const BC = {
  accent: '#4fffb0', accent2: '#7b6cff', accent3: '#ff6b6b',
  accent4: '#ffd93d', accent5: '#4fafff', orange: '#ff9800',
  text: '#e8eaf0', text2: '#8892b0', text3: '#4a5272',
  surface2: '#1a1e2a', border: '#2a2f3f', bg: '#0a0c10',
};
const PALETTE = [BC.accent2, BC.accent, BC.accent3, BC.accent4, BC.accent5, BC.orange, '#e91e63', '#009688', '#ff5722', '#2196f3'];

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// max-width を設けず 100% 幅で表示（コンテナに合わせてスケール）
function mkSvg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${w} ${h}" style="display:block;">${body}</svg>`;
}
function scl(d0, d1, r0, r1) {
  if (d1 === d0) return () => (r0 + r1) / 2;
  return v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
}
function fmt(n) { return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)); }
function yGrid(yS, mt, ph, ml, pw, maxV, ticks = 5) {
  let g = '';
  for (let i = 0; i <= ticks; i++) {
    const v = maxV * i / ticks, y = yS(v).toFixed(1);
    g += `<line x1="${ml}" y1="${y}" x2="${ml + pw}" y2="${y}" stroke="${BC.border}" stroke-width="0.7"/>
      <text x="${ml - 8}" y="${y}" text-anchor="end" font-size="11" fill="${BC.text2}" dominant-baseline="middle">${fmt(v)}</text>`;
  }
  return g;
}
function noData(container, msg = 'データなし') {
  container.innerHTML = `<div style="padding:40px;text-align:center;color:${BC.text3};font-size:14px;">${msg}</div>`;
}

// =============================================
// パレート図
// =============================================
function renderParetoChart(container, data, title) {
  if (!data || !data.items.length) { noData(container); return; }
  const items = data.items.slice(0, 15);
  const W = 1000, H = 460, ml = 70, mr = 65, mt = 44, mb = 90;
  const pw = W - ml - mr, ph = H - mt - mb;
  const maxC = Math.max(...items.map(i => i.count), 1);
  const bw = Math.max(10, pw / items.length * 0.68);
  const xS = i => ml + (i + 0.5) * pw / items.length;
  const yS = scl(0, maxC, mt + ph, mt);
  const y2S = scl(0, 100, mt + ph, mt);

  let bars = '', xlb = '';
  items.forEach((item, i) => {
    const x = xS(i), y = yS(item.count), h = mt + ph - y;
    const col = item.cumPct <= 80 ? BC.accent2 : BC.text3;
    bars += `<rect x="${(x - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}" opacity="0.85" rx="3"/>
      <text x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" font-size="12" fill="${BC.text}">${item.count}</text>`;
    const lbl = item.label.length > 12 ? item.label.slice(0, 12) + '…' : item.label;
    const rx = x.toFixed(1), ry = (mt + ph + 12).toFixed(1);
    xlb += `<text x="${rx}" y="${ry}" text-anchor="end" font-size="11" fill="${BC.text2}" transform="rotate(-35,${rx},${ry})">${esc(lbl)}</text>`;
  });

  const pts = items.map((it, i) => `${xS(i).toFixed(1)},${y2S(it.cumPct).toFixed(1)}`).join(' ');
  const dots = items.map((it, i) => `<circle cx="${xS(i).toFixed(1)}" cy="${y2S(it.cumPct).toFixed(1)}" r="4" fill="${BC.accent4}"/>`).join('');
  const y80 = y2S(80).toFixed(1);
  let y2ticks = '';
  [0, 25, 50, 75, 100].forEach(p => {
    const y = y2S(p).toFixed(1);
    y2ticks += `<text x="${(ml + pw + 8)}" y="${y}" text-anchor="start" font-size="11" fill="${BC.accent4}" dominant-baseline="middle">${p}%</text>`;
  });

  container.innerHTML = mkSvg(W, H, `
    <text x="${W / 2}" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="${BC.text}">${esc(title)}</text>
    ${yGrid(yS, mt, ph, ml, pw, maxC)}${y2ticks}${bars}
    <polyline points="${pts}" fill="none" stroke="${BC.accent4}" stroke-width="2.5"/>${dots}
    <line x1="${ml}" y1="${y80}" x2="${ml + pw}" y2="${y80}" stroke="${BC.accent4}" stroke-width="1.2" stroke-dasharray="5,4" opacity="0.6"/>
    <text x="${ml + 6}" y="${parseFloat(y80) - 5}" font-size="11" fill="${BC.accent4}" opacity="0.8">80%</text>
    ${xlb}
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1"/>
    <line x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1"/>
    <line x1="${ml + pw}" y1="${mt}" x2="${ml + pw}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1" opacity="0.4"/>
    <text x="${ml - 50}" y="${mt + ph / 2}" text-anchor="middle" font-size="11" fill="${BC.text2}" transform="rotate(-90,${ml - 50},${mt + ph / 2})">件数</text>
    <text x="${ml + pw + 52}" y="${mt + ph / 2}" text-anchor="middle" font-size="11" fill="${BC.accent4}" transform="rotate(90,${ml + pw + 52},${mt + ph / 2})">累積%</text>
  `);
}

// =============================================
// 信頼性成長曲線
// =============================================
// models: [{predicted:[{t,predicted,...}], t95, type, mse, total}, ...] の配列
function renderLineChart(container, series, models, title) {
  if (!series || !series.length) { noData(container, '発見日データが不足しています'); return; }
  const validModels = (models || []).filter(m => m && m.predicted && m.predicted.length);
  const W = 1000, H = 460, ml = 75, mr = 24, mt = 44, mb = 64;
  const pw = W - ml - mr, ph = H - mt - mb;
  const allY = [
    ...series.map(p => p.cumulative),
    ...validModels.flatMap(m => m.predicted.map(p => p.predicted || 0)),
  ];
  const maxY = Math.max(...allY, 1) * 1.05;
  const maxT = Math.max(series.length, ...validModels.map(m => m.predicted.length)) - 1;
  const xS = scl(0, maxT, ml, ml + pw);
  const yS = scl(0, maxY, mt + ph, mt);

  const obsPath = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${xS(i).toFixed(1)},${yS(p.cumulative).toFixed(1)}`).join('');
  const obsArea = obsPath + ` L${xS(series.length - 1).toFixed(1)},${(mt + ph).toFixed(1)} L${ml},${(mt + ph).toFixed(1)} Z`;

  const pColors = [BC.accent3, BC.accent2];
  let predSvg = '', legendSvg = '';
  validModels.forEach((model, pi) => {
    const col = pColors[pi];
    const path = model.predicted.map((p, i) => `${i === 0 ? 'M' : 'L'}${xS(i).toFixed(1)},${yS(p.predicted).toFixed(1)}`).join('');
    predSvg += `<path d="${path}" fill="none" stroke="${col}" stroke-width="2.5" stroke-dasharray="${pi === 1 ? '8,4' : ''}"/>`;
    if (model.t95 != null && model.t95 <= maxT) {
      const x95 = xS(model.t95).toFixed(1);
      predSvg += `<line x1="${x95}" y1="${mt}" x2="${x95}" y2="${mt + ph}" stroke="${col}" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.6"/>
        <text x="${parseFloat(x95) + 4}" y="${mt + 14}" font-size="10" fill="${col}" opacity="0.8">95%収束</text>`;
    }
    const lx = ml + pi * 240, ly = H - 20;
    const r2 = Math.max(0, 1 - model.mse / Math.max(maxY * maxY / 4, 1)).toFixed(2);
    const label = model.type === 'gompertz' ? `ゴンペルツ曲線 (R²≈${r2})` : `ロジスティック曲線 (R²≈${r2})`;
    legendSvg += `<line x1="${lx}" y1="${ly}" x2="${lx + 24}" y2="${ly}" stroke="${col}" stroke-width="2.5" stroke-dasharray="${pi === 1 ? '8,4' : ''}"/>
      <text x="${lx + 30}" y="${ly + 4}" font-size="11" fill="${BC.text2}">${esc(label)}</text>`;
  });

  // X軸ラベル（最大8点）
  let xlb = '';
  const step = Math.max(1, Math.floor(series.length / 8));
  for (let i = 0; i < series.length; i += step) {
    const d = series[i].date;
    if (!d) continue;
    xlb += `<text x="${xS(i).toFixed(1)}" y="${mt + ph + 18}" text-anchor="middle" font-size="11" fill="${BC.text2}">${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}</text>`;
  }

  // 実績ラベル
  const legX = ml + Math.min(480, pw - 60);
  legendSvg += `<line x1="${legX}" y1="${H - 20}" x2="${legX + 24}" y2="${H - 20}" stroke="${BC.accent5}" stroke-width="2.5"/>
    <text x="${legX + 30}" y="${H - 16}" font-size="11" fill="${BC.text2}">実績</text>`;

  container.innerHTML = mkSvg(W, H, `
    <text x="${W / 2}" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="${BC.text}">${esc(title)}</text>
    ${yGrid(yS, mt, ph, ml, pw, maxY)}
    <path d="${obsArea}" fill="${BC.accent5}" opacity="0.1"/>
    <path d="${obsPath}" fill="none" stroke="${BC.accent5}" stroke-width="3"/>
    ${predSvg}${xlb}${legendSvg}
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1"/>
    <line x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1"/>
    <text x="${ml - 54}" y="${mt + ph / 2}" text-anchor="middle" font-size="11" fill="${BC.text2}" transform="rotate(-90,${ml - 54},${mt + ph / 2})">累積件数</text>
  `);
}

// =============================================
// 汎用棒グラフ
// =============================================
function renderBarChart(container, items, title, opts = {}) {
  if (!items || !items.length) { noData(container); return; }
  const W = 1000, H = 420, ml = 70, mr = 24, mt = 44, mb = items.length > 5 ? 90 : 64;
  const pw = W - ml - mr, ph = H - mt - mb;
  const maxV = Math.max(...items.map(i => i.value ?? i.count ?? 0), 1);
  const bw = Math.max(12, pw / items.length * 0.65);
  const xS = i => ml + (i + 0.5) * pw / items.length;
  const yS = scl(0, maxV * 1.08, mt + ph, mt);
  const colors = opts.colors || items.map((_, i) => PALETTE[i % PALETTE.length]);

  let bars = '', xlb = '';
  items.forEach((item, i) => {
    const v = item.value ?? item.count ?? 0;
    const x = xS(i), y = yS(v), h = mt + ph - y;
    bars += `<rect x="${(x - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="${colors[i]}" opacity="0.85" rx="3"/>
      <text x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}" text-anchor="middle" font-size="12" fill="${BC.text}">${v}${opts.unit ? opts.unit : ''}</text>`;
    const lbl = String(item.label || '').slice(0, 14);
    const rx = x.toFixed(1), ry = (mt + ph + 12).toFixed(1);
    if (items.length > 5) {
      xlb += `<text x="${rx}" y="${ry}" text-anchor="end" font-size="11" fill="${BC.text2}" transform="rotate(-35,${rx},${ry})">${esc(lbl)}</text>`;
    } else {
      xlb += `<text x="${rx}" y="${(mt + ph + 20)}" text-anchor="middle" font-size="12" fill="${BC.text2}">${esc(lbl)}</text>`;
    }
  });

  container.innerHTML = mkSvg(W, H, `
    <text x="${W / 2}" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="${BC.text}">${esc(title)}</text>
    ${yGrid(yS, mt, ph, ml, pw, maxV)}${bars}${xlb}
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1"/>
    <line x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1"/>
  `);
}

// =============================================
// DRE チャート
// =============================================
function renderDREChart(container, dreData) {
  const items = dreData.filter(d => d.foundHere > 0 || d.escaped > 0);
  if (!items.length) { noData(container, '混入工程・発見工程のマッピングが必要です'); return; }
  const W = 1000, H = 460, ml = 70, mr = 70, mt = 44, mb = 84;
  const pw = W - ml - mr, ph = H - mt - mb;
  const maxC = Math.max(...items.map(d => d.foundHere + d.escaped), 1);
  const bw = Math.max(12, pw / items.length * 0.35);
  const xS = i => ml + (i + 0.5) * pw / items.length;
  const yS = scl(0, maxC * 1.1, mt + ph, mt);
  const y2S = scl(0, 100, mt + ph, mt);

  let bars = '', xlb = '', dreL = '', dreD = '';
  items.forEach((d, i) => {
    const x = xS(i);
    const hF = mt + ph - yS(d.foundHere), hE = mt + ph - yS(d.escaped);
    bars += `<rect x="${(x - bw * 1.1).toFixed(1)}" y="${yS(d.foundHere).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,hF).toFixed(1)}" fill="${BC.accent2}" opacity="0.8" rx="3"/>
      <rect x="${(x + bw * 0.1).toFixed(1)}" y="${yS(d.escaped).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,hE).toFixed(1)}" fill="${BC.accent3}" opacity="0.8" rx="3"/>`;
    const lbl = d.phase.length > 8 ? d.phase.slice(0, 8) + '…' : d.phase;
    const rx = x.toFixed(1), ry = (mt + ph + 12).toFixed(1);
    xlb += `<text x="${rx}" y="${ry}" text-anchor="end" font-size="11" fill="${BC.text2}" transform="rotate(-30,${rx},${ry})">${esc(lbl)}</text>`;
    if (d.dre !== null) {
      dreL += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y2S(d.dre).toFixed(1)}`;
      dreD += `<circle cx="${x.toFixed(1)}" cy="${y2S(d.dre).toFixed(1)}" r="5" fill="${BC.accent4}"/>
        <text x="${x.toFixed(1)}" y="${(y2S(d.dre) - 10).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="${BC.accent4}">${d.dre}%</text>`;
    }
  });

  let y2t = '';
  [0, 25, 50, 75, 100].forEach(p => {
    y2t += `<text x="${(ml + pw + 8)}" y="${y2S(p).toFixed(1)}" text-anchor="start" font-size="11" fill="${BC.accent4}" dominant-baseline="middle">${p}%</text>`;
  });

  const leg = `
    <rect x="${ml}" y="${H - 24}" width="12" height="12" fill="${BC.accent2}" rx="2"/>
    <text x="${ml + 16}" y="${H - 13}" font-size="11" fill="${BC.text2}">当工程検出</text>
    <rect x="${ml + 110}" y="${H - 24}" width="12" height="12" fill="${BC.accent3}" rx="2"/>
    <text x="${ml + 126}" y="${H - 13}" font-size="11" fill="${BC.text2}">漏れ件数</text>
    <line x1="${ml + 215}" y1="${H - 18}" x2="${ml + 239}" y2="${H - 18}" stroke="${BC.accent4}" stroke-width="2.5"/>
    <circle cx="${ml + 227}" cy="${H - 18}" r="4" fill="${BC.accent4}"/>
    <text x="${ml + 246}" y="${H - 13}" font-size="11" fill="${BC.text2}">DRE(%)</text>`;

  container.innerHTML = mkSvg(W, H, `
    <text x="${W / 2}" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="${BC.text}">不具合除去効率 (DRE)</text>
    ${yGrid(yS, mt, ph, ml, pw, maxC)}${y2t}${bars}
    ${dreL ? `<path d="${dreL}" fill="none" stroke="${BC.accent4}" stroke-width="2.5"/>` : ''}${dreD}${xlb}${leg}
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1"/>
    <line x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1"/>
    <line x1="${ml + pw}" y1="${mt}" x2="${ml + pw}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1" opacity="0.5"/>
    <text x="${ml - 52}" y="${mt + ph / 2}" text-anchor="middle" font-size="11" fill="${BC.text2}" transform="rotate(-90,${ml - 52},${mt + ph / 2})">件数</text>
    <text x="${ml + pw + 56}" y="${mt + ph / 2}" text-anchor="middle" font-size="11" fill="${BC.accent4}" transform="rotate(90,${ml + pw + 56},${mt + ph / 2})">DRE (%)</text>
  `);
}

// =============================================
// ゾーン分析 散布図
// =============================================
function renderZoneScatter(container, zd) {
  if (!zd || zd.points.length < 2) { noData(container, 'データ不足（2機能以上の工数データが必要）'); return; }
  const { points, medBugs, medEffort } = zd;
  const W = 780, H = 540, ml = 72, mr = 24, mt = 44, mb = 72;
  const pw = W - ml - mr, ph = H - mt - mb;
  const maxB = Math.max(...points.map(p => p.bugs), 1);
  const maxE = Math.max(...points.map(p => p.effort), 1);
  const xS = scl(0, maxE * 1.15, ml, ml + pw);
  const yS = scl(0, maxB * 1.15, mt + ph, mt);
  const xM = xS(medEffort).toFixed(1), yM = yS(medBugs).toFixed(1);

  const ZC = { Q1: BC.accent3, Q2: BC.orange, Q3: BC.accent4, Q4: BC.accent };
  const ZL = [
    { z: 'Q1', x: parseFloat(xM) + (ml + pw - parseFloat(xM)) / 2, y: mt + ph * 0.16, t: '⚠ 高工数・多バグ', s: '非効率' },
    { z: 'Q2', x: ml + (parseFloat(xM) - ml) / 2,                  y: mt + ph * 0.16, t: '🔥 低工数・多バグ', s: 'リスク大' },
    { z: 'Q3', x: parseFloat(xM) + (ml + pw - parseFloat(xM)) / 2, y: mt + ph * 0.86, t: '📌 高工数・少バグ', s: '過剰?' },
    { z: 'Q4', x: ml + (parseFloat(xM) - ml) / 2,                  y: mt + ph * 0.86, t: '✅ 低工数・少バグ', s: '良好' },
  ];

  const quads = `
    <rect x="${ml}" y="${mt}" width="${parseFloat(xM) - ml}" height="${parseFloat(yM) - mt}" fill="${BC.accent3}" opacity="0.05"/>
    <rect x="${xM}" y="${mt}" width="${ml + pw - parseFloat(xM)}" height="${parseFloat(yM) - mt}" fill="${BC.accent3}" opacity="0.04"/>
    <rect x="${ml}" y="${yM}" width="${parseFloat(xM) - ml}" height="${mt + ph - parseFloat(yM)}" fill="${BC.accent}" opacity="0.04"/>
    <rect x="${xM}" y="${yM}" width="${ml + pw - parseFloat(xM)}" height="${mt + ph - parseFloat(yM)}" fill="${BC.accent}" opacity="0.06"/>
    <line x1="${xM}" y1="${mt}" x2="${xM}" y2="${mt + ph}" stroke="${BC.text2}" stroke-width="1.2" stroke-dasharray="5,4"/>
    <line x1="${ml}" y1="${yM}" x2="${ml + pw}" y2="${yM}" stroke="${BC.text2}" stroke-width="1.2" stroke-dasharray="5,4"/>`;

  const dots = points.map(p => {
    const cx = xS(p.effort).toFixed(1), cy = yS(p.bugs).toFixed(1);
    const lbl = p.module.length > 12 ? p.module.slice(0, 12) + '…' : p.module;
    return `<circle cx="${cx}" cy="${cy}" r="8" fill="${ZC[p.zone]}" opacity="0.85"/>
      <text x="${cx}" y="${(parseFloat(cy) - 12).toFixed(1)}" text-anchor="middle" font-size="10" fill="${BC.text2}">${esc(lbl)}</text>`;
  }).join('');

  const zLabels = ZL.map(z => `
    <text x="${z.x}" y="${z.y}" text-anchor="middle" font-size="12" font-weight="700" fill="${ZC[z.z]}" opacity="0.7">${esc(z.t)}</text>
    <text x="${z.x}" y="${z.y + 17}" text-anchor="middle" font-size="11" fill="${BC.text2}" opacity="0.5">(${z.s})</text>`).join('');

  let xt = '', yt = '';
  for (let i = 0; i <= 5; i++) {
    const v = maxE * 1.15 * i / 5, x = xS(v).toFixed(1);
    xt += `<text x="${x}" y="${mt + ph + 20}" text-anchor="middle" font-size="11" fill="${BC.text2}">${Math.round(v)}h</text>
      <line x1="${x}" y1="${mt}" x2="${x}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="0.6"/>`;
    const bv = maxB * 1.15 * i / 5, y = yS(bv).toFixed(1);
    yt += `<text x="${ml - 8}" y="${y}" text-anchor="end" font-size="11" fill="${BC.text2}" dominant-baseline="middle">${Math.round(bv)}</text>
      <line x1="${ml}" y1="${y}" x2="${ml + pw}" y2="${y}" stroke="${BC.border}" stroke-width="0.6"/>`;
  }

  container.innerHTML = mkSvg(W, H, `
    <text x="${W / 2}" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="${BC.text}">ゾーン分析</text>
    ${quads}${xt}${yt}${dots}${zLabels}
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1"/>
    <line x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}" stroke="${BC.border}" stroke-width="1"/>
    <text x="${ml + pw / 2}" y="${mt + ph + 50}" text-anchor="middle" font-size="12" fill="${BC.text2}">テスト工数 (h)</text>
    <text x="${ml - 54}" y="${mt + ph / 2}" text-anchor="middle" font-size="12" fill="${BC.text2}" transform="rotate(-90,${ml - 54},${mt + ph / 2})">不具合件数</text>
  `);
}

// =============================================
// ドーナツ円グラフ
// =============================================
function renderDonutChart(container, items, title) {
  if (!items || !items.length) { noData(container); return; }
  const W = 640, H = 360, cx = 160, cy = 186, R = 128, r = 74;
  const total = items.reduce((s, i) => s + i.count, 0);
  let paths = '', leg = '';
  let ang = -Math.PI / 2;
  items.forEach((item, i) => {
    const frac = item.count / total;
    const a1 = ang, a2 = ang + frac * 2 * Math.PI;
    const lrg = frac > 0.5 ? 1 : 0;
    const col = PALETTE[i % PALETTE.length];
    const cos1 = Math.cos(a1), sin1 = Math.sin(a1), cos2 = Math.cos(a2), sin2 = Math.sin(a2);
    paths += `<path d="M${(cx + R * cos1).toFixed(1)},${(cy + R * sin1).toFixed(1)} A${R},${R},0,${lrg},1,${(cx + R * cos2).toFixed(1)},${(cy + R * sin2).toFixed(1)} L${(cx + r * cos2).toFixed(1)},${(cy + r * sin2).toFixed(1)} A${r},${r},0,${lrg},0,${(cx + r * cos1).toFixed(1)},${(cy + r * sin1).toFixed(1)} Z" fill="${col}" opacity="0.85"/>`;
    ang = a2;
    const ly = 36 + i * 26;
    if (ly < H - 10) {
      const pct = Math.round(frac * 100);
      leg += `<rect x="325" y="${ly - 9}" width="13" height="13" fill="${col}" rx="2"/>
        <text x="343" y="${ly + 2}" font-size="12" fill="${BC.text2}">${esc(String(item.label).slice(0, 18))} (${item.count} / ${pct}%)</text>`;
    }
  });

  container.innerHTML = mkSvg(W, H, `
    <text x="${W / 2}" y="24" text-anchor="middle" font-size="15" font-weight="700" fill="${BC.text}">${esc(title)}</text>
    ${paths}
    <circle cx="${cx}" cy="${cy}" r="${r - 2}" fill="${BC.bg}"/>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="26" font-weight="800" fill="${BC.text}">${total}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="12" fill="${BC.text2}">総件数</text>
    ${leg}
  `);
}

window.BugCharts = {
  renderParetoChart, renderLineChart, renderBarChart,
  renderDREChart, renderZoneScatter, renderDonutChart,
};
