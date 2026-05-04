// =============================================
// QualisCoverage - 分析エンジン
// =============================================

const EXCLUDE_KEYWORDS = [
  // テスト結果・判定系
  '結果', '期待', '判定', '合否', '備考', 'メモ', 'コメント',
  'note', 'result', 'expected', 'remark', 'comment', 'pass', 'fail', 'status',
  // 管理・連番系
  '番号', '通番', '実施日', '日付', '担当', 'date', 'no.', 'tester', 'author',
];

// 理論組み合わせ数の上限（これを超えるグループはスキップ）
const MAX_THEORETICAL_PER_GROUP = 50000;
// 未カバー一覧の表示件数上限
const MAX_UNCOVERED_DISPLAY = 200;
// チャンク処理: 何グループ処理するごとにUIに制御を返すか
const CHUNK_SIZE = 50;

/**
 * Excelデータをパースしてテストケース行列に変換
 * 結合セルを自動補完する
 * 書式だけ存在し値が一切ない列（幽霊列）は除外する
 */
function parseExcelData(rawData) {
  if (!rawData || rawData.length === 0) return { headers: [], rows: [] };

  const rawHeaders = rawData[0] || [];
  const totalCols = rawHeaders.length;

  // --- ステップ1: 値が1件でもある列のみ有効列とする ---
  // 書式だけ適用された空列（例: PictMaster生成ファイルの列7〜53）を除外
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

  // --- ステップ2: 有効列のみでヘッダーを構築 ---
  const headers = validCols.map((ci, ni) => {
    const h = rawHeaders[ci];
    return h != null && String(h).trim() !== '' ? String(h).trim() : `列${ni + 1}`;
  });
  const headerSet = new Set(headers.filter(h => h !== ''));
  const rows = [];
  const lastValues = new Array(headers.length).fill(null);

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;

    // 有効列だけ抽出した行を作成
    const remapped = validCols.map(ci => (row[ci] != null ? row[ci] : null));

    // 途中ヘッダー行の検出: 非空セルの中でヘッダー名と完全一致するものが80%以上
    const nonEmptyCells = remapped.filter(v => v != null && String(v).trim() !== '');
    if (nonEmptyCells.length >= 3) {
      const headerMatchCount = nonEmptyCells.filter(v => headerSet.has(String(v).trim())).length;
      if (headerMatchCount / nonEmptyCells.length >= 0.8) {
        lastValues.fill(null);
        continue;
      }
    }

    const filled = [];
    let hasAnyValue = false;

    for (let j = 0; j < headers.length; j++) {
      const val = remapped[j];
      if (val != null && String(val).trim() !== '') {
        lastValues[j] = String(val).trim();
        filled.push(lastValues[j]);
        hasAnyValue = true;
      } else {
        filled.push(lastValues[j] || '');
        if (lastValues[j]) hasAnyValue = true;
      }
    }

    if (hasAnyValue) rows.push(filled);
  }

  return { headers, rows };
}

/**
 * 全値ユニーク＋連番・IDパターンの列を検出（行番号・テストケースIDなど）
 */
