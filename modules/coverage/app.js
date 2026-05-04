// =============================================
// TestCov Analyzer - アプリケーションロジック
// =============================================

let parsedData = null;
let columnStates = [];
let selectedN = new Set([2, 3]);
let lastResults = null;

// ========== ファイル読み込み ==========

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

uploadZone.addEventListener('click', async () => {
  const filePath = await window.electronAPI.openFileDialog();
  if (filePath) loadFileFromPath(filePath);
});

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', async e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  // ドラッグ&ドロップはファイルパスを取得してNode.js側で処理
  const file = e.dataTransfer.files[0];
  if (file && file.path) {
    loadFileFromPath(file.path);
  }
});

async function loadFileFromPath(filePath) {
  showLoading('ファイルを読み込み中...');
  try {
    // Node.js側でファイル種別判定・文字コード変換を行う
    const result = await window.electronAPI.readFile(filePath);
    const name = filePath.split(/[\\/]/).pop();
    processFileResult(result, name);
  } catch (e) {
    alert('ファイルの読み込みに失敗しました: ' + e.message);
  } finally {
    hideLoading();
  }
}

/**
 * Node.js側から受け取ったファイルデータを処理
 * type='excel': base64のExcelデータ
 * type='text': 既にパース済みの2次元配列
 */
function processFileResult(result, fileName) {
  try {
    let rawData;

    if (result.type === 'excel') {
      // Excel形式: XLSXライブラリで解析
      const workbook = XLSX.read(result.data, { type: 'base64' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rawData = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        blankrows: false
      });
    } else {
      // テキスト形式: Node.js側で既にパース済み
      rawData = result.data;
    }

    if (!rawData || rawData.length === 0) {
      alert('ファイルを読み込めませんでした。');
      return;
    }

    parsedData = AnalysisEngine.parseExcelData(rawData);

    // UI更新
    document.getElementById('fileName').textContent = fileName;
    document.getElementById('fileStats').textContent =
      `${parsedData.headers.length}列 × ${parsedData.rows.length}行`;
    document.getElementById('fileInfo').style.display = 'block';
    uploadZone.classList.add('file-loaded');
    uploadZone.querySelector('.upload-icon').textContent = '✅';

    setupColumns();
    document.getElementById('columnSection').style.display = 'block';
    document.getElementById('nSection').style.display = 'block';
    document.getElementById('analyzeSection').style.display = 'block';

  } catch (e) {
    alert('ファイルの解析に失敗しました: ' + e.message);
    console.error(e);
  }
}



// ========== 列設定 ==========

function setupColumns() {
  const detected = AnalysisEngine.detectExcludeColumns(parsedData.headers);
  columnStates = detected.map(d => ({
    ...d,
    active: !d.autoExclude
  }));
  renderColList();
}

function renderColList() {
  const list = document.getElementById('colList');
  list.innerHTML = '';
  columnStates.forEach((col, i) => {
    const item = document.createElement('div');
    item.className = 'col-item' + (col.active ? ' active' : ' excluded');
    item.innerHTML = `
      <div class="col-checkbox"></div>
      <div class="col-name" title="${col.name}">${col.name}</div>
      ${col.autoExclude ? '<div class="col-badge auto">自動</div>' : ''}
    `;
    item.addEventListener('click', () => {
      columnStates[i].active = !columnStates[i].active;
      renderColList();
    });
    list.appendChild(item);
  });
}

function selectAllCols() {
  columnStates.forEach(c => c.active = true);
  renderColList();
}
function clearAllCols() {
  columnStates.forEach(c => c.active = false);
  renderColList();
}

// ========== Nファクター選択 ==========

document.getElementById('nSelector').addEventListener('click', e => {
  const btn = e.target.closest('.n-btn');
  if (!btn) return;
  const n = parseInt(btn.dataset.n);
  if (selectedN.has(n)) {
    selectedN.delete(n);
    btn.classList.remove('active');
  } else {
    selectedN.add(n);
    btn.classList.add('active');
  }
});

// ========== 分析実行 ==========

