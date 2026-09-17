/**
 * track.js 历史表提取器测试
 * 背景（2026-09-17 用户反馈）：集思录 LOF 详情页历史表是「净值 + 重仓涨幅」格式，
 * 旧提取器只认「净值涨幅 + 指数涨幅」，导致历史跟踪比恒不可用。
 * 新提取器按净值日期对齐相邻两期净值推算净值涨幅（QDII 净值滞后，不能按行错位配对）。
 * 本测试用最小假 DOM（提取器只依赖 querySelectorAll/textContent/children）。
 */
const test = require('node:test');
const assert = require('node:assert');

require('../core/format.js');
require('../core/track.js');

const T = globalThis.JsaTrack;

function cell(txt) { return { textContent: txt }; }
function tr(cells) { return { children: cells.map(cell) }; }
function table(heads, rows) {
  return {
    querySelectorAll(sel) {
      if (sel === 'thead th') return heads.map(cell);
      if (sel === 'tbody tr') return rows;
      return [];
    },
  };
}

const HEADS_LOF = ['日期', '收盘价', '净值日期', '净值', '溢价率', '成交额(万元)', '盘前份额(万份)', '盘前新增(万份)', '份额涨幅', '重仓涨幅'];

test('格式二：净值+重仓涨幅（国产 LOF，日期=净值日期）', () => {
  // 华夏磐晟LOF 160324 详情页实测结构（2026-09-17 截图），新→旧
  const tb = table(HEADS_LOF, [
    tr(['2026-09-17', '3.236', '2026-09-17', '-', '-', '83.22', '901', '0', '0.00%', '0.65%']),   // 当日净值未出 → 跳过
    tr(['2026-09-16', '3.260', '2026-09-16', '3.2438', '0.50%', '407.53', '901', '0', '0.00%', '4.05%']),
    tr(['2026-09-15', '3.170', '2026-09-15', '3.1820', '-0.38%', '279.40', '901', '0', '0.00%', '0.86%']),
    tr(['2026-09-14', '3.128', '2026-09-14', '3.1654', '-1.18%', '278.90', '901', '0', '0.00%', '-0.03%']),
  ]);
  const recs = T.extractFromTable(tb);
  assert.strictEqual(recs.length, 2, '3 个有效净值 → 2 条涨幅记录');
  // 新→旧：首条为 09-16（09-17 净值未出不参与）
  assert.strictEqual(recs[0].date, '2026-09-16');
  assert.ok(Math.abs(recs[0].navInc - ((3.2438 - 3.1820) / 3.1820) * 100) < 1e-9, '净值涨幅按相邻两期净值推算');
  assert.strictEqual(recs[0].indexInc, 4.05, '参考涨幅取同一净值日期当天的重仓涨幅');
  assert.strictEqual(recs[1].date, '2026-09-15');
  assert.strictEqual(recs[1].indexInc, 0.86);
});

test('格式二：QDII 净值滞后，必须按净值日期对齐而非按行配对', () => {
  const tb = table(HEADS_LOF, [
    tr(['2026-09-17', '1.110', '2026-09-15', '1.100', '', '', '', '', '', '0.5%']),
    tr(['2026-09-16', '1.100', '2026-09-14', '1.090', '', '', '', '', '', '0.3%']),
    tr(['2026-09-15', '1.095', '2026-09-13', '1.080', '', '', '', '', '', '2.0%']),
    tr(['2026-09-14', '1.080', '2026-09-12', '1.070', '', '', '', '', '', '-1.0%']),
    tr(['2026-09-13', '1.070', '2026-09-11', '1.060', '', '', '', '', '', '0.8%']),
  ]);
  const recs = T.extractFromTable(tb);
  // 09-12 无对应日期行（周末），该条被跳过；剩 3 条
  assert.strictEqual(recs.length, 3);
  // 关键断言：净值日期 09-15 的净值涨幅，配对的是 09-15 当天的重仓涨幅 2.0%，
  // 而不是它所在行（09-17 行）的 0.5%
  assert.strictEqual(recs[0].date, '2026-09-15');
  assert.strictEqual(recs[0].indexInc, 2.0, 'QDII 必须按净值日期对齐参考涨幅');
  assert.ok(Math.abs(recs[0].navInc - ((1.100 - 1.090) / 1.090) * 100) < 1e-9);
  assert.strictEqual(recs[1].indexInc, -1.0);
  assert.strictEqual(recs[2].indexInc, 0.8);
});

