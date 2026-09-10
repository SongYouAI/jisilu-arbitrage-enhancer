/**
 * 三级数据源降级 单测
 *
 * 优先级：● 交易所 IOPV > ◐ HaoETF 期货锚点估值（跨境） > ○ 自算推算
 *
 * 为什么要第二档：跨境品种在 A 股盘中海外休市，用「A 股现货指数 × 跟踪比」推算
 * 在方法论上就是错的 —— 正确锚点是海外期货。此档为第三方估算，必须明确标注身份。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

require('../core/format.js');
require('../core/premium.js');

const P = globalThis.JsaPremium;

const ROW = {
  code: '160723', name: '嘉实原油', price: 1.995,
  nav: 1.9518, navDate: '2026-09-08', refIncreaseRt: 1.97, iopv: null,
};

test('三级降级：有 IOPV 时用 ● 交易所官方值（最高优先）', () => {
  const res = P.compute(Object.assign({}, ROW, { iopv: 1.9873, haoEtfNav: 2.0448 }), { trackRatio: 1 });
  const nav = P.pickNav(res);
  assert.strictEqual(nav.source, 'IOPV', 'IOPV 存在时必须压过 HaoETF');
  assert.strictEqual(nav.value, 1.9873);
  assert.strictEqual(res.premium, res.realPremium, '采用的应是 IOPV 口径溢价');
  assert.strictEqual(P.markOf(nav.source), '●');
});

test('三级降级：无 IOPV 但有 HaoETF 实时估值时用 ◐ 期货锚点', () => {
  const res = P.compute(Object.assign({}, ROW, { haoEtfNav: 2.0448 }), { trackRatio: 1 });
  const nav = P.pickNav(res);
  assert.strictEqual(nav.source, 'HAOETF');
  assert.strictEqual(nav.value, 2.0448);
  // 溢价必须基于实时估值算：(1.995 − 2.0448) / 2.0448 = −2.435%
  const expect = ((1.995 - 2.0448) / 2.0448) * 100;
  assert.ok(Math.abs(res.premium - expect) < 1e-9, '溢价应按实时估值算，实际 ' + res.premium);
  assert.strictEqual(res.premium, res.haoPremium);
  assert.strictEqual(P.markOf(nav.source), '◐');
  // 自算轨道仍要算出来，供交叉对照
  assert.ok(res.estNav !== null, '自算净值应并存，便于对照');
});

test('三级降级：两者都没有时回落 ○ 自算推算', () => {
  const res = P.compute(Object.assign({}, ROW), { trackRatio: 1 });
  const nav = P.pickNav(res);
  assert.strictEqual(nav.source, 'EST');
  assert.strictEqual(res.premium, res.estPremium);
  assert.strictEqual(P.markOf(nav.source), '○');
  assert.strictEqual(res.haoPremium, null, '无 HaoETF 数据时不应产生该口径溢价');
});

test('三级降级：无参考涨幅且无前两档时标为 NAV 静态口径', () => {
  const res = P.compute({ code: 'x', price: 1.0, nav: 1.0, iopv: null }, { trackRatio: 1 });
  assert.strictEqual(res.source, 'NAV');
  assert.strictEqual(P.markOf('NAV'), '○');
  assert.ok(/未修正今日涨跌/.test(res.reason), '静态口径必须交代清楚');
});

test('标记定义唯一真相源：● / ◐ / ○ 三档不得混用', () => {
  assert.strictEqual(P.markOf('IOPV'), '●');
  assert.strictEqual(P.markOf('HAOETF'), '◐');
  assert.strictEqual(P.markOf('EST'), '○');
  assert.strictEqual(P.markOf('NAV'), '○');
  assert.strictEqual(P.markOf('NONE'), '');
  // 标签必须体现数据身份，尤其是「第三方」不能省
  assert.ok(/交易所官方/.test(P.labelOf('IOPV')));
  assert.ok(/第三方/.test(P.labelOf('HAOETF')), '◐ 的标签必须写明第三方估算，实际：' + P.labelOf('HAOETF'));
  assert.ok(/自算/.test(P.labelOf('EST')));
});

test('◐ 悬停：必须讲清期货锚点的道理，且必须声明非官方', () => {
  const row = Object.assign({}, ROW, { haoEtfNav: 2.0448 });
  const res = P.compute(row, { trackRatio: 1 });
  const tNav = P.tooltipNav(res, row);
  assert.ok(tNav.indexOf('◐') > -1, '净值列悬停要带 ◐ 标记');
  assert.ok(tNav.indexOf('期货') > -1, '要讲期货这个锚点');
  assert.ok(tNav.indexOf('休市') > -1, '要解释为什么现货指数法不适用');
  assert.ok(tNav.indexOf('第三方') > -1, '必须声明第三方来源');
  assert.ok(tNav.indexOf('不是交易所官方数据') > -1, '必须明确否定官方身份');

  const tPrem = P.tooltipPremium(res, row);
  assert.ok(tPrem.indexOf('第三方') > -1, '溢价列悬停同样要标注来源身份');
  assert.ok(tPrem.indexOf('套利建议') > -1, '套利建议不得因换了数据源而丢');
});