function isIdLikeColumn(colValues) {
  if (colValues.length < 3) return false;
  const strs = colValues.map(v => String(v).trim());
  const unique = new Set(strs);
  if (unique.size !== strs.length) return false; // 重複があれば通常の因子値
  const idPat = /^[A-Za-z_\-#№.]*\d+[A-Za-z_\-]*$/;
  const matchCount = strs.filter(v => idPat.test(v)).length;
  return matchCount / strs.length >= 0.8;
}

/**
 * 除外候補列を自動検出（rows を渡すと ID列ヒューリスティックも適用）
 */
function detectExcludeColumns(headers, rows) {
  return headers.map((h, i) => {
    const lower = h.toLowerCase();
    const byKeyword = EXCLUDE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
    let byHeuristic = false;
    if (!byKeyword && rows && rows.length > 0) {
      const colValues = rows.map(r => r[i]).filter(v => v != null && v !== '');
      byHeuristic = isIdLikeColumn(colValues);
    }
    return { index: i, name: h, autoExclude: byKeyword || byHeuristic, reason: byHeuristic ? 'ID列' : byKeyword ? 'キーワード' : null };
  });
}

/**
 * 各因子の値域を取得
 */
function getFactorValues(rows, colIndices) {
  const valuesMap = {};
  for (const idx of colIndices) {
    const vals = [...new Set(rows.map(r => r[idx]).filter(v => v != null && v !== ''))];
    valuesMap[idx] = vals;
  }
  return valuesMap;
}

/**
 * N因子間の組み合わせカバレッジを計算（非同期・チャンク処理）
 * progressCallback(done, total) を CHUNK_SIZE グループごとに呼び出す
 */
async function calcCombinationCoverageAsync(rows, colIndices, n, progressCallback) {
  if (colIndices.length < n) return null;

  const factorValues = getFactorValues(rows, colIndices);
  const factorCombinations = combinations(colIndices, n);
  const total = factorCombinations.length;
  const results = [];

  for (let i = 0; i < total; i++) {
    // CHUNK_SIZE ごとに UI スレッドに制御を返す
    if (i > 0 && i % CHUNK_SIZE === 0) {
      if (progressCallback) progressCallback(i, total);
      await new Promise(r => setTimeout(r, 0));
    }

    const factorCombo = factorCombinations[i];
    const valueSets = factorCombo.map(fi => factorValues[fi]);

    // 因子の値が空の場合はスキップ（bugfix: theoreticalSize=0→100%問題の防止）
    if (valueSets.some(vs => !vs || vs.length === 0)) {
      results.push({
        factors: factorCombo,
        theoreticalCount: 0,
        coveredCount: 0,
        uncoveredCount: 0,
        coverage: null,
        uncoveredCombos: [],
        uncoveredTotal: 0,
        skipped: false,
        warning: '値が存在しない因子が含まれています'
      });
      continue;
    }

    // 理論組み合わせ数を先に見積もり（組み合わせ爆発を防止）
    const theoreticalSize = valueSets.reduce((acc, vs) => acc * vs.length, 1);

    if (theoreticalSize > MAX_THEORETICAL_PER_GROUP) {
      results.push({
        factors: factorCombo,
        theoreticalCount: theoreticalSize,
        coveredCount: null,
        uncoveredCount: null,
        coverage: null,
        uncoveredCombos: [],
        uncoveredTotal: 0,
        skipped: true,
        warning: `理論組み合わせ数が${MAX_THEORETICAL_PER_GROUP.toLocaleString()}件を超えるため省略`
      });
      continue;
    }

    const theoreticalCombos = cartesianProduct(valueSets);
    const theoreticalSet = new Set(theoreticalCombos.map(c => c.join('\0')));

    // 実際のテストケースで現れた組み合わせ
    const actualSet = new Set();
    for (const row of rows) {
      if (factorCombo.every(fi => row[fi] != null && row[fi] !== '')) {
        actualSet.add(factorCombo.map(fi => row[fi]).join('\0'));
      }
    }

    const uncoveredAll = [...theoreticalSet].filter(k => !actualSet.has(k));
    const coveredCount = theoreticalSet.size - uncoveredAll.length;
    const coverage = (coveredCount / theoreticalSet.size) * 100;

    results.push({
      factors: factorCombo,
      theoreticalCount: theoreticalSet.size,
      coveredCount,
      uncoveredCount: uncoveredAll.length,
      coverage: Math.round(coverage * 10) / 10,
      uncoveredCombos: uncoveredAll.slice(0, MAX_UNCOVERED_DISPLAY).map(k => k.split('\0')),
      uncoveredTotal: uncoveredAll.length,
      skipped: false,
      warning: null
    });
  }

  return results;
}

// 因子グループ数の事前計算（配列を生成せず数値だけ返す）
function combinationsCount(n, k) {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let c = 1;
  for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1);
  return Math.round(c);
}

/**
 * 値の出現バランス分析
 */
