#!/usr/bin/env node
/**
 * 详情页面板离线验证
 * 真实详情页需登录，无法在沙箱直接打开。改为：在任意集思录页面注入 detail.js，
 * 通过 window.__jsaMsgHook 注入真实抓取的行情/持仓数据，驱动 build(code) 渲染，
 * 断言面板结构与数值正确、无 JS 异常。
 *
 * 用法：node tools/verify-detail.cjs [code]  默认 161028（国内 LOF，有持仓数据）
 */
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const AGENT = '/opt/homebrew/bin/agent-browser';
const CODE = process.argv[2] || '161028';
const HOST = 'https://www.jisilu.cn/data/lof/'; // 承载页面（非详情页，仅提供 DOM 环境）

require(path.join(ROOT, 'core/format.js'));
require(path.join(ROOT, 'core/quotes.js'));
require(path.join(ROOT, 'core/holdings.js'));
require(path.join(ROOT, 'core/nav.js'));
require(path.join(ROOT, 'core/haoetf.js'));
const Q = globalThis.JsaQuotes;
const H = globalThis.JsaHoldings;
const NAV = globalThis.JsaNav;
const HAO = globalThis.JsaHaoEtf;

function cleanEnv() {
  const env = Object.assign({}, process.env);
  ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy'].forEach((k) => delete env[k]);
  return env;
}
function evalInPage(js) {
  const r = spawnSync(AGENT, ['eval', js], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: cleanEnv() });
  if (r.error) throw r.error;
  return r.stdout;
}

