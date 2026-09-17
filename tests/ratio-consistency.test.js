/**
 * 「同一只基金，列表页与详情页跟踪比必须一致」回归守卫。
 *
 * 背景（2026-09-17 老板实测报的严重 bug）：
 *   首页看到的跟踪比与点进详情页看到的对不上，有些一样有些不一样。
 *   根因是这条四级链被复制成两份、且输入源不同：
 *     · 详情页多一档「页面现场回归」，压在缓存档之上（列表页没有历史表，复现不出）；
 *     · 「股票占比」列表页取 stock_ratio 列、详情页取正文正则，取不到时详情页直接掉到全局 1.00；
 *     · 详情页写了 autoRatio 缓存，列表页却只在 init 读一次，不重载就仍是旧值。
 *
 * 修法：把四级链抽成 `P.pickRatio` 唯一真相源，两页共用；
 *       回归值 / 股票占比都归一到**共享缓存**，保证两页输入同源。
 * 本文件锁死这三件事。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

require('../core/format.js');
require('../core/premium.js');
const P = globalThis.JsaPremium;

const LIST = read('content/jisilu-list.js');
const DETAIL = read('content/jisilu-detail.js');
const REPO = read('storage/repository.js');
const PANEL = read('content/ui/panel.js');

// —— 一、四级优先级：同一批输入 → 固定的裁决 ——

test('pickRatio：手动设定优先级最高，压过回归与股票占比', () => {
  const r = P.pickRatio({
    code: 'X', overrides: { X: 0.66 },
    autoRatio: { X: { ratio: 0.83, samples: 8, win: 10 } },
    pageReg: { ok: true, avg: 0.9, samples: 10 },
    stockPct: 95.2, globalRatio: 1,
  });
  assert.strictEqual(r.src, 'override');
  assert.strictEqual(r.ratio, 0.66);
  assert.strictEqual(r.label, '手动设定');
});

test('pickRatio：无手动值时用历史回归（页面现场回归优先于缓存）', () => {
  const live = P.pickRatio({
    code: 'X', overrides: {},
    autoRatio: { X: { ratio: 0.83, samples: 8, win: 10 } },
    pageReg: { ok: true, avg: 0.912, samples: 12 },
    stockPct: 95.2, globalRatio: 1,
  });
  assert.strictEqual(live.src, 'reg');
  assert.strictEqual(live.ratio, 0.91, '页面现场回归应优先');
  assert.strictEqual(live.label, '历史回归·近10日（12 样本）');

  // 样本不足（<3）不算数，回落到缓存
  const cached = P.pickRatio({
    code: 'X', overrides: {},
    autoRatio: { X: { ratio: 0.83, samples: 8, win: 10 } },
    pageReg: { ok: true, avg: 0.5, samples: 2 },
    stockPct: 95.2, globalRatio: 1,
  });
  assert.strictEqual(cached.ratio, 0.83);
  assert.strictEqual(cached.label, '历史回归·近10日（8 样本）', '缓存档文案与现场回归档一致');
});

test('pickRatio：无回归时用股票占比；都没有则全局兜底', () => {
  const stock = P.pickRatio({ code: 'X', overrides: {}, autoRatio: {}, stockPct: 95.2, globalRatio: 1 });
  assert.strictEqual(stock.src, 'stock');
  assert.strictEqual(stock.ratio, 0.95);
  assert.strictEqual(stock.label, '股票占比 95.2%');

  const global = P.pickRatio({ code: 'X', overrides: {}, autoRatio: {}, stockPct: null, globalRatio: 1.2 });
  assert.strictEqual(global.src, 'global');
  assert.strictEqual(global.ratio, 1.2);
  assert.strictEqual(global.label, '全局默认');
});

// —— 二、跨页一致：两页喂同一批共享数据 → 结果必须逐字相同 ——

test('跨页一致：列表页与详情页对同一只基金输出完全相同的值', () => {
  // 详情页现场回归算出 0.83，写入共享缓存（带 win/samples）；股票占比由列表页回写共享
  const sharedAuto = { 160106: { ratio: 0.83, samples: 10, win: 10, at: '2026-09-17' } };
  const sharedPct = { 160106: 95.2 };
  const overrides = {};
  const globalRatio = 1;

  // 列表页：没有历史表 → 无 pageReg；读共享缓存
  const listOut = P.pickRatio({
    code: '160106', overrides, autoRatio: sharedAuto, pageReg: null,
    stockPct: sharedPct['160106'], globalRatio,
  });
  // 详情页：有现场回归（值与缓存同）→ 走现场回归档；股票占比读同源缓存
  const detailOut = P.pickRatio({
    code: '160106', overrides, autoRatio: sharedAuto,
    pageReg: { ok: true, avg: 0.83, samples: 10 },
    stockPct: sharedPct['160106'], globalRatio,
  });

  assert.strictEqual(listOut.ratio, detailOut.ratio, '两页跟踪比数值必须一致');
  assert.strictEqual(listOut.label, detailOut.label, '两页档位文案也必须一致');
  assert.strictEqual(listOut.ratio, 0.83);
});

test('跨页一致：详情页正文取不到「股票占比」时，靠列表页回写的缓存对齐（旧实现此处会掉到全局 1.00）', () => {
  const sharedPct = { 161226: 95.2 };
  const listOut = P.pickRatio({ code: '161226', overrides: {}, autoRatio: {}, stockPct: sharedPct['161226'], globalRatio: 1 });
  // 详情页旧实现：stockPct=null → 全局 1.00；新实现：读共享缓存 → 同样 0.95
  const detailOut = P.pickRatio({ code: '161226', overrides: {}, autoRatio: {}, stockPct: sharedPct['161226'], globalRatio: 1 });
  assert.strictEqual(listOut.ratio, 0.95);
  assert.strictEqual(detailOut.ratio, listOut.ratio);

  // 反证：若详情页拿不到股票占比（缓存缺失且正文无该字样），就会掉到全局 —— 正是旧 bug
  const broken = P.pickRatio({ code: '161226', overrides: {}, autoRatio: {}, stockPct: null, globalRatio: 1 });
  assert.strictEqual(broken.ratio, 1, '缓存必须能被详情页读到，否则两页会差 0.05');
});

// —— 三、静态守卫：禁止再出现「各写一套链」 ——

test('静态守卫：两个页面都必须调用 P.pickRatio，不得自建一套 if/else 链', () => {
  assert.ok(/P\.pickRatio\s*\(/.test(LIST), '列表页应调用 P.pickRatio');
  assert.ok(/P\.pickRatio\s*\(/.test(DETAIL), '详情页应调用 P.pickRatio');

  // 列表页旧链的首行（直接读 ctx.overrides[row.code] 自行裁决）
  assert.ok(!/ctx\.overrides\[row\.code\]/.test(LIST), '列表页不得再自行裁决优先级');
  // 详情页旧链特征：effLabel 直接赋 '手动设定' / else if (reg10.ok
  assert.ok(!/effLabel\s*=\s*'手动设定'/.test(DETAIL), '详情页不得再自行裁决优先级');
  assert.ok(!/else\s+if\s*\(\s*reg10\.ok/.test(DETAIL), '详情页不得再写一套 else-if 链');
  // 旧的无 isFinite 兜底本地 clampRatio
  assert.ok(!/const\s+clampRatio\s*=\s*\(v\)\s*=>\s*Math\.min/.test(DETAIL), '详情页不得用无兜底的本地 clampRatio');
});

test('静态守卫：「股票占比」两页必须同源（列表页回写 / 详情页读取共享缓存）', () => {
  assert.ok(/getStockPcts/.test(REPO) && /saveStockPcts/.test(REPO), '仓库应提供股票占比缓存读写');
  assert.ok(/Repo\.saveStockPcts\s*\(/.test(LIST), '列表页应回写 stock_ratio 到共享缓存');
  assert.ok(/Repo\.getStockPcts\s*\(/.test(DETAIL), '详情页应读取共享缓存');
  assert.ok(/persistStockPcts/.test(LIST), '列表页渲染后应持久化股票占比');
});

test('静态守卫：列表页每轮刷新都要重读共享存储（否则详情页写入的缓存不会被看到）', () => {
  assert.ok(/refreshStored/.test(LIST), '列表页应有 refreshStored');
  assert.ok(/await\s+refreshStored\s*\(\s*\)/.test(LIST), 'run() 每轮应先 refreshStored()');
  assert.ok(/getAutoRatios/.test(LIST), 'refreshStored 应重读回归缓存');
});

test('静态守卫：跟踪比浮层（列表页调）仍写 jsa.overrides，走共享夹紧', () => {
  assert.ok(/P\.clampRatio\s*\(/.test(LIST), '应用手动值时应走 P.clampRatio');
  assert.ok(/UI\.openRatioEditor/.test(LIST) && /openRatioEditor/.test(PANEL), '就地调跟踪比入口仍在');
});
