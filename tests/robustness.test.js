/**
 * 第三方源健壮性 单测（静态源码断言）
 *
 * 事故背景（2026-09-10）：v0.4.0 引入 HaoETF 作为 ◐ 档数据源后，列表页用
 * `Promise.all([refreshQuotes(), refreshHaoEtf()])` 并行等待两个源。
 * 一旦第三方源假死（TCP 连着但不返回），后台 fetch 无超时 → 消息永不返回 →
 * **整个「实时净值 + 实时溢价」两列都不渲染**。核心列被加分项拖死，是本末倒置。
 *
 * 本文件把这条教训钉成回归锁：核心源先渲染，加分源后补且必须有超时。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SW = read('background/service-worker.js');
const LIST = read('content/jisilu-list.js');

test('后台：每次抓取必须带硬超时，禁止可能永不返回的裸 fetch', () => {
  assert.ok(/AbortController/.test(SW), 'fetchText 缺 AbortController');
  assert.ok(/setTimeout\(\(\) => ac\.abort\(\)/.test(SW), '缺超时触发 abort');
  assert.ok(/signal:\s*ac\.signal/.test(SW), 'signal 未传给 fetch，abort 不会生效');
  assert.ok(/clearTimeout\(timer\)/.test(SW), '成功后未清理定时器，会误伤后续请求');
});

test('列表页：核心行情列不得与第三方源 Promise.all 一起 await', () => {
  assert.ok(!/Promise\.all\(\[[^\]]*refreshHaoEtf/.test(LIST),
    '行情与 HaoETF 被并行等待 —— 第三方源卡死会拖垮整页注入列');
});

test('列表页：必须先把行情画出来，HaoETF 只是事后补画', () => {
  const runBody = LIST.match(/async function run\(full\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(runBody, '未找到 run() 函数体');
  const src = runBody[0];
  const qPos = src.indexOf('refreshQuotes');
  const paintPos = src.indexOf('paint(full)');
  const haoPos = src.indexOf('refreshHaoEtf');
  assert.ok(qPos > -1 && paintPos > -1 && haoPos > -1, 'run() 结构不完整');
  assert.ok(qPos < paintPos && paintPos < haoPos,
    '顺序必须是「取行情 → 画 → 取 HaoETF → 补画」，实际位置 q/paint/hao = ' + [qPos, paintPos, haoPos].join('/'));
});

test('列表页：HaoETF 调用必须带软超时，且超时按「本档不可用」降级', () => {
  assert.ok(/withTimeout\(/.test(LIST), '缺少 withTimeout 包装');
  assert.ok(/withTimeout\(safeSendMessage\(\{ type: 'JSA_GET_HAOETF' \}\), \d+\)/.test(LIST),
    'HaoETF 请求未套软超时');
  // 失败路径不得把 state.haoetf 置空 —— 否则一次抖动会把已点亮的 ◐ 抹掉
  const fn = LIST.match(/async function refreshHaoEtf\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fn, '未找到 refreshHaoEtf()');
  assert.ok(!/state\.haoetf = \{\}/.test(fn[0]), '失败时清空了 haoetf，会把已有 ◐ 抹掉');
});

test('列表页：HaoETF 拿到后要补画一次，且仅在确有变化时补画', () => {
  assert.ok(/state\.haoetf !== prev[\s\S]{0,40}?paint\(false\)/.test(LIST),
    'HaoETF 到手后未补画，或未做「有变化才补画」的守卫');
});

test('面板档位统计必须由唯一函数产出，两条渲染路径都要同步', () => {
  assert.ok(/function syncPanelStat\(\)/.test(LIST), '缺少 syncPanelStat');
  // 统计口径只能有一处 setStat，否则又会出现「表格 ◐2 / 面板 ◐0」
  const setStatCount = (LIST.match(/setStat\(/g) || []).length;
  assert.strictEqual(setStatCount, 1, `setStat 出现 ${setStatCount} 次，应集中在 syncPanelStat 内仅 1 次`);
  // paint() 与 renderAll() 都必须调用
  const paintBody = LIST.match(/function paint\(full\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(paintBody && /syncPanelStat\(\)/.test(paintBody[0]), 'paint() 未同步面板统计');
  const renderBody = LIST.match(/function renderAll\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(renderBody && /syncPanelStat\(\)/.test(renderBody[0]), 'renderAll() 未同步面板统计');
});
