/**
 * 跟踪比计算
 *
 * 定义：跟踪比 k 是「基金净值日涨幅对标的指数日涨幅的比例系数」——
 *   净值日涨幅 ≈ k × 指数日涨幅
 * k 只用来把参考涨幅放大/缩小成推算净值涨幅（○ 自算档），
 * ● 交易所 IOPV 与 ◐ 期货锚点都不经过它。
 *
 * 估计量（2026-09-17 方法学升级）：
 *   旧实现取「逐日比值 navInc/indexInc 的算术平均」= mean(y/x)。
 *   该估计量对小 |x| 样本极敏感（分母小 → 比值爆炸），有偏、也不是最小方差。
 *   现改为**过原点最小二乘**（regression through origin，即无截距线性回归）：
 *       k̂ = Σ(x_i·y_i) / Σ(x_i²)
 *   它是模型 y = k·x + ε（ε~N(0,σ²)）的极大似然解 = 最小二乘解，
 *   分母 Σx² 恒 > 0（数值稳定），权重天然偏向波动大的日子（信号强、比值可信）。
 *   这也是金融里「β（无截距口径）」的标准算法。
 *   同时给出 R² 与残差标准差，让用户能判断这个回归值可不可信。
 */
(function (global) {
  'use strict';

  const MIN_INDEX_ABS = 0.3; // 指数日涨跌绝对值小于该值(%)时不参与统计

  /**
   * 估计跟踪比。
   * @param {Array} records [{date, navInc, indexInc}] 均为百分数
   * @param {number} n 取最近 n 条有效记录
   * @returns {{
   *   ok:boolean, avg:number|null, samples:number, items:Array,
   *   r2:number|null, residStd:number|null, avgRatio:number|null, std:number|null
   * }} avg = 过原点最小二乘估计 k̂；avgRatio = 旧口径（逐日比值均值），保留供对比回溯
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

    // 过原点最小二乘：k̂ = Σxy / Σx²
    let sxx = 0, sxy = 0, syy = 0, sumRatio = 0;
    valid.forEach((it) => {
      const x = it.indexInc, y = it.navInc;
      sxx += x * x;
      sxy += x * y;
      syy += y * y;
      sumRatio += it.ratio;
    });
    const avgRatio = sumRatio / valid.length;          // 旧口径（逐日比值均值）
    const avg = sxx > 0 ? sxy / sxx : avgRatio;        // 新口径（OLS through origin）
    // 拟合残差与 R²：R² 越接近 1，说明「这只基金确实就是按这个指数在走」，跟踪比越可信
    let sse = 0;
    valid.forEach((it) => {
      const e = it.navInc - avg * it.indexInc;
      sse += e * e;
    });
    const residStd = Math.sqrt(sse / valid.length);    // 残差标准差（百分点）
    const r2 = syy > 0 ? 1 - sse / syy : null;
    // 旧口径的离散度（比值标准差），保留供对比
    const variance = valid.reduce((a, b) => a + Math.pow(b.ratio - avgRatio, 2), 0) / valid.length;
    return {
      ok: true,
      avg,
      r2,
      residStd,
      avgRatio,
      std: Math.sqrt(variance),
      samples: valid.length,
      items,
    };
  }

  /** 归一化日期：'09-17' → '2026-09-17'（按当年）；无法识别原样返回 */
  function normDate(s) {
    const t = String(s || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = t.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) {
      const p = (n) => String(n).padStart(2, '0');
      return `${new Date().getFullYear()}-${p(m[1])}-${p(m[2])}`;
    }
    return t;
  }

  /**
   * 从详情页历史表中提取 {date, navInc, indexInc} 记录（新→旧）。
   * 支持两种格式：
   *   格式一：直接带「净值涨幅 + 指数涨幅」列 —— 直接读取；
   *   格式二：「净值 + 重仓涨幅」列（集思录 LOF/QDII 详情历史表实测格式）——
   *           按净值日期对齐相邻两期净值算出净值涨幅，参考涨幅取同一净值日期当天的
   *           重仓/指数涨幅（QDII 净值滞后 2 天，必须按净值日期对齐，不能按行错位配对）。
   */
  function extractFromTable(table) {
    const heads = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim());
    let dIdx = -1, ndIdx = -1, nIdx = -1, niIdx = -1, iIdx = -1;
    heads.forEach((h, i) => {
      if (niIdx === -1 && /净值.*涨幅|净值增长率|日增长率/.test(h)) niIdx = i;
      else if (ndIdx === -1 && /净值日期/.test(h)) ndIdx = i;
      else if (nIdx === -1 && /^(单位)?净值$/.test(h)) nIdx = i;
      else if (dIdx === -1 && /日期/.test(h) && !/净值日期/.test(h)) dIdx = i;
      if (iIdx === -1 && /重仓.*涨幅|十大持仓.*涨幅|指数.*涨幅|跟踪指数|标的指数/.test(h)) iIdx = i;
    });
    const F = global.JsaFormat;
    const rows = [];
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const tds = Array.from(tr.children);
      if (!tds.length) return;
      const cell = (i) => (i >= 0 && tds[i] ? (tds[i].textContent || '').trim() : '');
      rows.push({
        date: normDate(cell(dIdx)),
        navDate: normDate(cell(ndIdx)),
        nav: F.number(cell(nIdx)),
        navInc: niIdx >= 0 ? F.number(cell(niIdx)) : null,
        refInc: iIdx >= 0 ? F.number(cell(iIdx)) : null,
      });
    });

    // 格式一：直接有净值涨幅列
    if (niIdx >= 0 && iIdx >= 0) {
      return rows
        .filter((r) => r.navInc !== null && r.refInc !== null)
        .map((r) => ({ date: r.date, navInc: r.navInc, indexInc: r.refInc }));
    }

    // 格式二：净值列 + 参考涨幅列 → 按净值日期对齐推算
    if (nIdx >= 0 && iIdx >= 0) {
      const navByDate = {};
      const refByDate = {};
      rows.forEach((r) => {
        const nd = r.navDate || r.date;
        if (nd && r.nav !== null && r.nav > 0 && navByDate[nd] === undefined) navByDate[nd] = r.nav;
        if (r.date && r.refInc !== null && refByDate[r.date] === undefined) refByDate[r.date] = r.refInc;
      });
      const dates = Object.keys(navByDate).sort(); // YYYY-MM-DD 字典序即时间序
      const out = [];
      for (let i = 1; i < dates.length; i++) {
        const d = dates[i];
        const pd = dates[i - 1];
        const navInc = ((navByDate[d] - navByDate[pd]) / navByDate[pd]) * 100;
        const ref = refByDate[d];
        if (ref === undefined || ref === null) continue;
        out.push({ date: d, navInc, indexInc: ref });
      }
      return out.reverse(); // 新→旧，与 average() 的 slice(0, n) 口径一致
    }
    return [];
  }

  global.JsaTrack = { average, extractFromTable, MIN_INDEX_ABS };
})(typeof window !== 'undefined' ? window : globalThis);
