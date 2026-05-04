// =============================================
// QualisCoverage - エクスポートユーティリティ
// =============================================

window.ExportUtils = {

  coverageToCSV(coverageResults, headers, n) {
    const nInt = parseInt(n);
    const lines = [];
    lines.push(`${n}因子間組み合わせカバレッジ分析`);
    lines.push('');
    const factorCols = Array.from({length: nInt}, (_, i) => `因子${i + 1}`).join(',');
    lines.push(`${factorCols},理論組み合わせ数,カバー済み,未カバー,カバレッジ(%),備考`);

    for (const r of coverageResults) {
      const factorNames = r.factors.map(fi => headers[fi]).join(',');
      if (r.groupSkipped) {
        lines.push(`${r.warning || 'グループ数上限超過'},,,,,"省略"`);
      } else if (r.skipped) {
        lines.push(`${factorNames},${r.theoreticalCount},,,,"計算上限超過"`);
      } else if (r.coverage === null) {
        lines.push(`${factorNames},0,,,,"${r.warning || ''}"`);
      } else {
        lines.push(`${factorNames},${r.theoreticalCount},${r.coveredCount},${r.uncoveredCount},${r.coverage},${r.uncoveredTotal > r.uncoveredCombos.length ? `上位${r.uncoveredCombos.length}件のみ表示` : ''}`);
      }
    }

    lines.push('');
    lines.push('未カバー組み合わせ詳細');
    lines.push('');

    for (const r of coverageResults) {
      if (r.skipped || r.coverage === null || r.uncoveredCombos.length === 0) continue;
      const factorNames = r.factors.map(fi => headers[fi]).join(' × ');
      lines.push(`【${factorNames}】（${r.uncoveredTotal}件中 ${r.uncoveredCombos.length}件表示）`);
      lines.push(r.factors.map(fi => headers[fi]).join(','));
      for (const combo of r.uncoveredCombos) {
        lines.push(combo.join(','));
      }
      lines.push('');
    }

    return lines.join('\n');
  },

  async exportToExcel(allResults, headers) {
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();

    // サマリーシート
    const summaryData = [['QualisCoverage 分析サマリー'], ['']];
    summaryData.push(['分析因子数', allResults.activeFactors.length]);
    summaryData.push(['テストケース数', allResults.totalRows]);
    summaryData.push(['重複ケース数', allResults.duplicates.length]);
    if (allResults.qualityScore && allResults.qualityScore.score !== null) {
      summaryData.push(['品質スコア', allResults.qualityScore.score + '%']);
    }
    summaryData.push(['']);
    summaryData.push(['N因子', '平均カバレッジ(%)', '最低カバレッジ(%)']);
    for (const b of (allResults.qualityScore?.breakdown || [])) {
      summaryData.push([`${b.n}因子間`, b.avg, b.min]);
    }
    const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, ws1, 'サマリー');

    // N因子カバレッジシート
    for (const [n, results] of Object.entries(allResults.coverage)) {
      if (!results || results.length === 0) continue;
      const nInt = parseInt(n);
      const sheetData = [];
      const factorHeaders = Array.from({length: nInt}, (_, i) => `因子${i + 1}`);
      sheetData.push([...factorHeaders, '理論数', 'カバー済み', '未カバー', 'カバレッジ(%)', '備考']);
      for (const r of results) {
        if (r.groupSkipped) {
          sheetData.push([r.warning || 'グループ数上限超過', '', '', '', '', '省略']);
        } else if (r.skipped) {
          sheetData.push([...r.factors.map(fi => headers[fi]), r.theoreticalCount, '', '', '', '計算上限超過']);
        } else if (r.coverage === null) {
          sheetData.push([...r.factors.map(fi => headers[fi]), 0, '', '', '', r.warning || '']);
        } else {
          sheetData.push([
            ...r.factors.map(fi => headers[fi]),
            r.theoreticalCount, r.coveredCount, r.uncoveredCount, r.coverage,
            r.uncoveredTotal > r.uncoveredCombos.length ? `上位${r.uncoveredCombos.length}件のみ` : ''
          ]);
        }
      }
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, `${n}因子カバレッジ`);
    }

    // 値バランスシート
    if (allResults.valueBalance) {
      const sheetData = [['因子名', '値', '出現回数', '割合(%)']];
      for (const fb of allResults.valueBalance) {
        for (const v of fb.values) {
          sheetData.push([fb.factorName, v.value, v.count, v.ratio]);
        }
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetData), '値バランス');
    }

    // 重複ケースシート
    if (allResults.duplicates.length > 0) {
      const sheetData = [['行番号', ...allResults.activeFactors.map(fi => headers[fi]), '重複数']];
      for (const d of allResults.duplicates) {
        sheetData.push([d.rows.join(', '), ...d.values, d.count]);
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetData), '重複ケース');
    }

    return XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
  }
};
