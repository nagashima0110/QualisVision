// =============================================
// QualisBug - 分析エンジン
// =============================================

const BUG_PHASES_DEFAULT = ['要件定義','基本設計','詳細設計','実装','単体テスト','結合テスト','システムテスト','受入テスト'];

// ========== Excel パース ==========

function parseBugExcel(rawData) {
  if (!rawData || rawData.length === 0) return { headers: [], rows: [] };
  const rawHeaders = rawData[0] || [];
  const totalCols = rawHeaders.length;
  const colHasContent = new Array(totalCols).fill(false);
  for (let j = 0; j < totalCols; j++) {
    if (rawHeaders[j] != null && String(rawHeaders[j]).trim() !== '') colHasContent[j] = true;
  }
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;
    for (let j = 0; j < Math.min(row.length, totalCols); j++) {
      if (row[j] != null && String(row[j]).trim() !== '') colHasContent[j] = true;
    }
  }
  const validCols = colHasContent.map((has, i) => has ? i : -1).filter(i => i >= 0);
  if (validCols.length === 0) return { headers: [], rows: [] };
  const headers = validCols.map((ci, ni) => {
    const h = rawHeaders[ci];
    return h != null && String(h).trim() !== '' ? String(h).trim() : `列${ni + 1}`;
  });
  const rows = [];
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;
    const remapped = validCols.map(ci => row[ci] ?? null);
    if (remapped.some(v => v != null && String(v).trim() !== ''))
      rows.push(remapped.map(v => (v != null ? String(v).trim() : '')));
  }
  return { headers, rows };
}

// ========== 日付パース ==========

function parseJsDate(val) {
  if (!val) return null;
  if (typeof val === 'number' && val > 1000) {
    const d = new Date(Math.round((val - 25569) * 86400000));
    return isNaN(d) ? null : d;
  }
  const s = String(val).trim();
  if (!s) return null;
  let d = new Date(s);
  if (!isNaN(d)) return d;
  const m = s.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  return null;
}

// ========== バグオブジェクト生成 ==========

function mapBugRecords(rows, mapping) {
  const REG_TRUE = new Set(['yes','true','1','あり','再発','デグレード','○','◯','●','y']);
  return rows.map((row, i) => {
    const bug = { _row: i + 2 };
    for (const [field, idx] of Object.entries(mapping)) {
      if (idx == null || idx < 0) continue;
      const v = row[idx];
      bug[field] = v != null && v !== '' ? v : null;
    }
    bug._foundDate  = parseJsDate(bug.foundDate);
    bug._fixedDate  = parseJsDate(bug.fixedDate);
    bug._isRegression = bug.isRegression
      ? REG_TRUE.has(String(bug.isRegression).toLowerCase().trim())
      : false;
    return bug;
  }).filter(b => Object.keys(b).length > 1);
}

// ========== パレート ==========

function calcPareto(bugs, field) {
  const counts = {};
  let mapped = 0;
  for (const b of bugs) {
    if (!b[field]) continue;
    counts[b[field]] = (counts[b[field]] || 0) + 1;
    mapped++;
  }
  if (mapped === 0) return null;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, c]) => s + c, 0);
  let cum = 0;
  return {
    items: sorted.map(([label, count]) => {
      cum += count;
      return { label, count, pct: Math.round(count / total * 100), cumPct: Math.round(cum / total * 100) };
    }),
    total,
    unmapped: bugs.length - mapped,
  };
}

// ========== 時系列 ==========

function buildTimeSeries(bugs, unitDays = 7) {
  const withDate = bugs.filter(b => b._foundDate);
  if (withDate.length < 3) return null;
  const times = withDate.map(b => b._foundDate.getTime());
  const minT = Math.min(...times), maxT = Math.max(...times);
  const unitMs = unitDays * 86400000;
  const numUnits = Math.ceil((maxT - minT) / unitMs) + 1;
  if (numUnits > 500) return null;
  const counts = new Array(numUnits).fill(0);
  for (const b of withDate) {
    const idx = Math.floor((b._foundDate.getTime() - minT) / unitMs);
    if (idx >= 0 && idx < numUnits) counts[idx]++;
  }
  let cum = 0;
  const series = counts.map((count, i) => {
    cum += count;
    return { t: i, count, cumulative: cum, date: new Date(minT + i * unitMs) };
  });
  return { series, minDate: new Date(minT), maxDate: new Date(maxT), total: cum, unitDays };
}

