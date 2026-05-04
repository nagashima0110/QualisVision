// =============================================
// TestCov Analyzer - 分析エンジン
// =============================================

const EXCLUDE_KEYWORDS = ['結果', '期待', '備考', 'メモ', 'コメント', 'note', 'result', 'expected', 'remark', 'comment', 'pass', 'fail', 'status'];

/**
 * Excelデータをパースしてテストケース行列に変換
 * 結合セルを自動補完する
 * 途中に混入したヘッダー行を自動除去する
 */
function parseExcelData(rawData) {
  if (!rawData || rawData.length === 0) return { headers: [], rows: [] };

  const headers = rawData[0].map((h, i) => h != null ? String(h).trim() : `列${i + 1}`);
  const headerSet = new Set(headers.filter(h => h !== ''));
  const rows = [];

  // 前の行の値を記憶（結合セル補完用）
  const lastValues = new Array(headers.length).fill(null);

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;

    // 途中に混入したヘッダー行を検出して除去
    // 行の値がヘッダー名と一致する割合が50%以上なら除去
    const nonEmptyCells = row.filter(v => v != null && String(v).trim() !== '');
    if (nonEmptyCells.length > 0) {
      const headerMatchCount = nonEmptyCells.filter(v => headerSet.has(String(v).trim())).length;
      if (headerMatchCount / nonEmptyCells.length >= 0.5) {
        // ヘッダー行と判定 → スキップ＆結合セル補完をリセット
        lastValues.fill(null);
        continue;
      }
    }

    const filled = [];
    let hasAnyValue = false;

    for (let j = 0; j < headers.length; j++) {
      const val = row[j];
      if (val != null && String(val).trim() !== '') {
        lastValues[j] = String(val).trim();
        filled.push(lastValues[j]);
        hasAnyValue = true;
      } else {
        // 結合セル補完: 前の値を引き継ぐ
        filled.push(lastValues[j] || '');
        if (lastValues[j]) hasAnyValue = true;
      }
    }

    if (hasAnyValue) {
      rows.push(filled);
    }
  }

  return { headers, rows };
}

/**
 * 除外候補列を自動検出
 */
function detectExcludeColumns(headers) {
  return headers.map((h, i) => {
    const lower = h.toLowerCase();
    const isExclude = EXCLUDE_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
    return { index: i, name: h, autoExclude: isExclude };
  });
}

/**
 * 各因子の値域を取得
 */
function getFactorValues(rows, colIndices) {
  const valuesMap = {};
  for (const idx of colIndices) {
    const vals = [...new Set(rows.map(r => r[idx]).filter(v => v !== ''))];
    valuesMap[idx] = vals;
  }
  return valuesMap;
}

/**
 * N因子間の組み合わせカバレッジを計算
 */
function calcCombinationCoverage(rows, colIndices, n) {
  if (colIndices.length < n) return null;

  const factorValues = getFactorValues(rows, colIndices);

  // n個の因子の組み合わせを列挙
  const factorCombinations = combinations(colIndices, n);
  const results = [];

  for (const factorCombo of factorCombinations) {
    // この因子の組み合わせで理論上発生しうる値の組み合わせ
    const valueSets = factorCombo.map(fi => factorValues[fi]);
    const theoreticalCombos = cartesianProduct(valueSets);
    const theoreticalSet = new Set(theoreticalCombos.map(c => c.join('\0')));

    // 実際のテストケースで現れた組み合わせ
    const actualSet = new Set();
    for (const row of rows) {
      const key = factorCombo.map(fi => row[fi]).join('\0');
      if (factorCombo.every(fi => row[fi] !== '')) {
        actualSet.add(key);
      }
    }

    const covered = [...theoreticalSet].filter(k => actualSet.has(k));
    const uncovered = [...theoreticalSet].filter(k => !actualSet.has(k));

    const coverage = theoreticalSet.size === 0 ? 100 : (covered.length / theoreticalSet.size) * 100;

    results.push({
      factors: factorCombo,
      theoreticalCount: theoreticalSet.size,
      coveredCount: covered.length,
      uncoveredCount: uncovered.length,
      coverage: Math.round(coverage * 10) / 10,
      uncoveredCombos: uncovered.map(k => k.split('\0'))
    });
  }

  return results;
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
      if (v !== '') counts[v] = (counts[v] || 0) + 1;
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
  const duplicates = [];

  rows.forEach((row, i) => {
    const key = colIndices.map(fi => row[fi]).join('\0');
    if (seen.has(key)) {
      seen.get(key).push(i + 2);
    } else {
      seen.set(key, [i + 2]);
    }
  });

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
 * 因子間の共起ヒートマップデータ生成（2因子）
 */
function calcHeatmapData(rows, colIndices, headers) {
  if (colIndices.length < 2) return null;

  const results = [];
  const factorCombos = combinations(colIndices, 2);

  for (const [fi, fj] of factorCombos) {
    const valsI = [...new Set(rows.map(r => r[fi]).filter(v => v !== ''))].sort();
    const valsJ = [...new Set(rows.map(r => r[fj]).filter(v => v !== ''))].sort();

    const matrix = {};
    for (const vi of valsI) {
      matrix[vi] = {};
      for (const vj of valsJ) {
        matrix[vi][vj] = 0;
      }
    }

    for (const row of rows) {
      const vi = row[fi], vj = row[fj];
      if (vi !== '' && vj !== '' && matrix[vi] !== undefined) {
        matrix[vi][vj] = (matrix[vi][vj] || 0) + 1;
      }
    }

    results.push({
      factor1: { index: fi, name: headers[fi], values: valsI },
      factor2: { index: fj, name: headers[fj], values: valsJ },
      matrix
    });
  }

  return results;
}

/**
 * テストケース密度マップ（2因子選択時）
 */
function calcDensityMap(rows, fi, fj, headers) {
  const valsI = [...new Set(rows.map(r => r[fi]).filter(v => v !== ''))].sort();
  const valsJ = [...new Set(rows.map(r => r[fj]).filter(v => v !== ''))].sort();

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
    factor1: { index: fi, name: headers[fi], values: valsI },
    factor2: { index: fj, name: headers[fj], values: valsJ },
    matrix,
    theoretical,
    covered,
    coverage: theoretical > 0 ? Math.round(covered / theoretical * 1000) / 10 : 0
  };
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
  calcCombinationCoverage,
  analyzeValueBalance,
  detectDuplicates,
  calcHeatmapData,
  calcDensityMap,
  combinations,
};
