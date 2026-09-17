/**
 * 格式化工具契约测试。
 *
 * 重点防「函数定义了但忘了导出」——2026-09-17 就因 `hhmm` 没进导出表，
 * 导致列表页面板统计抛 `F.hhmm is not a function`，而它跑在 `renderAll()` 里，
 * 直接中断整表注入（表现为两列全空）。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

require('../core/format.js');
const F = globalThis.JsaFormat;

test('hhmm：14 位行情时间戳 → HH:MM', () => {
  assert.strictEqual(F.hhmm('20260917103000'), '10:30');
  assert.strictEqual(F.hhmm('20260917093512'), '09:35');
  assert.strictEqual(F.hhmm(20260917155959), '15:59');
});

test('hhmm：位数不足或非法值返回空串（不猜）', () => {
  assert.strictEqual(F.hhmm(''), '');
  assert.strictEqual(F.hhmm(null), '');
  assert.strictEqual(F.hhmm(undefined), '');
  assert.strictEqual(F.hhmm('20260917'), '', '只有日期不能硬编成时间');
  assert.strictEqual(F.hhmm('20260917993000'), '', '小时越界应判无效');
  assert.strictEqual(F.hhmm('20260917109900'), '', '分钟越界应判无效');
});

test('导出契约：format.js 定义的每个工具都必须在 JsaFormat 上可见', () => {
  // 逐个点名，漏导出会在这里红——不要再让「定义了没导出」复发
  ['number', 'pct', 'colorOf', 'fixed', 'hhmm', 'today', 'daysAgo'].forEach((k) => {
    assert.strictEqual(typeof F[k], 'function', `JsaFormat.${k} 未导出`);
  });
});

test('daysAgo / today 基本可用（面板与净值日期展示依赖）', () => {
  assert.match(F.today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(F.daysAgo(''), null);
  assert.strictEqual(F.daysAgo(F.today()), 0);
});
