#!/usr/bin/env node
/**
 * 真页几何与计算验证
 * 沙箱无法加载扩展，改为把 content 脚本注入真实页面执行（行情用真实抓取的数据 mock）。
 *
 * 用法：node tools/verify-live.cjs [url]
 */
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
const AGENT = '/opt/homebrew/bin/agent-browser';
const TARGET = process.argv[2] || 'https://www.jisilu.cn/data/qdii/';

require(path.join(ROOT, 'core/format.js'));
require(path.join(ROOT, 'core/quotes.js'));
require(path.join(ROOT, 'core/haoetf.js'));
const Q = globalThis.JsaQuotes;

/** 抓取真实行情并解析为 {code: quote} */
async function loadQuotes(url) {
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  const text = new TextDecoder('gbk').decode(buf);
  return Q.parseText(text);
}

/** 从页面 DOM 拿到需要查询的代码列表 */
/** 集思录列表接口（游客 20 条）取参考涨幅，用于模拟登录态解锁后的估值列 */
async function loadRefIncrease(apiUrl) {
  try {
    const r = await fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await r.json();
    const out = {};
    (j.rows || []).forEach((row) => {
      const c = row.cell || {};
      // 三个页面参考涨幅字段名不同：QDII=ref_increase_rt / ETF=index_increase_rt / LOF=stock_increase_rt(十大持仓涨幅)
      const v = [c.ref_increase_rt, c.index_increase_rt, c.stock_increase_rt].find((x) => x != null && x !== '-' && x !== '');
      if (v != null) out[c.fund_id] = String(v).replace('%', '');
    });
    return out;
  } catch (e) {
    console.warn('参考涨幅加载失败:', e.message);
    return {};
  }
}

