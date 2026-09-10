/**
 * 列表页 / 详情页 档位一致性 单测（静态源码断言）
 *
 * 为什么需要它：档位（●/◐/○）在列表页与详情页都要展示，若两边各写一套文案，
 * 就会出现「同一只基金列表显示 ◐、详情页显示 ○」这类自相矛盾。
 * 真正的运行时断言在 tools/verify-live.cjs 与 tools/verify-detail.cjs（真页注入），
 * 本文件只做廉价的防漂移守卫：禁止硬编码档位文案、禁止漏接数据源。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const LIST = read('content/jisilu-list.js');
const DETAIL = read('content/jisilu-detail.js');

test('档位文案唯一真相源：两个页面都不得硬编码 ●真值 / ○估算', () => {
  [['content/jisilu-list.js', LIST], ['content/jisilu-detail.js', DETAIL]].forEach(([f, src]) => {
    assert.ok(!/●真值|○估算|●估算/.test(src), `${f} 出现硬编码档位文案，应改用 P.labelOf/P.markOf`);
  });
});

test('列表页与详情页都必须取用 P.markOf 或 P.labelOf', () => {
  assert.ok(/P\.markOf\(|P\.labelOf\(/.test(LIST), '列表页未走统一档位定义');
  assert.ok(/P\.labelOf\(/.test(DETAIL), '详情页未走统一档位定义');
});

test('详情页必须接入 HaoETF 单只查询，否则跨境品种会掉档', () => {
  assert.ok(/JSA_GET_HAOETF/.test(DETAIL), '详情页未请求 HaoETF');
  assert.ok(/haoEtfNav/.test(DETAIL), '详情页未把 HaoETF 实时估值喂进 row');
  // 自洽校验不通过的行宁可不用，避免把 HaoETF 自己都算错的数当权威
  assert.ok(/checked\s*!==\s*false/.test(DETAIL), '详情页缺少 HaoETF 自洽校验守卫');
});

test('详情页必须覆盖 ◐ 档的第三方来源声明与自算档警告，且互斥', () => {
  assert.ok(/HAOETF/.test(DETAIL), '详情页未处理 HAOETF 档');
  assert.ok(/第三方/.test(DETAIL), '详情页缺少第三方来源声明');
  // 分档互斥：HAOETF 分支必须在 EST/NAV 分支之前用 else if 隔开
  assert.ok(/if \(res\.source === 'HAOETF'\)[\s\S]{0,900}?else if \(res\.source === 'EST' \|\| res\.source === 'NAV'\)/.test(DETAIL),
    '◐ 与 ○ 的说明块未做成互斥分支，会串档');
});

test('估算净值只在被采用（○ EST）时展示，避免与实时净值做无意义对比', () => {
  assert.ok(/res\.source === 'EST' && res\.estNav != null/.test(DETAIL),
    '估算净值应仅在 EST 档展示');
});
