/**
 * 运行期安全封装（content script 共用）
 *
 * 提供 extension context 存活检测与消息发送封装，避免 context invalidated 时整页报错。
 * list / detail 两处原先各写一遍（detail 还额外包了一层 mock send），抽到此处复用（P4）。
 * 挂到 window.JsaRuntime，由 manifest 在 content_scripts 中先于 list/detail 注入。
 */
(function (global) {
  'use strict';

  function contextAlive() {
    try {
      return !!(global.chrome && global.chrome.runtime && global.chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function safeSendMessage(msg) {
    return new Promise((resolve) => {
      if (!contextAlive()) return resolve(null);
      try {
        const r = global.chrome.runtime.sendMessage(msg);
        if (r && typeof r.then === 'function') r.then(resolve).catch(() => resolve(null));
        else global.chrome.runtime.sendMessage(msg, (res) => resolve(res || null));
      } catch (e) {
        resolve(null);
      }
    });
  }

  global.JsaRuntime = { contextAlive, safeSendMessage };
})(typeof window !== 'undefined' ? window : globalThis);
