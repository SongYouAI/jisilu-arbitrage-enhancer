/**
 * HaoETF 解析单测
 * 夹具为 2026-09-10 真实抓取的首页表格片段（thead + 3 条数据行），结果可复现。
 *
 * 这套断言锁死三件事：
 *   ① 注释里的 <td> 不得混入（否则 23 个 td 会顶偏 20 个真实列）
 *   ② 头尾锚点定位正确（表头 23 列 ≠ 数据行 20 td，禁止按表头索引取值）
 *   ③ 实时溢价必须能通过「现价 ÷ 实时估值」自洽校验
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

require('../core/haoetf.js');

const FIX = path.join(__dirname, 'fixtures');
const HX = globalThis.JsaHaoEtf;
const html = fs.readFileSync(path.join(FIX, 'haoetf-home-2026-09-10.html'), 'utf8');

test('HaoETF：表头解析出 23 列，含实时估值/实时溢价/申购限额', () => {
  const heads = HX.parseHeads(html);
  assert.strictEqual(heads.length, 23, '表头应为 23 列，实际 ' + heads.length);
  ['实时估值', '实时溢价', '最新估值', '最新溢价', '申购限额'].forEach((h) => {
    assert.ok(heads.indexOf(h) > -1, '表头应含 ' + h);
  });
});

test('HaoETF：注释里的 td 不得混入（回归锁）', () => {
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/gi) || [];
  const dataRow = rows.find((r) => /501018/.test(r));
  const rawCount = (dataRow.match(/<td[^>]*>/gi) || []).length;
  const cleanCount = (dataRow.replace(/<!--[\s\S]*?-->/g, '').match(/<td[^>]*>/gi) || []).length;
  assert.strictEqual(rawCount, 23, '原始含注释应为 23 个 td');
  assert.strictEqual(cleanCount, 20, '剔除注释后应为 20 个 td');
  // 注释里的 200.59 绝不能被当成成交额
  const it = HX.parseRow(dataRow);
  assert.notStrictEqual(it.amount, 200.59, '注释中的数值不得被解析为成交额');
});

test('HaoETF：501018 全字段解析正确', () => {
  const it = HX.find(html, '501018');
  assert.ok(it, '应能找到 501018');
  assert.strictEqual(it.name, '南方原油');
  assert.strictEqual(it.rtNav, 2.0448, '实时估值');
  assert.strictEqual(it.rtPrem, -2.43, '实时溢价');
  assert.strictEqual(it.lastNav, 1.9884, '最新估值');
  assert.strictEqual(it.lastPrem, 0.33, '最新溢价');
  assert.strictEqual(it.valDate, '09-09', '估值日期');
  assert.strictEqual(it.price, 1.995, '现价');
  assert.strictEqual(it.nav, 1.9518, '官方净值');
  assert.strictEqual(it.navDate, '09-08', '净值日期');
  assert.strictEqual(it.applyLimit, '暂停申购', '申购限额（套利通道是否通畅的关键）');
  assert.strictEqual(it.checked, true, '必须通过自洽校验');
});

test('HaoETF：自洽校验能机器验证实时溢价真伪', () => {
  const it = HX.find(html, '501018');
  const expect = ((it.price - it.rtNav) / it.rtNav) * 100;
  assert.ok(Math.abs(expect - it.rtPrem) < 0.06, '实时溢价应与现价/实时估值自洽，实际偏差 ' + (expect - it.rtPrem).toFixed(4));
  // 反向：把溢价篡改后校验必须失败
  assert.strictEqual(HX.selfCheck(Object.assign({}, it, { rtPrem: 9.99 })), false, '篡改后校验应失败');
  // 数据不足时不误判
  assert.strictEqual(HX.selfCheck({ rtNav: null, price: 1, rtPrem: 1 }), null);
});

test('HaoETF：多行解析不串行、行数正确', () => {
  const r = HX.parseHome(html);
  assert.strictEqual(r.ok, true, '应解析成功：' + r.reason);
  assert.strictEqual(r.items.length, 3, '夹具有 3 条数据行，实际 ' + r.items.length);
  const codes = r.items.map((x) => x.code);
  assert.deepStrictEqual(codes, ['501018', '160723', '161129']);
  r.items.forEach((it) => {
    assert.match(it.code, /^\d{6}$/);
    assert.ok(it.name, it.code + ' 应有名称');
    assert.ok(it.applyLimit, it.code + ' 应有申购限额');
  });
});

test('HaoETF：页面改版或缺表头时安全降级', () => {
  assert.strictEqual(HX.parseHome('').ok, false, '空响应应失败');
  assert.strictEqual(HX.parseHome('<table><tr><td>x</td></tr></table>').ok, false, '无表头应失败');
  const r = HX.parseHome('<thead><tr><th>代码</th><th>名称</th></tr></thead><tbody><tr><td>501018</td><td>x</td></tr></tbody>');
  assert.strictEqual(r.ok, false, '表头缺关键列应判定页面改版');
  assert.ok(/页面结构已变/.test(r.reason), '应给出改版提示，实际：' + r.reason);
  assert.strictEqual(HX.find(html, '999999'), null, '查不到应返回 null');
});
