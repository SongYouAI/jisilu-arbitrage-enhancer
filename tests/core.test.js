/**
 * 核心逻辑单测
 * 行情/持仓样本均为 2026-09-10 真实抓取，固化在 tests/fixtures 下，结果可复现。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

require('../core/format.js');
require('../core/quotes.js');
require('../core/premium.js');
require('../core/holdings.js');
require('../core/nav.js');
require('../core/track.js');
require('../core/dom.js');

const FIX = path.join(__dirname, 'fixtures');
const Q = globalThis.JsaQuotes;
const P = globalThis.JsaPremium;
const H = globalThis.JsaHoldings;
const NAV = globalThis.JsaNav;
const D = globalThis.JsaDom;
const T = globalThis.JsaTrack;
const F = globalThis.JsaFormat;

test('行情解析：锚点定位出 IOPV / 净值 / 溢价率', () => {
  const text = fs.readFileSync(path.join(FIX, 'quotes-2026-09-10.txt'), 'utf8');
  const r = Q.parseText(text);
  assert.ok(r['513100'], '应解析出 513100');

  const nq = r['513100'];
  assert.strictEqual(nq.code, '513100');
  assert.ok(nq.price > 0, '现价应为正数');
  assert.strictEqual(nq.iopv, 1.9873, 'IOPV 应锚点定位到 [78]');
  assert.strictEqual(nq.nav, 1.9942, '单位净值应锚点定位到 [81]');
  assert.strictEqual(nq.iopvPremium, 11.66, 'IOPV 溢价率应锚点定位到 [77]');

  // 交叉验算：溢价率与 (现价-IOPV)/IOPV 一致
  const calc = ((nq.price - nq.iopv) / nq.iopv) * 100;
  assert.ok(Math.abs(calc - nq.iopvPremium) < 0.02, `溢价率自洽: ${calc} vs ${nq.iopvPremium}`);

  // 黄金 ETF（收盘后最终 IOPV）
  assert.strictEqual(r['518880'].iopv, 9.0662);
  assert.strictEqual(r['518880'].nav, 9.0540);
});

test('行情解析：腾讯溢价率[77] 与 IOPV/净值 自洽（全样本）', () => {
  // 语义：有 IOPV 时 [77]=(现价-IOPV)/IOPV；无 IOPV 时 [77]=(现价-净值)/净值
  const text = fs.readFileSync(path.join(FIX, 'quotes-2026-09-10.txt'), 'utf8');
  const r = Q.parseText(text);
  let checked = 0;
  Object.values(r).forEach((q) => {
    if (q.iopvPremium === null || q.price === null) return;
    const base = q.iopv && q.iopv > 0 ? q.iopv : q.nav;
    if (!base) return;
    const calc = ((q.price - base) / base) * 100;
    assert.ok(
      Math.abs(calc - q.iopvPremium) < 0.02,
      `${q.code} 溢价率自洽失败: 计算 ${calc.toFixed(3)} vs 腾讯 ${q.iopvPremium}`
    );
    checked++;
  });
  assert.ok(checked >= 4, `应至少校验 4 只，实际 ${checked}`);
});

test('行情解析：无 IOPV 的 QDII 品种 iopv 为 null', () => {
  const text = fs.readFileSync(path.join(FIX, 'quotes-2026-09-10.txt'), 'utf8');
  const r = Q.parseText(text);
  assert.strictEqual(r['164906'].iopv, null, '164906 无 IOPV');
  assert.strictEqual(r['164906'].nav, 0.9111, '164906 净值');
  assert.strictEqual(r['161127'].iopv, null, '161127 无 IOPV');
  assert.strictEqual(r['161127'].nav, 2.1373, '161127 净值');
  // 有 IOPV 的
  assert.strictEqual(r['159561'].iopv, 1.3388);
});

test('代码前缀映射', () => {
  assert.strictEqual(Q.prefixOf('513100'), 'sh');
  assert.strictEqual(Q.prefixOf('518880'), 'sh');
  assert.strictEqual(Q.prefixOf('501312'), 'sh');
  assert.strictEqual(Q.prefixOf('164906'), 'sz');
  assert.strictEqual(Q.prefixOf('159561'), 'sz');
  assert.strictEqual(Q.prefixOf('161116'), 'sz');
});

test('双轨溢价：有 IOPV 走真值轨道', () => {
  const row = { code: '513100', name: '纳指ETF', price: 2.219, nav: 1.9942, navDate: '2026-09-08', refIncreaseRt: 0.35, iopv: 1.9873 };
  const res = P.compute(row, { trackRatio: 1 });
  assert.strictEqual(res.source, 'IOPV');
  assert.ok(Math.abs(res.premium - 11.66) < 0.05, `真值溢价应约 11.66%，实际 ${res.premium}`);
  assert.ok(res.realPremium !== null);
});

test('双轨溢价：无 IOPV 走估算轨道，跟踪比生效', () => {
  const row = { code: '161127', name: '标普生物LOF', price: 2.103, nav: 2.1373, navDate: '2026-09-08', refIncreaseRt: -1.56, iopv: null };
  const r1 = P.compute(row, { trackRatio: 1 });
  assert.strictEqual(r1.source, 'EST');
  const expectNav = 2.1373 * (1 + (-1.56 / 100) * 1);
  assert.ok(Math.abs(r1.estNav - expectNav) < 1e-9, '估算净值公式');
  const expectPrem = ((2.103 - expectNav) / expectNav) * 100;
  assert.ok(Math.abs(r1.estPremium - expectPrem) < 1e-9, '估算溢价率');

  // 跟踪比 0.5 → 净值跌幅减半 → 估算净值更高 → 溢价更低
  const r2 = P.compute(row, { trackRatio: 0.5 });
  assert.ok(r2.estNav > r1.estNav, '跟踪比变小，估算净值应变大');
  assert.ok(r2.estPremium < r1.estPremium, '跟踪比变小，估算溢价应变小');
  assert.strictEqual(r2.trackRatio, 0.5);
});

test('双轨溢价：数据缺失时给出原因而非 NaN', () => {
  const res = P.compute({ code: 'x', price: 1, nav: null, iopv: null }, { trackRatio: 1 });
  assert.strictEqual(res.premium, null);
  assert.strictEqual(res.source, 'NONE');
  assert.ok(res.reason.length > 0);
});

test('格式化：涨红跌绿、百分比、净值滞后天数', () => {
  assert.strictEqual(F.pct(11.66), '+11.66%');
  assert.strictEqual(F.pct(-2.54), '-2.54%');
  assert.strictEqual(F.number('-1.56%'), -1.56);
  assert.strictEqual(F.number('登录'), null);
  assert.strictEqual(F.number(''), null);
  assert.ok(F.colorOf(1).indexOf('up') > -1 || F.colorOf(1).indexOf('#d93025') > -1);
  assert.ok(F.colorOf(-1).indexOf('down') > -1 || F.colorOf(-1).indexOf('#0f9960') > -1);
});

test('持仓解析：真实样本能解出前十且有权重', () => {
  const raw = fs.readFileSync(path.join(FIX, 'holdings-161028.txt'), 'utf8');
  const r = H.parse(raw);
  assert.ok(r.ok, '应解析成功：' + (r.reason || ''));
  assert.ok(r.items.length > 0 && r.items.length <= 10, `条数 1..10，实际 ${r.items.length}`);
  r.items.forEach((it) => {
    assert.ok(/^\d{6}$/.test(it.code), `代码格式: ${it.code}`);
  });
  assert.ok(r.items.some((i) => typeof i.weight === 'number' && i.weight > 0), '应有权重');
});

test('持仓解析：空数据不抛错', () => {
  assert.strictEqual(H.parse('').ok, false);
  assert.strictEqual(H.parse('var apidata={ content:"",arryear:[],curyear:2026};').ok, false);
  assert.deepStrictEqual(H.parse(null).items, []);
});

test('加权涨幅：按权重计算，缺数据时降级', () => {
  const items = [
    { code: '300750', name: 'A', weight: 10, change: null },
    { code: '601127', name: 'B', weight: 10, change: null },
  ];
  const q = { '300750': { changePct: 20 }, '601127': { changePct: 10 } };
  const w = H.weightedChange(items, q);
  assert.ok(w.ok);
  assert.ok(Math.abs(w.avg - 15) < 1e-9, `加权平均应为 15，实际 ${w.avg}`);
  assert.strictEqual(w.covered, 2);

  const none = H.weightedChange(items, {});
  assert.strictEqual(none.ok, false);
  assert.strictEqual(none.avg, null);
});

test('跟踪比：平均值计算与噪声过滤', () => {
  const recs = [
    { date: 'd1', navInc: 1.0, indexInc: 1.0 },
    { date: 'd2', navInc: 0.9, indexInc: 1.0 },
    { date: 'd3', navInc: 0.01, indexInc: 0.01 }, // 噪声，应被过滤
  ];
  const a = T.average(recs, 10);
  assert.ok(a.ok);
  assert.strictEqual(a.samples, 2, '噪声样本应被过滤');
  assert.ok(Math.abs(a.avg - 0.95) < 1e-9, `均值应为 0.95，实际 ${a.avg}`);
});

test('跟踪比：样本不足时返回 ok=false', () => {
  const a = T.average([{ date: 'd', navInc: 1, indexInc: 0.01 }], 10);
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.avg, null);
});

// —— v0.2.0：实时净值 / 实时溢价 两列 ——

test('pickNav：有 IOPV 取 IOPV，无则取推算净值', () => {
  const real = P.compute({ code: '513100', price: 2.219, nav: 1.9942, refIncreaseRt: 0.35, iopv: 1.9873 }, { trackRatio: 1 });
  assert.strictEqual(P.pickNav(real).value, 1.9873, '有 IOPV 应直接取 IOPV');
  assert.strictEqual(P.pickNav(real).source, 'IOPV');

  const est = P.compute({ code: '164906', price: 0.888, nav: 0.9111, navDate: '2026-09-08', refIncreaseRt: 3.0, iopv: null }, { trackRatio: 1 });
  assert.ok(Math.abs(P.pickNav(est).value - 0.9111 * 1.03) < 1e-9, '无 IOPV 应取推算净值');
  assert.strictEqual(P.pickNav(est).source, 'EST');

  const none = P.compute({ code: 'x', price: 1, nav: null, iopv: null }, { trackRatio: 1 });
  assert.strictEqual(P.pickNav(none).source, 'NONE');
});

test('无参考涨幅时降级为静态净值口径（货币 ETF 场景，不是 NaN）', () => {
  // 实测：511880 银华日利，交易所不发 IOPV，页面也不给指数涨幅
  const res = P.compute({ code: '511880', name: '银华日利', price: 100.783, nav: 100.7779, refIncreaseRt: null, iopv: null }, { trackRatio: 1 });
  assert.strictEqual(res.source, 'NAV', '应降级为静态净值口径');
  assert.ok(res.premium !== null && isFinite(res.premium), '不该是 NaN');
  const expect = ((100.783 - 100.7779) / 100.7779) * 100;
  assert.ok(Math.abs(res.premium - expect) < 1e-9, `静态溢价应为 ${expect}，实际 ${res.premium}`);
  assert.ok(res.reason.indexOf('未修正今日涨跌') > -1, '原因里必须诚实说明未修正今日涨跌');
});

test('套利建议：高溢价劝退 + 限购状态单独提示', () => {
  const row = { code: '513100', name: '纳指ETF', price: 2.219, nav: 1.9942, navDate: '2026-09-08', refIncreaseRt: 0.35, iopv: 1.9873, applyStatus: '暂停申购' };
  const res = P.compute(row, { trackRatio: 1 });
  const adv = P.advice(res, row).join('\n');
  assert.ok(adv.indexOf('溢价 11.66%') > -1, `应点明溢价幅度，实际：${adv}`);
  assert.ok(adv.indexOf('别在这个价位买') > -1, '高溢价应劝退');
  assert.ok(adv.indexOf('暂停申购') > -1, '限购/暂停申购必须单独提示');
  assert.ok(adv.indexOf('30 万~100 万份') > -1, '必须讲清散户做不了的门槛');
});

test('套利建议：折价与无空间两种情形措辞正确', () => {
  const rowDisc = { code: '164906', name: '中概互联LOF', price: 0.888, nav: 0.9111, navDate: '2026-09-08', refIncreaseRt: 3.0, iopv: null };
  const rDisc = P.compute(rowDisc, { trackRatio: 1 });
  assert.ok(rDisc.premium < -1, `应算出折价，实际 ${rDisc.premium}`);
  const aDisc = P.advice(rDisc, rowDisc).join('\n');
  assert.ok(aDisc.indexOf('折价') > -1 && aDisc.indexOf('赎回费') > -1, '折价建议要提赎回费');

  const rowFlat = { code: '518880', name: '黄金ETF', price: 9.083, nav: 9.054, refIncreaseRt: 0.3, iopv: 9.0662 };
  const rFlat = P.compute(rowFlat, { trackRatio: 1 });
  assert.ok(Math.abs(rFlat.premium) < 1, `应在 ±1% 内，实际 ${rFlat.premium}`);
  assert.ok(P.advice(rFlat, rowFlat).join('\n').indexOf('正常波动') > -1, '小幅溢价应说没有套利空间');
});

test('悬停文本：净值列讲原理、溢价列含计算过程与套利建议', () => {
  const row = { code: '513100', name: '纳指ETF', price: 2.219, nav: 1.9942, navDate: '2026-09-08', refIncreaseRt: 0.35, iopv: 1.9873, pagePremium: 11.28 };
  const res = P.compute(row, { trackRatio: 1 });

  const tNav = P.tooltipNav(res, row);
  assert.ok(tNav.indexOf('申赎篮子') > -1, '净值列悬停应讲 IOPV 原理');
  assert.ok(tNav.indexOf('Σ 成分股数量 × 最新价 + 现金差额') > -1, '应给出 IOPV 详细算式');
  assert.ok(tNav.indexOf('不是插件算的') > -1, '必须声明 IOPV 是交易所官方数据');
  assert.ok(tNav.indexOf('顺手算笔账') > -1, '应给出「每份多付多少」的换算');

  const tPrem = P.tooltipPremium(res, row);
  assert.ok(tPrem.indexOf('套利建议') > -1, '溢价列悬停必须含套利建议');
  assert.ok(tPrem.indexOf('(2.219 − 1.9873)') > -1, `应给出计算过程，实际：${tPrem}`);
  assert.ok(tPrem.indexOf('为什么会有溢价') > -1, '应讲溢价存在的原理');
  assert.ok(tPrem.indexOf('温度计') > -1, '应点明溢价的信号意义');
  assert.ok(tPrem.indexOf('拉不回来') > -1, '应讲限购时溢价抹不平');
  assert.ok(tPrem.indexOf('净值溢价率') > -1, '应保留与集思录原值的对照说明');

  // 无 IOPV 的品种：净值列要解释为什么没有 IOPV
  const rowLof = { code: '164906', name: '中概互联LOF', price: 0.888, nav: 0.9111, navDate: '2026-09-08', refIncreaseRt: 3.0, iopv: null };
  const rLof = P.compute(rowLof, { trackRatio: 1 });
  const tLof = P.tooltipNav(rLof, rowLof);
  assert.ok(tLof.indexOf('现金申赎') > -1, 'LOF 要解释为什么交易所算不出 IOPV');
});