// ========== 曲線フィット共通 ==========

function linReg(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const ssxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const ssx  = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const slope = ssx > 0 ? ssxy / ssx : 0;
  return { slope, intercept: my - slope * mx };
}

function extendPredictions(series, predictFn, params) {
  const N = series.length;
  const extN = Math.ceil(N * 1.4);
  return Array.from({ length: extN }, (_, i) => ({
    t: i,
    cumulative: i < N ? series[i].cumulative : null,
    predicted: predictFn(params, i),
    date: i < N ? series[i].date : null,
  }));
}

// ========== ゴンペルツ ==========

function fitGompertz(series) {
  const obs = series.map(s => s.cumulative);
  const maxObs = Math.max(...obs);
  if (maxObs === 0) return null;
  let best = null, bestMSE = Infinity;
  for (let f = 1.05; f <= 3.0; f += 0.05) {
    const a = maxObs * f;
    const pts = [];
    for (let i = 0; i < obs.length; i++) {
      const y = obs[i];
      if (y <= 0 || y >= a) continue;
      const inner = -Math.log(y / a);
      if (inner <= 0) continue;
      pts.push({ x: i, y: Math.log(inner) });
    }
    if (pts.length < 3) continue;
    const { slope, intercept } = linReg(pts.map(p => p.x), pts.map(p => p.y));
    const b = Math.exp(intercept), c = -slope;
    if (b <= 0 || c <= 0) continue;
    const pred = obs.map((_, i) => a * Math.exp(-b * Math.exp(-c * i)));
    const mse = pred.reduce((s, p, i) => s + (p - obs[i]) ** 2, 0) / obs.length;
    if (mse < bestMSE) { bestMSE = mse; best = { a, b, c }; }
  }
  if (!best) return null;
  const { a, b, c } = best;
  const fn = ({ a, b, c }, t) => a * Math.exp(-b * Math.exp(-c * t));
  const t95 = c > 0 ? Math.ceil(-Math.log(-Math.log(0.95) / b) / c) : null;
  return { params: best, predicted: extendPredictions(series, fn, best), t95, mse: bestMSE, type: 'gompertz', total: a };
}

// ========== ロジスティック ==========

function fitLogistic(series) {
  const obs = series.map(s => s.cumulative);
  const maxObs = Math.max(...obs);
  if (maxObs === 0) return null;
  let best = null, bestMSE = Infinity;
  for (let f = 1.05; f <= 3.0; f += 0.05) {
    const a = maxObs * f;
    const pts = [];
    for (let i = 0; i < obs.length; i++) {
      const y = obs[i];
      if (y <= 0 || y >= a) continue;
      pts.push({ x: i, y: Math.log(y / (a - y)) });
    }
    if (pts.length < 3) continue;
    const { slope, intercept } = linReg(pts.map(p => p.x), pts.map(p => p.y));
    const b = slope, c = slope !== 0 ? -intercept / slope : 0;
    if (b <= 0) continue;
    const pred = obs.map((_, i) => a / (1 + Math.exp(-b * (i - c))));
    const mse = pred.reduce((s, p, i) => s + (p - obs[i]) ** 2, 0) / obs.length;
    if (mse < bestMSE) { bestMSE = mse; best = { a, b, c }; }
  }
  if (!best) return null;
  const { a, b, c } = best;
  const fn = ({ a, b, c }, t) => a / (1 + Math.exp(-b * (t - c)));
  const t95 = Math.ceil(c + Math.log(19) / b);
  return { params: best, predicted: extendPredictions(series, fn, best), t95, mse: bestMSE, type: 'logistic', total: a };
}

