/**
 * 基金详情页聚合面板（/data/{qdii|lof|etf}/detail/{code}）
 *
 * 设计原则：不依赖详情页表格结构（页面结构未知且需登录才能观察），
 * 自绘一块独立卡片插入到主内容区顶部；找不到容器时退化为固定悬浮卡片。
 *
 * 数据：URL 取代码 → 腾讯行情（现价/IOPV/净值）→ 天天基金持仓 → 腾讯批量取持仓股涨幅
 */
(function () {
  'use strict';

  const F = window.JsaFormat;
  const P = window.JsaPremium;
  const H = window.JsaHoldings;
  const T = window.JsaTrack;
  const N = window.JsaNav;
  const D = window.JsaDom;
  const Repo = window.JsaRepo;
  if (!F || !P) return;

  const DETAIL_RE = /\/data\/(?:qdii|lof|etf|fund)\/detail\/(\d{6})/;

  /** 参考涨幅解析：复用 core/dom.js 的实现，避免两处正则漂移 */
  const pickRefIncrease = D && D.pickRefIncrease ? D.pickRefIncrease : () => ({ value: null, label: '' });

  function contextAlive() {
    try { return !!(window.chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }
  function safeSendMessage(msg) {
    return new Promise((resolve) => {
      if (!contextAlive()) return resolve(null);
      try {
        const r = chrome.runtime.sendMessage(msg);
        if (r && typeof r.then === 'function') r.then(resolve).catch(() => resolve(null));
        else chrome.runtime.sendMessage(msg, (res) => resolve(res || null));
      } catch (e) { resolve(null); }
    });
  }

  /**
   * 消息出口。离线验证时可通过 window.__jsaMsgHook 注入 mock 数据（生产环境该钩子不存在，无副作用）。
   */
  function send(msg) {
    if (typeof window.__jsaMsgHook === 'function') {
      return Promise.resolve(window.__jsaMsgHook(msg));
    }
    return safeSendMessage(msg);
  }

  /** 找一个合适的宿主容器 */
  function hostContainer() {
    const sels = [
      '.aw-content-wrap', '#main-content', '.aw-main-content', '.container .row > div',
      '#content', '.main-content', 'body',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return document.body;
  }

  function kv(k, v, color) {
    const d = document.createElement('div');
    const kk = document.createElement('div');
    kk.className = 'k';
    kk.textContent = k;
    const vv = document.createElement('div');
    vv.className = 'v';
    vv.textContent = v;
    if (color) vv.style.color = color;
    d.appendChild(kk);
    d.appendChild(vv);
    return d;
  }

  async function build(code) {
    const settings = await Repo.getSettings();
    const quoteResp = await send({ type: 'JSA_GET_QUOTES', payload: { codes: [code] } });
    const q = quoteResp && quoteResp.ok && quoteResp.data ? quoteResp.data[code] : null;

    // HaoETF 期货锚点实时估值（仅跨境品种有；单只查询，失败不阻塞主流程）
    // 与列表页共用同一档位口径，否则同一只基金会出现「列表 ◐ / 详情 ○」的不一致
    let hao = null;
    try {
      const hr = await send({ type: 'JSA_GET_HAOETF', payload: { code } });
      if (hr && hr.ok && hr.data && hr.data.row) hao = hr.data.row;
    } catch (e) { /* 忽略 */ }

    const row = {
      code,
      name: (q && q.name) || '',
      price: q ? q.price : null,
      // 注意：腾讯 [81] 只给净值数值，不给净值日期；不可用行情时间戳冒充净值日期
      nav: q ? q.nav : null,
      navDate: '',
      iopv: q ? q.iopv : null,
      // checked === false 表示 HaoETF 自身的「现价×(1−溢价)」自洽校验不通过，宁可不用
      haoEtfNav: hao && hao.rtNav != null && hao.rtNav > 0 && hao.checked !== false ? hao.rtNav : null,
      refIncreaseRt: null,
    };

    // 尝试从页面 DOM 补充名称与参考涨幅（登录态下可见）
    const pageName = document.querySelector('h1, .aw-item-title, .fund-name, title');
    if (pageName && pageName.textContent && !row.name) {
      row.name = pageName.textContent.trim().split(/\s+/)[0].slice(0, 24);
    }
    const bodyText = (document.body.innerText || '');
    const ref = pickRefIncrease(bodyText);
    row.refIncreaseRt = ref.value;
    row.refIncreaseLabel = ref.label;
    const mNav = bodyText.match(/(?:T-2净值|最新净值|单位净值)[^\d]{0,6}(\d+\.\d{3,4})/);
    if (mNav && row.nav == null) row.nav = parseFloat(mNav[1]);
    // 净值日期：只认页面标注的净值日期，不用行情时间冒充
    const mNavDate = bodyText.match(/净值日期[^\d]{0,10}(\d{4}-\d{2}-\d{2})/);
    if (mNavDate) row.navDate = mNavDate[1];
    else {
      const mNavDate2 = bodyText.match(/净值日期[^\d]{0,10}(\d{2}-\d{2})/);
      if (mNavDate2) row.navDate = `${new Date().getFullYear()}-${mNavDate2[1]}`;
    }

    // 历史净值序列（天天基金 pingzhongdata，无需 Referer）：
    // 用于补全真实净值日期、近期涨跌与波动率；失败不阻塞主流程
    let nav = { ok: false, items: [] };
    try {
      const nr = await send({ type: 'JSA_GET_NAV_SERIES', payload: { code } });
      if (nr && nr.ok && nr.data) nav = nr.data;
    } catch (e) { /* 忽略 */ }
    if (nav.ok) {
      if (!row.navDate && nav.asOf) row.navDate = nav.asOf;
      if (row.nav == null && nav.lastNav != null) row.nav = nav.lastNav;
    }

    const res = P.compute(row, { trackRatio: settings.trackRatio });

    // —— 组装卡片 ——
    const card = document.createElement('div');
    card.className = 'jsa-detail-card';
    card.id = 'jsa-detail-card';

    const hd = document.createElement('div');
    hd.className = 'jsa-dc-hd';
    hd.innerHTML = `<span>套利增强 · 决策面板</span><span style="font-weight:400;opacity:.85">${row.code}${row.name ? ' · ' + row.name : ''}</span>`;
    card.appendChild(hd);

    const bd = document.createElement('div');
    bd.className = 'jsa-dc-bd';

    // 关键指标
    const grid = document.createElement('div');
    grid.className = 'jsa-kv';
    grid.appendChild(kv('现价', row.price == null ? '—' : row.price.toFixed(3)));

    // 实时净值：与列表页共用三档口径（● IOPV / ◐ 期货锚点 / ○ 自算），
    // 档位文案统一取 P.labelOf，避免列表页与详情页两处各写一套而漂移
    const navPick = P.pickNav(res);
    grid.appendChild(kv(
      `实时净值 ${P.labelOf(navPick.source)}`,
      navPick.value == null ? '无' : navPick.value.toFixed(4),
      navPick.value == null ? '#94a3b8' : (navPick.source === 'HAOETF' ? '#185FA5' : undefined)
    ));

    const premV = res.premium == null ? '—' : F.pct(res.premium);
    grid.appendChild(kv(`溢价率 ${P.labelOf(res.source)}`, premV, F.colorOf(res.premium)));
    grid.appendChild(kv('最新净值', row.nav == null ? '—' : row.nav.toFixed(4)));
    grid.appendChild(kv('净值日期', row.navDate ? `${row.navDate}${res.navLagDays !== null ? ' (T-' + res.navLagDays + ')' : ''}` : '—',
      res.navLagDays !== null && res.navLagDays >= 2 ? '#b45309' : undefined));
    // 估算净值只在它**真的被采用**（○ EST）时展示；
    // 走 ● IOPV / ◐ HaoETF 时它不是采用值，展示只会让人拿它和实时净值做无意义对比
    if (res.source === 'EST' && res.estNav != null) grid.appendChild(kv('估算净值', res.estNav.toFixed(4)));
    bd.appendChild(grid);

    // 口径说明
    if (row.refIncreaseRt != null) {
      grid.appendChild(kv(
        `参考涨幅（${row.refIncreaseLabel || '页面'}）`,
        `${row.refIncreaseRt > 0 ? '+' : ''}${row.refIncreaseRt}%`,
        F.colorOf(row.refIncreaseRt)
      ));
    }
    const note = document.createElement('div');
    note.className = 'jsa-note';
    note.textContent = res.reason || '';
    if (res.source === 'HAOETF') {
      // 第三方估算必须显式声明，不得让用户误以为是交易所官方净值
      const w = document.createElement('div');
      w.className = 'jsa-note';
      w.style.color = '#185FA5';
      w.textContent = '数据来源：HaoETF 期货锚点估值 = T-1 估值 + 海外实时期货。跨境品种在 A 股盘中海外休市，用「A 股指数 × 跟踪比」推算净值在方法论上就站不住，海外期货才是正确锚点（腾讯行情取不到期货，这是目前唯一可得的免费锚点源）。此为第三方站点自行估算，不是交易所官方数据，仅供参考。';
      bd.appendChild(w);
    } else if (res.source === 'EST' || res.source === 'NAV') {
      const w = document.createElement('div');
      w.className = 'jsa-note jsa-warn';
      w.textContent = row.refIncreaseRt == null
        ? '该基金无实时 IOPV，也未拿到 HaoETF 期货锚点；本页未识别到「重仓涨幅 / T-1指数涨幅 / 指数涨幅 / 参考涨幅」任一字段，暂按官方净值静态比价（未修正今日涨跌，可能与实际差 1 个百分点以上）。'
        : `该基金无实时 IOPV，也未命中 HaoETF 期货锚点（该源只覆盖 40 只跨境品种）。估算溢价 = 昨净值 ×(1 + ${row.refIncreaseLabel || '参考涨幅'} ${row.refIncreaseRt}% × 跟踪比 ${settings.trackRatio})，可在控制面板调整跟踪比校准。`;
      bd.appendChild(w);
    }
    if (note.textContent) bd.appendChild(note);

    // —— 前十持仓 ——
    const hs = document.createElement('div');
    hs.style.marginTop = '14px';
    const hTitle = document.createElement('div');
    hTitle.style.fontWeight = '600';
    hTitle.style.marginBottom = '6px';
    hTitle.textContent = '前十大持仓 · 盘中涨幅汇总';
    hs.appendChild(hTitle);
    const holder = document.createElement('div');
    holder.textContent = '加载中…';
    holder.style.color = '#94a3b8';
    hs.appendChild(holder);
    bd.appendChild(hs);

    // —— 历史跟踪比（尝试从页面表格提取）——
    const trTitle = document.createElement('div');
    trTitle.style.cssText = 'font-weight:600;margin:14px 0 6px';
    trTitle.textContent = '历史跟踪比';
    bd.appendChild(trTitle);
    const trBox = document.createElement('div');
    bd.appendChild(trBox);

    let records = [];
    document.querySelectorAll('table').forEach((t) => {
      if (records.length) return;
      const r = T.extractFromTable(t);
      if (r && r.length) records = r;
    });
    if (records.length) {
      [5, 10, 20].forEach((n) => {
        const a = T.average(records, n);
        const line = document.createElement('div');
        line.className = 'jsa-note';
        line.textContent = a.ok
          ? `近 ${n} 日平均跟踪比：${a.avg.toFixed(3)}（样本 ${a.samples} 个${a.std != null ? '，标准差 ' + a.std.toFixed(3) : ''}）`
          : `近 ${n} 日：有效样本不足`;
        trBox.appendChild(line);
      });
      const btn = document.createElement('button');
      btn.className = 'jsa-btn';
      btn.textContent = '用近 10 日均值覆盖全局跟踪比';
      btn.style.cssText = 'border:1px solid #cbd5e1;background:#f8fafc;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;margin-top:6px';
      btn.addEventListener('click', async () => {
        const a = T.average(records, 10);
        if (!a.ok) return;
        const s = await Repo.getSettings();
        s.trackRatio = Math.min(1.5, Math.max(0.5, Number(a.avg.toFixed(2))));
        await Repo.saveSettings(s);
        btn.textContent = `已设为 ${s.trackRatio}（列表页生效）`;
      });
      trBox.appendChild(btn);
    } else if (nav.ok) {
      // 页面无历史表时，改用真实净值序列给出波动特征，不再是"未能识别"的失败态
      trTitle.textContent = '净值波动特征（真实净值）';
      [5, 10, 20].forEach((n) => {
        const s = N.stats(nav.items, n);
        const line = document.createElement('div');
        line.className = 'jsa-note';
        line.textContent = s.ok
          ? `近 ${n} 日：日均 ${(s.avg >= 0 ? '+' : '') + s.avg.toFixed(3)}%　波动 ${s.std.toFixed(3)}%　上涨占比 ${Math.round(s.upRatio * 100)}%`
          : `近 ${n} 日：样本不足`;
        trBox.appendChild(line);
      });
      const tip = document.createElement('div');
      tip.className = 'jsa-note';
      tip.style.color = '#64748b';
      tip.textContent = `本页无「净值涨幅 / 指数涨幅」历史表，以上为真实净值统计（截至 ${nav.asOf}）。跟踪比请在列表页控制面板手动设置。`;
      trBox.appendChild(tip);
    } else {
      // 页面无表、净值序列也拿不到 → 整块移除，不留失败占位
      if (trTitle.parentNode) trTitle.remove();
      if (trBox.parentNode) trBox.remove();
    }

    card.appendChild(bd);

    // 插入
    const host = hostContainer();
    const old = document.getElementById('jsa-detail-card');
    if (old) old.remove();
    if (host === document.body) {
      card.style.cssText += 'position:fixed;right:18px;top:70px;width:340px;z-index:2147483000';
    }
    host.insertBefore(card, host.firstChild);

    // 异步加载持仓
    (async () => {
      const hr = await send({ type: 'JSA_GET_HOLDINGS', payload: { code } });
      const data = hr && hr.ok ? hr.data : null;
      if (!data || !data.ok || !data.items || !data.items.length) {
        // 拿不到就整块移除，不留"未能获取"占位。
        // 原因：东财持仓接口强制校验 Referer，而 Referer 属浏览器禁用请求头、JS 无法伪造，
        // 该源在扩展环境下长期不可用；与其展示失败态，不如不显示。
        if (hs && hs.parentNode) hs.remove();
        return;
      }
      const qr = await send({ type: 'JSA_GET_QUOTES', payload: { codes: data.items.map((i) => i.code) } });
      const qmap = qr && qr.ok && qr.data ? qr.data : {};
      const w = H.weightedChange(data.items, qmap);

      holder.innerHTML = '';
      const lagDays = data.asOf ? F.daysAgo(data.asOf) : null;
      const sum = document.createElement('div');
      sum.className = 'jsa-note';
      sum.innerHTML = w.ok
        ? `持仓截止：${data.asOf || '—'}${lagDays !== null ? `（${lagDays} 天前）` : ''}　加权平均涨幅：<b style="color:${F.colorOf(w.avg)}">${F.pct(w.avg)}</b>　已覆盖 ${w.covered}/${data.items.length} 只`
        : `持仓截止：${data.asOf || '—'}　暂无涨幅数据`;
      holder.appendChild(sum);

      // 季报持仓滞后警示：持仓最多滞后一个季度，基金可能已调仓
      if (lagDays !== null && lagDays > 45) {
        const lag = document.createElement('div');
        lag.className = 'jsa-note jsa-warn';
        lag.textContent = `⚠️ 持仓是季报数据，已滞后 ${lagDays} 天，基金很可能已调仓。据此算出的加权涨幅只能当参考，精度未必高于「指数涨幅 × 跟踪比」。`;
        holder.appendChild(lag);
      }

      const tb = document.createElement('table');
      const thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>代码</th><th>名称</th><th>权重</th><th>涨幅</th><th>贡献</th></tr>';
      tb.appendChild(thead);
      const tbody = document.createElement('tbody');
      (w.contribution && w.contribution.length ? w.contribution : data.items.map((i) => ({
        code: i.code, name: i.name, weight: i.weight || 0, change: null, contrib: null,
      }))).forEach((c) => {
        const tr = document.createElement('tr');
        tr.innerHTML =
          `<td>${c.code}</td>` +
          `<td>${c.name || '—'}</td>` +
          `<td>${c.weight ? c.weight.toFixed(2) + '%' : '—'}</td>` +
          `<td style="color:${F.colorOf(c.change)}">${c.change == null ? '—' : F.pct(c.change)}</td>` +
          `<td style="color:${F.colorOf(c.contrib)}">${c.contrib == null ? '—' : F.pct(c.contrib)}</td>`;
        tbody.appendChild(tr);
      });
      tb.appendChild(tbody);
      holder.appendChild(tb);
    })();
  }

  function init() {
    if (!(document.documentElement && document.body)) { setTimeout(init, 300); return; }
    const m = location.href.match(DETAIL_RE);
    if (!m) return;
    build(m[1]).catch(() => {});
  }

  // 暴露入口：便于离线验证脚本驱动（生产环境无副作用）
  window.__jsaDetail = { build: build };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 400));
  } else {
    setTimeout(init, 400);
  }
})();
