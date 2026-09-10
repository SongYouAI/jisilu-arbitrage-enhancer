/**
 * 清单完整性测试：防止漏文件（插件加载失败最常见原因）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

test('manifest 基本字段合法', () => {
  assert.strictEqual(manifest.manifest_version, 3);
  assert.ok(manifest.name && manifest.version);
  assert.ok(manifest.description && manifest.description.length > 10);
});

test('content_scripts 声明的 js 文件全部存在', () => {
  const missing = [];
  (manifest.content_scripts || []).forEach((cs) => {
    (cs.js || []).forEach((f) => {
      if (!fs.existsSync(path.join(ROOT, f))) missing.push(f);
    });
  });
  assert.deepStrictEqual(missing, [], `缺失文件: ${missing.join(', ')}`);
});

test('声明的图标文件存在', () => {
  Object.values(manifest.icons || {}).forEach((f) => {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `图标缺失: ${f}`);
  });
});

test('background service worker 存在，且其 importScripts 目标存在', () => {
  const sw = manifest.background && manifest.background.service_worker;
  assert.ok(sw, '应声明 service_worker');
  const p = path.join(ROOT, sw);
  assert.ok(fs.existsSync(p), 'service-worker 文件缺失');
  const src = fs.readFileSync(p, 'utf8');
  const m = src.match(/importScripts\(([^)]*)\)/);
  if (m) {
    const dir = path.dirname(p);
    m[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .forEach((rel) => {
        assert.ok(fs.existsSync(path.resolve(dir, rel)), `importScripts 目标缺失: ${rel}`);
      });
  }
});

test('host_permissions 覆盖全部数据源', () => {
  const hosts = (manifest.host_permissions || []).join(' ');
  // fund.eastmoney.com：历史净值序列（pingzhongdata），无需 Referer，是净值日期/波动特征的数据源
  ['jisilu.cn', 'qt.gtimg.cn', 'fundf10.eastmoney.com', 'fund.eastmoney.com'].forEach((h) => {
    assert.ok(hosts.indexOf(h) > -1, `缺少 host 权限: ${h}`);
  });
});

test('列表页与详情页 URL 均被匹配', () => {
  const matches = [];
  (manifest.content_scripts || []).forEach((cs) => matches.push(...(cs.matches || [])));
  const joined = matches.join('\n');
  ['/data/qdii/', '/data/lof/', '/data/etf/'].forEach((p) => {
    assert.ok(joined.indexOf(p) > -1, `未匹配列表页: ${p}`);
  });
  // 详情页经通配符 /data/qdii/* 覆盖
  assert.ok(/\/data\/(qdii|lof|etf)\/\*/.test(joined), '详情页应被通配符覆盖');
});

test('后台：失败结果不得按成功时长缓存（回归锁）', () => {
  const src = fs.readFileSync(path.join(ROOT, manifest.background.service_worker), 'utf8');
  assert.ok(/fail:\s*5\s*\*\s*60000/.test(src), '失败缓存应为 5 分钟');
  const failBranches = src.match(/put\([^;]*CACHE_TTL\.fail/g) || [];
  assert.ok(failBranches.length >= 3, '持仓失败/净值失败等路径都应走 fail TTL，实际 ' + failBranches.length + ' 处');
  assert.ok(!/CACHE_TTL\.holdings/.test(src), '不应保留旧的 holdings 7 天失败缓存');
});