// ========== DRE ==========

function calcDRE(bugs, phaseOrder) {
  const phases = phaseOrder || BUG_PHASES_DEFAULT;
  const rank = Object.fromEntries(phases.map((p, i) => [p, i]));
  return phases.map(phase => {
    const pRank = rank[phase];
    const foundHere = bugs.filter(b => b.foundPhase === phase).length;
    const escaped   = bugs.filter(b => {
      const ir = rank[b.injectedPhase], fr = rank[b.foundPhase];
      return ir != null && fr != null && ir <= pRank && fr > pRank;
    }).length;
    const dre = (foundHere + escaped) > 0
      ? Math.round(foundHere / (foundHere + escaped) * 1000) / 10 : null;
    return { phase, foundHere, escaped, dre };
  });
}

// ========== 修正期間 ==========

function calcFixDuration(bugs) {
  const valid = bugs
    .filter(b => b._foundDate && b._fixedDate && b._fixedDate >= b._foundDate)
    .map(b => ({ ...b, days: Math.round((b._fixedDate - b._foundDate) / 86400000) }));
  if (!valid.length) return null;
  const allDays = valid.map(b => b.days).sort((a, b) => a - b);
  const avg    = Math.round(allDays.reduce((s, d) => s + d, 0) / allDays.length * 10) / 10;
  const median = allDays[Math.floor(allDays.length / 2)];
  const p90    = allDays[Math.floor(allDays.length * 0.9)];
  const buckets = [
    { label: '1日以内', min: 0, max: 1 }, { label: '2〜3日', min: 2, max: 3 },
    { label: '4〜7日', min: 4, max: 7 },   { label: '8〜14日', min: 8, max: 14 },
    { label: '15〜30日', min: 15, max: 30 }, { label: '31日以上', min: 31, max: Infinity },
  ];
  const histogram = buckets.map(b => ({ ...b, count: allDays.filter(d => d >= b.min && d <= b.max).length }));
  const bySev = {};
  for (const b of valid) {
    const s = b.severity || '（未設定）';
    if (!bySev[s]) bySev[s] = [];
    bySev[s].push(b.days);
  }
  const bySeverity = Object.entries(bySev).map(([severity, ds]) => ({
    severity, count: ds.length,
    avg: Math.round(ds.reduce((s, d) => s + d, 0) / ds.length * 10) / 10,
  })).sort((a, b) => b.avg - a.avg);
  return { avg, median, p90, max: allDays[allDays.length - 1], histogram, bySeverity, total: valid.length };
}

// ========== 再発・デグレード ==========

function calcRegressionRate(bugs) {
  const total = bugs.length;
  const regs = bugs.filter(b => b._isRegression).length;
  const byPhase = {};
  for (const b of bugs) {
    if (!b.foundPhase) continue;
    if (!byPhase[b.foundPhase]) byPhase[b.foundPhase] = { total: 0, reg: 0 };
    byPhase[b.foundPhase].total++;
    if (b._isRegression) byPhase[b.foundPhase].reg++;
  }
  return {
    total, regs, rate: total > 0 ? Math.round(regs / total * 1000) / 10 : 0,
    byPhase: Object.entries(byPhase).map(([phase, d]) => ({
      phase, total: d.total, reg: d.reg,
      rate: d.total > 0 ? Math.round(d.reg / d.total * 1000) / 10 : 0,
    })),
  };
}

// ========== ゾーン分析（9ゾーン: テスト数 × バグ数） ==========
//
// ゾーン配置（バグ多い=上、テスト多い=右）:
//   バグ多 | 8  5  6
//   バグ中 | 7  1  4
//   バグ少 | 9  3  2
//          テスト: 少 中 多
//
// 閾値: 33パーセンタイル / 67パーセンタイル

const ZONE_MAP = [
  [9, 3, 2],  // バグ少（Low）: テスト少→9, 中→3, 多→2
  [7, 1, 4],  // バグ中（Med）: テスト少→7, 中→1, 多→4
  [8, 5, 6],  // バグ多（High）: テスト少→8, 中→5, 多→6
];

