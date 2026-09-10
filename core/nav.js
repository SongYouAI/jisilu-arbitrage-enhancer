/**
 * 历史净值序列
 * 数据源：天天基金 pingzhongdata（fund.eastmoney.com/pingzhongdata/{code}.js）
 *   实测：无需 Referer 即可 200（与 FundArchivesDatas.aspx 不同，后者强制校验 Referer，
 *   而 Referer 是浏览器禁用请求头、JS fetch 无法伪造，故本插件改用此源）。
 *   内含 Data_netWorthTrend：[{x:毫秒时间戳, y:单位净值, equityReturn:日涨跌%}, ...]
 * 用途：① 真实净值日期（填补详情页"—"）② 近期净值涨跌与波动率 ③ 跟踪比校准基准
 */
(function (global) {
  'use strict';

  const KEEP = 400; // 只保留最近 400 个交易日，足够 20 日统计

  function ymdOf(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '';
    // 东财时间戳按 UTC+8 零点给出，固定偏移换算，避免运行环境时区干扰
    return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /**
   * 解析 pingzhongdata 脚本文本
   * @returns {{ok:boolean, reason?:string, items:Array<{date,nav,inc}>, asOf?:string, lastNav?:number}}
   */
  function parsePingZhong(text) {
    if (!text || typeof text !== 'string') return { ok: false, reason: '空响应', items: [] };
    const key = 'Data_netWorthTrend';
    const ki = text.indexOf(key);
    if (ki < 0) return { ok: false, reason: '响应中无净值序列', items: [] };
    const s = text.indexOf('[', ki);
    if (s < 0) return { ok: false, reason: '净值序列格式异常', items: [] };
    let depth = 0, end = -1;
    for (let k = s; k < text.length; k++) {
      const ch = text[k];
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { end = k + 1; break; } }
    }
    if (end < 0) return { ok: false, reason: '净值序列未闭合', items: [] };
    let arr;
    try { arr = JSON.parse(text.slice(s, end)); }
    catch (e) { return { ok: false, reason: '净值序列解析失败', items: [] }; }
    if (!Array.isArray(arr) || arr.length < 2) return { ok: false, reason: '净值数据不足', items: [] };

    // 多取一条用于计算首日涨跌
    const raw = arr.slice(-(KEEP + 1));
    const items = [];
    for (let i = 1; i < raw.length; i++) {
      const prev = raw[i - 1], cur = raw[i];
      const nav = typeof cur.y === 'number' ? cur.y : null;
      const pnav = typeof prev.y === 'number' ? prev.y : null;
      if (nav === null || pnav === null || pnav === 0) continue;
      const date = ymdOf(cur.x);
      if (!date) continue;
      items.push({ date, nav, inc: ((nav - pnav) / pnav) * 100 });
    }
    if (!items.length) return { ok: false, reason: '无有效净值点', items: [] };
    const last = items[items.length - 1];
    return { ok: true, items, asOf: last.date, lastNav: last.nav };
  }

  /**
   * 近期统计
   * @param {Array} items parsePingZhong 的 items
   * @param {number} n 最近 n 个交易日
   */
  function stats(items, n) {
    const list = (items || []).filter((r) => r && isFinite(r.inc));
    if (!list.length) return { ok: false };
    const take = list.slice(-(n > 0 ? n : list.length));
    if (!take.length) return { ok: false };
    const sum = take.reduce((a, b) => a + b.inc, 0);
    const avg = sum / take.length;
    const variance = take.reduce((a, b) => a + Math.pow(b.inc - avg, 2), 0) / take.length;
    const up = take.filter((x) => x.inc > 0).length;
    return {
      ok: true,
      n: take.length,
      avg,
      std: Math.sqrt(variance),
      upRatio: up / take.length,
      from: take[0].date,
      to: take[take.length - 1].date,
    };
  }

  global.JsaNav = { parsePingZhong, stats, ymdOf, KEEP };
})(typeof window !== 'undefined' ? window : globalThis);
