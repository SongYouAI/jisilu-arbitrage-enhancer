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
   * 浮动控制面板
   * @param {Object} opts { settings, onTrackRatio, onRefreshSec, onToggle, onRefreshNow, stats }
   */
  function createPanel(opts) {
    const s = opts.settings;
    const box = document.createElement('div');
    box.id = 'jsa-panel';

    const hd = document.createElement('div');
    hd.className = 'jsa-hd';
    hd.innerHTML = '<span>套利增强 · 溢价计算</span>';
    const min = document.createElement('span');
    min.className = 'jsa-min';
    min.textContent = '–';
    min.title = '折叠/展开';
    hd.appendChild(min);
    box.appendChild(hd);

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
      '<b>跟踪比</b> —— 只影响 ○ 推算值，● 与 ◐ 永远不受它影响<br>' +
      '<b>原理</b>：推算净值 = 昨官方净值 × (1 + 指数涨幅 × 跟踪比)<br>' +
      '<b>含义</b>：跟踪比 = 基金当天实际涨跌 ÷ 指数当天涨跌，衡量这只基金跟指数跟得紧不紧：<br>' +
      '· <b>1.00</b> 完全紧跟指数（默认，拿不准就用它）<br>' +
      '· <b>&gt;1</b>（如 1.2）基金比指数波动更猛：含杠杆、增强策略、持仓集中<br>' +
      '· <b>&lt;1</b>（如 0.8）涨跌都比指数温和：仓位不满、现金拖累<br>' +
      '· <b>≈0 或负</b> 基本不跟指数走（货币/债券型），○ 推算不可靠<br>' +
      '<b>怎么调</b>：若推算溢价连续几天和实际对不上，去该基金详情页看「历史跟踪比」均值，把滑杆调到那个值即可校准。<br>' +
      '<span id="jsa-stat">—</span>';
    bd.appendChild(meta);

    box.appendChild(bd);
    min.addEventListener('click', () => box.classList.toggle('min'));

    // 拖动
    (function draggable() {
      let dragging = false, ox = 0, oy = 0;
      hd.addEventListener('mousedown', (e) => {
        if (e.target === min) return;
        dragging = true;
        const r = box.getBoundingClientRect();
        ox = e.clientX - r.left;
        oy = e.clientY - r.top;
        box.style.right = 'auto';
        box.style.bottom = 'auto';
        e.preventDefault();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        box.style.left = e.clientX - ox + 'px';
        box.style.top = e.clientY - oy + 'px';
      });
      document.addEventListener('mouseup', () => { dragging = false; });
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

  global.JsaUI = { tip, createPanel };
})(typeof window !== 'undefined' ? window : globalThis);
