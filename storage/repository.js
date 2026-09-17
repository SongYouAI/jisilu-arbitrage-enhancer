/**
 * 本地存储：设置 / 自选 / 单品种跟踪比覆写
 * 注意：mock 环境可能只提供回调式 API，故统一包一层 Promise，且兼容回调式 chrome.storage
 */
(function (global) {
  'use strict';

  const KEY_SETTINGS = 'jsa.settings';
  const KEY_WATCH = 'jsa.watchlist';
  const KEY_OVERRIDE = 'jsa.overrides';
  const KEY_AUTORATIO = 'jsa.autoRatio';
  const KEY_STOCKPCT = 'jsa.stockPct';

  const DEFAULTS = {
    enabled: true,
    trackRatio: 1.0,     // 全局跟踪比（只影响 ○ 推算值；四级优先级链的兜底）
    refreshSec: 30,      // 刷新频率（秒）
    autoRefresh: true,
    panelCollapsed: true, // 控制面板默认折叠（只显示窄标题条，不再一打开就糊脸）
  };

  function hasStorage() {
    try {
      return !!(global.chrome && chrome.storage && chrome.storage.local);
    } catch (e) {
      return false;
    }
  }

  function get(keys) {
    return new Promise((resolve) => {
      if (!hasStorage()) return resolve({});
      try {
        const r = chrome.storage.local.get(keys);
        // 兼容 Promise 形态与回调式 mock
        if (r && typeof r.then === 'function') r.then(resolve).catch(() => resolve({}));
        else chrome.storage.local.get(keys, (res) => resolve(res || {}));
      } catch (e) {
        resolve({});
      }
    });
  }

  function set(obj) {
    return new Promise((resolve) => {
      if (!hasStorage()) return resolve(false);
      try {
        const r = chrome.storage.local.set(obj);
        if (r && typeof r.then === 'function') r.then(() => resolve(true)).catch(() => resolve(false));
        else chrome.storage.local.set(obj, () => resolve(true));
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function getSettings() {
    const r = await get([KEY_SETTINGS]);
    return Object.assign({}, DEFAULTS, r[KEY_SETTINGS] || {});
  }
  function saveSettings(s) { return set({ [KEY_SETTINGS]: s }); }

  async function getWatchlist() {
    const r = await get([KEY_WATCH]);
    const arr = r[KEY_WATCH] || [];
    return new Set(arr);
  }
  function saveWatchlist(list) { return set({ [KEY_WATCH]: [...list] }); }

  async function getOverrides() {
    const r = await get([KEY_OVERRIDE]);
    return r[KEY_OVERRIDE] || {};
  }
  function saveOverrides(o) { return set({ [KEY_OVERRIDE]: o }); }

  // 历史回归自动跟踪比缓存：{ code: { ratio, samples, win, at } }
  // 详情页解析历史表后自动写入；列表页按「手动 > 自动 > 股票占比 > 全局」取用
  async function getAutoRatios() {
    const r = await get([KEY_AUTORATIO]);
    return r[KEY_AUTORATIO] || {};
  }
  function saveAutoRatios(o) { return set({ [KEY_AUTORATIO]: o }); }

  // 股票占比缓存：{ code: 95.2 }
  // 列表页有权威的 stock_ratio 列、详情页没有 —— 由列表页回写共享，详情页读取，
  // 保证「股票占比」这一档两页取到同一个数（否则同一只基金两页跟踪比会对不上）。
  async function getStockPcts() {
    const r = await get([KEY_STOCKPCT]);
    return r[KEY_STOCKPCT] || {};
  }
  function saveStockPcts(o) { return set({ [KEY_STOCKPCT]: o }); }

  global.JsaRepo = {
    DEFAULTS,
    getSettings, saveSettings,
    getWatchlist, saveWatchlist,
    getOverrides, saveOverrides,
    getAutoRatios, saveAutoRatios,
    getStockPcts, saveStockPcts,
    _get: get, _set: set,
  };
})(typeof window !== 'undefined' ? window : globalThis);