async function runAnalysis() {
  if (!parsedData) return;

  const activeIndices = columnStates.filter(c => c.active).map(c => c.index);
  if (activeIndices.length < 2) {
    alert('分析対象列を2列以上選択してください');
    return;
  }

  showLoading('組み合わせを計算中...');

  setTimeout(async () => {
    try {
      const { headers, rows } = parsedData;
      const results = {};

      for (const n of [...selectedN].sort()) {
        if (activeIndices.length >= n) {
          setLoadingText(`${n}因子間の組み合わせを計算中...`);
          results[n] = AnalysisEngine.calcCombinationCoverage(rows, activeIndices, n);
        }
      }

      setLoadingText('値バランスを分析中...');
      const valueBalance = AnalysisEngine.analyzeValueBalance(rows, activeIndices, headers);

      setLoadingText('重複ケースを検出中...');
      const duplicates = AnalysisEngine.detectDuplicates(rows, activeIndices);

      setLoadingText('因子値サマリーを生成中...');
      const heatmapData = null; // ドロップダウン選択時に都度生成
      const factorValues = AnalysisEngine.getFactorValues(rows, activeIndices);

      lastResults = {
        coverage: results,
        valueBalance,
        duplicates,
        heatmapData,
        factorValues,
        activeFactors: activeIndices,
        totalRows: rows.length,
        headers,
        rows
      };

      renderResults(lastResults);
    } catch (e) {
      alert('分析中にエラーが発生しました: ' + e.message);
      console.error(e);
    } finally {
      hideLoading();
    }
  }, 50);
}

// ========== 結果レンダリング ==========

