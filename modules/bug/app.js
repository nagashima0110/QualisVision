// =============================================
// QualisBug - UIオーケストレーション
// =============================================

const FIELDS = [
  // 基本情報
  { id: 'bugId',        label: 'バグID',         group: '基本情報' },
  { id: 'title',        label: 'タイトル',        group: '基本情報' },
  { id: 'foundDate',    label: '発見日',           group: '基本情報' },
  { id: 'fixedDate',    label: '修正完了日',       group: '基本情報' },
  { id: 'status',       label: 'ステータス',       group: '基本情報' },
  // 分類
  { id: 'severity',     label: '重大度',           group: '分類' },
  { id: 'priority',     label: '優先度',           group: '分類' },
  { id: 'foundPhase',   label: '発見工程',         group: '分類' },
  { id: 'injectedPhase',label: '混入工程',         group: '分類' },
  { id: 'cause',        label: '原因分類',         group: '分類' },
  { id: 'module',       label: 'モジュール/機能',  group: '分類' },
  { id: 'isRegression', label: '再発/デグレード',  group: '分類' },
  // 組織
  { id: 'assignee',     label: '担当者',           group: '組織' },
  // ODC
  { id: 'odcType',      label: 'ODC欠陥タイプ',    group: 'ODC' },
  { id: 'odcTrigger',   label: 'ODCトリガー',      group: 'ODC' },
  { id: 'odcTarget',    label: 'ODCターゲット',    group: 'ODC' },
  { id: 'odcImpact',    label: 'ODCインパクト',    group: 'ODC' },
];

const TABS = [
  { id: 'dashboard',    label: 'ダッシュボード' },
  { id: 'pareto',       label: 'パレート図' },
  { id: 'growth',       label: '信頼性成長曲線' },
  { id: 'dre',          label: '工程別DRE' },
  { id: 'duration',     label: '修正期間' },
  { id: 'regression',   label: '再発・デグレード' },
  { id: 'zone',         label: 'ゾーン分析' },
  { id: 'odc',          label: 'ODC分析' },
];

let rawData = null;
let bugs = [];
let fileHeaders = [];
let columnMapping = {};
let testCountMap = {}; // モジュール別テスト数（ユーザー手入力）
let analysisResult = null;
let renderedTabs = new Set();
let tabRenderers = {};

// ========== 初期化 ==========

document.addEventListener('DOMContentLoaded', () => {
  initProfiles();
  buildMappingUI();
  buildTabs();
  setupFileUpload();
  setupAnalysisButton();
});

// ========== ファイルアップロード ==========

function setupFileUpload() {
  const dropZone = document.getElementById('dropZone');

  dropZone.addEventListener('click', async () => {
    const filePath = await window.electronAPI.openFileDialog();
    if (filePath) loadFileFromPath(filePath);
  });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.path) loadFileFromPath(file.path);
  });
}