const ZONE_INFO = {
  1: { label: '期待通り',             color: '#4fffb0', desc: 'テスト数に対して期待通りのバグが発見できている' },
  2: { label: 'バグ少（品質良好）',    color: '#4fafff', desc: 'テスト数に対してバグの数が少ない' },
  3: { label: 'テスト効率が良い',      color: '#7b6cff', desc: 'テスト数は少ないがバグを発見できている（テスト内容を見直す）' },
  4: { label: 'テスト効率が悪い',      color: '#ffd93d', desc: 'テスト数に対してバグの発見が少ない' },
  5: { label: 'バグ多（品質問題）',    color: '#ff9800', desc: 'テスト数に対してバグの発見が多い（品質確保できていない）' },
  6: { label: 'バグ多・テスト多（深刻）', color: '#ff6b6b', desc: 'テストすればするほどバグが見つかる状態（品質確保できていない）' },
  7: { label: 'テスト不足・バグ中',    color: '#ff9800', desc: 'テストが少ないがバグがある程度出ている（テスト不足・品質問題）' },
  8: { label: 'テスト不足・バグ多（最悪）', color: '#ff3b3b', desc: 'テストが少なくバグが多い（テスト不足・品質問題が深刻）' },
  9: { label: 'テストが少ない',        color: '#4a5272', desc: 'テスト数が少なく判断できない（テスト不足）' },
};

function pct(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function calcZoneAnalysis(bugs, testCountMap) {
  const bugsByMod = {};
  for (const b of bugs) {
    const m = b.module || '（未分類）';
    bugsByMod[m] = (bugsByMod[m] || 0) + 1;
  }
  const allMods = new Set([...Object.keys(bugsByMod), ...Object.keys(testCountMap)]);
  const points = [...allMods].map(m => ({
    module: m,
    bugs:  bugsByMod[m] || 0,
    tests: parseFloat(testCountMap[m]) || 0,
  })).filter(p => p.bugs > 0 || p.tests > 0);

  if (points.length < 3) return { points, thresholds: null };

  // 33・67パーセンタイルで3分割
  const sb = [...points.map(p => p.bugs)].sort((a, b) => a - b);
  const st = [...points.map(p => p.tests)].sort((a, b) => a - b);
  const b33 = pct(sb, 0.33), b67 = pct(sb, 0.67);
  const t33 = pct(st, 0.33), t67 = pct(st, 0.67);

  return {
    points: points.map(p => {
      const tl = p.tests <= t33 ? 0 : p.tests <= t67 ? 1 : 2;
      const bl = p.bugs  <= b33 ? 0 : p.bugs  <= b67 ? 1 : 2;
      const zoneNum = ZONE_MAP[bl][tl];
      return { ...p, zone: zoneNum, testLevel: tl, bugLevel: bl };
    }),
    thresholds: { b33, b67, t33, t67 },
  };
}

// ========== ODC ==========

function calcODC(bugs) {
  const dims = [
    { id: 'odcType', label: '欠陥タイプ' },
    { id: 'odcTrigger', label: 'トリガー' },
    { id: 'odcTarget', label: 'ターゲット' },
    { id: 'odcImpact', label: 'インパクト' },
  ];
  const out = {};
  for (const { id, label } of dims) {
    const counts = {};
    for (const b of bugs) {
      if (!b[id]) continue;
      counts[b[id]] = (counts[b[id]] || 0) + 1;
    }
    if (Object.keys(counts).length > 0)
      out[id] = { label, items: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([l, c]) => ({ label: l, count: c })) };
  }
  return out;
}

window.BugAnalysisEngine = {
  parseBugExcel, mapBugRecords, calcPareto,
  buildTimeSeries, fitGompertz, fitLogistic,
  calcDRE, calcFixDuration, calcRegressionRate,
  calcZoneAnalysis, calcODC, BUG_PHASES_DEFAULT, ZONE_INFO,
};
