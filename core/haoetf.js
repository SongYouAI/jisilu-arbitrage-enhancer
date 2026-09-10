/**
 * HaoETF（haoetf.com）跨境 QDII 实时估值解析
 *
 * 为什么需要它：跨境品种（QDII-LOF / 跨境 ETF）在 A 股盘中，海外市场是休市的，
 * 用「A 股现货指数 × 跟踪比」推算净值在方法论上就是错的 —— 正确的锚点是**海外期货**。
 * HaoETF 的算法正是：最新估值 = T-2 净值 + 跟踪指数(T-1)；实时估值 = T-1 估值 + 实时期货。
 * 腾讯行情取不到期货（hf_GC / hf_CL / hf_NQ 实测全空），故此源是目前唯一可得期货锚点的免费源。
 *
 * 实测（2026-09-10）：
 *   - 首页与详情页均可抓，无 Referer / 无 UA 也返回 200（51KB HTML，服务端渲染）
 *   - 表头 23 列，但数据行只有 20 个 td —— 部分列被 HTML 注释掉（如「成交量」）
 *     ⇒ 按表头索引取值必然错位；必须先剔除注释，并用「头锚点 + 尾锚点 + 内容特征」定位
 *   - 自洽校验成立：501018 现价 1.995 / 实时估值 2.0448 ⇒ (1.995−2.0448)/2.0448 = −2.435%
 *     与页面标注的实时溢价 −2.43% 吻合 ⇒ 该字段可机器验证真伪
 *
 * 接入状态（v0.4.0）：已在 manifest 注册 background/importScripts 与 content_scripts，
 * 由 background 的 JSA_GET_HAOETF 统一取回（传 code 取单只，不传取全表 byCode 索引）。
 * 列表页用于 ◐ 档；详情页用单只查询，保证「列表 ◐ / 详情 ◐」档位一致。
 * 数据为第三方站点的自行估算，展示时必须标注来源，不得冒充交易所官方值。
 */
