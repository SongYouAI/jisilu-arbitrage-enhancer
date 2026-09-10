/**
 * 集思录列表页增强（/data/qdii/、/data/lof/、/data/etf/）
 *
 * 注入 4 列：自选 ★ / IOPV 溢价率(真值●) / 估算溢价率(○) / 净值日期
 * 数据来源：页面 DOM（已渲染）+ 腾讯行情（IOPV、实时价、净值）
 */
(function () {
  'use strict';

  const D = window.JsaDom;
  const Q = window.JsaQuotes;
  const P = window.JsaPremium;
  const F = window.JsaFormat;
  const UI = window.JsaUI;
  const Repo = window.JsaRepo;

  if (!D || !Q || !P || !F || !UI || !Repo) return;

  const DETAIL_RE = /\/data\/(?:qdii|lof|etf|fund)\/detail\//;
  const LIST_RE = /\/data\/(?:qdii|lof|etf|fund)\//;

  const state = {
    settings: null,
    quotes: {},
    haoetf: {},   // code -> { rtNav, rtPrem, applyLimit, ... } 跨境期货锚点估值
    rows: [],
    tables: [],
    panel: null,
    timer: null,
    observer: null,
    alive: true,
    lastCount: 0,
  };

  // —— chrome API 安全封装（防 extension context invalidated）——
  function contextAlive() {
    try {
      return !!(window.chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }
  function safeSendMessage(msg) {
    return new Promise((resolve) => {
      if (!contextAlive()) return resolve(null);
      try {
        const r = chrome.runtime.sendMessage(msg);
        if (r && typeof r.then === 'function') r.then(resolve).catch(() => resolve(null));
        else chrome.runtime.sendMessage(msg, (res) => resolve(res || null));
      } catch (e) {
        resolve(null);
      }
    });
  }

  function ready() {
    return !!(document.documentElement && document.body);
  }

  // —— 列定义 ——
  function buildCols() {
    const cols = [];

    // 1) 实时净值（● 交易所 IOPV 真值 / ○ 推算值，同一格自适应）
    cols.push({
      key: 'nav',
      title: '实时净值',
      width: 88,
      tooltip: '这只基金此刻值多少钱。● = 交易所每15秒发布的官方实时净值(IOPV)，不是插件算的；○ = 交易所不发布，由昨净值 × 指数涨幅 × 跟踪比推算（是估算）。悬停看原理。',
      render(row, ctx) {
        return renderCell(row, ctx, 'nav');
      },
    });

    // 2) 实时溢价（(现价 − 实时净值) ÷ 实时净值）
    cols.push({
      key: 'prem',
      title: '实时溢价',
      width: 92,
      tooltip: '(现价 − 实时净值) ÷ 实时净值。正数 = 市价比基金实际价值贵（买入要多付），负数 = 便宜（打折买）。悬停看计算过程与套利建议。',
      render(row, ctx) {
        return renderCell(row, ctx, 'prem');
      },
    });
    return cols;
  }

  /** 合并页面 DOM 数据 + 腾讯行情，算出这一行的双轨结果 */
  function computeOf(row, ctx) {
    const q = ctx.quotes[row.code];
    const merged = Object.assign({}, row);
    if (q) {
      if (q.price != null) merged.price = q.price;
      if (q.iopv != null) merged.iopv = q.iopv;
      if (q.tencentPremium != null) merged.tencentPremium = q.tencentPremium;
      if (q.nav != null && merged.nav == null) merged.nav = q.nav;
      // 净值日期只认页面标注值，不可用行情时间戳冒充
    }
    // 三级降级的第二档：HaoETF 期货锚点实时估值（仅跨境品种有；已验证自洽的才采用）
    const h = ctx.haoetf && ctx.haoetf[row.code];
    if (h && h.rtNav != null && h.rtNav > 0 && h.checked !== false) {
      merged.haoEtfNav = h.rtNav;
      merged.haoEtfPrem = h.rtPrem;
      merged.haoEtfLimit = h.applyLimit;
    }
    const ratio = ctx.overrides[row.code] != null ? ctx.overrides[row.code] : ctx.settings.trackRatio;
    return { res: P.compute(merged, { trackRatio: ratio }), merged };
  }

  /** 绑定自定义黑色悬浮（注意：不设 title，否则原生悬浮会与它重复出现） */
  function attachTip(el, text) {
    el.addEventListener('mouseenter', (e) => UI.tip.show(text, e.clientX, e.clientY));
    el.addEventListener('mousemove', (e) => UI.tip.show(text, e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => UI.tip.hide());
  }

  /** 渲染「实时净值」或「实时溢价」单元格，● 真值 / ○ 推算自适应 */
  function renderCell(row, ctx, mode) {
    const { res, merged } = computeOf(row, ctx);
    const span = document.createElement('span');

    if (mode === 'nav') {
      const nav = P.pickNav(res);
      if (nav.value === null) {
        span.textContent = '—';
        span.style.color = '#94a3b8';
        attachTip(span, P.tooltipNav(res, merged));
        return span;
      }
      const isReal = nav.source === 'IOPV';
      const isFutures = nav.source === 'HAOETF';
      span.className = 'jsa-nav';
      span.textContent = isReal ? String(nav.value) : nav.value.toFixed(4);
      span.style.color = isReal ? '#0b1b34' : (isFutures ? '#185FA5' : '#64748b');
      span.style.fontWeight = isReal ? '600' : '400';
      const badge = document.createElement('span');
      badge.className = 'jsa-badge';
      badge.textContent = P.markOf(nav.source);   // ● / ◐ / ○ 统一定义在 premium.js
      if (isFutures) badge.style.color = '#185FA5';
      span.appendChild(badge);
      attachTip(span, P.tooltipNav(res, merged));
      return span;
    }

    const v = res.premium;
    if (v === null || !isFinite(v)) {
      span.textContent = '—';
      span.style.color = '#94a3b8';
      attachTip(span, P.tooltipPremium(res, merged));
      return span;
    }
    span.className = 'jsa-prem';
    span.textContent = F.pct(v);
    span.style.color = F.colorOf(v);
    const badge = document.createElement('span');
    badge.className = 'jsa-badge';
    badge.textContent = P.markOf(res.source);
    if (res.source === 'HAOETF') badge.style.color = '#185FA5';
    span.appendChild(badge);
    attachTip(span, P.tooltipPremium(res, merged));
    return span;
  }

  // —— 主渲染 ——
  /**
   * 给 Promise 套一个软超时：超时不是错误，按「本档拿不到」处理。
   * 必要性：HaoETF 是第三方源，卡住时若直接 await，整页注入列都会不渲染。
   */
  function withTimeout(promise, ms) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
      const t = setTimeout(() => finish(null), ms);
      Promise.resolve(promise).then(finish).catch(() => finish(null));
    });
  }

  async function refreshQuotes() {
    const codes = [];
    state.rows.forEach((r) => codes.push(r.code));
    if (!codes.length) return;
    const resp = await safeSendMessage({ type: 'JSA_GET_QUOTES', payload: { codes } });
    if (resp && resp.ok && resp.data) state.quotes = resp.data || {};
  }

  /** 拉取 HaoETF 跨境实时估值（一次请求取全表，后台缓存 5 分钟；失败不影响主流程） */
  async function refreshHaoEtf() {
    const resp = await withTimeout(safeSendMessage({ type: 'JSA_GET_HAOETF' }), 8000);
    if (resp && resp.ok && resp.data && resp.data.ok && resp.data.byCode) {
      state.haoetf = resp.data.byCode;
    }
  }

  /**
   * 冻结左侧「代码 / 名称」两列（position:sticky），横向滚动时始终可见。
   * 背景必须不透明，否则滚动时下层内容会透过来 —— 逐行读取实际计算背景色。
   */
  function freezeLeadingCols(table) {
    const first = table.querySelector('tbody tr td[data-name="fund_id"]');
    if (!first) return;
    const w1 = first.offsetWidth;
    const thead = table.querySelector('thead');
    if (thead) {
      const ths = thead.querySelectorAll('tr:last-child th');
      if (ths.length >= 2) {
        [ths[0], ths[1]].forEach((th, i) => {
          th.classList.add('jsa-sticky');
          th.style.left = (i === 0 ? 0 : ths[0].offsetWidth) + 'px';
          th.style.zIndex = '3';
        });
      }
    }
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const c1 = tr.querySelector('td[data-name="fund_id"]');
      const c2 = tr.querySelector('td[data-name="fund_nm_color"]') || tr.querySelector('td[data-name="fund_nm"]');
      if (!c1) return;
      // 读取行背景色（tablesorter 奇偶行色不同），落到冻结单元格上
      const bg = getComputedStyle(tr).backgroundColor;
      const opaque = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : '#ffffff';
      const apply = (td, left) => {
        td.classList.add('jsa-sticky');
        td.style.left = left + 'px';
        if (!td.style.backgroundColor) td.style.backgroundColor = opaque;
      };
      apply(c1, 0);
      if (c2) apply(c2, w1);
    });
  }

  /** 渲染上下文唯一构造点（新增数据源只改这里，避免多处漏改） */
  function makeCtx() {
    return {
      quotes: state.quotes,
      haoetf: state.haoetf,
      settings: state.settings,
      overrides: window.__jsaOverrides || {},
    };
  }

  function renderAll() {
    state.tables = D.findTables();
    if (!state.tables.length) return 0;
    const ctx = makeCtx();
    const cols = buildCols();
    let n = 0;
    state.rows = [];
    state.tables.forEach((t) => {
      n += D.injectColumns(t, cols, ctx);
      state.rows = state.rows.concat(D.extractRows(t));
    });
    // 重新绑定行引用（injectColumns 内部已重取，这里对齐）
    state.rows.forEach((r) => { r.tr = document.getElementById(r.code) || r.tr; });
    state.tables.forEach((t) => freezeLeadingCols(t));
    state.lastCount = state.rows.length;
    syncPanelStat();
    return n;
  }

  /**
   * 同步控制面板的档位统计。
   * 口径：直接数页面上真实渲染的徽标（所见即所得）。
   * 旧实现靠内部 state 推断，出现过「1394 只 · 0 只 ●」与界面实际不符的情况。
   * 注意：两条渲染路径（renderAll / paint(false)）都必须调它 ——
   * HaoETF 晚到后补画 ◐ 时若不同步，面板会继续写「◐ 0」与表格自相矛盾。
   */
  function syncPanelStat() {
    if (!state.panel) return;
    const m = countMarks();
    state.panel.setStat(
      `本页 ${state.rows.length} 只 · ● ${m.iopv} 交易所官方` +
      (m.futures ? ` · ◐ ${m.futures} 期货锚点` : '')
    );
  }

  /** 统计已渲染的标记数量：数净值列徽标（每只基金最多 1 次），分「交易所官方 / 期货锚点」两档 */
  function countMarks() {
    const out = { iopv: 0, futures: 0 };
    document.querySelectorAll('td[data-jsa-col="nav"] .jsa-badge').forEach((b) => {
      const t = b.textContent || '';
      if (t.indexOf('●') >= 0) out.iopv++;
      else if (t.indexOf('◐') >= 0) out.futures++;
    });
    return out;
  }

  /** 把当前 state 画到页面上（full=true 整表重建，否则只更新数值，保留排序/滚动） */
  function paint(full) {
    if (full) {
      renderAll();
      return;
    }
    state.tables.forEach((t) => {
      D.injectColumns(t, buildCols(), makeCtx());
    });
    state.rows.forEach((r) => {
      const tr = document.getElementById(r.code);
      if (tr) r.tr = tr;
    });
    syncPanelStat();
  }

  async function run(full) {
    if (!state.settings || !state.settings.enabled) return;
    // ① 行情是核心列，先拿先画。绝不与第三方源一起 await —— 否则源卡住则整页无列。
    await withTimeout(refreshQuotes(), 8000);
    paint(full);
    // ② HaoETF 只影响跨境品种能否升到 ◐ 档：晚到就补画一次，拿不到就保持 ○。
    const prev = state.haoetf;
    await refreshHaoEtf();
    if (state.haoetf !== prev) paint(false);
  }

  function scheduleRefresh() {
    if (state.timer) clearInterval(state.timer);
    const sec = state.settings.refreshSec || 0;
    if (!sec || !state.settings.autoRefresh) return;
    state.timer = setInterval(() => {
      if (!state.alive || !contextAlive()) { stopSelfHeal(); return; }
      run(false).catch(() => {});
    }, sec * 1000);
  }

  // —— 自愈：DOM 被第三方脚本重绘后立即修复 ——
  function startSelfHeal() {
    stopSelfHeal();
    let t = null;
    const kick = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        if (!state.alive || !contextAlive()) { stopSelfHeal(); return; }
        // 不变量检查：注入列数是否完整
        const need = buildCols().length;
        const broken = state.tables.some((tb) => {
          const tr = tb.querySelector('tbody tr[id]');
          if (!tr) return false;
          return tr.querySelectorAll('[data-jsa-col]').length !== need;
        }) || D.findTables().length !== state.tables.length;
        if (broken) renderAll();
      }, 260);
    };
    state.observer = new MutationObserver(kick);
    state.tables.forEach((tb) => {
      const body = tb.querySelector('tbody');
      if (body) state.observer.observe(body, { childList: true, subtree: true });
    });
    // 兜底轮询
    state.healTimer = setInterval(() => {
      if (!state.alive || !contextAlive()) { stopSelfHeal(); return; }
      const need = buildCols().length;
      const tr = document.querySelector('table tbody tr[id] [data-jsa-col]');
      if (!tr) { renderAll(); }
    }, 5000);
  }
  function stopSelfHeal() {
    if (state.observer) { try { state.observer.disconnect(); } catch (e) {} state.observer = null; }
    if (state.healTimer) { clearInterval(state.healTimer); state.healTimer = null; }
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  // —— 入口 ——
  async function init() {
    if (!ready()) { setTimeout(init, 200); return; }
    const href = location.href;
    if (DETAIL_RE.test(href)) return; // 详情页交给 jisilu-detail.js
    if (!LIST_RE.test(href)) return;

    state.settings = await Repo.getSettings();
    window.__jsaOverrides = await Repo.getOverrides();

    if (!state.settings.enabled) return; // 关闭时仍保留面板入口由用户开启
    if (!D.findTables().length) { setTimeout(init, 500); return; }

    await run(true);
    startSelfHeal();
    scheduleRefresh();

    if (!document.getElementById('jsa-panel')) {
      state.panel = UI.createPanel({
        settings: state.settings,
        async onTrackRatio(v) {
          state.settings.trackRatio = v;
          await Repo.saveSettings(state.settings);
          await run(false);
        },
        async onRefreshSec(v) {
          state.settings.refreshSec = v;
          await Repo.saveSettings(state.settings);
          scheduleRefresh();
        },
        async onToggle(k, v) {
          state.settings[k] = v;
          await Repo.saveSettings(state.settings);
          if (k === 'enabled') {
            if (v) { await run(true); startSelfHeal(); scheduleRefresh(); }
            else { stopSelfHeal(); D.clearInjected(document); }
          } else {
            await run(true);
          }
        },
        async onRefreshNow() { await run(true); },
      });
      // 面板刚建好时先同步一次（此时表格还没注入，通常显示 0 只，随后 run() 会刷新）
      syncPanelStat();
    }

    window.addEventListener('beforeunload', () => { state.alive = false; stopSelfHeal(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  } else {
    setTimeout(init, 300);
  }

  // 暴露内部状态与方法：便于真页验证脚本驱动（生产环境无副作用）
  window.__jsaList = state;
  window.__jsaList.renderAll = renderAll;
  window.__jsaList.run = run;
  window.__jsaList.refreshQuotes = refreshQuotes;
  window.__jsaList.refreshHaoEtf = refreshHaoEtf;
  window.__jsaList.countMarks = countMarks;
})();
