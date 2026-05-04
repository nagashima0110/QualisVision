// =============================================
// QualisCoverage - アプリケーションロジック
// =============================================

let parsedData = null;
let columnStates = [];
let selectedN = new Set([2, 3]);
let lastResults = null;
let tabRenderers = {};
let renderedTabs = new Set();

// ========== ファイル読み込み ==========

const uploadZone = document.getElementById('uploadZone');

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
  const file = e.dataTransfer.files[0];
  if (file && file.path) loadFileFromPath(file.path);
});

async function loadFileFromPath(filePath) {
  showLoading('ファイルを読み込み中...');
  try {
    const result = await window.electronAPI.readFile(filePath);
    const name = filePath.split(/[\\/]/).pop();
    processFileResult(result, name);
  } catch (e) {
    alert('ファイルの読み込みに失敗しました: ' + e.message);
  } finally {
    hideLoading();
  }
}

function processFileResult(result, fileName) {
  try {
    let rawData;
    if (result.type === 'excel') {
      const workbook = XLSX.read(result.data, { type: 'base64' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false });
    } else {
      rawData = result.data;
    }

    if (!rawData || rawData.length === 0) { alert('ファイルを読み込めませんでした。'); return; }

    parsedData = AnalysisEngine.parseExcelData(rawData);
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
  const detected = AnalysisEngine.detectExcludeColumns(parsedData.headers, parsedData.rows);
  columnStates = detected.map(d => ({ ...d, active: !d.autoExclude }));
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
      ${col.autoExclude ? `<div class="col-badge auto">${col.reason || '自動'}</div>` : ''}
    `;
    item.addEventListener('click', () => { columnStates[i].active = !columnStates[i].active; renderColList(); });
    list.appendChild(item);
  });
}

function selectAllCols() { columnStates.forEach(c => c.active = true); renderColList(); }
function clearAllCols()  { columnStates.forEach(c => c.active = false); renderColList(); }

// ========== Nファクター選択 ==========

document.getElementById('nSelector').addEventListener('click', e => {
  const btn = e.target.closest('.n-btn');
  if (!btn) return;
  const n = parseInt(btn.dataset.n);
  if (selectedN.has(n)) { selectedN.delete(n); btn.classList.remove('active'); }
  else                   { selectedN.add(n);    btn.classList.add('active'); }
});

// ========== 分析実行 ==========

async function runAnalysis() {
  if (!parsedData) return;
  const activeIndices = columnStates.filter(c => c.active).map(c => c.index);
  if (activeIndices.length < 2) { alert('分析対象列を2列以上選択してください'); return; }

  showLoading('分析を開始中...');
  await new Promise(r => setTimeout(r, 50)); // ローディング表示を待つ

  try {
    const { headers, rows } = parsedData;
    const coverage = {};

    for (const n of [...selectedN].sort()) {
      if (activeIndices.length >= n) {
        const groupTotal = AnalysisEngine.combinationsCount(activeIndices.length, n);
        setLoadingText(`${n}因子間を計算中... (0 / ${groupTotal.toLocaleString()} グループ)`);
        await new Promise(r => setTimeout(r, 0));

        coverage[n] = await AnalysisEngine.calcCombinationCoverageAsync(
          rows, activeIndices, n,
          (done, total) => setLoadingText(`${n}因子間を計算中... (${done.toLocaleString()} / ${total.toLocaleString()} グループ)`)
        );
        setLoadingText(`${n}因子間を計算中... (${groupTotal.toLocaleString()} / ${groupTotal.toLocaleString()} グループ) ✓`);
      }
    }

    setLoadingText('値バランスを分析中...');
    await new Promise(r => setTimeout(r, 0));
    const valueBalance = AnalysisEngine.analyzeValueBalance(rows, activeIndices, headers);

    setLoadingText('重複ケースを検出中...');
    await new Promise(r => setTimeout(r, 0));
    const duplicates = AnalysisEngine.detectDuplicates(rows, activeIndices);

    setLoadingText('品質スコアを計算中...');
    const qualityScore = AnalysisEngine.calcQualityScore(coverage);
    const factorValues = AnalysisEngine.getFactorValues(rows, activeIndices);

    lastResults = { coverage, valueBalance, duplicates, qualityScore, factorValues, activeFactors: activeIndices, totalRows: rows.length, headers, rows };
    renderResults(lastResults);
  } catch (e) {
    alert('分析中にエラーが発生しました: ' + e.message);
    console.error(e);
  } finally {
    hideLoading();
  }
}

// ========== 結果レンダリング ==========

function renderTab(tabId) {
  if (renderedTabs.has(tabId)) return;
  const renderer = tabRenderers[tabId];
  if (!renderer) return;
  const el = document.getElementById('tab-' + tabId);
  if (!el) return;
  el.innerHTML = renderer();
  renderedTabs.add(tabId);
}

function renderResults(results) {
  const { coverage, valueBalance, duplicates, qualityScore, activeFactors, totalRows, headers } = results;

  const avgCoverages = {};
  for (const [n, res] of Object.entries(coverage)) {
    if (!res) continue;
    const valid = res.filter(r => r.coverage !== null && !r.skipped);
    if (valid.length > 0)
      avgCoverages[n] = Math.round(valid.reduce((s, r) => s + r.coverage, 0) / valid.length * 10) / 10;
  }

  const mainContent = document.getElementById('mainContent');
  mainContent.innerHTML = '';

  const scoreColor = qualityScore.score >= 80 ? 'green' : qualityScore.score >= 50 ? 'yellow' : 'red';
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
        ${qualityScore.score !== null ? `
          <div class="stat-card ${scoreColor}">
            <div class="stat-value">${qualityScore.score}<span class="stat-unit">%</span></div>
            <div class="stat-label">品質スコア</div>
          </div>
        ` : ''}
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

  // タブ骨格のみ先に挿入（コンテンツは遅延レンダリング）
  const tabAreaHtml = `
    <div class="panel">
      <div class="tabs" id="mainTabs">
        <div class="tab active" data-tab="dashboard">ダッシュボード</div>
        <div class="tab" data-tab="coverage">組み合わせカバレッジ</div>
        <div class="tab" data-tab="uncovered">未カバー一覧</div>
        <div class="tab" data-tab="balance">値バランス</div>
        <div class="tab" data-tab="heatmap">密度マップ</div>
        <div class="tab" data-tab="duplicates">重複ケース ${duplicates.length > 0 ? `<span style="color:var(--accent3)">(${duplicates.length})</span>` : ''}</div>
        <div class="tab" data-tab="factors">因子値サマリー</div>
      </div>
      <div class="tab-content active" id="tab-dashboard"></div>
      <div class="tab-content" id="tab-coverage"></div>
      <div class="tab-content" id="tab-uncovered"></div>
      <div class="tab-content" id="tab-balance"></div>
      <div class="tab-content" id="tab-heatmap"></div>
      <div class="tab-content" id="tab-duplicates"></div>
      <div class="tab-content" id="tab-factors"></div>
    </div>
  `;
  mainContent.insertAdjacentHTML('beforeend', tabAreaHtml);

  // 各タブのレンダラーを登録
  renderedTabs = new Set();
  tabRenderers = {
    dashboard:  () => renderDashboardTab(results),
    coverage:   () => renderCoverageTab(coverage, headers),
    uncovered:  () => renderUncoveredTab(coverage, headers),
    balance:    () => renderBalanceTab(valueBalance),
    heatmap:    () => renderHeatmapTab(),
    duplicates: () => renderDuplicatesTab(duplicates, activeFactors, headers),
    factors:    () => renderFactorsTab(results.factorValues, activeFactors, headers),
  };

  // デフォルトのダッシュボードだけ即時レンダリング
  renderTab('dashboard');

  document.getElementById('mainTabs').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    switchToTab(tab.dataset.tab);
  });

  mainContent.addEventListener('click', e => {
    const header = e.target.closest('.uncovered-header');
    if (!header) return;
    header.nextElementSibling.classList.toggle('open');
  });
}

function coverageClass(v) { return v >= 80 ? 'high' : v >= 50 ? 'mid' : 'low'; }

// タブ切り替えの共通処理
function switchToTab(tabId) {
  const tabsEl = document.getElementById('mainTabs');
  if (!tabsEl) return;
  tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const targetBtn = tabsEl.querySelector(`[data-tab="${tabId}"]`);
  if (targetBtn) targetBtn.classList.add('active');

  // tab-content は mainTabs の兄弟要素なのでパネル全体をスコープにする
  const panelEl = tabsEl.parentElement;
  panelEl.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const targetContent = document.getElementById('tab-' + tabId);
  if (targetContent) targetContent.classList.add('active');

  renderTab(tabId);
}

// ダッシュボードから未カバー一覧の特定グループへジャンプ
function jumpToUncovered(factorKey) {
  switchToTab('uncovered');
  setTimeout(() => {
    const panel = document.querySelector(`.uncovered-panel[data-factor-key="${factorKey}"]`);
    if (panel) {
      const body = panel.querySelector('.uncovered-body');
      if (body && !body.classList.contains('open')) body.classList.add('open');
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      panel.style.outline = '2px solid var(--accent2)';
      setTimeout(() => { panel.style.outline = ''; }, 2000);
    }
  }, 50);
}

// ========== ダッシュボードタブ ==========

function renderDashboardTab(results) {
  const { coverage, valueBalance, duplicates, qualityScore, activeFactors, totalRows, headers } = results;

  const allCombos = [];
  for (const [n, res] of Object.entries(coverage)) {
    if (!res) continue;
    for (const r of res) {
      if (r.coverage !== null && !r.skipped)
        allCombos.push({ n: parseInt(n), factors: r.factors, coverage: r.coverage, uncoveredCount: r.uncoveredCount });
    }
  }
  allCombos.sort((a, b) => a.coverage - b.coverage);
  const top5Worst = allCombos.slice(0, 5);

  const skewedFactors = valueBalance
    .filter(fb => fb.values.length >= 2)
    .map(fb => ({ ...fb, skew: fb.values[0].ratio - fb.values[fb.values.length - 1].ratio }))
    .filter(fb => fb.skew > 30)
    .sort((a, b) => b.skew - a.skew)
    .slice(0, 3);

  const scoreColor = qualityScore.score >= 80 ? 'var(--accent)' : qualityScore.score >= 50 ? 'var(--accent4)' : 'var(--accent3)';
  const scoreLabel = qualityScore.score >= 80 ? '良好' : qualityScore.score >= 50 ? '要改善' : '不十分';
  const circumference = Math.round(2 * Math.PI * 34);

  return `<div style="padding:20px; display:flex; flex-direction:column; gap:20px;">

    ${qualityScore.score !== null ? `
    <div style="background:var(--surface2); border-radius:var(--radius); padding:20px;">
      <div style="font-size:10px; font-family:monospace; letter-spacing:0.15em; color:var(--text3); text-transform:uppercase; margin-bottom:14px;">Quality Score</div>
      <div style="display:flex; align-items:center; gap:24px; flex-wrap:wrap;">
        <div style="position:relative; width:80px; height:80px; flex-shrink:0;">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="var(--surface3)" stroke-width="8"/>
            <circle cx="40" cy="40" r="34" fill="none" stroke="${scoreColor}" stroke-width="8"
              stroke-dasharray="${Math.round(circumference * qualityScore.score / 100)} ${circumference}"
              stroke-dashoffset="${Math.round(circumference * 0.25)}"
              stroke-linecap="round"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:monospace;font-size:15px;font-weight:700;color:${scoreColor}">${qualityScore.score}</div>
        </div>
        <div>
          <div style="font-size:20px; font-weight:800; color:${scoreColor}; margin-bottom:4px;">${scoreLabel}</div>
          <div style="font-size:11px; color:var(--text2); margin-bottom:8px;">N因子カバレッジの重み付き平均（N=2: ×1, N=3: ×2, N=4: ×3, N=5: ×4）</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${qualityScore.breakdown.map(b => {
              const c = b.avg >= 80 ? 'var(--accent)' : b.avg >= 50 ? 'var(--accent4)' : 'var(--accent3)';
              return `<div style="background:var(--surface3); border-radius:6px; padding:5px 10px; font-size:11px;">
                <span style="color:var(--text3); font-family:monospace;">${b.n}因子</span>
                <span style="color:${c}; font-weight:700; margin-left:6px;">${b.avg}%</span>
                <span style="color:var(--text3); font-size:10px; margin-left:4px;">(最小 ${b.min}%)</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
    ` : ''}

    ${top5Worst.length > 0 ? `
    <div style="background:var(--surface2); border-radius:var(--radius); padding:20px;">
      <div style="font-size:10px; font-family:monospace; letter-spacing:0.15em; color:var(--text3); text-transform:uppercase; margin-bottom:14px;">⚠ カバレッジ最低 Top ${top5Worst.length}</div>
      <div style="display:flex; flex-direction:column; gap:10px;">
        ${top5Worst.map(c => {
          const fnames = c.factors.map(fi => headers[fi]).join(' × ');
          const cls = coverageClass(c.coverage);
          const factorKey = c.factors.join('-');
          return `<div style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:6px 8px; border-radius:6px; transition:background 0.15s;"
            onmouseover="this.style.background='var(--surface3)'" onmouseout="this.style.background=''"
            onclick="jumpToUncovered('${factorKey}')" title="未カバー一覧を表示">
            <span style="font-size:10px; font-family:monospace; color:var(--text3); min-width:30px;">${c.n}因子</span>
            <div style="flex:1; font-size:12px; color:var(--text2); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${fnames}">${fnames}</div>
            <div class="progress-wrap" style="flex:none; gap:8px; min-width:180px;">
              <div class="progress-bar" style="min-width:100px;"><div class="progress-fill ${cls}" style="width:${c.coverage}%"></div></div>
              <span class="progress-value ${cls}" style="min-width:42px;">${c.coverage}%</span>
            </div>
            <span style="font-size:11px; color:var(--accent3); min-width:55px; text-align:right;">${c.uncoveredCount}件未</span>
            <span style="font-size:10px; color:var(--text3);">▸</span>
          </div>`;
        }).join('')}
      </div>
    </div>
    ` : `<div style="background:var(--surface2); border-radius:var(--radius); padding:20px; text-align:center; color:var(--accent);">🎉 すべての組み合わせがカバーされています！</div>`}

    ${skewedFactors.length > 0 ? `
    <div style="background:var(--surface2); border-radius:var(--radius); padding:20px;">
      <div style="font-size:10px; font-family:monospace; letter-spacing:0.15em; color:var(--text3); text-transform:uppercase; margin-bottom:14px;">📊 値バランスに偏りがある因子</div>
      <div style="display:flex; flex-direction:column; gap:12px;">
        ${skewedFactors.map(fb => `
          <div>
            <div style="font-size:12px; font-weight:700; color:var(--text); margin-bottom:6px;">${fb.factorName}
              <span style="font-size:10px; font-family:monospace; color:var(--accent4); margin-left:8px;">偏差 ${fb.skew.toFixed(1)}%</span>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              ${fb.values.map(v => `
                <div style="background:var(--surface3); border-radius:4px; padding:3px 8px; font-size:11px;">
                  <span style="color:var(--text2);">${v.value}</span>
                  <span style="color:${v.ratio > 60 ? 'var(--accent3)' : 'var(--text3)'}; font-family:monospace; margin-left:5px;">${v.ratio}%</span>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    ${duplicates.length > 0 ? `
    <div style="background:rgba(255,107,107,0.08); border:1px solid rgba(255,107,107,0.25); border-radius:var(--radius); padding:16px;">
      <div style="font-size:13px; font-weight:700; color:var(--accent3); margin-bottom:6px;">⚠ 重複テストケース: ${duplicates.length}件</div>
      <div style="font-size:12px; color:var(--text2);">同じ因子の組み合わせを持つテストケースが存在します。「重複ケース」タブで詳細を確認してください。</div>
    </div>
    ` : ''}

  </div>`;
}

// ========== カバレッジタブ ==========

function renderCoverageTab(coverage, headers) {
  let html = '';
  for (const [n, results] of Object.entries(coverage)) {
    if (!results || results.length === 0) continue;
    html += `
      <div style="padding:16px; border-bottom:1px solid var(--border);">
        <div style="font-size:13px; font-weight:700; margin-bottom:12px; color:var(--text2); font-family:monospace;">${n}因子間カバレッジ</div>
        <table class="coverage-table">
          <thead>
            <tr>
              ${Array.from({length: parseInt(n)}, (_, i) => `<th>因子${i+1}</th>`).join('')}
              <th>理論数</th><th>カバー済</th><th>未カバー</th>
              <th style="min-width:160px;">カバレッジ</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(r => {
              if (r.skipped) return `<tr>${r.factors.map(fi=>`<td>${headers[fi]}</td>`).join('')}<td colspan="3" style="color:var(--text3);font-size:11px;">理論数 ${r.theoreticalCount.toLocaleString()}件 — 計算上限超過</td><td style="color:var(--text3);font-size:11px;">省略</td></tr>`;
              if (r.warning && r.coverage === null) return `<tr>${r.factors.map(fi=>`<td>${headers[fi]}</td>`).join('')}<td colspan="4" style="color:var(--text3);font-size:11px;">${r.warning}</td></tr>`;
              return `<tr>
                ${r.factors.map(fi=>`<td>${headers[fi]}</td>`).join('')}
                <td style="color:var(--text2);">${r.theoreticalCount}</td>
                <td style="color:var(--accent);">${r.coveredCount}</td>
                <td style="color:${r.uncoveredCount>0?'var(--accent3)':'var(--text3)'};">${r.uncoveredCount}</td>
                <td>
                  <div class="progress-wrap">
                    <div class="progress-bar"><div class="progress-fill ${coverageClass(r.coverage)}" style="width:${r.coverage}%"></div></div>
                    <span class="progress-value ${coverageClass(r.coverage)}">${r.coverage}%</span>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  return html || '<div style="padding:24px; text-align:center; color:var(--text3);">Nを選択して分析を実行してください</div>';
}

// ========== 未カバータブ ==========

function renderUncoveredTab(coverage, headers) {
  let html = `
    <div style="padding:12px 16px; font-size:12px; color:var(--text2); border-bottom:1px solid var(--border); line-height:1.7;">
      各グループは<strong style="color:var(--text);">「これらの因子を同時に考えたとき、存在しなければならないはずの値の組み合わせ」</strong>のうち、
      テストケースに1件も存在しないものを列挙しています。<br>
      例: OS × ブラウザ × デバイス の組み合わせで「Windows / Firefox / モバイル」という行が1件もなければ未カバーです。
    </div>
    <div style="padding:16px; display:flex; flex-direction:column; gap:12px;">
  `;
  let hasAny = false;

  for (const [n, results] of Object.entries(coverage)) {
    if (!results) continue;
    for (const r of results) {
      if (r.skipped || r.coverage === null || r.uncoveredCount === 0) continue;
      hasAny = true;
      const factorNames = r.factors.map(fi => headers[fi]).join(' × ');
      const truncated = r.uncoveredTotal > r.uncoveredCombos.length;
      const factorKey = r.factors.join('-');
      html += `
        <div class="uncovered-panel" data-factor-key="${factorKey}">
          <div class="uncovered-header">
            <span>⚠</span>
            <span class="uncovered-title">${n}因子: ${factorNames}</span>
            <span class="uncovered-count">${r.uncoveredTotal}件未カバー</span>
          </div>
          <div class="uncovered-body">
            <div style="font-size:11px; color:var(--text3); margin-bottom:10px;">
              下記の値の組み合わせを持つテストケースが存在しません
            </div>
            ${truncated ? `<div style="font-size:11px; color:var(--accent4); padding-bottom:8px; border-bottom:1px solid var(--border); margin-bottom:8px;">⚠ ${r.uncoveredTotal.toLocaleString()}件中、最初の${r.uncoveredCombos.length}件を表示</div>` : ''}
            <div style="display:flex; gap:8px; padding-bottom:8px; border-bottom:1px solid var(--border); margin-bottom:4px;">
              ${r.factors.map(fi => `<span style="font-size:10px; font-weight:700; color:var(--accent2); min-width:80px;">${headers[fi]}</span>`).join('<span style="color:var(--text3); font-size:10px; align-self:center;">×</span>')}
            </div>
            ${r.uncoveredCombos.map(combo => `
              <div class="uncovered-combo">${combo.map(v => `<span class="combo-tag">${v}</span>`).join('<span style="color:var(--text3); font-size:10px; margin:0 2px;">/</span>')}</div>
            `).join('')}
          </div>
        </div>
      `;
    }
  }
  html += '</div>';
  return hasAny ? html : '<div style="padding:48px; text-align:center; color:var(--accent);">🎉 すべての組み合わせがカバーされています！</div>';
}

// ========== 値バランスタブ ==========

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
              <div class="balance-bar"><div class="balance-fill" style="width:${v.ratio}%"></div></div>
              <div class="balance-pct">${v.ratio}%</div>
            </div>
          `).join('')}
          <div style="font-size:10px; color:var(--text3); margin-top:4px;">計${fb.total}件</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ========== 密度マップタブ（N因子対応）==========

let currentHeatmapN = 2;

function selStyle() { return 'padding:6px 10px; border-radius:6px; border:1.5px solid var(--border); background:var(--surface2); color:var(--text); font-size:12px; cursor:pointer;'; }
function btnStyle() { return 'padding:6px 16px; border-radius:6px; border:1.5px solid var(--accent); background:transparent; color:var(--accent); font-size:12px; cursor:pointer;'; }

function renderHeatmapTab() {
  if (!lastResults || !lastResults.activeFactors || lastResults.activeFactors.length < 2)
    return '<div style="padding:24px;color:var(--text3);text-align:center">因子が2つ以上必要です</div>';

  const { activeFactors, headers } = lastResults;
  const maxN = Math.min(5, activeFactors.length);
  const nButtons = Array.from({length: maxN - 1}, (_, i) => i + 2)
    .map(n => `<div class="n-btn ${n === 2 ? 'active' : ''}" data-heatmap-n="${n}" onclick="onHeatmapNClick(${n})">${n}</div>`)
    .join('');

  return `
    <div style="padding:12px 16px; font-size:12px; color:var(--text2); border-bottom:1px solid var(--border);">
      因子数を選択し、分析対象の因子を選んでマトリクスを表示します。N=3以上の場合は3番目以降の因子の値ごとにスライス表示します。
    </div>
    <div style="padding:12px 16px; display:flex; align-items:center; gap:12px; border-bottom:1px solid var(--border);">
      <span style="font-size:11px; color:var(--text3); font-family:monospace;">表示N因子</span>
      <div style="display:flex; gap:6px;" id="heatmapNSelector">${nButtons}</div>
    </div>
    <div id="heatmapFactorSelectors" style="padding:12px 16px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; border-bottom:1px solid var(--border);">
      <label style="font-size:12px; color:var(--text2);">因子1</label>
      <select id="hfSel0" style="${selStyle()}">${activeFactors.map((fi,i)=>`<option value="${fi}">${headers[fi]}</option>`).join('')}</select>
      <span style="color:var(--text3);">×</span>
      <label style="font-size:12px; color:var(--text2);">因子2</label>
      <select id="hfSel1" style="${selStyle()}">${activeFactors.map((fi,i)=>`<option value="${fi}" ${i===1?'selected':''}>${headers[fi]}</option>`).join('')}</select>
      <button onclick="updateHeatmapN()" style="${btnStyle()}">表示</button>
    </div>
    <div class="heatmap-wrap" id="heatmapContent">
      ${renderHeatmapMatrixByIndices([activeFactors[0], activeFactors[1]])}
    </div>
  `;
}

function onHeatmapNClick(n) {
  currentHeatmapN = n;
  document.querySelectorAll('[data-heatmap-n]').forEach(btn =>
    btn.classList.toggle('active', parseInt(btn.dataset.heatmapN) === n));

  const { activeFactors, headers } = lastResults;
  const container = document.getElementById('heatmapFactorSelectors');
  let html = '';
  for (let i = 0; i < n; i++) {
    const defaultIdx = Math.min(i, activeFactors.length - 1);
    html += `<label style="font-size:12px; color:var(--text2);">因子${i+1}</label>
      <select id="hfSel${i}" style="${selStyle()}">${activeFactors.map((fi,j)=>`<option value="${fi}" ${j===defaultIdx?'selected':''}>${headers[fi]}</option>`).join('')}</select>
      ${i < n-1 ? '<span style="color:var(--text3);">×</span>' : ''}`;
  }
  html += `<button onclick="updateHeatmapN()" style="${btnStyle()}">表示</button>`;
  container.innerHTML = html;
  updateHeatmapN();
}

function updateHeatmapN() {
  const indices = [];
  for (let i = 0; i < currentHeatmapN; i++) {
    const sel = document.getElementById(`hfSel${i}`);
    if (!sel) break;
    indices.push(parseInt(sel.value));
  }
  if (new Set(indices).size !== indices.length) {
    document.getElementById('heatmapContent').innerHTML = '<div style="color:var(--accent3); padding:16px;">異なる因子を選択してください</div>';
    return;
  }
  document.getElementById('heatmapContent').innerHTML = renderHeatmapMatrixByIndices(indices);
}

function renderHeatmapMatrixByIndices(indices) {
  const { rows, headers } = lastResults;
  const data = AnalysisEngine.calcDensityMapN(rows, indices, headers);
  if (!data) return '<div style="color:var(--text3); padding:16px;">データ不足</div>';

  if (data.type === 'matrix') return '<div style="padding:16px;">' + renderHeatmapMatrix(data) + '</div>';

  return data.slices.map(slice => `
    <div style="padding:16px 16px 0;">
      <div style="font-size:12px; font-family:monospace; color:var(--accent2); margin-bottom:10px; padding:6px 10px; background:var(--surface2); border-radius:var(--radius-sm); display:inline-block;">▸ ${slice.label}</div>
      ${renderHeatmapMatrix(slice)}
    </div>
    <div style="border-top:1px solid var(--border); margin:16px 0 0;"></div>
  `).join('');
}

function renderHeatmapMatrix(d) {
  const maxVal = Math.max(...d.factor1.values.flatMap(vi => d.factor2.values.map(vj => d.matrix[vi]?.[vj] || 0)), 1);
  const pct = d.coverage;
  const cls = coverageClass(pct);
  return `
    <div style="margin-bottom:12px; display:flex; align-items:center; gap:12px;">
      <span style="font-size:12px; color:var(--text2);">密度カバレッジ:</span>
      <div class="progress-wrap" style="flex:none; gap:8px;">
        <div class="progress-bar" style="min-width:120px;"><div class="progress-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="progress-value ${cls}">${pct}%</span>
      </div>
      <span style="font-size:11px; color:var(--text3);">${d.covered}/${d.theoretical}組み合わせ</span>
    </div>
    <div style="overflow-x:auto;">
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
                const bg = cnt === 0 ? 'rgba(255,107,107,0.12)' : `rgba(79,255,176,${0.08 + (cnt/maxVal)*0.55})`;
                const color = cnt === 0 ? 'var(--accent3)' : 'var(--accent)';
                return `<td style="background:${bg}; color:${color}; font-size:12px;">${cnt === 0 ? '–' : cnt}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ========== 重複タブ ==========

function renderDuplicatesTab(duplicates, activeFactors, headers) {
  if (duplicates.length === 0)
    return '<div style="padding:48px; text-align:center; color:var(--accent);">✅ 重複テストケースはありません</div>';
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

// ========== 因子値サマリータブ ==========

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
            <div class="factor-values-list">${vals.map(v => `<span class="factor-value-chip">${v}</span>`).join('')}</div>
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
  await window.electronAPI.saveCsv(csv, 'qualis_coverage.csv');
}

async function exportExcel() {
  if (!lastResults) return;
  showLoading('Excelファイルを生成中...');
  try {
    const base64 = await ExportUtils.exportToExcel(lastResults, lastResults.headers);
    await window.electronAPI.saveExcel(base64, 'qualis_coverage.xlsx');
  } catch (e) {
    alert('エクスポートに失敗しました: ' + e.message);
  } finally {
    hideLoading();
  }
}

// ========== ユーティリティ ==========

function showLoading(text) { document.getElementById('loadingText').textContent = text || '処理中...'; document.getElementById('loadingOverlay').classList.add('show'); }
function setLoadingText(text) { document.getElementById('loadingText').textContent = text; }
function hideLoading() { document.getElementById('loadingOverlay').classList.remove('show'); }