async function loadFileFromPath(filePath) {
  showLoading('ファイルを読み込んでいます…');
  try {
    const result = await window.electronAPI.readFile(filePath);
    const fileName = filePath.split(/[\\/]/).pop();

    let rawRows;
    if (result.type === 'excel') {
      const wb = XLSX.read(result.data, { type: 'base64' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
    } else {
      rawRows = result.data;
    }

    const engine = window.BugAnalysisEngine;
    const parsed = engine.parseBugExcel(rawRows);
    if (parsed.headers.length === 0) {
      showError('ファイルを解析できませんでした。Excel形式を確認してください。');
      return;
    }
    rawData = parsed;
    fileHeaders = parsed.headers;
    updateMappingDropdowns();
    applyAutoMapping();
    document.getElementById('fileInfo').textContent =
      `${fileName}  /  ${fileHeaders.length}列・${parsed.rows.length}行`;
    document.getElementById('mappingSection').style.display = 'block';
    document.getElementById('runBtn').disabled = false;
  } catch (err) {
    showError('ファイル読み込みエラー: ' + err.message);
    console.error(err);
  } finally {
    hideLoading();
  }
}

// ========== カラムマッピングUI ==========

function buildMappingUI() {
  const container = document.getElementById('mappingFields');
  const groups = [...new Set(FIELDS.map(f => f.group))];
  for (const group of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'mapping-group';
    groupEl.innerHTML = `<div class="mapping-group-label">${group}</div>`;
    const grid = document.createElement('div');
    grid.className = 'mapping-grid';
    for (const field of FIELDS.filter(f => f.group === group)) {
      const row = document.createElement('div');
      row.className = 'mapping-row';
      row.innerHTML = `
        <label class="mapping-label">${field.label}</label>
        <select class="mapping-select" id="map_${field.id}" data-field="${field.id}">
          <option value="">(未設定)</option>
        </select>`;
      grid.appendChild(row);
    }
    groupEl.appendChild(grid);
    container.appendChild(groupEl);
  }
}

function updateMappingDropdowns() {
  for (const field of FIELDS) {
    const sel = document.getElementById(`map_${field.id}`);
    if (!sel) continue;
    const prev = sel.value;
    sel.innerHTML = '<option value="">(未設定)</option>';
    fileHeaders.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i + 1}. ${h}`;
      sel.appendChild(opt);
    });
    if (prev !== '' && columnMapping[field.id] != null)
      sel.value = columnMapping[field.id];
  }
}

function readMapping() {
  const m = {};
  for (const field of FIELDS) {
    const sel = document.getElementById(`map_${field.id}`);
    if (sel && sel.value !== '') m[field.id] = parseInt(sel.value);
    else m[field.id] = null;
  }
  return m;
}

function applyAutoMapping() {
  const lower = fileHeaders.map(h => h.toLowerCase());
  const HINTS = {
    bugId:        ['id', 'no', '番号', 'チケット', 'issue'],
    title:        ['タイトル', '件名', 'summary', 'subject'],
    foundDate:    ['発見', '検出', '登録', 'found', 'created', 'open'],
    fixedDate:    ['修正', '完了', 'fixed', 'closed', 'resolved'],
    status:       ['ステータス', 'status', '状態'],
    severity:     ['重大', '深刻', 'severity', '重要度'],
    priority:     ['優先', 'priority'],
    foundPhase:   ['発見工程', '発見フェーズ', 'phase'],
    injectedPhase:['混入工程', '混入フェーズ', 'inject'],
    cause:        ['原因', 'cause', '不具合種別'],
    module:       ['モジュール', 'module', '機能', 'component'],
    isRegression: ['再発', 'デグレード', 'regression'],
    assignee:     ['担当', 'assignee', 'owner'],
    odcType:      ['欠陥タイプ', 'defect type', 'odc type'],
    odcTrigger:   ['トリガー', 'trigger'],
    odcTarget:    ['ターゲット', 'target'],
    odcImpact:    ['インパクト', 'impact'],
  };
  for (const [fieldId, hints] of Object.entries(HINTS)) {
    const sel = document.getElementById(`map_${fieldId}`);
    if (!sel || sel.value !== '') continue;
    for (const hint of hints) {
      const idx = lower.findIndex(h => h.includes(hint));
      if (idx >= 0) { sel.value = idx; break; }
    }
  }
}

// ========== プロファイル管理 ==========

const PROFILE_KEY = 'qualisBugProfiles';

function initProfiles() {
  const sel = document.getElementById('profileSelect');
  const profiles = getProfiles();
  sel.innerHTML = '<option value="">（プロファイルなし）</option>';
  Object.keys(profiles).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name; sel.appendChild(opt);
  });
}

function getProfiles() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}'); } catch { return {}; }
}

function saveProfile() {
  const name = document.getElementById('profileName').value.trim();
  if (!name) return;
  const profiles = getProfiles();
  profiles[name] = readMapping();
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
  initProfiles();
  document.getElementById('profileSelect').value = name;
}

function loadProfile() {
  const sel = document.getElementById('profileSelect');
  if (!sel.value) return;
  const profiles = getProfiles();
  const mapping = profiles[sel.value];
  if (!mapping) return;
  columnMapping = mapping;
  for (const field of FIELDS) {
    const s = document.getElementById(`map_${field.id}`);
    if (s) s.value = (mapping[field.id] != null) ? mapping[field.id] : '';
  }
}

function deleteProfile() {
  const sel = document.getElementById('profileSelect');
  if (!sel.value) return;
  const profiles = getProfiles();
  delete profiles[sel.value];
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
  initProfiles();
}

// ========== 分析実行 ==========

function setupAnalysisButton() {
  document.getElementById('runBtn').addEventListener('click', runAnalysis);
}

const yield_ = () => new Promise(r => setTimeout(r, 0));

async function runAnalysis() {
  columnMapping = readMapping();
  const engine = window.BugAnalysisEngine;

  try {
    showLoading('バグレコードをマッピング中…');
    await yield_();

    bugs = engine.mapBugRecords(rawData.rows, columnMapping);
    if (bugs.length === 0) {
      showError('有効なバグレコードが見つかりませんでした。列マッピングを確認してください。');
      return;
    }

    showLoading(`${bugs.length}件のバグを分析中…`);
    await yield_();

    const timeSeries = engine.buildTimeSeries(bugs, 7);

    showLoading('信頼性成長曲線をフィッティング中…');
    await yield_();
    const gompertz = timeSeries ? engine.fitGompertz(timeSeries.series) : null;
    await yield_();
    const logistic = timeSeries ? engine.fitLogistic(timeSeries.series) : null;

    showLoading('パレート・DRE・工程分析中…');
    await yield_();

    analysisResult = {
      bugs,
      total: bugs.length,
      timeSeries,
      gompertz,
      logistic,
      pareto: {
        cause:      engine.calcPareto(bugs, 'cause'),
        module:     engine.calcPareto(bugs, 'module'),
        assignee:   engine.calcPareto(bugs, 'assignee'),
        severity:   engine.calcPareto(bugs, 'severity'),
        priority:   engine.calcPareto(bugs, 'priority'),
        foundPhase: engine.calcPareto(bugs, 'foundPhase'),
        status:     engine.calcPareto(bugs, 'status'),
      },
      dre:         engine.calcDRE(bugs),
      fixDuration: engine.calcFixDuration(bugs),
      regression:  engine.calcRegressionRate(bugs),
      zone:        engine.calcZoneAnalysis(bugs, testCountMap),
      odc:         engine.calcODC(bugs),
    };

    showLoading('ダッシュボードを描画中…');
    await yield_();

    renderedTabs.clear();
    buildTabRenderers();
    showResults();
    renderTab('dashboard');
    switchToTab('dashboard');
  } catch (err) {
    console.error('分析エラー:', err);
    showError('分析中にエラーが発生しました: ' + err.message);
  } finally {
    hideLoading();
  }
}

// ========== タブ管理 ==========

function buildTabs() {
  const tabsEl = document.getElementById('mainTabs');
  const contentsEl = document.getElementById('tabContents');
  tabsEl.innerHTML = '';
  contentsEl.innerHTML = '';
  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.className = 'tab'; btn.dataset.tab = tab.id; btn.textContent = tab.label;
    btn.addEventListener('click', () => switchToTab(tab.id));
    tabsEl.appendChild(btn);

    const div = document.createElement('div');
    div.className = 'tab-content'; div.id = `tab-${tab.id}`;
    contentsEl.appendChild(div);
  }
}

function buildTabRenderers() {
  tabRenderers = {
    dashboard:  renderDashboard,
    pareto:     renderParetoTab,
    growth:     renderGrowthTab,
    dre:        renderDRETab,
    duration:   renderDurationTab,
    regression: renderRegressionTab,
    zone:       renderZoneTab,
    odc:        renderODCTab,
  };
}

function switchToTab(tabId) {
  const tabsEl = document.getElementById('mainTabs');
  tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const activeBtn = tabsEl.querySelector(`[data-tab="${tabId}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById(`tab-${tabId}`);
  if (panel) panel.classList.add('active');
  renderTab(tabId);
}

function renderTab(tabId) {
  if (renderedTabs.has(tabId)) return;
  if (tabRenderers[tabId]) {
    tabRenderers[tabId]();
    renderedTabs.add(tabId);
  }
}

function showResults() {
  document.getElementById('uploadSection').style.display = 'none';
  document.getElementById('mappingSection').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('backBtn').style.display = 'inline-flex';
}

function goBack() {
  document.getElementById('uploadSection').style.display = 'block';
  document.getElementById('mappingSection').style.display = 'block';
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('backBtn').style.display = 'none';
  analysisResult = null;
  renderedTabs.clear();
}

// ========== ダッシュボード ==========

function renderDashboard() {
  const r = analysisResult;
  const el = document.getElementById('tab-dashboard');

  const withDate = r.bugs.filter(b => b._foundDate).length;

  // クローズ判定: 正規表現で幅広く対応（Jira・Redmine・独自Excel の各種表現）
  const CLOSED_RE = /closed|fixed|done|resolved|rejected|wontfix|won.?t.?fix|invalid|duplicate|完了|修正済|クローズ|解決|済み|却下|無効|終了|検証済|対応済/i;
  const statusPareto = r.pareto.status;
  let closedCount = 0, openCount = null;
  if (statusPareto) {
    closedCount = statusPareto.items
      .filter(item => CLOSED_RE.test(item.label))
      .reduce((s, item) => s + item.count, 0);
    openCount = r.total - closedCount;
  }

  const bestModel = r.gompertz && r.logistic
    ? (r.gompertz.mse <= r.logistic.mse ? r.gompertz : r.logistic)
    : (r.gompertz || r.logistic);

  const kpiItems = [
    { label: '総バグ数',     value: r.total,      sub: `${withDate}件日付あり` },
    { label: 'オープン',     value: openCount ?? '—', sub: openCount != null ? `${closedCount}件クローズ` : 'ステータス列未設定' },
    { label: '再発率',       value: r.regression ? r.regression.rate + '%' : '—', sub: `${r.regression?.regs || 0}件` },
    { label: '修正平均日数', value: r.fixDuration ? r.fixDuration.avg + '日' : '—', sub: r.fixDuration ? `中央値 ${r.fixDuration.median}日` : '' },
    { label: '予測総バグ数', value: bestModel ? Math.round(bestModel.total) + '件' : '—', sub: bestModel ? `${bestModel.type === 'gompertz' ? 'ゴンペルツ' : 'ロジスティック'}モデル` : '' },
    { label: '95%収束予測',  value: bestModel?.t95 != null ? `第${bestModel.t95}週` : '—', sub: '' },
  ];

  let html = `<div class="kpi-grid">${kpiItems.map(k => `
    <div class="kpi-card">
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-label">${k.label}</div>
      ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
    </div>`).join('')}</div>`;

  // ミニチャートグリッド
  html += `<div class="dash-charts">`;

  // 信頼性成長曲線ミニ
  if (r.timeSeries) {
    html += `<div class="dash-chart-card"><div class="dash-chart-title">信頼性成長曲線</div><div id="dashGrowthChart"></div></div>`;
  }

  // 原因パレート ミニ
  const causeP = r.pareto.cause;
  if (causeP) {
    html += `<div class="dash-chart-card"><div class="dash-chart-title">原因分類パレート</div><div id="dashCauseChart"></div></div>`;
  }

  // 工程別DRE ミニ
  const dreHasData = r.dre.some(d => d.foundHere > 0 || d.escaped > 0);
  if (dreHasData) {
    html += `<div class="dash-chart-card"><div class="dash-chart-title">工程別DRE</div><div id="dashDREChart"></div></div>`;
  }

  // 発見工程パレート ミニ
  const phaseP = r.pareto.foundPhase;
  if (phaseP) {
    html += `<div class="dash-chart-card"><div class="dash-chart-title">発見工程分布</div><div id="dashPhaseChart"></div></div>`;
  }

  // ステータス分布ミニ
  if (statusPareto) {
    html += `<div class="dash-chart-card"><div class="dash-chart-title">ステータス分布</div><div id="dashStatusChart"></div></div>`;
  }

  html += `</div>`;
  el.innerHTML = html;

  // チャート描画
  const BC = window.BugCharts;
  if (r.timeSeries) {
    BC.renderLineChart(
      document.getElementById('dashGrowthChart'),
      r.timeSeries.series,
      [r.gompertz, r.logistic].filter(Boolean),
      '',
      { compact: true }
    );
  }
  if (causeP) {
    BC.renderParetoChart(document.getElementById('dashCauseChart'), causeP, '', { compact: true });
  }
  if (dreHasData) {
    BC.renderDREChart(document.getElementById('dashDREChart'), r.dre, { compact: true });
  }
  if (phaseP) {
    BC.renderBarChart(document.getElementById('dashPhaseChart'),
      phaseP.items.map(i => ({ label: i.label, value: i.count })), '', { compact: true });
  }
  if (statusPareto) {
    BC.renderBarChart(document.getElementById('dashStatusChart'),
      statusPareto.items.map(i => ({ label: i.label, value: i.count })), '', { compact: true });
  }
}

// ========== パレート図タブ ==========

function renderParetoTab() {
  const r = analysisResult;
  const BC = window.BugCharts;
  const el = document.getElementById('tab-pareto');
  const defs = [
    { key: 'status',     title: 'ステータス' },
    { key: 'cause',      title: '原因分類' },
    { key: 'module',     title: 'モジュール/機能' },
    { key: 'severity',   title: '重大度' },
    { key: 'priority',   title: '優先度' },
    { key: 'assignee',   title: '担当者' },
    { key: 'foundPhase', title: '発見工程' },
  ];
  // パレート図は1列表示で大きく見せる
  el.innerHTML = '<div class="charts-single"></div>';
  const grid = el.querySelector('.charts-single');
  let anyChart = false;
  for (const d of defs) {
    const data = r.pareto[d.key];
    if (!data) continue;
    const card = document.createElement('div');
    card.className = 'chart-card full-width';
    card.innerHTML = `<div class="chart-card-title">${d.title}</div><div class="chart-area"></div>`;
    grid.appendChild(card);
    BC.renderParetoChart(card.querySelector('.chart-area'), data, d.title);
    anyChart = true;
  }
  if (!anyChart) el.innerHTML = '<p class="no-data">パレート図を描画するための分類データがありません。列マッピングで原因分類・モジュール等を設定してください。</p>';
}

// ========== 信頼性成長曲線タブ ==========

function renderGrowthTab() {
  const r = analysisResult;
  const el = document.getElementById('tab-growth');
  if (!r.timeSeries) {
    el.innerHTML = '<p class="no-data">信頼性成長曲線を描画するには発見日の列マッピングが必要です（3件以上のデータ）。</p>';
    return;
  }
  el.innerHTML = '<div class="chart-card full-width"><div class="chart-area" id="growthMainChart"></div></div>';
  el.innerHTML += `<div class="growth-info">
    ${r.gompertz ? `<div class="info-card"><b>ゴンペルツ曲線</b><br>総バグ予測: ${Math.round(r.gompertz.total)}件<br>95%収束: 第${r.gompertz.t95 ?? '—'}週<br>MSE: ${Math.round(r.gompertz.mse)}</div>` : ''}
    ${r.logistic ? `<div class="info-card"><b>ロジスティック曲線</b><br>総バグ予測: ${Math.round(r.logistic.total)}件<br>95%収束: 第${r.logistic.t95 ?? '—'}週<br>MSE: ${Math.round(r.logistic.mse)}</div>` : ''}
  </div>`;
  el.innerHTML = `<div class="chart-card full-width"><div class="chart-area" id="growthMainChart"></div></div>
    <div class="growth-info">
      ${r.gompertz ? `<div class="info-card"><b>ゴンペルツ曲線</b><br>総バグ予測: ${Math.round(r.gompertz.total)}件<br>95%収束: 第${r.gompertz.t95 ?? '—'}週<br>MSE: ${Math.round(r.gompertz.mse)}</div>` : ''}
      ${r.logistic ? `<div class="info-card"><b>ロジスティック曲線</b><br>総バグ予測: ${Math.round(r.logistic.total)}件<br>95%収束: 第${r.logistic.t95 ?? '—'}週<br>MSE: ${Math.round(r.logistic.mse)}</div>` : ''}
    </div>`;
  window.BugCharts.renderLineChart(
    document.getElementById('growthMainChart'),
    r.timeSeries.series,
    [r.gompertz, r.logistic].filter(Boolean),
    '累積バグ数と信頼性成長曲線'
  );
}

// ========== DREタブ ==========

function renderDRETab() {
  const r = analysisResult;
  const el = document.getElementById('tab-dre');
  const hasData = r.dre.some(d => d.foundHere > 0 || d.escaped > 0);
  if (!hasData) {
    el.innerHTML = '<p class="no-data">DRE分析には発見工程・混入工程の列マッピングが必要です。</p>';
    return;
  }
  el.innerHTML = '<div class="chart-card full-width"><div class="chart-area" id="dreMainChart"></div></div>';
  el.innerHTML += `<div class="dre-table-wrap"><table class="data-table"><thead><tr>
    <th>工程</th><th>当工程検出</th><th>流出件数</th><th>DRE(%)</th>
  </tr></thead><tbody>${r.dre.map(d => `<tr>
    <td>${d.phase}</td><td>${d.foundHere}</td><td>${d.escaped}</td>
    <td class="${d.dre != null ? (d.dre >= 80 ? 'good' : d.dre >= 60 ? 'warn' : 'bad') : ''}">${d.dre != null ? d.dre + '%' : '—'}</td>
  </tr>`).join('')}</tbody></table></div>`;
  el.innerHTML = `<div class="chart-card full-width"><div class="chart-area" id="dreMainChart"></div></div>
    <div class="dre-table-wrap"><table class="data-table"><thead><tr>
      <th>工程</th><th>当工程検出</th><th>流出件数</th><th>DRE(%)</th>
    </tr></thead><tbody>${r.dre.map(d => `<tr>
      <td>${d.phase}</td><td>${d.foundHere}</td><td>${d.escaped}</td>
      <td class="${d.dre != null ? (d.dre >= 80 ? 'good' : d.dre >= 60 ? 'warn' : 'bad') : ''}">${d.dre != null ? d.dre + '%' : '—'}</td>
    </tr>`).join('')}</tbody></table></div>`;
  window.BugCharts.renderDREChart(document.getElementById('dreMainChart'), r.dre);
}

// ========== 修正期間タブ ==========

function renderDurationTab() {
  const r = analysisResult;
  const el = document.getElementById('tab-duration');
  const fd = r.fixDuration;
  if (!fd) {
    el.innerHTML = '<p class="no-data">修正期間分析には発見日・修正完了日の列マッピングが必要です。</p>';
    return;
  }
  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-value">${fd.avg}日</div><div class="kpi-label">平均修正期間</div></div>
      <div class="kpi-card"><div class="kpi-value">${fd.median}日</div><div class="kpi-label">中央値</div></div>
      <div class="kpi-card"><div class="kpi-value">${fd.p90}日</div><div class="kpi-label">90パーセンタイル</div></div>
      <div class="kpi-card"><div class="kpi-value">${fd.max}日</div><div class="kpi-label">最大</div></div>
    </div>
    <div class="charts-grid">
      <div class="chart-card"><div class="chart-card-title">修正期間分布</div><div class="chart-area" id="durationHistChart"></div></div>
      <div class="chart-card"><div class="chart-card-title">重大度別平均修正日数</div><div class="chart-area" id="durationSevChart"></div></div>
    </div>`;
  window.BugCharts.renderBarChart(
    document.getElementById('durationHistChart'),
    fd.histogram.map(b => ({ label: b.label, value: b.count })),
    '修正期間分布'
  );
  window.BugCharts.renderBarChart(
    document.getElementById('durationSevChart'),
    fd.bySeverity.map(b => ({ label: b.severity, value: b.avg })),
    '重大度別平均修正日数',
    { unit: '日' }
  );
}

// ========== 再発・デグレードタブ ==========

function renderRegressionTab() {
  const r = analysisResult;
  const el = document.getElementById('tab-regression');
  const rg = r.regression;
  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-value">${rg.regs}件</div><div class="kpi-label">再発・デグレード数</div></div>
      <div class="kpi-card"><div class="kpi-value">${rg.rate}%</div><div class="kpi-label">再発率</div></div>
    </div>`;

  if (rg.byPhase.length > 0) {
    el.innerHTML += `<div class="chart-card full-width"><div class="chart-card-title">工程別再発率</div><div class="chart-area" id="regPhaseChart"></div></div>`;
    el.innerHTML += `<div class="dre-table-wrap"><table class="data-table"><thead><tr>
      <th>工程</th><th>総バグ</th><th>再発数</th><th>再発率(%)</th>
    </tr></thead><tbody>${rg.byPhase.map(p => `<tr>
      <td>${p.phase}</td><td>${p.total}</td><td>${p.reg}</td>
      <td class="${p.rate >= 20 ? 'bad' : p.rate >= 10 ? 'warn' : 'good'}">${p.rate}%</td>
    </tr>`).join('')}</tbody></table></div>`;
    el.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="kpi-value">${rg.regs}件</div><div class="kpi-label">再発・デグレード数</div></div>
        <div class="kpi-card"><div class="kpi-value">${rg.rate}%</div><div class="kpi-label">再発率</div></div>
      </div>
      <div class="chart-card full-width"><div class="chart-card-title">工程別再発率</div><div class="chart-area" id="regPhaseChart"></div></div>
      <div class="dre-table-wrap"><table class="data-table"><thead><tr>
        <th>工程</th><th>総バグ</th><th>再発数</th><th>再発率(%)</th>
      </tr></thead><tbody>${rg.byPhase.map(p => `<tr>
        <td>${p.phase}</td><td>${p.total}</td><td>${p.reg}</td>
        <td class="${p.rate >= 20 ? 'bad' : p.rate >= 10 ? 'warn' : 'good'}">${p.rate}%</td>
      </tr>`).join('')}</tbody></table></div>`;
    window.BugCharts.renderBarChart(
      document.getElementById('regPhaseChart'),
      rg.byPhase.map(p => ({ label: p.phase, value: p.rate })),
      '工程別再発率',
      { unit: '%', threshold: 10 }
    );
  } else if (rg.regs === 0) {
    el.innerHTML += '<p class="no-data">再発・デグレードのフラグが設定されているバグがありません。列マッピングで「再発/デグレード」を設定してください。</p>';
  }
}

// ========== ゾーン分析タブ ==========

// ゾーン説明テキスト（ローカル参照用）
const ZONE_INFO_LOCAL = {
  1: '期待通り（テスト数・バグ数ともに中程度で安定）',
  2: 'バグ少（テスト数多いがバグが少ない／テスト効率に問題なし）',
  3: 'テスト効率良（テスト少ないがバグを発見できている）',
  4: 'テスト効率悪（テスト多いがバグが少ない／リソース過剰）',
  5: '品質問題（テスト数に対してバグが多い）',
  6: '品質深刻（テスト多・バグも多い／最優先改善）',
  7: 'テスト不足・バグ中（品質懸念あり）',
  8: 'テスト不足・バグ多（深刻な品質問題）',
  9: 'テスト少（情報不足／評価困難）',
};

function renderZoneTab() {
  const r = analysisResult;
  const el = document.getElementById('tab-zone');

  // モジュール一覧収集
  const modules = [...new Set(r.bugs.map(b => b.module).filter(Boolean))].sort();

  // 9ゾーン凡例HTML生成
  const ZONE_COLORS = {
    1:'#4fffb0', 2:'#4fafff', 3:'#7b6cff',
    4:'#a0c4ff', 5:'#ffd93d', 6:'#ff6b6b',
    7:'#ffb347', 8:'#ff4500', 9:'#8b949e',
  };
  const legendItems = Object.entries(ZONE_INFO_LOCAL).map(([z, desc]) =>
    `<div class="zone-legend-item">
      <span class="zone-num-badge" style="background:${ZONE_COLORS[z]}22;color:${ZONE_COLORS[z]};border:1px solid ${ZONE_COLORS[z]}66;">${z}</span>
      <span>${desc}</span>
    </div>`
  ).join('');

  el.innerHTML = `
    <div class="zone-layout">
      <div class="zone-left">
        <div class="chart-card full-width"><div class="chart-card-title">ゾーン散布図（テスト数 × バグ数 9ゾーン）</div><div class="chart-area" id="zoneScatterChart"></div></div>
        <div class="zone-legend">${legendItems}</div>
      </div>
      <div class="zone-right">
        <div class="zone-effort-title">モジュール別テスト数入力</div>
        <div class="zone-effort-table">
          <table class="data-table">
            <thead><tr><th>モジュール</th><th>バグ数</th><th>テスト数</th></tr></thead>
            <tbody id="testCountTableBody"></tbody>
          </table>
        </div>
        <button class="btn btn-secondary" onclick="recalcZone()">散布図を更新</button>
      </div>
    </div>`;

  const tbody = document.getElementById('testCountTableBody');
  const bugByMod = {};
  for (const b of r.bugs) { const m = b.module || '（未分類）'; bugByMod[m] = (bugByMod[m] || 0) + 1; }
  const allMods = modules.length > 0 ? modules : Object.keys(bugByMod);
  if (allMods.length === 0) allMods.push('（未分類）');

  for (const mod of allMods) {
    const tr = document.createElement('tr');
    const safemod = String(mod).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    tr.innerHTML = `<td>${safemod}</td><td>${bugByMod[mod] || 0}</td>
      <td><input type="number" class="effort-input" data-module="${safemod}" value="${testCountMap[mod] || ''}" min="0" step="1" placeholder="—"></td>`;
    tbody.appendChild(tr);
  }

  drawZoneScatter();
}

function recalcZone() {
  // 入力値をtestCountMapに反映
  document.querySelectorAll('.effort-input').forEach(inp => {
    if (inp.value) testCountMap[inp.dataset.module] = parseFloat(inp.value);
    else delete testCountMap[inp.dataset.module];
  });
  analysisResult.zone = window.BugAnalysisEngine.calcZoneAnalysis(bugs, testCountMap);
  drawZoneScatter();
}

function drawZoneScatter() {
  const container = document.getElementById('zoneScatterChart');
  if (container) window.BugCharts.renderZoneScatter(container, analysisResult.zone);
}

// ========== ODCタブ ==========

function renderODCTab() {
  const r = analysisResult;
  const el = document.getElementById('tab-odc');
  const odc = r.odc;
  const keys = Object.keys(odc);
  if (keys.length === 0) {
    el.innerHTML = '<p class="no-data">ODC分析にはODC系列の列マッピングが必要です（欠陥タイプ・トリガー・ターゲット・インパクト）。</p>';
    return;
  }
  el.innerHTML = '<div class="charts-grid"></div>';
  const grid = el.querySelector('.charts-grid');
  for (const key of keys) {
    const dim = odc[key];
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.innerHTML = `<div class="chart-card-title">${dim.label}</div><div class="chart-area"></div>`;
    grid.appendChild(card);
    window.BugCharts.renderDonutChart(card.querySelector('.chart-area'), dim.items, dim.label);
  }
}

// ========== UIユーティリティ ==========

function showLoading(msg) {
  const ov = document.getElementById('loadingOverlay');
  ov.querySelector('.loading-text').textContent = msg || '処理中…';
  ov.style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}
