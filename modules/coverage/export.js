// =============================================
// エクスポートユーティリティ
// =============================================

window.ExportUtils = {

  /**
   * 組み合わせカバレッジ結果をCSVに変換
   */
  coverageToCSV(coverageResults, headers, n) {
    const lines = [];
    lines.push(`${n}因子間組み合わせカバレッジ分析`);
    lines.push('');
    lines.push('因子1,因子2' + (n >= 3 ? ',因子3' : '') + (n >= 4 ? ',因子4' : '') + ',理論組み合わせ数,カバー済み,未カバー,カバレッジ(%)');

    for (const r of coverageResults) {
      const factorNames = r.factors.map(fi => headers[fi]).join(',');
      lines.push(`${factorNames},${r.theoreticalCount},${r.coveredCount},${r.uncoveredCount},${r.coverage}`);
    }

    lines.push('');
    lines.push('未カバー組み合わせ詳細');
    lines.push('');

    for (const r of coverageResults) {
      if (r.uncoveredCombos.length > 0) {
        const factorNames = r.factors.map(fi => headers[fi]).join(' × ');
        lines.push(`【${factorNames}】`);
        lines.push(r.factors.map(fi => headers[fi]).join(','));
        for (const combo of r.uncoveredCombos) {
          lines.push(combo.join(','));
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  },

  /**
   * 全分析結果をExcelに変換（xlsxライブラリ使用）
   */
  async exportToExcel(allResults, headers) {
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();

    // シート1: サマリー
    const summaryData = [['分析サマリー'], ['']];
    summaryData.push(['分析因子数', allResults.activeFactors.length]);
    summaryData.push(['テストケース数', allResults.totalRows]);
    summaryData.push(['重複ケース数', allResults.duplicates.length]);
    summaryData.push(['']);
    summaryData.push(['N因子', 'カバレッジ平均(%)']);
    for (const [n, results] of Object.entries(allResults.coverage)) {
      if (results && results.length > 0) {
        const avg = results.reduce((s, r) => s + r.coverage, 0) / results.length;
        summaryData.push([`${n}因子間`, Math.round(avg * 10) / 10]);
      }
    }
    const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, ws1, 'サマリー');

    // シート2〜: 各N因子カバレッジ
    for (const [n, results] of Object.entries(allResults.coverage)) {
      if (!results || results.length === 0) continue;
      const sheetData = [];
      const factorHeaders = results[0].factors.map((_, i) => `因子${i + 1}`);
      sheetData.push([...factorHeaders, '理論数', 'カバー済み', '未カバー', 'カバレッジ(%)']);
      for (const r of results) {
        sheetData.push([
          ...r.factors.map(fi => headers[fi]),
          r.theoreticalCount,
          r.coveredCount,
          r.uncoveredCount,
          r.coverage
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, `${n}因子カバレッジ`);
    }

    // シート: 値バランス
    if (allResults.valueBalance) {
      const sheetData = [['因子名', '値', '出現回数', '割合(%)']];
      for (const fb of allResults.valueBalance) {
        for (const v of fb.values) {
          sheetData.push([fb.factorName, v.value, v.count, v.ratio]);
        }
      }
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, '値バランス');
    }

    // シート: 重複ケース
    if (allResults.duplicates.length > 0) {
      const sheetData = [['行番号', ...allResults.activeFactors.map(fi => headers[fi]), '重複数']];
      for (const d of allResults.duplicates) {
        sheetData.push([d.rows.join(', '), ...d.values, d.count]);
      }
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, '重複ケース');
    }

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    return wbout;
  }
};