(function (global) {
  'use strict';

  const REQUIRED_HEADS = ['实时估值', '实时溢价', '申购限额'];

  function stripTags(s) {
    return String(s == null ? '' : s)
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function num(s) {
    const t = stripTags(s);
    if (!t || t === '-' || t === '—') return null;
    const v = parseFloat(t.replace(/,/g, ''));
    return isFinite(v) ? v : null;
  }

  function pct(s) {
    const t = stripTags(s);
    if (!t || t.indexOf('%') < 0) return null;
    const v = parseFloat(t.replace(/%/g, ''));
    return isFinite(v) ? v : null;
  }

  /** MD-MM 形式的日期（该站年份需由调用方补） */
  function isShortDate(s) {
    return /^\d{2}-\d{2}$/.test(stripTags(s));
  }

  /** 解析表头，用于页面改版检测 */
  function parseHeads(text) {
    const m = String(text || '').match(/<thead[\s\S]*?<\/thead>/i);
    if (!m) return [];
    return Array.from(m[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((x) => stripTags(x[1]));
  }

  /**
   * 解析单行
   * 定位策略：头部 6 列固定（代码/名称/实时估值/实时溢价/最新估值/最新溢价），
   * 尾部 4 列固定（申购限额/申购费/赎回费/其它），中间弹性区按内容特征找，
   * 从而不受「某些列被注释」的影响。
   */
  function parseRow(tr) {
    const clean = String(tr).replace(/<!--[\s\S]*?-->/g, '');
    const tds = Array.from(clean.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((x) => x[1]);
    if (tds.length < 12) return null;

    const code = stripTags(tds[0]);
    if (!/^\d{6}$/.test(code)) return null;

    const n = tds.length;
    const item = {
      code,
      name: stripTags(tds[1]),
      rtNav: num(tds[2]),        // 实时估值（T-1 估值 + 实时期货）
      rtPrem: pct(tds[3]),       // 实时溢价（基于实时估值）
      lastNav: num(tds[4]),      // 最新估值（T-2 净值 + 跟踪指数）
      lastPrem: pct(tds[5]),     // 最新溢价（基于最新估值）
      valDate: '',               // 估值日期 MM-DD
      price: null,               // 场内现价
      change: null,              // 现价涨跌 %
      amount: null,              // 成交额（万元）
      nav: null,                 // 官方净值
      navInc: null,              // 官方净值涨跌 %
      navDate: '',               // 净值日期 MM-DD
      indexInc: null,            // 指数涨跌 %
      applyLimit: stripTags(tds[n - 4]), // 申购限额：暂停申购 / 无限制 / 300000元
      feeBuy: stripTags(tds[n - 3]),
      feeSell: stripTags(tds[n - 2]),
    };

    // 中段弹性区：先定位两个日期，再围绕它们取相邻数值
    const mid = tds.slice(6, n - 4);
    const dates = [];
    mid.forEach((t, i) => { if (isShortDate(t)) dates.push(i); });

    if (dates.length) {
      item.valDate = stripTags(mid[dates[0]]);
      // 现价 = 估值日期之后的第一个纯数值
      for (let i = dates[0] + 1; i < mid.length; i++) {
        const v = num(mid[i]);
        if (v !== null) { item.price = v; break; }
      }
      if (dates.length > 1) {
        item.navDate = stripTags(mid[dates[1]]);
        // 净值 = 净值日期前两位（前一位是净值涨跌%）
        item.navInc = pct(mid[dates[1] - 1]);
        item.nav = num(mid[dates[1] - 2]);
      }
    }
    // 现价之后的第一个百分比 = 现价涨跌
    if (item.price !== null) {
      const pi = mid.findIndex((t) => num(t) === item.price);
      for (let i = pi + 1; i < mid.length; i++) {
        const p = pct(mid[i]);
        if (p !== null) { item.change = p; break; }
      }
    }
    // 成交额：估值日期之后、净值之前，最大的那个数值（万元）
    if (item.navDate) {
      const nIdx = mid.findIndex((t) => stripTags(t) === item.navDate);
      const cands = mid.slice(dates.length ? dates[0] + 1 : 0, nIdx)
        .map(num).filter((v) => v !== null && v > 1000);
      if (cands.length) item.amount = Math.max.apply(null, cands);
    }
    // 指数涨跌：净值日期之后的第一个百分比
    if (item.navDate) {
      const nIdx = mid.findIndex((t) => stripTags(t) === item.navDate);
      for (let i = nIdx + 1; i < mid.length; i++) {
        const p = pct(mid[i]);
        if (p !== null) { item.indexInc = p; break; }
      }
    }

    item.checked = selfCheck(item);
    return item;
  }

  /**
   * 自洽校验：实时溢价 应约等于 (现价 − 实时估值) ÷ 实时估值
   * @returns {boolean|null} true 通过 / false 不符 / null 数据不足无法校验
   */
  function selfCheck(item) {
    if (!item || item.rtNav === null || item.rtNav <= 0) return null;
    if (item.price === null || item.price <= 0 || item.rtPrem === null) return null;
    const expect = ((item.price - item.rtNav) / item.rtNav) * 100;
    return Math.abs(expect - item.rtPrem) < 0.06;
  }

  /**
   * 解析 HaoETF 首页
   * @returns {{ok:boolean, reason?:string, asOf?:string, items:Array, heads:string[]}}
   */
  function parseHome(text) {
    const src = String(text || '');
    if (!src) return { ok: false, reason: '空响应', items: [], heads: [] };
    const heads = parseHeads(src);
    const hit = REQUIRED_HEADS.filter((h) => heads.join('|').indexOf(h) < 0);
    if (heads.length && hit.length) {
      return { ok: false, reason: '页面结构已变，缺少表头：' + hit.join('、'), items: [], heads };
    }
    const rows = src.match(/<tr>[\s\S]*?<\/tr>/gi) || [];
    const items = [];
    rows.forEach((tr) => {
      const it = parseRow(tr);
      if (it) items.push(it);
    });
    if (!items.length) return { ok: false, reason: '未解析到任何数据行', items: [], heads };
    // 数据更新时间（页面注明估值口径）
    const m = src.match(/数据更新时间[:：]\s*([\d\-: ]+)/);
    return { ok: true, items, heads, asOf: m ? m[1].trim() : '' };
  }

  /** 按代码查找 */
  function find(text, code) {
    const r = parseHome(text);
    if (!r.ok) return null;
    return r.items.find((it) => it.code === String(code)) || null;
  }

  global.JsaHaoEtf = { parseHome, find, parseRow, selfCheck, parseHeads, stripTags };
})(typeof window !== 'undefined' ? window : globalThis);
