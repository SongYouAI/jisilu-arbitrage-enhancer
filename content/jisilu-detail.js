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
  const UI = window.JsaUI;   // 轻提示（收起/隐藏后告知恢复入口）；缺失时全部调用点都有兜底
  if (!F || !P) return;

  const DETAIL_RE = /\/data\/(?:qdii|lof|etf|fund)\/detail\/(\d{6})/;

  /** 参考涨幅解析：复用 core/dom.js 的实现，避免两处正则漂移 */
  const pickRefIncrease = D && D.pickRefIncrease ? D.pickRefIncrease : () => ({ value: null, label: '' });

  // P4：复用 core/runtime.js 的 JsaRuntime（不再本文件重复实现），附兜底
  const contextAlive = (window.JsaRuntime && window.JsaRuntime.contextAlive) || function () {
    try { return !!(window.chrome && chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  };
  const safeSendMessage = (window.JsaRuntime && window.JsaRuntime.safeSendMessage) || function () {
    return Promise.resolve(null);
  };

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

  /** 隐藏面板后，在视口右缘挂一个竖条恢复入口 */
  function showRestoreChip() {
    if (document.getElementById('jsa-dc-restore')) return;
    const r = document.createElement('div');
    r.id = 'jsa-dc-restore';
    r.textContent = '套利面板';
    r.title = '点击重新显示决策面板';
    r.addEventListener('click', () => {
      const c = document.getElementById('jsa-detail-card');
      if (c) c.style.display = '';
      r.remove();
    });
    document.body.appendChild(r);
  }

  async function build(code) {
    const settings = await Repo.getSettings();
    const quoteResp = await send({ type: 'JSA_GET_QUOTES', payload: { codes: [code] } });
    const q = quoteResp && quoteResp.ok && quoteResp.data ? quoteResp.data[code] : null;

    // HaoETF 期货锚点实时估值（仅跨境品种有；单只查询，失败不阻塞主流程）
    // 与列表页共用同一档位口径，否则同一只基金会出现「列表 ◐ / 详情 ○」的不一致
    let hao = null;
    let haoAsOf = '';
    try {
      const hr = await send({ type: 'JSA_GET_HAOETF', payload: { code } });
      if (hr && hr.ok && hr.data) {
        if (hr.data.row) hao = hr.data.row;
        haoAsOf = hr.data.asOf || '';
      }
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
    // P5：跨境期货锚点估值更新时间（用于 ◐ 档新鲜度展示）
    row.haoEtfAsOf = haoAsOf;
    // 行情时间戳（数据新鲜度展示）
    if (q && q.time) row.quoteTime = q.time;
    // P2 修复：详情页此前未传 applyStatus，导致 advice() 的限购提示恒失效。
    // 详情页无 apply_status 列，优先从页面文本提取申购状态，其次复用 HaoETF 申购限额（跨境品种已有准确值）。
    const mApply = bodyText.match(/申购状态[:：]?\s*([^\s；;，,。]+)/);
    row.applyStatus = mApply ? mApply[1] : (hao && hao.applyLimit ? hao.applyLimit : '');
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

    // —— 跟踪比：每只基金独立生效（四级优先级链，与列表页同口径）——
    // 提前解析页面历史表（格式一「净值涨幅+指数涨幅」/ 格式二「净值+重仓涨幅」按净值日期对齐），
    // 既供优先级链取「历史回归」档，也供下方「跟踪比」区块展示，只解析一次。
    let records = [];
    if (T) {
      document.querySelectorAll('table').forEach((t) => {
        if (records.length) return;
        const r = T.extractFromTable(t);
        if (r && r.length) records = r;
      });
    }
    const reg10 = records.length ? T.average(records, 10) : { ok: false };

    const overrides = await Repo.getOverrides();
    const autoMap = Repo.getAutoRatios ? await Repo.getAutoRatios() : {};

    // 股票占比：**优先读列表页回写的共享缓存**，保证与列表页同一个数。
    // 详情页没有 stock_ratio 列，只能靠正文正则，而正文常常根本没有「股票占比」字样 ——
    // 旧实现此时 stockPct=null 会直接掉到「全局默认 1.00」，列表页却用 0.95 —— 这就是
    // 「同一只基金两页跟踪比对不上」的主因之一。
    const pctMap = Repo.getStockPcts ? await Repo.getStockPcts() : {};
    let stockPct = pctMap[code] != null ? pctMap[code] : null;
    let stockPctFromPage = false;
    if (stockPct == null) {
      const mStock = bodyText.match(/股票占比[^\d]{0,8}(\d+(?:\.\d+)?)\s*%/);
      if (mStock) { stockPct = parseFloat(mStock[1]); stockPctFromPage = true; }
    }

    // 页面现场回归可用时写入共享缓存（带 win，供两页统一文案），
    // 使列表页无需再进详情页即可拿到**同一个数**（这是两页一致的关键）。
    if (reg10.ok && reg10.samples >= 3) {
      autoMap[code] = { ratio: P.clampRatio(reg10.avg), samples: reg10.samples, win: 10, at: F.today() };
      if (Repo.saveAutoRatios) Promise.resolve(Repo.saveAutoRatios(autoMap)).catch(() => {});
    }
    // 若股票占比是从正文里挖到的（列表页没来过 / 没缓存），回写共享，供列表页同源
    if (stockPctFromPage && Repo.saveStockPcts) {
      pctMap[code] = stockPct;
      Promise.resolve(Repo.saveStockPcts(pctMap)).catch(() => {});
    }

    // 生效值：**必须走 P.pickRatio**（列表页调的是同一个函数），禁止再在本文件里写一套 if/else。
    const pick = P.pickRatio({
      code,
      overrides,
      autoRatio: autoMap,
      pageReg: reg10,
      stockPct,
      globalRatio: settings.trackRatio,
    });
    const effRatio = pick.ratio;
    const effLabel = pick.label;
    const clampRatio = P.clampRatio;   // 统一用共享实现（带 isFinite 兜底，非数不会抛）
    // 自证钩子：把本次裁决的**输入与输出**留档，供验证脚本断言
    // 「详情页生效值 == P.pickRatio(同一批输入)」，杜绝本页再长出第二套链。
    try {
      window.__jsaDetail = window.__jsaDetail || {};
      window.__jsaDetail.last = {
        code,
        ratio: pick.ratio,
        label: pick.label,
        src: pick.src,
        inputs: {
          code,
          overrides,
          autoRatio: autoMap,
          pageReg: reg10,
          stockPct,
          globalRatio: settings.trackRatio,
        },
      };
    } catch (e) { /* 仅验证用途，失败无副作用 */ }

    const res = P.compute(row, { trackRatio: effRatio });

    // —— 组装卡片 ——
    const card = document.createElement('div');
    card.className = 'jsa-detail-card';
    card.id = 'jsa-detail-card';

    const hd = document.createElement('div');
    hd.className = 'jsa-dc-hd';
    const hdT = document.createElement('span');
    hdT.className = 'jsa-dc-t';
    hdT.innerHTML = `套利增强 · 决策面板 <span style="font-weight:400;opacity:.85">${row.code}${row.name ? ' · ' + row.name : ''}</span>`;
    // 标题栏右侧控制：收起（−/+）与隐藏（×）；隐藏后右缘竖条可再打开
    const dcMin = document.createElement('span');
    dcMin.className = 'jsa-dc-btn';
    dcMin.title = '收起 / 展开';
    const dcHide = document.createElement('span');
    dcHide.className = 'jsa-dc-btn';
    dcHide.textContent = '×';
    dcHide.title = '隐藏面板（视口右缘的竖条可再打开）';
    hd.appendChild(hdT);
    hd.appendChild(dcMin);
    hd.appendChild(dcHide);
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
        : `该基金无实时 IOPV，也未命中 HaoETF 期货锚点（该源只覆盖 40 只跨境品种）。估算溢价 = 昨净值 ×(1 + ${row.refIncreaseLabel || '参考涨幅'} ${row.refIncreaseRt}% × 跟踪比 ${effRatio}（${effLabel}）)，可在下方「跟踪比」区块校准本基金取值。`;
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

    // —— 跟踪比（本基金）：当前生效值 + 历史回归 + 手动调整 ——
    const trTitle = document.createElement('div');
    trTitle.style.cssText = 'font-weight:600;margin:14px 0 6px';
    trTitle.textContent = '跟踪比（本基金）';
    bd.appendChild(trTitle);
    const trBox = document.createElement('div');
    bd.appendChild(trBox);

    const curLine = document.createElement('div');
    curLine.className = 'jsa-note';
    curLine.style.color = '#334155';
    curLine.innerHTML = `当前生效：<b>${effRatio.toFixed(2)}</b>（${effLabel}）<br>` +
      '<span style="color:#94a3b8">取用优先级：手动设定 &gt; 历史回归 &gt; 股票占比 &gt; 全局滑杆；' +
      '本页与列表页同源同函数，同一只基金两处显示必然一致。</span>';
    trBox.appendChild(curLine);

    if (records.length) {
      // 历史回归：近 5/10/20 日「净值涨幅 ≈ k × 重仓(指数)涨幅」的**过原点最小二乘**解
      // （净值日期对齐 + |指数涨幅|≥0.3% 过滤 + R² 拟合优度，见 core/track.js）
      [5, 10, 20].forEach((n) => {
        const a = T.average(records, n);
        const line = document.createElement('div');
        line.className = 'jsa-note';
        line.textContent = a.ok
          ? `近 ${n} 日回归：${a.avg.toFixed(3)}（最小二乘，样本 ${a.samples} 个` +
            `${a.r2 != null ? '，拟合优度 R² ' + a.r2.toFixed(2) : ''}` +
            `${a.residStd != null ? '，残差标准差 ' + a.residStd.toFixed(3) + '%' : ''}）`
          : `近 ${n} 日：有效样本不足`;
        trBox.appendChild(line);
      });
    } else if (nav.ok) {
      // 页面无历史表时，改用真实净值序列给出波动特征，不再是"未能识别"的失败态
      [5, 10, 20].forEach((n) => {
        const s = N.stats(nav.items, n);
        const line = document.createElement('div');
        line.className = 'jsa-note';
        line.textContent = s.ok
          ? `近 ${n} 日净值：日均 ${(s.avg >= 0 ? '+' : '') + s.avg.toFixed(3)}%　波动 ${s.std.toFixed(3)}%　上涨占比 ${Math.round(s.upRatio * 100)}%`
          : `近 ${n} 日：样本不足`;
        trBox.appendChild(line);
      });
      const tip = document.createElement('div');
      tip.className = 'jsa-note';
      tip.style.color = '#64748b';
      tip.textContent = `本页无可用历史表，回归值不可用（以上为真实净值统计，截至 ${nav.asOf}）。可用下方滑杆手动设定。`;
      trBox.appendChild(tip);
    } else {
      const tip = document.createElement('div');
      tip.className = 'jsa-note';
      tip.textContent = '本页无历史表、净值序列也不可用，历史回归无法计算。可用下方滑杆手动设定。';
      trBox.appendChild(tip);
    }

    // 手动调整滑杆：只对本基金生效（写 jsa.overrides[code]，优先级最高）
    const rowS = document.createElement('div');
    rowS.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px';
    const slLabel = document.createElement('span');
    slLabel.textContent = '手动设定';
    slLabel.style.cssText = 'font-size:12px;color:#64748b;flex:0 0 auto';
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = '0.05'; sl.max = '1.5'; sl.step = '0.01';
    sl.value = String(effRatio);
    sl.style.cssText = 'flex:1;accent-color:#f5b64a';
    const sv = document.createElement('span');
    sv.textContent = Number(effRatio).toFixed(2);
    sv.style.cssText = 'min-width:38px;text-align:right;font-weight:600;color:#0b1b34;font-variant-numeric:tabular-nums';
    sl.addEventListener('input', () => { sv.textContent = Number(sl.value).toFixed(2); });
    sl.addEventListener('change', async () => {
      const o = await Repo.getOverrides();
      o[code] = Number(Number(sl.value).toFixed(2));
      await Repo.saveOverrides(o);
      build(code); // 重建面板：重算并刷新「当前生效」标签
    });
    rowS.appendChild(slLabel);
    rowS.appendChild(sl);
    rowS.appendChild(sv);
    trBox.appendChild(rowS);

    // 操作按钮：采用回归均值 / 恢复自动（删手动值）
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:6px';
    const btnStyle = 'border:1px solid #cbd5e1;background:#f8fafc;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;color:#334155';
    if (reg10.ok) {
      const btnUse = document.createElement('button');
      btnUse.style.cssText = btnStyle;
      btnUse.textContent = `采用近 10 日回归值 ${clampRatio(reg10.avg).toFixed(2)}`;
      btnUse.addEventListener('click', async () => {
        const o = await Repo.getOverrides();
        o[code] = clampRatio(reg10.avg);
        await Repo.saveOverrides(o);
        build(code);
      });
      btnRow.appendChild(btnUse);
    }
    if (overrides[code] != null) {
      const btnClear = document.createElement('button');
      btnClear.style.cssText = btnStyle;
      btnClear.textContent = '恢复自动（清除手动值）';
      btnClear.addEventListener('click', async () => {
        const o = await Repo.getOverrides();
        delete o[code];
        await Repo.saveOverrides(o);
        build(code);
      });
      btnRow.appendChild(btnClear);
    }
    if (btnRow.children.length) trBox.appendChild(btnRow);

    card.appendChild(bd);

    // 插入
    const host = hostContainer();
    const old = document.getElementById('jsa-detail-card');
    if (old) old.remove();
    const oldRestore = document.getElementById('jsa-dc-restore');
    if (oldRestore) oldRestore.remove();
    // 悬浮态（找不到内容容器时）：加限高 + 内部滚动，避免内容长于视口时底部被裁掉
    if (host === document.body) card.classList.add('jsa-dc-fixed');
    host.insertBefore(card, host.firstChild);

    // 标题栏控制：收起 / 隐藏
    // 两者效果都是「点了之后有东西不见了」，因此都补一句轻提示说明去了哪、怎么回来 ——
    // 2026-09-17 老板反馈「一点击它就消失了」，实为本设计，但缺反馈就会被当 bug。
    const syncDcMin = () => { dcMin.textContent = card.classList.contains('jsa-dc-min') ? '+' : '–'; };
    syncDcMin();
    dcMin.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.toggle('jsa-dc-min');
      syncDcMin();
      if (card.classList.contains('jsa-dc-min') && UI && UI.toast) {
        UI.toast('决策面板已收起 · 点标题栏右侧「+」可展开');
      }
    });
    dcHide.addEventListener('click', (e) => {
      e.stopPropagation();
      card.style.display = 'none';
      showRestoreChip();
      if (UI && UI.toast) UI.toast('决策面板已隐藏 · 点视口右缘「套利面板」竖条可恢复');
    });

    // 异步加载持仓
    (async () => {
      const hr = await send({ type: 'JSA_GET_HOLDINGS', payload: { code } });
      const data = hr && hr.ok ? hr.data : null;
      if (!data || !data.ok || !data.items || !data.items.length) {
        // P3 持仓：东财持仓接口强制校验 Referer（浏览器禁用请求头，JS 无法伪造），
        // 该源在扩展环境下长期不可用。不再整块移除，而是保留标题并给出替代提示，
        // 引导用户用本面板「历史跟踪比 / 净值波动特征」估算当日走势。
        if (holder) {
          holder.textContent = '';
          const tip = document.createElement('div');
          tip.className = 'jsa-note jsa-warn';
          tip.textContent = '前十持仓暂不可用：东财持仓接口强制校验 Referer（浏览器禁用请求头，扩展无法伪造），该源在扩展环境下长期不可用。可用本面板「跟踪比（本基金）/ 真实净值统计」估算当日走势。';
          holder.appendChild(tip);
        }
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