function buildInjectScript(quotes, refs, haoetf) {
  const files = [
    'core/format.js',
    'core/quotes.js',
    'core/premium.js',
    'core/dom.js',
    'core/holdings.js',
    'core/nav.js',
    'core/haoetf.js',
    'core/track.js',
    'storage/repository.js',
    'content/ui/styles.js',
    'content/ui/panel.js',
    'content/jisilu-list.js',
  ];
  const parts = [];

  // mock 环境
  parts.push(`
    window.__JSA_MOCK_QUOTES__ = ${JSON.stringify(quotes)};
    window.__JSA_MOCK_HAO__ = ${JSON.stringify((haoetf && haoetf.byCode) || {})};
    window.chrome = window.chrome || {};
    // 贴近 MV3 真实行为：sendMessage 返回 Promise
    window.chrome.runtime = { id: 'verify-mock', sendMessage: function (msg) {
      if (msg && msg.type === 'JSA_GET_QUOTES') { return Promise.resolve({ ok: true, data: window.__JSA_MOCK_QUOTES__ }); }
      if (msg && msg.type === 'JSA_GET_HAOETF') { return Promise.resolve({ ok: true, data: ${JSON.stringify(haoetf || { ok: false, byCode: {} })} }); }
      return Promise.resolve({ ok: false, error: 'mock' });
    }, onMessage: { addListener: function(){} } };
    window.chrome.storage = { local: {
      get: function (k, cb) { const r = {}; (Array.isArray(k)?k:[k]).forEach(function(x){ r[x] = window.__JSA_STORE__ && window.__JSA_STORE__[x]; }); cb(r); },
      set: function (o, cb) { window.__JSA_STORE__ = Object.assign({}, window.__JSA_STORE__, o); if (cb) cb(); }
    } };
    window.__JSA_STORE__ = { 'jsa.settings': { enabled: true, trackRatio: 1.0, refreshSec: 0, autoRefresh: false }, 'jsa.overrides': {} };
  `);

  files.forEach((f) => {
    parts.push(`/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8'));
  });

  // 等待渲染完成并输出结果
  // 注意：页面主世界的 window.chrome 是浏览器原生只读对象，无法 mock，
  // 因此直接对内部 state 注入行情/自选/设置后手动触发渲染（真实扩展运行于 isolated world，走正常路径）。
  parts.push(`
    setTimeout(function () {
      var out = { rows: 0, tables: 0, colsPerRow: [], sample: [], errors: [] };
      try {
        // 模拟登录态：把被「登录」占位锁定的参考涨幅单元格替换为真实值
        var UNLOCK = ${JSON.stringify(refs || {})};
        document.querySelectorAll('table tbody tr[id]').forEach(function (tr) {
          var td = tr.querySelector('td[data-name="ref_increase_rt"]') ||
                   tr.querySelector('td[data-name="index_increase_rt"]') ||
                   tr.querySelector('td[data-name="stock_increase_rt"]');
          if (td && UNLOCK[tr.id] != null) td.innerHTML = UNLOCK[tr.id] + '%';
        });

        var st = window.__jsaList;
        if (st) {
          st.settings = { enabled: true, trackRatio: 1.0, refreshSec: 0, autoRefresh: false };
          st.quotes = window.__JSA_MOCK_QUOTES__ || {};
          st.haoetf = window.__JSA_MOCK_HAO__ || {};
          st.renderAll();
        }
        var tables = window.JsaDom.findTables();
        out.tables = tables.length;
        tables.forEach(function (tb) {
          var trs = tb.querySelectorAll('tbody tr[id]');
          out.rows += trs.length;
          trs.forEach(function (tr, i) {
            var n = tr.querySelectorAll('[data-jsa-col]').length;
            if (out.colsPerRow.indexOf(n) === -1) out.colsPerRow.push(n);
            if (out.sample.length < 3 && n > 0) {
              var tds = tr.querySelectorAll('[data-jsa-col]');
              out.sample.push({
                code: tr.id,
                cells: Array.from(tds).map(function (t) { return t.textContent.trim(); })
              });
            }
          });
          // 表头注入数
          var th = tb.querySelectorAll('thead [data-jsa-col]');
          out.headCols = th.length;
        });
        // 各列填充率（只有 nav / prem 两列）
        ['nav','prem'].forEach(function (k) {
          var all = document.querySelectorAll('td[data-jsa-col="' + k + '"]');
          var filled = Array.from(all).filter(function (t) { return t.textContent.trim() !== '—' && t.textContent.trim() !== ''; });
          out['filled_' + k] = filled.length + '/' + all.length;
        });
        // 三级标记分布（● 交易所官方 / ◐ 期货锚点 / ○ 自算）
        out.marks = { iopv: 0, futures: 0, est: 0 };
        document.querySelectorAll('td[data-jsa-col="nav"] .jsa-badge').forEach(function (b) {
          var t = b.textContent || '';
          if (t.indexOf('●') >= 0) out.marks.iopv++;
          else if (t.indexOf('◐') >= 0) out.marks.futures++;
          else if (t.indexOf('○') >= 0) out.marks.est++;
        });
        // 面板
        out.panel = !!document.getElementById('jsa-panel');
        var panelEl = document.getElementById('jsa-panel');
        out.panelStat = panelEl ? (panelEl.textContent || '').replace(/\\s+/g, ' ') : '';
        // 冻结列
        out.stickyTd = document.querySelectorAll('td.jsa-sticky').length;
        out.stickyTh = document.querySelectorAll('th.jsa-sticky').length;
        var st1 = document.querySelector('td[data-name="fund_id"]');
        var st2 = document.querySelector('td[data-name="fund_nm_color"], td[data-name="fund_nm"]');
        if (st1 && st2) {
          var s1 = getComputedStyle(st1), s2 = getComputedStyle(st2);
          out.stickyCheck = {
            pos: s1.position + '/' + s2.position,
            left: s1.left + '/' + s2.left,
            bg1: s1.backgroundColor,
            bg2: s2.backgroundColor,
          };
        }
        // 调试：内部状态
        var st = window.__jsaList || {};
        out.debug = {
          settings: st.settings,
          watch: st.watch ? Array.from(st.watch) : null,
          quoteCount: st.quotes ? Object.keys(st.quotes).length : 0,
          rowCount: st.rows ? st.rows.length : 0,
          sampleRow: st.rows && st.rows[1] ? { code: st.rows[1].code, price: st.rows[1].price, nav: st.rows[1].nav, navDate: st.rows[1].navDate, refInc: st.rows[1].refIncreaseRt } : null
        };
        // 校验：表头注入数 == 表体注入数
        var bodyFirst = document.querySelector('table tbody tr[id]');
        out.bodyCols = bodyFirst ? bodyFirst.querySelectorAll('[data-jsa-col]').length : 0;
      } catch (e) { out.errors.push(String(e && e.stack || e)); }
      window.__JSA_RESULT__ = out;
    }, 2200);
  `);
  return parts.join('\n');
}

/** 浏览器不应走本机代理（否则 ERR_TUNNEL_CONNECTION_FAILED） */
function cleanEnv() {
  const env = Object.assign({}, process.env);
  ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'].forEach((k) => {
    delete env[k];
  });
  return env;
}

function evalInPage(js) {
  const r = spawnSync(AGENT, ['eval', js], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: cleanEnv() });
  if (r.error) throw r.error;
  return r.stdout;
}

(async function main() {
  console.log('目标页面:', TARGET);
  // 1. 打开页面（先关掉旧 daemon，否则可能继承上一次的代理配置导致 ERR_TUNNEL_CONNECTION_FAILED）
  // 冷启动后首次 open 有时不导航（停在 about:blank），因此带重试 + 校验 location.href
  try { spawnSync(AGENT, ['close'], { encoding: 'utf8', env: cleanEnv() }); } catch (e) {}
  let opened = false;
  for (let i = 0; i < 3 && !opened; i++) {
    try {
      const out = execFileSync(AGENT, ['open', TARGET], { encoding: 'utf8', env: cleanEnv() });
      if (process.env.JSA_DEBUG) process.stderr.write(`  [open ${i}] ${String(out).trim()}\n`);
    } catch (e) {
      if (process.env.JSA_DEBUG) process.stderr.write(`  [open ${i}] failed: ${e.message}\n`);
    }
    await new Promise((r) => setTimeout(r, 3000));
    const href = String(evalInPage('location.href') || '');
    opened = href.indexOf('about:blank') === -1 && href.indexOf('jisilu.cn') > -1;
  }
  if (!opened) {
    console.error('页面未能打开（可能是代理导致），请先在终端手动执行一次 agent-browser open 后再试');
    process.exit(1);
  }

  // 2. 从页面动态取代码列表（自适应任何列表页）；表格由 JS 渲染，需轮询等待
  let codes = [];
  for (let i = 0; i < 8; i++) {
    const codesRaw = evalInPage(
      'JSON.stringify({ href: location.href, tb: document.querySelectorAll("table").length, n: Array.from(document.querySelectorAll("table tbody tr[id]")).map(function(t){return t.id;}) })'
    );
    try {
      const parsed = JSON.parse(JSON.parse(codesRaw.trim()));
      codes = parsed.n || [];
      if (process.env.JSA_DEBUG) {
        process.stderr.write(`  [wait ${i}] href=${parsed.href} tables=${parsed.tb} rows=${codes.length}\n`);
      }
    } catch (e) {
      codes = [];
    }
    if (codes.length) break;
    if (process.env.JSA_DEBUG) {
      process.stderr.write(`  [wait ${i}] raw=${String(codesRaw).slice(0, 160)}\n`);
      process.stderr.write(`  [wait ${i}] stderr=${String(evalInPage.__lastErr || '')}\n`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!codes.length) {
    console.error('页面未渲染出数据行，无法验证');
    process.exit(1);
  }
  console.log('页面代码:', codes.length, '只 →', codes.slice(0, 5).join(','), '...');

  let quotes = {};
  try {
    quotes = await loadQuotes(`https://qt.gtimg.cn/q=${codes.map(Q.symbolOf).join(',')}`);
    console.log('行情加载:', Object.keys(quotes).length, '只');
  } catch (e) {
    console.warn('行情抓取失败，使用空数据继续（IOPV 列将为空）:', e.message);
  }

  // 2.5 HaoETF 跨境实时估值（三级降级的第二档）
  let haoetf = { ok: false, byCode: {} };
  try {
    const resp = await fetch('https://www.haoetf.com/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await resp.text();
    const parsed = globalThis.JsaHaoEtf.parseHome(text);
    if (parsed.ok) {
      const byCode = {};
      parsed.items.forEach((it) => { byCode[it.code] = it; });
      haoetf = { ok: true, byCode, count: parsed.items.length };
      const hit = codes.filter((c) => byCode[c] && byCode[c].rtNav != null).length;
      console.log('HaoETF 加载:', parsed.items.length, '只 → 本页命中', hit, '/', codes.length);
    } else {
      console.warn('HaoETF 解析失败:', parsed.reason);
    }
  } catch (e) {
    console.warn('HaoETF 抓取失败（将全部回落 ○ 自算）:', e.message);
  }

  // 3. 注入
  const refs = await loadRefIncrease(
    TARGET.indexOf('/lof/') > -1
      ? 'https://www.jisilu.cn/data/lof/stock_lof_list/'
      : TARGET.indexOf('/etf/') > -1
        ? 'https://www.jisilu.cn/data/etf/etf_list/'
        : 'https://www.jisilu.cn/data/qdii/qdii_list/E'
  );
  console.log('参考涨幅:', Object.keys(refs).length, '只');
  const script = buildInjectScript(quotes, refs, haoetf);
  evalInPage(script);
  await new Promise((r) => setTimeout(r, 3000));

  // 4. 取结果
  const raw = evalInPage('JSON.stringify(window.__JSA_RESULT__ || {error:"no-result"})');
  let res;
  try {
    res = JSON.parse(JSON.parse(raw.trim()));
  } catch (e) {
    console.error('结果解析失败，原始输出:\n', raw.slice(0, 2000));
    process.exit(1);
  }

  console.log('\n===== 验证结果 =====');
  console.log(JSON.stringify(res, null, 1));

  const fails = [];
  if (res.errors && res.errors.length) fails.push('脚本异常: ' + res.errors.join('; '));
  if (!res.tables) fails.push('未找到数据表格');
  if (!res.rows) fails.push('未提取到数据行');
  if (res.headCols !== res.bodyCols) fails.push(`表头(${res.headCols})与表体(${res.bodyCols})注入列数不一致`);
  if (res.bodyCols !== 2) fails.push(`注入列数应为 2，实际 ${res.bodyCols}`);
  if (res.colsPerRow && res.colsPerRow.length > 1) fails.push(`各行注入列数不一致: ${res.colsPerRow}`);
  if (!res.filled_nav || res.filled_nav.indexOf('0/') === 0) {
    fails.push(`实时净值列未填充: ${res.filled_nav}`);
  }
  if (!res.filled_prem || res.filled_prem.indexOf('0/') === 0) {
    fails.push(`实时溢价列未填充: ${res.filled_prem}`);
  }
  if (res.stickyTd !== res.rows * 2 || res.stickyTh < 2) {
    fails.push(`冻结列异常: td=${res.stickyTd}/${res.rows * 2} th=${res.stickyTh}`);
  }
  if (res.stickyCheck) {
    const sc = res.stickyCheck;
    if (sc.pos !== 'sticky/sticky') fails.push(`冻结列 position 异常: ${sc.pos}`);
    if (sc.left === '0px/0px') fails.push(`冻结列 left 未错开: ${sc.left}`);
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(sc.bg1 + sc.bg2)) fails.push(`冻结列背景透明（滚动会穿透）: ${sc.bg1} ${sc.bg2}`);
  }
  // 面板统计必须与表格实际徽标一致（HaoETF 晚到补画后容易不同步）
  if (res.panel && res.marks) {
    const stat = res.panelStat || '';
    const mIopv = stat.match(/●\s*(\d+)/);
    const mFut = stat.match(/◐\s*(\d+)/);
    const statIopv = mIopv ? Number(mIopv[1]) : 0;
    const statFut = mFut ? Number(mFut[1]) : 0;
    if (statIopv !== res.marks.iopv) {
      fails.push(`面板 ● 数与表格不符：面板 ${statIopv} / 表格 ${res.marks.iopv}（「${stat}」）`);
    }
    if (res.marks.futures > 0 && statFut !== res.marks.futures) {
      fails.push(`面板 ◐ 数与表格不符：面板 ${statFut} / 表格 ${res.marks.futures}（「${stat}」）`);
    }
  }

  console.log('\n===== 断言 =====');
  if (fails.length) {
    fails.forEach((f) => console.log('❌', f));
    process.exit(1);
  }
  console.log('✅ 全部通过：表格', res.tables, '个 / 行', res.rows, '行 / 注入', res.bodyCols, '列 / 净值填充', res.filled_nav, '/ 溢价填充', res.filled_prem);

  // 可选：横向滚动到最右并截图，供人工复核冻结列效果（JSA_SHOT=/path/x.png）
  if (process.env.JSA_SHOT) {
    evalInPage(`(function () {
      var t = document.querySelector('table tbody tr[id]');
      if (!t) return 'no table';
      var p = t;
      while (p && p !== document.body) {
        var s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowX)) break;
        p = p.parentElement;
      }
      if (p && p !== document.body) {
        p.style.maxWidth = '620px';   // 强制出横向滚动条，模拟窄视口
        p.style.overflow = 'auto';
        p.scrollLeft = 99999;
        return 'scrolled ' + p.scrollLeft;
      }
      window.scrollTo(99999, 0); return 'window';
    })()`);
    await new Promise((r) => setTimeout(r, 800));
    execFileSync(AGENT, ['screenshot', process.env.JSA_SHOT], { encoding: 'utf8', env: cleanEnv() });
    console.log('截图:', process.env.JSA_SHOT);
  }
})();