test('格式一：直接带净值涨幅+指数涨幅列（旧格式保持兼容）', () => {
  const tb = table(['日期', '净值涨幅', '指数涨幅'], [
    tr(['2026-09-16', '1.5%', '2.0%']),
    tr(['2026-09-15', '-0.5%', '-1.0%']),
  ]);
  const recs = T.extractFromTable(tb);
  assert.strictEqual(recs.length, 2);
  assert.strictEqual(recs[0].navInc, 1.5);
  assert.strictEqual(recs[0].indexInc, 2.0);
});

test('无参考涨幅列 → 返回空（不硬算）', () => {
  const tb = table(['日期', '净值'], [tr(['2026-09-16', '1.0'])]);
  assert.deepStrictEqual(T.extractFromTable(tb), []);
});

test('average：指数波动小于阈值(0.3%)的样本被过滤 + 过原点最小二乘估计', () => {
  const a = T.average([
    { date: 'd1', navInc: 1.9, indexInc: 4.0 },
    { date: 'd2', navInc: 0.01, indexInc: 0.1 },  // 指数波动过小 → 噪声，应被过滤
    { date: 'd3', navInc: 0.45, indexInc: 0.9 },
  ]);
  assert.strictEqual(a.samples, 2);
  // 新口径：过原点最小二乘 k̂ = Σxy / Σx²（权重偏向波动大的样本）
  const ols = (4.0 * 1.9 + 0.9 * 0.45) / (4.0 * 4.0 + 0.9 * 0.9);
  assert.ok(Math.abs(a.avg - ols) < 1e-12, `应为过原点最小二乘解 ${ols}，实际 ${a.avg}`);
  // 旧口径（逐日比值算术平均）保留为 avgRatio，供对比回溯
  const meanOfRatios = (1.9 / 4.0 + 0.45 / 0.9) / 2;
  assert.ok(Math.abs(a.avgRatio - meanOfRatios) < 1e-12);
  assert.ok(Math.abs(a.avg - a.avgRatio) > 1e-3, '两种口径结果应不同 —— 否则说明口径并没换');
  assert.ok(a.r2 !== null && a.r2 <= 1 && a.r2 >= 0, `R² 应在 [0,1]，实际 ${a.r2}`);
});

test('average：完美线性样本 → k̂ 精确且 R²=1', () => {
  const recs = [
    { date: 'd1', navInc: 0.88 * 1.5, indexInc: 1.5 },
    { date: 'd2', navInc: 0.88 * -2.0, indexInc: -2.0 },
    { date: 'd3', navInc: 0.88 * 0.7, indexInc: 0.7 },
  ];
  const a = T.average(recs, 10);
  assert.ok(Math.abs(a.avg - 0.88) < 1e-12, `k̂ 应为 0.88，实际 ${a.avg}`);
  assert.ok(Math.abs(a.r2 - 1) < 1e-12, `完美拟合 R² 应为 1，实际 ${a.r2}`);
  assert.ok(Math.abs(a.residStd) < 1e-12, `完美拟合残差标准差应为 0，实际 ${a.residStd}`);
});

test('average：有噪声时 R² < 1（能反映「这只基金是不是真按这个指数走」）', () => {
  const recs = [
    { date: 'd1', navInc: 0.9 * 1.0, indexInc: 1.0 },
    { date: 'd2', navInc: 0.9 * -1.2, indexInc: -1.2 },
    { date: 'd3', navInc: 0.9 * 0.8 + 0.9, indexInc: 0.8 },  // 加 0.9 个百分点的偏离
    { date: 'd4', navInc: 0.9 * 2.0 - 0.7, indexInc: 2.0 },
  ];
  const a = T.average(recs, 10);
  assert.ok(a.ok);
  assert.ok(a.r2 !== null && a.r2 < 1, `有噪声时 R² 应小于 1，实际 ${a.r2}`);
  assert.ok(a.residStd > 0, '残差标准差应大于 0');
});
