/**
 * 跟踪比「就地调整」与「详情页面板滚动/隐藏」的回归守卫。
 *
 * 背景（2026-09-17 线上事故，三条都被本文件锁死）：
 *  1) `jisilu-list.js` 的 ratioOf 调了未定义的**裸 clampRatio** → 每行抛 ReferenceError
 *     → 被 injectColumns 的 try/catch 吞掉 → 「实时净值 / 实时溢价」两列全变「—」。
 *  2) 列表页**没有**调整跟踪比的入口（saveOverrides 只被详情页调用），
 *     而老板的预期是「每一只基金都能（在列表页）单独调」。
 *  3) 详情页决策面板悬浮时**无高度上限**，内容长于视口时底部被裁掉，且无法隐藏。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

require('../core/premium.js');
const P = globalThis.JsaPremium;

const LIST = read('content/jisilu-list.js');
const PANEL = read('content/ui/panel.js');
const DETAIL = read('content/jisilu-detail.js');
const STYLES = read('content/ui/styles.js');

test('clampRatio：夹紧到 [0.05,1.5]，非法输入回落 1', () => {
  assert.strictEqual(P.clampRatio(0.001), 0.05);
  assert.strictEqual(P.clampRatio(9), 1.5);
  assert.strictEqual(P.clampRatio(0.876), 0.88, '保留两位小数');
  assert.strictEqual(P.clampRatio(NaN), 1);
  assert.strictEqual(P.clampRatio(undefined), 1);
  assert.strictEqual(P.clampRatio('abc'), 1);
});

test('回归守卫：列表页不得出现裸 clampRatio 调用（必须走 P.clampRatio）', () => {
  // 匹配「前面不是 . 或单词字符」的 clampRatio(，即未加命名空间的调用
  const bare = /(^|[^.\w])clampRatio\s*\(/m;
  assert.ok(
    !bare.test(LIST),
    'jisilu-list.js 出现裸 clampRatio(...) 调用 —— 该作用域无此函数，会在运行时抛 ReferenceError 并把整列吞成「—」'
  );
  assert.ok(/P\.clampRatio\s*\(/.test(LIST), '股票占比/手动值夹紧应走 P.clampRatio（唯一真相源）');
});

test('列表页提供「就地调整跟踪比」入口（点击格子 → UI.openRatioEditor）', () => {
  assert.ok(/UI\.openRatioEditor\s*\(/.test(LIST), '列表页应调用 UI.openRatioEditor');
  assert.ok(/function attachEditor\s*\(/.test(LIST), '应存在 attachEditor 绑定点击');
  assert.ok(/attachEditor\(span,\s*row\)/.test(LIST), '两个列（净值/溢价）的格子都应绑定调整入口');
  // 必须写回 overrides 才算「手动设定」这一档
  assert.ok(/Repo\.saveOverrides\s*\(/.test(LIST), '应用后应写回 jsa.overrides');
  assert.ok(/window\.__jsaOverrides\s*=/.test(LIST), '应用后应同步内存缓存，ratioOf 才能立即生效');
});

test('JsaUI 导出 openRatioEditor', () => {
  assert.ok(/openRatioEditor/.test(PANEL), 'panel.js 应定义 openRatioEditor');
  assert.ok(/global\.JsaUI\s*=\s*\{[^}]*openRatioEditor[^}]*\}/.test(PANEL), 'JsaUI 应导出 openRatioEditor');
});

test('详情页面板：悬浮态加限高滚动类，并提供收起/隐藏与恢复入口', () => {
  assert.ok(/jsa-dc-fixed/.test(DETAIL), '悬浮态应加 jsa-dc-fixed（限高 + 内部滚动）');
  assert.ok(!/card\.style\.cssText\s*\+=\s*'position:fixed/.test(DETAIL), '不应再用内联 cssText 直接设 fixed（无法限高滚动）');
  assert.ok(/jsa-dc-btn/.test(DETAIL), '标题栏应有 收起(−/+)/隐藏(×) 按钮');
  assert.ok(/jsa-dc-min/.test(DETAIL), '应支持收起态');
  assert.ok(/showRestoreChip/.test(DETAIL) && /jsa-dc-restore/.test(DETAIL), '隐藏后应提供右缘竖条恢复入口');
});

test('样式定义了面板限高滚动 / 恢复竖条 / 跟踪比浮层', () => {
  assert.ok(/\.jsa-detail-card\.jsa-dc-fixed\{[^}]*max-height/.test(STYLES), '.jsa-dc-fixed 应含 max-height');
  assert.ok(/\.jsa-detail-card\.jsa-dc-fixed\s+\.jsa-dc-bd\{[^}]*overflow\s*:\s*auto/.test(STYLES), '面板内容区应可滚动');
  assert.ok(/#jsa-dc-restore\{/.test(STYLES), '应定义恢复竖条样式');
  assert.ok(/#jsa-ratio-pop\{/.test(STYLES), '应定义跟踪比浮层样式');
});
