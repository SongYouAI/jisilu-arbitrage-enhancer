/**
 * 后台服务：行情抓取（GBK 解码）+ 持仓抓取 + 缓存
 * content script 因 CORS 无法直连第三方行情，统一经此中转。
 */
importScripts(
  '../core/format.js',
  '../core/quotes.js',
  '../core/holdings.js',
  '../core/nav.js',
  '../core/haoetf.js'
);

const CACHE_TTL = {
  quote: 15000,          // 行情 15 秒（IOPV 刷新周期）
  nav: 6 * 3600000,      // 历史净值 6 小时（每日只更新一次，无需 7 天）
  haoetf: 5 * 60000,     // HaoETF 实时估值 5 分钟（随海外期货变动，不必更频）
  ok: 7 * 86400000,      // 成功结果默认 7 天
  fail: 5 * 60000,       // 失败结果只缓存 5 分钟，避免一次失败锁死一周
};

const cache = new Map(); // key -> { at, value }

/** 读取缓存：TTL 由写入时决定，成功与失败分别计时 */
function cached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  return null;
}
/** 写入缓存：ttl 省略时按成功结果处理（7 天） */
function put(key, value, ttl) {
  cache.set(key, { at: Date.now(), value, ttl: ttl || CACHE_TTL.ok });
  return value;
}

/** 单次抓取硬超时：第三方源（HaoETF 等）不可达时，绝不能让消息永不返回、拖死前台渲染 */
const FETCH_TIMEOUT_MS = 8000;

/** 抓取文本并按 GBK 解码 */
async function fetchText(url, decode) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: '*/*' },
      signal: ac.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    if (decode === 'gbk') {
      try {
        return new TextDecoder('gbk').decode(buf);
      } catch (e) {
        // 极少数环境无 gbk 解码器，回退 utf-8
        return new TextDecoder('utf-8').decode(buf);
      }
    }
    return new TextDecoder('utf-8').decode(buf);
  } finally {
    clearTimeout(timer);
  }
}

/** 行情批量抓取（内部切片 50 只/批） */
async function handleQuotes(codes) {
  const list = Array.isArray(codes) ? codes : [];
  const missing = [];
  const out = {};

  list.forEach((c) => {
    const key = 'q:' + c;
    const v = cached(key);
    if (v) out[c] = v;
    else missing.push(c);
  });

  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    const symbols = batch
      .map((c) => (String(c).charAt(0) === '5' || String(c).charAt(0) === '6' || String(c).charAt(0) === '9'
        ? 'sh' + c
        : (String(c).charAt(0) === '4' || String(c).charAt(0) === '8' ? 'bj' + c : 'sz' + c)))
      .join(',');
    try {
      const text = await fetchText(`https://qt.gtimg.cn/q=${symbols}`, 'gbk');
      const parsed = JsaQuotes.parseText(text);
      Object.keys(parsed).forEach((code) => {
        out[code] = put('q:' + code, parsed[code], CACHE_TTL.quote);
      });
      // 未返回的也缓存空对象，避免反复重试
      batch.forEach((c) => { if (!out[c]) out[c] = put('q:' + c, null, CACHE_TTL.quote); });
    } catch (e) {
      batch.forEach((c) => { out[c] = null; });
    }
  }
  return out;
}

/** 天天基金前十持仓 */
async function handleHoldings(code) {
  const key = 'h:' + code;
  const hit = cached(key);
  if (hit !== null) return hit;
  try {
    const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=`;
    const text = await fetchText(url, 'utf-8');
    const parsed = JsaHoldings.parse(text);
    if (parsed && parsed.ok) return put(key, parsed);
    // 解析失败（多为被拦截返回的 404 页面）按失败缓存，快速重试
    return put(key, { ok: false, reason: (parsed && parsed.reason) || 'parse-failed', items: [] }, CACHE_TTL.fail);
  } catch (e) {
    return put(key, { ok: false, reason: 'fetch-failed', items: [] }, CACHE_TTL.fail);
  }
}

/**
 * 历史净值序列（天天基金 pingzhongdata）
 * 注意：此源无需 Referer，而 FundArchivesDatas.aspx 强制校验 Referer
 * （Referer 是浏览器禁用请求头，JS fetch 无法伪造），故净值序列走此源。
 */
async function handleNavSeries(code) {
  const key = 'n:' + code;
  const hit = cached(key);
  if (hit !== null) return hit;
  try {
    const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
    const text = await fetchText(url, 'utf-8');
    const parsed = JsaNav.parsePingZhong(text);
    if (parsed && parsed.ok) return put(key, parsed, CACHE_TTL.nav);
    return put(key, { ok: false, reason: (parsed && parsed.reason) || 'parse-failed', items: [] }, CACHE_TTL.fail);
  } catch (e) {
    return put(key, { ok: false, reason: 'fetch-failed', items: [] }, CACHE_TTL.fail);
  }
}

/**
 * HaoETF 跨境基金实时估值（期货锚点）
 * 一次请求取回全表（实测 40 行 / 46KB），按代码建索引供列表页查表；
 * 详情页只要单只，传 code 即返回单行，避免整表白传。
 * 该源无需 Referer，且与东财 FundArchivesDatas 不同，可稳定抓取。
 *
 * @param {string} [code] 只取单只时传入
 * @returns {Promise<{ok:boolean, reason?:string, byCode?:Object, row?:Object|null, count?:number, asOf?:string}>}
 */
async function handleHaoEtf(code) {
  const key = 'hao';
  let hit = cached(key);
  if (hit === null) {
    hit = await fetchHaoEtfTable(key);
  }
  if (code && hit && hit.ok) {
    return { ok: true, row: (hit.byCode && hit.byCode[code]) || null, asOf: hit.asOf };
  }
  return hit;
}

async function fetchHaoEtfTable(key) {
  try {
    const text = await fetchText('https://www.haoetf.com/', 'utf-8');
    const parsed = JsaHaoEtf.parseHome(text);
    if (!parsed.ok) {
      return put(key, { ok: false, reason: parsed.reason || 'parse-failed', byCode: {} }, CACHE_TTL.fail);
    }
    const byCode = {};
    parsed.items.forEach((it) => {
      byCode[it.code] = {
        name: it.name,
        rtNav: it.rtNav,        // 实时估值（T-1 估值 + 实时期货）
        rtPrem: it.rtPrem,
        lastNav: it.lastNav,
        lastPrem: it.lastPrem,
        valDate: it.valDate,
        nav: it.nav,
        navDate: it.navDate,
        indexInc: it.indexInc,
        applyLimit: it.applyLimit,
        checked: it.checked,
      };
    });
    return put(key, { ok: true, byCode, count: parsed.items.length, asOf: parsed.asOf }, CACHE_TTL.haoetf);
  } catch (e) {
    return put(key, { ok: false, reason: 'fetch-failed', byCode: {} }, CACHE_TTL.fail);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const { type, payload } = msg || {};
  if (type === 'JSA_GET_QUOTES') {
    handleQuotes(payload && payload.codes)
      .then((r) => sendResponse({ ok: true, data: r }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (type === 'JSA_GET_HOLDINGS') {
    handleHoldings(payload && payload.code)
      .then((r) => sendResponse({ ok: true, data: r }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (type === 'JSA_GET_NAV_SERIES') {
    handleNavSeries(payload && payload.code)
      .then((r) => sendResponse({ ok: true, data: r }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (type === 'JSA_GET_HAOETF') {
    handleHaoEtf(payload && payload.code)
      .then((r) => sendResponse({ ok: true, data: r }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  return undefined;
});
