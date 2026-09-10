/**
 * 历史净值序列 + 参考涨幅解析 单测
 * 样本为 2026-09-10 真实抓取的 pingzhongdata 尾部切片，结果可复现。
 *
 * 背景：东财 FundArchivesDatas.aspx 强制校验 Referer，而 Referer 是浏览器禁用请求头、
 * JS fetch 无法伪造 —— 故历史净值改用 fund.eastmoney.com/pingzhongdata（无需 Referer）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

require('../core/format.js');
require('../core/premium.js');
require('../core/nav.js');
require('../core/dom.js');

const FIX = path.join(__dirname, 'fixtures');
const NAV = globalThis.JsaNav;
const D = globalThis.JsaDom;
const P = globalThis.JsaPremium;

test('净值序列：真实样本解析出日期/净值/日涨跌', () => {
  const text = fs.readFileSync(path.join(FIX, 'nav-160323.js'), 'utf8');
  const r = NAV.parsePingZhong(text);
  assert.strictEqual(r.ok, true, '应解析成功，实际：' + r.reason);
  assert.ok(r.items.length >= 20, '样本应足够统计，实际 ' + r.items.length);
  assert.strictEqual(r.asOf, '2026-09-09', '截止日应为末条日期');
  assert.strictEqual(r.lastNav, 1.7688, '末值应等于最后一条净值');
  const last = r.items[r.items.length - 1];
  const expect = ((1.7688 - 1.7715) / 1.7715) * 100;
  assert.ok(Math.abs(last.inc - expect) < 1e-9, '末条日涨跌应自算正确');
  r.items.forEach((it) => {
    assert.match(it.date, /^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');
  });
});

test('净值序列：异常输入全部安全降级（不抛异常、不带脏数据）', () => {
  const bads = ['', 'var x=1;', 'Data_netWorthTrend=[{broken', 'Data_netWorthTrend=[]'];
  bads.forEach((bad) => {
    const r = NAV.parsePingZhong(bad);
    assert.strictEqual(r.ok, false, '应判定失败：' + bad);
    assert.ok(r.reason, '失败必须给出原因');
    assert.deepStrictEqual(r.items, [], '失败不得带出数据');
  });
});

test('净值序列统计：近 5/10/20 日均值与波动率', () => {
  const r = NAV.parsePingZhong(fs.readFileSync(path.join(FIX, 'nav-160323.js'), 'utf8'));
  [5, 10, 20].forEach((n) => {
    const s = NAV.stats(r.items, n);
    assert.strictEqual(s.ok, true);
    assert.strictEqual(s.n, n, '近 ' + n + ' 日应取 ' + n + ' 个样本');
    assert.ok(isFinite(s.avg) && isFinite(s.std), '均值与波动率必须是有限数');
    assert.ok(s.upRatio >= 0 && s.upRatio <= 1, '上涨占比应在 0~1');
  });
});

// —— P0：参考涨幅漏抓会直接导致溢价方向判反 ——
test('参考涨幅：LOF 页的「重仓涨幅」必须能抓到', () => {
  const r = D.pickRefIncrease('净值日期 2026-09-09\n重仓涨幅 -1.50%\n现价 1.234');
  assert.strictEqual(r.value, -1.5, '必须解析出 -1.50，实际 ' + r.value);
  assert.strictEqual(r.label, '重仓涨幅');
});

test('参考涨幅：QDII 页的「T-1指数涨幅」优先于普通「指数涨幅」', () => {
  const r = D.pickRefIncrease('T-1指数涨幅 2.30%\n指数涨幅 1.10%');
  assert.strictEqual(r.value, 2.3, '应取 T-1 口径 2.30，实际 ' + r.value);
  assert.strictEqual(r.label, 'T-1指数涨幅');
});

test('参考涨幅：ETF 页的「指数涨幅」「参考涨幅」各有兜底', () => {
  assert.strictEqual(D.pickRefIncrease('指数涨幅 1.10%').value, 1.1);
  assert.strictEqual(D.pickRefIncrease('参考涨幅 -0.40%').value, -0.4);
  assert.strictEqual(D.pickRefIncrease('重仓股涨幅 3.25%').value, 3.25, '应兼容「重仓股涨幅」写法');
});

test('参考涨幅：页面没有相关字段时返回 null（不得瞎猜）', () => {
  const r = D.pickRefIncrease('现价 1.234 元\n成交额 1.2 亿');
  assert.strictEqual(r.value, null);
  assert.strictEqual(r.label, '');
});

test('P0 回归：重仓涨幅漏抓 → 溢价偏差 1.5 个百分点（回归锁）', () => {
  const row = { code: '160323', name: '测试LOF', price: 1.208, nav: 1.2266, navDate: '2026-09-09', iopv: null };
  // 漏抓：refInc = null → 走「官方净值直接比价」静态兜底，未修正今日涨跌
  const miss = P.compute(Object.assign({}, row), { trackRatio: 1 });
  // 抓到：refInc = -1.5% → 净值修正为 1.2266 × 0.985
  const hit = P.compute(Object.assign({}, row, { refIncreaseRt: -1.5 }), { trackRatio: 1 });

  assert.strictEqual(miss.source, 'NAV', '漏抓时必须老实标注为静态口径，不得冒充估算值');
  assert.strictEqual(hit.source, 'EST', '抓到后应走估算轨道');
  assert.ok(Math.abs(hit.estNav - 1.2266 * 0.985) < 1e-4, '估算净值应为 1.2266×0.985，实际 ' + hit.estNav);

  // 实测：漏抓 -1.52% vs 抓到 -0.02%，差 1.5 个百分点 —— 这就是 P0 的代价
  const gap = Math.abs(miss.premium - hit.premium);
  assert.ok(gap > 1, '漏抓造成的偏差应超过 1 个百分点（锁死该 bug 的严重性），实际 ' + gap.toFixed(3));
  assert.ok(/未修正今日涨跌/.test(miss.reason), '静态兜底必须在口径说明里交代清楚，实际：' + miss.reason);
});