async function grab(url, ua) {
  const r = await fetch(url, ua ? { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://fundf10.eastmoney.com/' } } : {});
  return r.arrayBuffer();
}

(async function main() {
  // 1. 抓取真实数据
  let quotes = {};
  try {
    const buf = await grab(`https://qt.gtimg.cn/q=${Q.symbolOf(CODE)}`);
    quotes = Q.parseText(new TextDecoder('gbk').decode(buf));
  } catch (e) { console.warn('行情抓取失败:', e.message); }

  let holdings = { ok: false, reason: 'no-data', items: [] };
  try {
    const buf = await grab(
      `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${CODE}&topline=10&year=2026&month=`,
      true
    );
    holdings = H.parse(new TextDecoder('utf-8').decode(buf));
  } catch (e) { console.warn('持仓抓取失败:', e.message); }

  // 连同持仓个股的行情一并抓取，用于验证加权涨幅链路
  if (holdings.items && holdings.items.length) {
    try {
      const codes = [CODE].concat(holdings.items.map((i) => i.code));
      const buf = await grab(`https://qt.gtimg.cn/q=${codes.map(Q.symbolOf).join(',')}`);
      Object.assign(quotes, Q.parseText(new TextDecoder('gbk').decode(buf)));
    } catch (e) { console.warn('持仓股行情抓取失败:', e.message); }
  }

  // 历史净值序列（pingzhongdata，无需 Referer）
  let nav = { ok: false, items: [] };
  try {
    const buf = await grab(`https://fund.eastmoney.com/pingzhongdata/${CODE}.js?v=${Date.now()}`);
    nav = NAV.parsePingZhong(new TextDecoder('utf-8').decode(buf));
  } catch (e) { console.warn('净值序列抓取失败:', e.message); }

  // HaoETF 期货锚点（只有 40 只跨境品种覆盖，未命中时 row 为 null）
  let haoRow = null;
  let haoAsOf = '';
  try {
    const r = await fetch('https://www.haoetf.com/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const hp = HAO.parseHome(await r.text());
    if (hp.ok) {
      haoAsOf = hp.asOf || '';
      haoRow = hp.items.find((it) => it.code === String(CODE)) || null;
    }
  } catch (e) { console.warn('HaoETF 抓取失败:', e.message); }

  const haoUsable = !!(haoRow && haoRow.rtNav != null && haoRow.rtNav > 0 && haoRow.checked !== false);

  console.log('代码:', CODE, '| 行情:', Object.keys(quotes).length, '| 持仓:', holdings.items.length,
    '条 | 净值序列:', nav.ok ? nav.items.length + ' 条 截止 ' + nav.asOf : '不可用',
    '| HaoETF:', haoRow ? (haoUsable ? `命中 ◐ 实时估值 ${haoRow.rtNav}` : `命中但不可用(rtNav=${haoRow.rtNav} checked=${haoRow.checked})`) : '未覆盖');

  // 2. 打开承载页（先关掉旧 daemon，否则可能继承上一次的代理配置导致 ERR_TUNNEL_CONNECTION_FAILED）
  try { spawnSync(AGENT, ['close'], { encoding: 'utf8', env: cleanEnv() }); } catch (e) {}
  execFileSync(AGENT, ['open', HOST], { encoding: 'utf8', env: cleanEnv() });
  await new Promise((r) => setTimeout(r, 4000));

  // 3. 注入
  const files = [
    'core/format.js', 'core/quotes.js', 'core/premium.js', 'core/dom.js',
    'core/holdings.js', 'core/nav.js', 'core/track.js', 'storage/repository.js',
    'content/ui/styles.js', 'content/jisilu-detail.js',
  ];
  const parts = [`
    window.__JSA_MOCK__ = {
      quotes: ${JSON.stringify(quotes)},
      holdings: ${JSON.stringify(holdings)},
      nav: ${JSON.stringify(nav)},
      haoRow: ${JSON.stringify(haoRow)},
      haoAsOf: ${JSON.stringify(haoAsOf)}
    };
    window.__jsaMsgHook = function (msg) {
      if (msg.type === 'JSA_GET_QUOTES') {
        var d = {};
        (msg.payload.codes || []).forEach(function (c) { if (window.__JSA_MOCK__.quotes[c]) d[c] = window.__JSA_MOCK__.quotes[c]; });
        return { ok: true, data: d };
      }
      if (msg.type === 'JSA_GET_HOLDINGS') return { ok: true, data: window.__JSA_MOCK__.holdings };
      if (msg.type === 'JSA_GET_NAV_SERIES') return { ok: true, data: window.__JSA_MOCK__.nav };
      if (msg.type === 'JSA_GET_HAOETF') {
        // 与后台 handleHaoEtf(code) 同形：单只查询返回 { ok, row, asOf }
        return { ok: true, data: { ok: true, row: window.__JSA_MOCK__.haoRow, asOf: window.__JSA_MOCK__.haoAsOf } };
      }
      return { ok: false, error: 'mock' };
    };
    window.__JSA_DETAIL_ERR__ = null;
    window.addEventListener('error', function (e) { window.__JSA_DETAIL_ERR__ = String(e.message); });
  `];
  files.forEach((f) => parts.push(`/* ${f} */\n` + fs.readFileSync(path.join(ROOT, f), 'utf8')));
  // 注入共享「股票占比」缓存（模拟列表页已回写），用来验证详情页读的确实是共享值，
  // 而不是像旧实现那样在本页用正文正则猜（猜不到就掉到全局 1.00 → 与列表页对不上）。
  const SEED_PCT = 87.52;
  parts.push(`
    (function () {
      var SEED = ${JSON.stringify({ [CODE]: SEED_PCT })};
      if (window.JsaRepo) {
        window.JsaRepo.getStockPcts = function () { return Promise.resolve(SEED); };
      }
    })();
  `);
  parts.push(`
    (function () {
      var old = document.getElementById('jsa-detail-card'); if (old) old.remove();
      window.__jsaDetail.build('${CODE}').then(function () {
        setTimeout(function () {
          var card = document.getElementById('jsa-detail-card');
          var out = { exists: !!card, error: window.__JSA_DETAIL_ERR__ };
          if (card) {
            out.kvCount = card.querySelectorAll('.jsa-kv > div').length;
            out.kvText = Array.from(card.querySelectorAll('.jsa-kv > div')).map(function (d) {
              return d.querySelector('.k').textContent + '=' + d.querySelector('.v').textContent;
            });
            out.hasHoldingsTitle = (card.textContent || '').indexOf('前十大持仓') > -1;
            out.hasTrackTitle = (card.textContent || '').indexOf('跟踪比（本基金）') > -1;
            out.hasNavFeature = (card.textContent || '').indexOf('真实净值统计') > -1;
            out.hasFailPlaceholder = /未能获取|未能识别|加载中/.test(card.textContent || '');
            var tbl = card.querySelector('table');
            out.holdingRows = tbl ? tbl.querySelectorAll('tbody tr').length : 0;
            out.holdingSample = tbl ? Array.from(tbl.querySelectorAll('tbody tr')).slice(0, 3).map(function (tr) {
              return Array.from(tr.children).map(function (td) { return td.textContent; }).join('|');
            }) : [];
            out.text = (card.textContent || '').replace(/\\s+/g, ' ').slice(0, 400);
            // 自证：详情页展示的跟踪比必须等于共享函数 P.pickRatio 对**同一批输入**的裁决。
            // 只要这条成立 + 列表页也走 pickRatio（verify-live 断言），两页就不可能再漂移。
            var last = window.__jsaDetail && window.__jsaDetail.last;
            if (last && window.JsaPremium && window.JsaPremium.pickRatio) {
              var re = window.JsaPremium.pickRatio(last.inputs);
              out.pickCheck = {
                detailRatio: last.ratio, detailLabel: last.label, src: last.src,
                sharedRatio: re.ratio, sharedLabel: re.label,
                stockPct: last.inputs.stockPct,
                ok: last.ratio === re.ratio && last.label === re.label,
              };
            } else {
              out.pickCheck = { ok: false, missing: true };
            }
            // 悬浮态限高滚动 + 标题栏控制（收起 / 隐藏 / 恢复）
            out.isFixed = card.classList.contains('jsa-dc-fixed');
            out.maxHeight = getComputedStyle(card).maxHeight || '';
            var bdEl = card.querySelector('.jsa-dc-bd');
            out.bodyOverflowY = bdEl ? getComputedStyle(bdEl).overflowY : '';
            out.hasControls = card.querySelectorAll('.jsa-dc-btn').length;
            var btns = card.querySelectorAll('.jsa-dc-btn');
            var minBtn = btns[0];
            var hideBtn = btns[1];
            if (minBtn) {
              minBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              out.collapsed = card.classList.contains('jsa-dc-min');
              out.collapsedBodyDisplay = bdEl ? getComputedStyle(bdEl).display : '';
              minBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              out.expandedBack = !card.classList.contains('jsa-dc-min');
            }
            if (hideBtn) {
              hideBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              out.hiddenDisplay = getComputedStyle(card).display;
              out.restoreChip = !!document.getElementById('jsa-dc-restore');
              var chip = document.getElementById('jsa-dc-restore');
              if (chip) {
                chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                out.restoredDisplay = getComputedStyle(card).display;
                out.restoreChipGone = !document.getElementById('jsa-dc-restore');
              }
            }
          }
          window.__JSA_DETAIL_RESULT__ = out;
        }, 1200);
      }).catch(function (e) {
        window.__JSA_DETAIL_RESULT__ = { exists: false, error: String(e && e.stack || e) };
      });
    })();
  `);
  evalInPage(parts.join('\n'));
  await new Promise((r) => setTimeout(r, 3500));

  const raw = evalInPage('JSON.stringify(window.__JSA_DETAIL_RESULT__ || {error:"no-result"})');
  let res;
  try {
    res = JSON.parse(JSON.parse(raw.trim()));
  } catch (e) {
    console.error('结果解析失败:\n', raw.slice(0, 1500));
    process.exit(1);
  }

  console.log('\n===== 详情页面板验证 =====');
  console.log(JSON.stringify(res, null, 1));

  const fails = [];
  if (res.error) fails.push('JS 异常: ' + res.error);
  if (!res.exists) fails.push('面板未渲染');
  else {
    if (!(res.kvCount >= 4)) fails.push(`关键指标区块不足: ${res.kvCount}`);
    // 详情页跟踪比必须由共享函数裁决，且必须读共享「股票占比」缓存（两页同源的关键）
    if (!res.pickCheck || !res.pickCheck.ok) {
      fails.push('详情页生效值 != 共享函数 pickRatio 裁决：' + JSON.stringify(res.pickCheck));
    } else if (res.pickCheck.stockPct !== 87.52) {
      fails.push(`详情页未读取共享股票占比缓存（读到 ${res.pickCheck.stockPct}，期望 87.52）→ 会与列表页漂移`);
    }
    // 面板可用性：限高滚动 + 收起 / 隐藏 / 恢复（老板反馈底部看不到、想能隐藏）
    if (!(res.hasControls >= 2)) fails.push(`详情面板缺少收起/隐藏按钮（.jsa-dc-btn=${res.hasControls}）`);
    if (!res.collapsed) fails.push('点击「收起」未生效');
    if (res.collapsedBodyDisplay !== 'none') fails.push(`收起态内容区未隐藏（display=${res.collapsedBodyDisplay}）`);
    if (!res.expandedBack) fails.push('再次点击未展开');
    if (res.hiddenDisplay !== 'none') fails.push('点击「×」未隐藏面板');
    if (!res.restoreChip) fails.push('隐藏后未出现右缘恢复竖条');
    if (res.restoreChipGone === false) fails.push('点击恢复竖条后竖条未消失');
    if (res.restoredDisplay === 'none') fails.push('点击恢复竖条未重新显示面板');
    if (holdings.ok && holdings.items.length) {
      if (!res.hasHoldingsTitle) fails.push('持仓数据可用却未渲染持仓区块');
      if (!res.holdingRows) fails.push('持仓表格未渲染');
    }
    // 页面无历史表时，应给出净值波动特征；有历史表时应给出跟踪比
    if (!(res.hasTrackTitle || res.hasNavFeature)) fails.push('既无跟踪比也无净值波动特征（面板应有其一）');
    // 拿不到数据时不许留失败占位文案
    if (res.hasFailPlaceholder) fails.push('存在失败占位文案（未能获取/加载中），应整块移除而非占位');
    // 净值日期不应再是「—」
    const navDateKv = (res.kvText || []).find((t) => t.indexOf('净值日期=') === 0);
    if (navDateKv && /净值日期=—/.test(navDateKv) && nav.ok) {
      fails.push(`净值序列可用却仍显示「—」：${navDateKv}`);
    }
    // 档位一致性：HaoETF 可用时必须走 ◐，且必须声明第三方来源
    const kvAll = (res.kvText || []).join(' | ');
    const cardText = res.text || '';
    if (haoUsable) {
      if (!/◐/.test(kvAll)) fails.push(`HaoETF 实时估值可用（${haoRow.rtNav}）却未显示 ◐ 档：${kvAll}`);
      if (kvAll.indexOf('实时净值') < 0) fails.push('缺少「实时净值」指标行');
      if (cardText.indexOf('第三方') < 0 && cardText.indexOf('HaoETF') < 0) {
        fails.push('走了 ◐ 档却未声明第三方估算来源（有冒充官方净值的风险）');
      }
      if (cardText.indexOf('估算溢价 = 昨净值') > -1) {
        fails.push('走了 ◐ 档却仍显示自算估算的警告文案（档位串档）');
      }
    } else if (/◐/.test(kvAll)) {
      fails.push(`HaoETF 未命中/不可用，却显示了 ◐ 档：${kvAll}`);
    }
    // 档位标签必须是唯一真相源 P.labelOf 产出的，不允许硬编码残留
    if (/●真值|○估算/.test(kvAll)) fails.push(`档位标签仍是硬编码旧文案：${kvAll}`);
  }

  console.log('\n===== 断言 =====');
  if (fails.length) { fails.forEach((f) => console.log('❌', f)); process.exit(1); }
  console.log(`✅ 详情页面板通过：指标 ${res.kvCount} 项 / 持仓 ${res.holdingRows} 行 / 波动特征 ${res.hasNavFeature ? '有' : '无'}`);
})();
