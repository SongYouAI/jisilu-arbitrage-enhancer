/**
 * 腾讯行情解析器（qt.gtimg.cn）
 *
 * 关键字段语义（2026-09-10 实测锁定，88 字段）：
 *   [3]  现价
 *   [4]  昨收
 *   [30] 时间戳 20260910150000
 *   [32] 涨跌幅(%)
 *   [77] 溢价率(%)。有 IOPV 时按 IOPV 算，无 IOPV 时按单位净值算（腾讯算好的静态溢价）
 *   [78] IOPV 实时净值估值（交易所 15 秒刷新；无 IOPV 的品种为空）
 *   [81] 单位净值（QDII 常为 T-2）
 *   [82] 货币锚点 "CNY"
 *
 * 已验证自洽：(现价 − IOPV[或净值]) / IOPV[或净值] ≈ [77]
 *
 * 字段定位策略：以 "CNY" 为锚点向前定位（82-1=81 净值 / 82-4=78 IOPV / 82-5=77 溢价率），
 * 避免腾讯增删字段导致整体位移。锚点缺失时回退到硬编码下标。
 */
(function (global) {
  'use strict';

  /** 代码 → 交易所前缀 */
  function prefixOf(code) {
    const c = String(code).trim();
    const head = c.charAt(0);
    if (head === '5' || head === '6' || head === '9') return 'sh';
    if (head === '1' || head === '0' || head === '3') return 'sz';
    if (head === '4' || head === '8') return 'bj';
    return 'sh';
  }

  /** 带前缀的完整代码，如 sh513100 */
  function symbolOf(code) {
    return prefixOf(code) + String(code).trim();
  }

  /** 批量请求时每批数量（腾讯单次 URL 长度有限制） */
  const BATCH_SIZE = 50;

  /**
   * 解析腾讯返回的文本（GBK 已解码为 UTF-8）
   * @param {string} text
   * @returns {Object} { sh513100: {...}, ... }
   */
  function parseText(text) {
    const out = {};
    if (!text) return out;
    const re = /v_([a-zA-Z0-9_]+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const symbol = m[1];
      const f = m[2].split('~');
      const code = String(f[2] || '').trim() || symbol.slice(2);
      const rec = {
        symbol,
        code,
        name: f[1] || '',
        price: num(f[3]),
        prevClose: num(f[4]),
        changePct: num(f[32] !== undefined ? f[32] : f[31]),
        time: f[30] || '',
        nav: null,
        iopv: null,
        iopvPremium: null,    // 百分数，如 11.66 表示 +11.66%（腾讯 [77]）
        tencentPremium: null, // 同 [77]，语义更明确的别名
      };

      // —— 锚点定位：以 CNY 为基准向前推 ——
      let anchor = -1;
      for (let i = f.length - 1; i >= 0; i--) {
        if (f[i] === 'CNY') { anchor = i; break; }
      }
      if (anchor < 5) {
        // 回退：尾部倒数定位（实测 CNY 后还有 5 个字段）
        anchor = f.length - 6;
      }
      if (anchor >= 5) {
        rec.nav = num(f[anchor - 1]);         // 81
        rec.iopv = num(f[anchor - 4]);        // 78
        rec.iopvPremium = num(f[anchor - 5]); // 77
        rec.tencentPremium = rec.iopvPremium;
      }

      out[code] = rec;
    }
    return out;
  }

  function num(s) {
    if (s === undefined || s === null) return null;
    const t = String(s).trim();
    if (!t || t === '-') return null;
    const v = parseFloat(t);
    return isFinite(v) ? v : null;
  }

  /** 批量切片 */
  function chunk(arr, size) {
    const res = [];
    for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
    return res;
  }

  /**
   * 抓取一批行情（在 background 中调用；content script 走 runtime 消息）
   * @param {string[]} codes 6 位代码数组
   * @param {Function} fetcher async (url) => text
   */
  async function fetchQuotes(codes, fetcher) {
    const result = {};
    const uniq = [];
    const seen = Object.create(null);
    codes.forEach((c) => {
      const key = String(c).trim();
      if (key && !seen[key]) { seen[key] = 1; uniq.push(key); }
    });
    for (const batch of chunk(uniq, BATCH_SIZE)) {
      const symbols = batch.map(symbolOf).join(',');
      const url = `https://qt.gtimg.cn/q=${symbols}`;
      try {
        const text = await fetcher(url);
        Object.assign(result, parseText(text));
      } catch (e) {
        // 单批失败不阻断整体
      }
    }
    return result;
  }

  global.JsaQuotes = { prefixOf, symbolOf, parseText, fetchQuotes, BATCH_SIZE };
})(typeof window !== 'undefined' ? window : globalThis);