function analyzeValueBalance(rows, colIndices, headers) {
  const result = [];
  for (const idx of colIndices) {
    const counts = {};
    for (const row of rows) {
      const v = row[idx];
      if (v != null && v !== '') counts[v] = (counts[v] || 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const entries = Object.entries(counts).map(([val, cnt]) => ({
      value: val,
      count: cnt,
      ratio: total > 0 ? Math.round((cnt / total) * 1000) / 10 : 0
    })).sort((a, b) => b.count - a.count);

    result.push({
      factorIndex: idx,
      factorName: headers[idx],
      total,
      values: entries
    });
  }
  return result;
}

/**
 * 重複テストケース検出
 */
function detectDuplicates(rows, colIndices) {
  const seen = new Map();

  rows.forEach((row, i) => {
    const key = colIndices.map(fi => row[fi]).join('\0');
    if (seen.has(key)) {
      seen.get(key).push(i + 2);
    } else {
      seen.set(key, [i + 2]);
    }
  });

  const duplicates = [];
  for (const [key, lineNums] of seen) {
    if (lineNums.length > 1) {
      duplicates.push({
        values: key.split('\0'),
        rows: lineNums,
        count: lineNums.length
      });
    }
  }
  return duplicates;
}

/**
 * N因子密度マップデータ生成
 * N=2: 通常の2D行列
 * N=3: factor3の値ごとにスライスした複数の2D行列
 */
function calcDensityMapN(rows, factorIndices, headers) {
  const n = factorIndices.length;
  if (n < 2) return null;

  if (n === 2) {
    const [fi, fj] = factorIndices;
    return calcDensityMap(rows, fi, fj, headers);
  }

  // N=3以上: 最後の因子をsliceキーとして使い、残り2因子で2D行列を生成
  const fi = factorIndices[0];
  const fj = factorIndices[1];
  const sliceFactors = factorIndices.slice(2);

  const valsI = [...new Set(rows.map(r => r[fi]).filter(v => v && v !== ''))].sort();
  const valsJ = [...new Set(rows.map(r => r[fj]).filter(v => v && v !== ''))].sort();

  // sliceファクターの各組み合わせごとに行列を生成
  const sliceValueSets = sliceFactors.map(sf =>
    [...new Set(rows.map(r => r[sf]).filter(v => v && v !== ''))].sort()
  );
  const sliceCombos = cartesianProduct(sliceValueSets);

  const slices = sliceCombos.map(sliceVals => {
    const sliceLabel = sliceFactors.map((sf, i) => `${headers[sf]}=${sliceVals[i]}`).join(', ');
    const matrix = {};
    for (const vi of valsI) {
      matrix[vi] = {};
      for (const vj of valsJ) matrix[vi][vj] = 0;
    }

    for (const row of rows) {
      const matchesSlice = sliceFactors.every((sf, i) => row[sf] === sliceVals[i]);
      if (!matchesSlice) continue;
      const vi = row[fi], vj = row[fj];
      if (vi && vj && matrix[vi]) matrix[vi][vj] = (matrix[vi][vj] || 0) + 1;
    }

    const theoretical = valsI.length * valsJ.length;
    const covered = valsI.reduce((acc, vi) =>
      acc + valsJ.filter(vj => matrix[vi][vj] > 0).length, 0);

    return {
      label: sliceLabel,
      factor1: { index: fi, name: headers[fi], values: valsI },
      factor2: { index: fj, name: headers[fj], values: valsJ },
      matrix,
      theoretical,
      covered,
      coverage: theoretical > 0 ? Math.round(covered / theoretical * 1000) / 10 : 0
    };
  });

  return {
    type: 'sliced',
    n,
    factorIndices,
    sliceFactors,
    slices
  };
}

/**
 * テストケース密度マップ（2因子）
 */
function calcDensityMap(rows, fi, fj, headers) {
  const valsI = [...new Set(rows.map(r => r[fi]).filter(v => v && v !== ''))].sort();
  const valsJ = [...new Set(rows.map(r => r[fj]).filter(v => v && v !== ''))].sort();

  const matrix = {};
  for (const vi of valsI) {
    matrix[vi] = {};
    for (const vj of valsJ) matrix[vi][vj] = 0;
  }
  for (const row of rows) {
    const vi = row[fi], vj = row[fj];
    if (vi && vj && matrix[vi]) matrix[vi][vj]++;
  }

  const theoretical = valsI.length * valsJ.length;
  const covered = valsI.reduce((acc, vi) =>
    acc + valsJ.filter(vj => matrix[vi][vj] > 0).length, 0);

  return {
    type: 'matrix',
    n: 2,
    factor1: { index: fi, name: headers[fi], values: valsI },
    factor2: { index: fj, name: headers[fj], values: valsJ },
    matrix,
    theoretical,
    covered,
    coverage: theoretical > 0 ? Math.round(covered / theoretical * 1000) / 10 : 0
  };
}

/**
 * 品質スコア計算（コンサルタント向けサマリ）
 */
function calcQualityScore(coverageByN) {
  const weights = { 2: 1, 3: 2, 4: 3, 5: 4 };
  let totalWeight = 0;
  let weightedSum = 0;
  const breakdown = [];

  for (const [nStr, results] of Object.entries(coverageByN)) {
    if (!results || results.length === 0) continue;
    const n = parseInt(nStr);
    const validResults = results.filter(r => r.coverage !== null && !r.skipped);
    if (validResults.length === 0) continue;

    const avg = validResults.reduce((s, r) => s + r.coverage, 0) / validResults.length;
    const min = Math.min(...validResults.map(r => r.coverage));
    const w = weights[n] || 1;

    totalWeight += w;
    weightedSum += avg * w;

    breakdown.push({ n, avg: Math.round(avg * 10) / 10, min: Math.round(min * 10) / 10, count: validResults.length });
  }

  const score = totalWeight > 0 ? Math.round(weightedSum / totalWeight * 10) / 10 : null;
  return { score, breakdown };
}

// ユーティリティ: 組み合わせ
function combinations(arr, n) {
  if (n === 1) return arr.map(x => [x]);
  const result = [];
  for (let i = 0; i <= arr.length - n; i++) {
    const rest = combinations(arr.slice(i + 1), n - 1);
    for (const r of rest) result.push([arr[i], ...r]);
  }
  return result;
}

// ユーティリティ: 直積
function cartesianProduct(arrays) {
  if (arrays.length === 0) return [[]];
  return arrays.reduce((acc, arr) => {
    const result = [];
    for (const a of acc) {
      for (const b of arr) result.push([...a, b]);
    }
    return result;
  }, [[]]);
}

window.AnalysisEngine = {
  parseExcelData,
  detectExcludeColumns,
  getFactorValues,
  calcCombinationCoverageAsync,
  combinationsCount,
  analyzeValueBalance,
  detectDuplicates,
  calcDensityMap,
  calcDensityMapN,
  calcQualityScore,
  combinations,
};