function renderResults(results) {
  const { coverage, valueBalance, duplicates, heatmapData, factorValues, activeFactors, totalRows, headers } = results;

  const avgCoverages = {};
  for (const [n, res] of Object.entries(coverage)) {
    if (res && res.length > 0) {
      avgCoverages[n] = Math.round(res.reduce((s, r) => s + r.coverage, 0) / res.length * 10) / 10;
    }
  }

  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = '';

  // サマリーカード
  const summaryHtml = `
    <div>
      <div class="section-header">
        <div class="section-title">📊 分析サマリー
          <span class="section-badge">${activeFactors.length}因子 × ${totalRows}ケース</span>
        </div>
        <div class="export-bar">
          <button class="export-btn" onclick="exportCSV()">⬇ CSV出力</button>
          <button class="export-btn" onclick="exportExcel()">⬇ Excel出力</button>
        </div>
      </div>
      <div class="result-grid">
        <div class="stat-card green">
          <div class="stat-value">${totalRows}<span class="stat-unit">件</span></div>
          <div class="stat-label">テストケース数</div>
        </div>
        <div class="stat-card purple">
          <div class="stat-value">${activeFactors.length}<span class="stat-unit"> 因子</span></div>
          <div class="stat-label">分析対象因子数</div>
        </div>
        ${Object.entries(avgCoverages).map(([n, avg]) => `
          <div class="stat-card ${avg >= 80 ? 'green' : avg >= 50 ? 'yellow' : 'red'}">
            <div class="stat-value">${avg}<span class="stat-unit">%</span></div>
            <div class="stat-label">${n}因子間 平均カバレッジ</div>
          </div>
        `).join('')}
        <div class="stat-card ${duplicates.length > 0 ? 'red' : 'green'}">
          <div class="stat-value">${duplicates.length}<span class="stat-unit"> 件</span></div>
          <div class="stat-label">重複テストケース</div>
        </div>
      </div>
    </div>
  `;
  mainContent.insertAdjacentHTML('beforeend', summaryHtml);

  // タブエリア
  const tabAreaHtml = `
    <div class="panel">
      <div class="tabs" id="mainTabs">
        <div class="tab active" data-tab="coverage">組み合わせカバレッジ</div>
        <div class="tab" data-tab="uncovered">未カバー一覧</div>
        <div class="tab" data-tab="balance">値バランス</div>
        <div class="tab" data-tab="heatmap">密度マップ</div>
        <div class="tab" data-tab="duplicates">重複ケース ${duplicates.length > 0 ? `<span style="color:var(--accent3)">(${duplicates.length})</span>` : ''}</div>
        <div class="tab" data-tab="factors">因子値サマリー</div>
      </div>
      <div class="tab-content active" id="tab-coverage">
        ${renderCoverageTab(coverage, headers)}
      </div>
      <div class="tab-content" id="tab-uncovered">
        ${renderUncoveredTab(coverage, headers)}
      </div>
      <div class="tab-content" id="tab-balance">
        ${renderBalanceTab(valueBalance)}
      </div>
      <div class="tab-content" id="tab-heatmap">
        ${renderHeatmapTab(heatmapData)}
      </div>
      <div class="tab-content" id="tab-duplicates">
        ${renderDuplicatesTab(duplicates, activeFactors, headers)}
      </div>
      <div class="tab-content" id="tab-factors">
        ${renderFactorsTab(factorValues, activeFactors, headers)}
      </div>
    </div>
  `;
  mainContent.insertAdjacentHTML('beforeend', tabAreaHtml);

  // タブ切り替え（イベント委譲）
  document.getElementById('mainTabs').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#mainTabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });

  // 未カバー詳細の開閉（イベント委譲）
  mainContent.addEventListener('click', e => {
    const header = e.target.closest('.uncovered-header');
    if (!header) return;
    header.nextElementSibling.classList.toggle('open');
  });

  // 密度マップのボタン切り替え（イベント委譲）
  mainContent.addEventListener('click', e => {
    const btn = e.target.closest('.heatmap-factor-btn');
    if (!btn) return;
    const container = btn.closest('.panel');
    container.querySelectorAll('.heatmap-factor-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const idx = parseInt(btn.dataset.idx);
    const contentEl = container.querySelector('#heatmapContent');
    if (contentEl && lastResults.heatmapData) {
      contentEl.innerHTML = renderHeatmapMatrix(lastResults.heatmapData[idx]);
    }
  });
}

function coverageClass(v) {
  return v >= 80 ? 'high' : v >= 50 ? 'mid' : 'low';
}

function renderCoverageTab(coverage, headers) {
  let html = '';
  for (const [n, results] of Object.entries(coverage)) {
    if (!results || results.length === 0) continue;
    html += `
      <div style="padding:16px; border-bottom:1px solid var(--border);">
        <div style="font-size:13px; font-weight:700; margin-bottom:12px; color:var(--text2);">
          ${n}因子間カバレッジ
        </div>
        <table class="coverage-table">
          <thead>
            <tr>
              ${Array.from({length: parseInt(n)}, (_, i) => `<th>因子${i+1}</th>`).join('')}
              <th>理論数</th>
              <th>カバー済</th>
              <th>未カバー</th>
              <th style="min-width:160px;">カバレッジ</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(r => `
              <tr>
                ${r.factors.map(fi => `<td>${headers[fi]}</td>`).join('')}
                <td style="color:var(--text2);">${r.theoreticalCount}</td>
                <td style="color:var(--accent);">${r.coveredCount}</td>
                <td style="color:${r.uncoveredCount > 0 ? 'var(--accent3)' : 'var(--text3)'};">${r.uncoveredCount}</td>
                <td>
                  <div class="progress-wrap">
                    <div class="progress-bar">
                      <div class="progress-fill ${coverageClass(r.coverage)}" style="width:${r.coverage}%"></div>
                    </div>
                    <span class="progress-value ${coverageClass(r.coverage)}">${r.coverage}%</span>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  return html || '<div style="padding:24px; text-align:center; color:var(--text3);">Nを選択して分析を実行してください</div>';
}

function renderUncoveredTab(coverage, headers) {
  let html = '<div style="padding:16px; display:flex; flex-direction:column; gap:12px;">';
  let hasAny = false;

  for (const [n, results] of Object.entries(coverage)) {
    if (!results) continue;
    for (const r of results) {
      if (r.uncoveredCombos.length === 0) continue;
      hasAny = true;
      const factorNames = r.factors.map(fi => headers[fi]).join(' × ');
      html += `
        <div class="uncovered-panel">
          <div class="uncovered-header">
            <span style="font-size:13px;">⚠</span>
            <span class="uncovered-title">${factorNames}</span>
            <span class="uncovered-count">${r.uncoveredCombos.length}件未カバー</span>
          </div>
          <div class="uncovered-body">
            <div style="display:flex; gap:8px; padding-bottom:8px; border-bottom:1px solid var(--border); margin-bottom:4px;">
              ${r.factors.map(fi => `<span style="font-size:10px; color:var(--text3); min-width:80px;">${headers[fi]}</span>`).join('')}
            </div>
            ${r.uncoveredCombos.map(combo => `
              <div class="uncovered-combo">
                ${combo.map(v => `<span class="combo-tag">${v}</span>`).join('')}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
  }

  html += '</div>';
  if (!hasAny) {
    return '<div style="padding:48px; text-align:center; color:var(--accent);">🎉 すべての組み合わせがカバーされています！</div>';
  }
  return html;
}

function renderBalanceTab(valueBalance) {
  return `
    <div style="padding:12px 16px; font-size:12px; color:var(--text2); border-bottom:1px solid var(--border);">
      各因子の値がテストケース全体でどの割合で使われているかを示します。偏りが大きい場合、特定の値ばかりテストされている可能性があります。
    </div>
    <div class="balance-grid">
      ${valueBalance.map(fb => `
        <div class="balance-factor">
          <div class="balance-factor-name" title="${fb.factorName}">${fb.factorName}</div>
          ${fb.values.map(v => `
            <div class="balance-item">
              <div class="balance-val" title="${v.value}">${v.value}</div>
              <div class="balance-bar">
                <div class="balance-fill" style="width:${v.ratio}%"></div>
              </div>
              <div class="balance-pct">${v.ratio}%</div>
            </div>
          `).join('')}
          <div style="font-size:10px; color:var(--text3); margin-top:4px;">計${fb.total}件</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderHeatmapTab(heatmapData) {
  if (!lastResults || !lastResults.activeFactors || lastResults.activeFactors.length < 2) {
    return '<div style="padding:24px;color:var(--text3);text-align:center">因子が2つ以上必要です</div>';
  }

  const { activeFactors, headers } = lastResults;

  // 初期選択: 最初の2因子
  const defaultF1 = activeFactors[0];
  const defaultF2 = activeFactors[1];

  const options = activeFactors.map(fi =>
    `<option value="${fi}">${headers[fi]}</option>`
  ).join('');

  return `
    <div style="padding:12px 16px; font-size:12px; color:var(--text2); border-bottom:1px solid var(--border);">
      2つの因子を選ぶと、その組み合わせごとに何件テストされているかをマトリクスで表示します。– は未テストです。
    </div>
    <div style="padding:14px 16px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; border-bottom:1px solid var(--border);">
      <label style="font-size:12px; color:var(--text2);">因子1</label>
      <select id="heatmapSelect1" style="padding:6px 10px; border-radius:6px; border:1.5px solid var(--border); background:var(--surface2); color:var(--text); font-size:12px; cursor:pointer;">
        ${options}
      </select>
      <span style="color:var(--text3); font-size:16px;">×</span>
      <label style="font-size:12px; color:var(--text2);">因子2</label>
      <select id="heatmapSelect2" style="padding:6px 10px; border-radius:6px; border:1.5px solid var(--border); background:var(--surface2); color:var(--text); font-size:12px; cursor:pointer;">
        ${options}
      </select>
      <button onclick="updateHeatmap()" style="padding:6px 16px; border-radius:6px; border:1.5px solid var(--accent); background:transparent; color:var(--accent); font-size:12px; cursor:pointer;">表示</button>
    </div>
    <div class="heatmap-wrap" id="heatmapContent" style="padding:16px;">
      ${renderHeatmapMatrixByIndex(defaultF1, defaultF2)}
    </div>
  `;
}

function updateHeatmap() {
  const s1 = document.getElementById('heatmapSelect1');
  const s2 = document.getElementById('heatmapSelect2');
  if (!s1 || !s2) return;
  const fi = parseInt(s1.value);
  const fj = parseInt(s2.value);
  if (fi === fj) {
    document.getElementById('heatmapContent').innerHTML =
      '<div style="color:var(--accent3); padding:16px;">異なる因子を選択してください</div>';
    return;
  }
  document.getElementById('heatmapContent').innerHTML = renderHeatmapMatrixByIndex(fi, fj);
}

function renderHeatmapMatrixByIndex(fi, fj) {
  const { rows, headers } = lastResults;
  const valsI = [...new Set(rows.map(r => r[fi]).filter(v => v && v !== ''))].sort();
  const valsJ = [...new Set(rows.map(r => r[fj]).filter(v => v && v !== ''))].sort();

  const matrix = {};
  for (const vi of valsI) {
    matrix[vi] = {};
    for (const vj of valsJ) matrix[vi][vj] = 0;
  }
  for (const row of rows) {
    const vi = row[fi], vj = row[fj];
    if (vi && vj && matrix[vi]) matrix[vi][vj] = (matrix[vi][vj] || 0) + 1;
  }

  const d = { factor1: { name: headers[fi], values: valsI },
               factor2: { name: headers[fj], values: valsJ }, matrix };
  return renderHeatmapMatrix(d);
}

function renderHeatmapMatrix(d) {
  const maxVal = Math.max(...d.factor1.values.flatMap(vi =>
    d.factor2.values.map(vj => d.matrix[vi]?.[vj] || 0)
  ), 1);

  let covered = 0, total = 0;
  for (const vi of d.factor1.values) {
    for (const vj of d.factor2.values) {
      total++;
      if ((d.matrix[vi]?.[vj] || 0) > 0) covered++;
    }
  }
  const pct = total > 0 ? Math.round(covered / total * 1000) / 10 : 0;
  const cls = coverageClass(pct);

  return `
    <div style="margin-bottom:12px; display:flex; align-items:center; gap:12px;">
      <span style="font-size:12px; color:var(--text2);">密度カバレッジ:</span>
      <div class="progress-wrap" style="flex:none; gap:8px;">
        <div class="progress-bar" style="min-width:120px;">
          <div class="progress-fill ${cls}" style="width:${pct}%"></div>
        </div>
        <span class="progress-value ${cls}">${pct}%</span>
      </div>
      <span style="font-size:11px; color:var(--text3);">${covered}/${total}組み合わせ</span>
    </div>
    <table class="heatmap-table">
      <thead>
        <tr>
          <th style="background:var(--surface2);">${d.factor1.name} ＼ ${d.factor2.name}</th>
          ${d.factor2.values.map(vj => `<th>${vj}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${d.factor1.values.map(vi => `
          <tr>
            <td class="heatmap-label">${vi}</td>
            ${d.factor2.values.map(vj => {
              const cnt = d.matrix[vi]?.[vj] || 0;
              const intensity = cnt / maxVal;
              const bg = cnt === 0
                ? 'rgba(255,107,107,0.12)'
                : `rgba(79,255,176,${0.08 + intensity * 0.55})`;
              const color = cnt === 0 ? 'var(--accent3)' : 'var(--accent)';
              return `<td style="background:${bg}; color:${color}; font-size:12px;">${cnt === 0 ? '–' : cnt}</td>`;
            }).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderDuplicatesTab(duplicates, activeFactors, headers) {
  if (duplicates.length === 0) {
    return '<div style="padding:48px; text-align:center; color:var(--accent);">✅ 重複テストケースはありません</div>';
  }
  return `
    <div style="padding:12px 16px; font-size:12px; color:var(--text2); border-bottom:1px solid var(--border);">
      同じ因子の組み合わせを持つテストケースが複数存在します。意図的な重複かどうか確認してください。
    </div>
    <div class="dup-list">
      ${duplicates.map(d => `
        <div class="dup-item">
          <div class="dup-rows">行 ${d.rows.join(', ')}<br><span style="color:var(--text3);">${d.count}件重複</span></div>
          <div class="dup-values">
            ${activeFactors.map((fi, i) => `
              <div style="display:flex; flex-direction:column; gap:2px;">
                <span style="font-size:9px; color:var(--text3);">${headers[fi]}</span>
                <span class="dup-tag">${d.values[i] || ''}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderFactorsTab(factorValues, activeFactors, headers) {
  return `
    <div style="padding:12px 16px; font-size:12px; color:var(--text2); border-bottom:1px solid var(--border);">
      各因子に使われている値の一覧です。表記ゆれ（例：「YES」と「yes」の混在）の検出に活用できます。
    </div>
    <div class="factor-summary-grid">
      ${activeFactors.map(fi => {
        const vals = factorValues[fi] || [];
        return `
          <div class="factor-summary-card">
            <div class="factor-summary-name" title="${headers[fi]}">${headers[fi]}</div>
            <div class="factor-values-list">
              ${vals.map(v => `<span class="factor-value-chip">${v}</span>`).join('')}
            </div>
            <div class="factor-value-count" style="margin-top:6px;">${vals.length}種類の値</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ========== エクスポート ==========

async function exportCSV() {
  if (!lastResults) return;
  const { coverage, headers } = lastResults;
  let csv = '';
  for (const [n, results] of Object.entries(coverage)) {
    if (results) csv += ExportUtils.coverageToCSV(results, headers, n) + '\n\n';
  }
  await window.electronAPI.saveCsv(csv, 'testcov_analysis.csv');
}

async function exportExcel() {
  if (!lastResults) return;
  showLoading('Excelファイルを生成中...');
  try {
    const base64 = await ExportUtils.exportToExcel(lastResults, lastResults.headers);
    await window.electronAPI.saveExcel(base64, 'testcov_analysis.xlsx');
  } catch (e) {
    alert('エクスポートに失敗しました: ' + e.message);
  } finally {
    hideLoading();
  }
}

// ========== ユーティリティ ==========

function showLoading(text) {
  document.getElementById('loadingText').textContent = text || '処理中...';
  document.getElementById('loadingOverlay').classList.add('show');
}
function setLoadingText(text) {
  document.getElementById('loadingText').textContent = text;
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('show');
}
