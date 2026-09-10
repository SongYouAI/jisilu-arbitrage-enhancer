/**
 * 跟踪比计算
 * 跟踪比 = 基金净值日涨幅 ÷ 标的指数日涨幅
 * 指数波动过小时比值噪声极大，需设阈值过滤。
 */
(function (global) {
  'use strict';

  const MIN_INDEX_ABS = 0.3; // 指数日涨跌绝对值小于该值(%)时不参与统计

  /**
   * @param {Array} records [{date, navInc, indexInc}] 均为百分数
   * @param {number} n 取最近 n 条有效记录
   */
  function average(records, n) {
    const list = (records || []).filter(
      (r) =>
        r &&
        typeof r.navInc === 'number' &&
        typeof r.indexInc === 'number' &&
        isFinite(r.navInc) &&
        isFinite(r.indexInc) &&
        Math.abs(r.indexInc) >= MIN_INDEX_ABS
    );
    const take = list.slice(0, n && n > 0 ? n : list.length);
    if (!take.length) return { ok: false, avg: null, samples: 0, items: [] };
    const items = take.map((r) => ({
      date: r.date,
      navInc: r.navInc,
      indexInc: r.indexInc,
      ratio: r.indexInc === 0 ? null : r.navInc / r.indexInc,
    }));
    const valid = items.filter((x) => x.ratio !== null && isFinite(x.ratio));
    if (!valid.length) return { ok: false, avg: null, samples: 0, items };
    const sum = valid.reduce((a, b) => a + b.ratio, 0);
    const avg = sum / valid.length;
    // 离散度（标准差），用于提示跟踪稳定性
    const variance = valid.reduce((a, b) => a + Math.pow(b.ratio - avg, 2), 0) / valid.length;
    return { ok: true, avg, std: Math.sqrt(variance), samples: valid.length, items };
  }

  /** 从详情页表格中提取历史记录（容错：多种表头别名） */
  function extractFromTable(table) {
    const heads = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim());
    let dIdx = -1, nIdx = -1, iIdx = -1;
    heads.forEach((h, i) => {
      if (/日期/.test(h) && dIdx === -1) dIdx = i;
      if (/净值.*涨幅|净值增长率|日增长率/.test(h) && nIdx === -1) nIdx = i;
      if (/指数.*涨幅|跟踪指数|标的指数/.test(h) && iIdx === -1) iIdx = i;
    });
    if (nIdx === -1 || iIdx === -1) return [];
    const F = global.JsaFormat;
    const out = [];
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const tds = Array.from(tr.children);
      if (!tds.length) return;
      const date = dIdx >= 0 ? (tds[dIdx] ? (tds[dIdx].textContent || '').trim() : '') : '';
      const navInc = F.number(tds[nIdx] ? tds[nIdx].textContent : null);
      const indexInc = F.number(tds[iIdx] ? tds[iIdx].textContent : null);
      if (navInc === null || indexInc === null) return;
      out.push({ date, navInc, indexInc });
    });
    return out;
  }

  global.JsaTrack = { average, extractFromTable, MIN_INDEX_ABS };
})(typeof window !== 'undefined' ? window : globalThis);
