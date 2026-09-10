/**
 * 格式化与配色工具
 * 中国习惯：涨红跌绿
 */
(function (global) {
  'use strict';

  /** 解析带百分号/逗号的数字，失败返回 null */
  function number(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return isFinite(raw) ? raw : null;
    const s = String(raw).replace(/[,%\s]/g, '');
    if (!s || s === '-' || s === '--' || s === 'N/A') return null;
    const m = s.match(/-?\d+(\.\d+)?/);
    if (!m) return null;
    const v = parseFloat(m[0]);
    return isFinite(v) ? v : null;
  }

  /** 格式化成百分比字符串，保留 2 位 */
  function pct(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return `${v >= 0 ? '+' : ''}${v.toFixed(digits === undefined ? 2 : digits)}%`;
  }

  /** 涨跌配色：涨红跌绿 */
  function colorOf(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'var(--jsa-flat, #64748b)';
    if (v > 0) return 'var(--jsa-up, #d93025)';
    if (v < 0) return 'var(--jsa-down, #0f9960)';
    return 'var(--jsa-flat, #64748b)';
  }

  /** 数字固定小数位 */
  function fixed(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return v.toFixed(digits === undefined ? 3 : digits);
  }

  /** 今天日期 YYYY-MM-DD（本地时区） */
  function today() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** 距今几个自然日 */
  function daysAgo(dateStr) {
    if (!dateStr) return null;
    const m = String(dateStr).match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((now - d) / 86400000);
  }

  global.JsaFormat = { number, pct, colorOf, fixed, today, daysAgo };
})(typeof window !== 'undefined' ? window : globalThis);
