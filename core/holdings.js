/**
 * 天天基金「前十持仓」解析（fundf10.eastmoney.com）
 * 返回内容形如： var apidata={ content:"<table>…</table>", arryear:[…], curyear:2026 };
 * 在 service worker 中运行，无 DOM，全部用正则解析。
 */
(function (global) {
  'use strict';

  /** 去掉 HTML 标签 */
  function stripTags(s) {
    return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  }

  /**
   * @param {string} raw 接口返回的脚本文本
   * @returns {{ok:boolean, reason?:string, asOf?:string, items:Array<{code,name,weight,change,price}>}}
   */
  function parse(raw) {
    const empty = { ok: false, reason: 'no-data', items: [] };
    if (!raw) return empty;

    let content = '';
    const mContent = raw.match(/content\s*:\s*"([\s\S]*?)"\s*,\s*arryear/);
    if (mContent) {
      // 接口里是 JS 字符串，含 \/ 与 \" 转义
      content = mContent[1].replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\r\\n/g, '\n');
    } else {
      const m2 = raw.match(/content\s*:\s*"([\s\S]*?)"\s*\}/);
      if (m2) content = m2[1].replace(/\\\//g, '/').replace(/\\"/g, '"');
    }
    if (!content || content.indexOf('<table') === -1) return empty;

    // 截止日期
    let asOf = '';
    const mDate = content.match(/截止至：[^>]*>?\s*(\d{4}-\d{2}-\d{2})/) || content.match(/(\d{4}-\d{2}-\d{2})/);
    if (mDate) asOf = mDate[1];

    // 表头定位列索引
    const thead = content.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
    let codeIdx = 0, nameIdx = 1, weightIdx = -1, changeIdx = -1, priceIdx = -1;
    if (thead) {
      const ths = Array.from(thead[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((m) => stripTags(m[1]));
      ths.forEach((t, i) => {
        if (/股票代码|代码/.test(t) && codeIdx === 0) codeIdx = i;
        if (/股票名称|名称/.test(t) && nameIdx === 1) nameIdx = i;
        if (/占净值|占基金净值|比例/.test(t) && weightIdx === -1) weightIdx = i;
        if (/涨跌幅/.test(t) && changeIdx === -1) changeIdx = i;
        if (/最新价/.test(t) && priceIdx === -1) priceIdx = i;
      });
    }

    const tbody = content.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (!tbody) return empty;

    const items = [];
    const trs = tbody[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    for (const tr of trs) {
      const tds = Array.from(tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => stripTags(m[1]));
      if (!tds.length) continue;
      const code = String(tds[codeIdx] || '').replace(/\D/g, '');
      if (!/^\d{6}$/.test(code)) continue;
      const name = tds[nameIdx] || '';
      const weight = weightIdx >= 0 ? parseFloat(String(tds[weightIdx]).replace(/[^\d.\-]/g, '')) : NaN;
      const change = changeIdx >= 0 ? parseFloat(String(tds[changeIdx]).replace(/[^\d.\-]/g, '')) : NaN;
      const price = priceIdx >= 0 ? parseFloat(String(tds[priceIdx]).replace(/[^\d.\-]/g, '')) : NaN;
      items.push({
        code,
        name,
        weight: isFinite(weight) ? weight : null,
        change: isFinite(change) ? change : null,
        price: isFinite(price) ? price : null,
      });
      if (items.length >= 10) break;
    }

    if (!items.length) return { ok: false, reason: 'parse-empty', asOf, items: [] };
    return { ok: true, asOf, items };
  }

  /**
   * 加权平均涨幅（用权重加权；权重缺失时等权）
   * @param {Array} items
   * @param {Object} quotesMap { code: {changePct} }
   */
  function weightedChange(items, quotesMap) {
    let sumW = 0, sumC = 0, covered = 0, missing = [];
    items.forEach((it) => {
      const q = quotesMap && quotesMap[it.code];
      const chg = q && typeof q.changePct === 'number' ? q.changePct : it.change;
      const w = typeof it.weight === 'number' && it.weight > 0 ? it.weight : 0;
      if (typeof chg === 'number' && isFinite(chg)) {
        sumC += chg * (w || 1);
        sumW += (w || 1);
        covered++;
      } else {
        missing.push(it.code);
      }
    });
    if (!sumW) {
      return { ok: false, avg: null, covered: 0, missing, contribution: [] };
    }
    const avg = sumC / sumW;
    const contribution = items
      .map((it) => {
        const q = quotesMap && quotesMap[it.code];
        const chg = q && typeof q.changePct === 'number' ? q.changePct : it.change;
        if (typeof chg !== 'number' || !isFinite(chg)) return null;
        const w = typeof it.weight === 'number' ? it.weight : 0;
        return { code: it.code, name: it.name, weight: w, change: chg, contrib: (chg * w) / 100 };
      })
      .filter(Boolean)
      .sort((a, b) => b.contrib - a.contrib);
    return { ok: true, avg, covered, missing, contribution };
  }

  global.JsaHoldings = { parse, weightedChange };
})(typeof window !== 'undefined' ? window : globalThis);
