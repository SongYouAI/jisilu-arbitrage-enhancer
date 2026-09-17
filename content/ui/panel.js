/**
 * UI 组件：浮动控制面板 + 悬停提示
 */
(function (global) {
  'use strict';

  /** 全局悬停提示 */
  const tip = (function () {
    let el = null;
    function ensure() {
      if (el && document.body.contains(el)) return el;
      el = document.createElement('div');
      el.id = 'jsa-tip';
      document.body.appendChild(el);
      return el;
    }
    return {
      show(text, x, y) {
        const n = ensure();
        // 内容相同不重写：避免 mousemove 频繁触发时滚动位置被重置
        if (n.textContent !== text) n.textContent = text;
        n.style.display = 'block';
        const r = n.getBoundingClientRect();
        let left = x + 14;
        let top = y + 14;
        if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
        if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
        n.style.left = Math.max(8, left) + 'px';
        n.style.top = Math.max(8, top) + 'px';
      },
      hide() { if (el) el.style.display = 'none'; },
    };
  })();

  /**
   * 轻提示（视口底部居中，2.6 秒后淡出，3.2 秒后移除）。
   *
   * 为什么需要它：面板的「收起 / 隐藏」按钮效果是**整块内容消失**，
   * 用户第一反应是「坏了 / 我的东西没了」（2026-09-17 老板反馈）。
   * 这类「点了之后有东西不见了」的操作必须给一次明确的口头反馈 + 恢复路径，
   * 否则再合理的设计也会被当成 bug。
   */
  function toast(text) {
    if (!document.body) return null;
    const old = document.getElementById('jsa-toast');
    if (old) old.remove();               // 连点只保留最后一条，不堆叠
    const el = document.createElement('div');
    el.id = 'jsa-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('out'); }, 2600);
    setTimeout(() => { el.remove(); }, 3300);
    return el;
  }

  /**
   * 浮动控制面板
   * @param {Object} opts { settings, onTrackRatio, onRefreshSec, onToggle, onRefreshNow, stats }
   */
  function createPanel(opts) {
    const s = opts.settings;
    const box = document.createElement('div');
    box.id = 'jsa-panel';
    // 默认折叠（settings.panelCollapsed，默认 true）：
    // 用户反馈「一打开就弹出大面板挡表格太突兀、隐藏按钮难点击」，
    // 故首次只显示窄标题条，点击标题栏任意位置即可展开/收起，状态持久化。
    if (s.panelCollapsed !== false) box.classList.add('min');

    const hd = document.createElement('div');
    hd.className = 'jsa-hd';
    hd.innerHTML = '<span>套利增强 · 溢价计算</span>';
    const min = document.createElement('span');
    min.className = 'jsa-min';
    hd.appendChild(min);
    box.appendChild(hd);

    function syncMinBtn() {
      const collapsed = box.classList.contains('min');
      min.textContent = collapsed ? '+' : '–';
      min.title = collapsed ? '展开面板' : '收起面板';
    }
    function toggle() {
      box.classList.toggle('min');
      syncMinBtn();
      const collapsed = box.classList.contains('min');
      // 收起是「点了之后内容不见」，必须说一句；再点「+」即展开，不必反复提示
      if (collapsed) toast('面板已收起 · 点标题栏右侧「+」可再展开');
      // 折叠状态持久化（走 onToggle 通用通道，不触发重绘）
      opts.onToggle && opts.onToggle('panelCollapsed', collapsed);
    }
    syncMinBtn();

    const bd = document.createElement('div');
    bd.className = 'jsa-bd';

    // 跟踪比
    const r1 = document.createElement('div');
    r1.className = 'jsa-row';
    r1.innerHTML =
      '<label title="跟踪比 = 基金涨跌 ÷ 指数涨跌。1.00 表示紧跟指数；调大则推算净值随指数放大，调小则缩小。只影响 ○ 推算的净值与溢价，不影响 ● 交易所实时值。">跟踪比 ⓘ</label>';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0.5'; slider.max = '1.5'; slider.step = '0.05';
    slider.value = String(s.trackRatio);
    const val = document.createElement('span');
    val.className = 'jsa-val';
    val.textContent = Number(s.trackRatio).toFixed(2);
    slider.addEventListener('input', () => {
      val.textContent = Number(slider.value).toFixed(2);
    });
    slider.addEventListener('change', () => {
      opts.onTrackRatio && opts.onTrackRatio(parseFloat(slider.value));
    });
    r1.appendChild(slider);
    r1.appendChild(val);
    bd.appendChild(r1);

    // 刷新频率
    const r2 = document.createElement('div');
    r2.className = 'jsa-row';
    r2.innerHTML = '<label>刷新(秒)</label>';
    const sel = document.createElement('select');
    [10, 15, 30, 60, 0].forEach((v) => {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = v === 0 ? '关闭' : String(v);
      if (v === s.refreshSec) o.selected = true;
      sel.appendChild(o);
    });
    sel.className = 'jsa-btn';
    sel.addEventListener('change', () => {
      opts.onRefreshSec && opts.onRefreshSec(parseInt(sel.value, 10));
    });
    r2.appendChild(sel);
    const btnNow = document.createElement('button');
    btnNow.className = 'jsa-btn';
    btnNow.textContent = '立即刷新';
    btnNow.addEventListener('click', () => opts.onRefreshNow && opts.onRefreshNow());
    r2.appendChild(btnNow);
    bd.appendChild(r2);

    // 开关
    const r3 = document.createElement('div');
    r3.className = 'jsa-row';
    const sw2 = document.createElement('span');
    sw2.className = 'jsa-sw';
    const cbOn = document.createElement('input');
    cbOn.type = 'checkbox';
    cbOn.checked = !!s.enabled;
    cbOn.addEventListener('change', () => opts.onToggle && opts.onToggle('enabled', cbOn.checked));
    sw2.appendChild(cbOn);
    sw2.appendChild(document.createTextNode('启用增强'));
    r3.appendChild(sw2);
    bd.appendChild(r3);

    const meta = document.createElement('div');
    meta.className = 'jsa-meta';
    meta.innerHTML =
      '<b>净值来源三档</b>（悬停格子里有完整说明）<br>' +
      '· <b>●</b> 交易所 IOPV —— 官方每 15 秒发布的真实持仓估值<br>' +
      '· <b>◐</b> HaoETF 期货锚点 —— 跨境品种专用：T-1 估值 + <b>海外实时期货</b>，第三方估算，非官方<br>' +
      '· <b>○</b> 自算推算 —— 没上面两档时，用昨净值 × 指数涨幅 × 跟踪比<br>' +
      '<b>跟踪比 · 每只基金独立生效</b>（只影响 ○ 推算值，● 与 ◐ 不受它影响）<br>' +
      '取用优先级：<b>手动设定</b>（列表页点格子 / 详情页调） &gt; <b>历史回归</b>（详情页按近期「净值涨幅 ≈ k×指数涨幅」做过原点最小二乘，附 R² 拟合优度） &gt; <b>股票占比</b>（净值涨跌 ≈ 仓位 × 持仓涨幅，被动指数基金严格成立） &gt; <b>全局滑杆</b>（上面的 1.00，兜底默认）<br>' +
      '<b>含义</b>：跟踪比 = 基金当天实际涨跌 ÷ 指数当天涨跌。1.00 紧跟指数；&gt;1 比指数猛；&lt;1 比指数温和；≈0 不跟指数（○ 推算不可靠）<br>' +
      '<b>单只怎么调</b>：直接在列表页<b>点击该基金的「实时净值 / 实时溢价」格子</b>，就地拖动滑杆校准（只对这只生效）；也可进该基金详情页 → 「跟踪比」区块微调。<br>' +
      '<span id="jsa-stat">—</span>';
    bd.appendChild(meta);

    box.appendChild(bd);

    // 拖动 + 折叠交互（拖动与点击靠位移区分：移动 <5px 视为点击）
    // 交互规则（用户反馈「点一下就消失」）：
    //   · 折叠态 → 点击标题栏任意位置都可展开；
    //   · 展开态 → 只有「+ / –」按钮点击才收起，点在栏上其它位置不收起（避免误触）。
    (function draggable() {
      let dragging = false, moved = false, ox = 0, oy = 0, downX = 0, downY = 0;
      hd.addEventListener('mousedown', (e) => {
        dragging = true;
        moved = false;
        downX = e.clientX;
        downY = e.clientY;
        const r = box.getBoundingClientRect();
        ox = e.clientX - r.left;
        oy = e.clientY - r.top;
        box.style.right = 'auto';
        box.style.bottom = 'auto';
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 5) moved = true;
        box.style.left = e.clientX - ox + 'px';
        box.style.top = e.clientY - oy + 'px';
      });
      document.addEventListener('mouseup', () => { dragging = false; });
      // 折叠态：整栏点击展开
      hd.addEventListener('click', () => {
        if (!moved && box.classList.contains('min')) toggle();
      });
      // 展开态：仅「+ / –」按钮点击收起（阻止冒泡，避免与整栏点击重复触发）
      min.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!moved) toggle();
      });
    })();

    document.body.appendChild(box);

    return {
      el: box,
      setStat(t) {
        const n = box.querySelector('#jsa-stat');
        if (n) n.textContent = t;
      },
      destroy() { box.remove(); },
    };
  }

  /**
   * 单只基金跟踪比调整浮层（列表页点击「实时净值 / 实时溢价」格子弹出）。
   * 让用户在列表页就地校准某一只基金的跟踪比，不必为每只基金都点进详情页。
   *
   * @param {Object} o
   *   anchor      {HTMLElement} 触发格子（用于定位）
   *   code/name   {string}
   *   ratio       {number}   当前生效值
   *   ratioLabel  {string}   生效来源（手动设定 / 历史回归 / 股票占比 / 全局默认）
   *   manual      {boolean}  当前是否为手动设定（决定是否显示「恢复自动」）
   *   onApply(v)  {Function} 应用（写 overrides[code]）
   *   onClear()   {Function} 恢复自动（删 overrides[code]）
   */
  function openRatioEditor(o) {
    const old = document.getElementById('jsa-ratio-pop');
    if (old) old.remove();

    const el = document.createElement('div');
    el.id = 'jsa-ratio-pop';

    const hd = document.createElement('div');
    hd.className = 'jp-hd';
    const hdT = document.createElement('b');
    hdT.textContent = `${o.name || ''} ${o.code || ''}`.trim();
    const x = document.createElement('span');
    x.className = 'jp-x';
    x.textContent = '×';
    x.title = '关闭';
    hd.appendChild(hdT);
    hd.appendChild(x);
    el.appendChild(hd);

    const cur = document.createElement('div');
    cur.className = 'jp-cur';
    cur.innerHTML = `当前生效：<b>${Number(o.ratio).toFixed(2)}</b>（${o.ratioLabel || '—'}）<br>` +
      '只对本基金生效，优先级高于「历史回归 &gt; 股票占比 &gt; 全局滑杆」';
    el.appendChild(cur);

    const row = document.createElement('div');
    row.className = 'jp-row';
    const sl = document.createElement('input');
    sl.type = 'range';
    sl.min = '0.05'; sl.max = '1.5'; sl.step = '0.01';
    sl.value = String(o.ratio);
    const v = document.createElement('span');
    v.className = 'jp-v';
    v.textContent = Number(o.ratio).toFixed(2);
    sl.addEventListener('input', () => { v.textContent = Number(sl.value).toFixed(2); });
    row.appendChild(sl);
    row.appendChild(v);
    el.appendChild(row);

    const btns = document.createElement('div');
    btns.className = 'jp-btns';
    const bApply = document.createElement('button');
    bApply.className = 'jp-btn pri';
    bApply.textContent = '应用';
    const bClear = document.createElement('button');
    bClear.className = 'jp-btn';
    bClear.textContent = '恢复自动';
    const bClose = document.createElement('button');
    bClose.className = 'jp-btn';
    bClose.textContent = '关闭';
    btns.appendChild(bApply);
    if (o.manual) btns.appendChild(bClear);
    btns.appendChild(bClose);
    el.appendChild(btns);

    const tipEl = document.createElement('div');
    tipEl.className = 'jp-tip';
    tipEl.textContent = '跟踪比 = 基金涨跌 ÷ 指数涨跌。只影响 ○ 自算档的净值与溢价，● 交易所值 / ◐ 期货锚点不受影响。';
    el.appendChild(tipEl);

    document.body.appendChild(el);

    // 定位到格子旁边，并夹在视口内
    const a = o.anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = a.left - w - 10;
    if (left < 8) left = a.right + 10;
    left = Math.min(left, window.innerWidth - w - 8);
    let top = a.top;
    if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
    el.style.left = Math.max(8, left) + 'px';
    el.style.top = Math.max(8, top) + 'px';

    function close() {
      el.remove();
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
    }
    function onDoc(e) { if (!el.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    // 延迟挂载：避免触发本次点击的 mousedown 立即把它关掉
    setTimeout(() => {
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);

    x.addEventListener('click', close);
    bClose.addEventListener('click', close);
    bApply.addEventListener('click', async () => {
      const val = parseFloat(sl.value);
      close();
      try { await o.onApply(val); } catch (e) { /* 由调用方兜底 */ }
    });
    bClear.addEventListener('click', async () => {
      close();
      try { await o.onClear(); } catch (e) { /* 由调用方兜底 */ }
    });
    return el;
  }

  global.JsaUI = { tip, toast, createPanel, openRatioEditor };
})(typeof window !== 'undefined' ? window : globalThis);
