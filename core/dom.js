/**
 * 集思录列表页 DOM 适配层
 *
 * 三个列表页（/data/qdii/、/data/lof/、/data/etf/）结构同构：
 *   - 单个 <table class="tablesorter">，table-layout: auto，无 colgroup
 *   - <tbody><tr id="161127"> 行 id 即基金代码
 *   - 每个 <td data-name="fund_id"> 带统一字段名
 *
 * 因此不写死 table id，而是自适应查找「含 6 位数字 id 的数据行」的表格。
 */
(function (global) {
  'use strict';

  const F = global.JsaFormat;
  const MARK = 'data-jsa-col';

  /** 找出页面上所有数据表 */
  function findTables() {
    const all = Array.from(document.querySelectorAll('table'));
    return all.filter((t) => {
      const tb = t.querySelector('tbody');
      if (!tb) return false;
      const tr = tb.querySelector('tr[id]');
      return tr && /^\d{6}$/.test(tr.id);
    });
  }

  /** 判断单元格是否为「需登录」占位 */
  function isLocked(td) {
    if (!td) return true;
    const txt = (td.textContent || '').trim();
    if (!txt || txt === '-' || txt === '--') return true;
    if (txt === '登录' || txt === '会员') return true;
    if (td.querySelector('a[href*="/login/"]')) return true;
    return false;
  }

  function cellText(tr, name) {
    const td = tr.querySelector(`td[data-name="${name}"]`);
    if (!td) return null;
    if (isLocked(td)) return null;
    return (td.textContent || '').trim();
  }

  /** 净值日期：优先 data-sortvalue（完整日期），否则解析文本 */
  function navDateOf(tr) {
    const td = tr.querySelector('td[data-name="nav_dt_s"]') || tr.querySelector('td[data-name="nav_dt"]');
    if (!td) return '';
    const sv = td.getAttribute('data-sortvalue');
    if (sv && /^\d{4}-\d{2}-\d{2}$/.test(sv)) return sv;
    let txt = (td.textContent || '').trim();
    if (!txt) return '';
    let m = txt.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    m = txt.match(/^(\d{2})-(\d{2})$/);
    if (m) return `${new Date().getFullYear()}-${m[1]}-${m[2]}`;
    return txt;
  }

  /** 提取一行的结构化数据 */
  function extractRow(tr) {
    const code = tr.id && /^\d{6}$/.test(tr.id) ? tr.id : (cellText(tr, 'fund_id') || '').trim();
    if (!code) return null;
    const name = cellText(tr, 'fund_nm_color') || cellText(tr, 'fund_nm') || '';
    return {
      tr,
      code,
      name,
      price: F.number(cellText(tr, 'price')),
      increaseRt: F.number(cellText(tr, 'increase_rt')),
      nav: F.number(cellText(tr, 'fund_nav')),
      navDate: navDateOf(tr),
      // QDII 页用 ref_increase_rt，ETF 页用 index_increase_rt，LOF 页用 stock_increase_rt（十大持仓涨幅）
      refIncreaseRt: F.number(cellText(tr, 'ref_increase_rt')) ??
        F.number(cellText(tr, 'index_increase_rt')) ??
        F.number(cellText(tr, 'stock_increase_rt')),
      pageIopv: F.number(cellText(tr, 'iopv')),
      // 统一出口：页面 IOPV（登录可见）作为 merged.iopv 的兜底来源
      iopv: F.number(cellText(tr, 'iopv')),
      pagePremium: F.number(cellText(tr, 'iopv_discount_rt')) ?? F.number(cellText(tr, 'nav_discount_rt')),
      indexName: cellText(tr, 'index_nm') || '',
      applyStatus: cellText(tr, 'apply_status') || '',
      redeemStatus: cellText(tr, 'redeem_status') || '',
      volume: F.number(cellText(tr, 'volume')),
    };
  }

  /** 提取一个表的所有行 */
  function extractRows(table) {
    const rows = [];
    const trs = table.querySelectorAll('tbody > tr');
    trs.forEach((tr) => {
      const r = extractRow(tr);
      if (r) rows.push(r);
    });
    return rows;
  }

  /** 删除本插件此前注入的所有节点（guard：先删后加） */
  function clearInjected(root) {
    const scope = root || document;
    scope.querySelectorAll(`[${MARK}]`).forEach((n) => n.remove());
  }

  /**
   * 幂等注入列（先删后加）
   * @param {HTMLTableElement} table
   * @param {Array} cols [{ key, title, width, tooltip, render(row, ctx) -> HTMLElement|string }]
   * @param {Object} ctx 渲染上下文（行情、设置、自选等）
   */
  function injectColumns(table, cols, ctx) {
    clearInjected(table);

    // —— 表头 ——
    // tablesorter 可能生成克隆表头（fixedtableheader），需对所有匹配表头同步
    const headerRows = [];
    const thead = table.querySelector('thead');
    if (thead) headerRows.push(thead.querySelector('tr:last-child'));
    // 页面级克隆表头（若有）
    document.querySelectorAll('.fixedtableheader_clone, .tablesorter-clone, table.fixedtableheader').forEach((t) => {
      if (t === table) return;
      const h = t.querySelector('thead tr:last-child');
      if (h && h.querySelector(`th[data-name="fund_id"], th[data-name="fund_nm"], th[data-name="fund_nm_color"]`)) {
        headerRows.push(h);
      }
    });

    headerRows.filter(Boolean).forEach((htr) => {
      cols.forEach((c) => {
        const th = document.createElement('th');
        th.setAttribute(MARK, c.key);
        th.className = 'header jsa-th';
        th.style.cssText = `width:${c.width || 70}px;white-space:nowrap;text-align:right;background:#0b1b34;color:#f5b64a;`;
        th.textContent = c.title;
        if (c.tooltip) th.title = c.tooltip;
        htr.appendChild(th);
      });
    });

    // —— 表体 ——
    const rows = extractRows(table);
    rows.forEach((row) => {
      cols.forEach((c) => {
        const td = document.createElement('td');
        td.setAttribute(MARK, c.key);
        td.className = 'jsa-td';
        td.style.cssText = `white-space:nowrap;text-align:right;`;
        try {
          const v = c.render(row, ctx);
          if (typeof v === 'string') td.innerHTML = v;
          else if (v && v.nodeType) td.appendChild(v);
          else td.textContent = '—';
        } catch (e) {
          td.textContent = '—';
        }
        row.tr.appendChild(td);
      });
    });
    return rows.length;
  }

  /**
   * 参考涨幅候选字段（按优先级）。
   * 集思录各板块字段名不同：LOF 页写「重仓涨幅」，QDII 页写「T-1指数涨幅」，
   * ETF 页写「指数涨幅 / 参考涨幅」。漏配会直接导致溢价方向判反，故逐一覆盖。
   */
  const REF_PATTERNS = [
    ['重仓涨幅', /重仓(?:股)?涨幅[^\d\-+]{0,10}([\-+]?\d+\.?\d*)\s*%/],
    ['T-1指数涨幅', /T-1\s*指数涨幅[^\d\-+]{0,10}([\-+]?\d+\.?\d*)\s*%/],
    // 上一条已优先命中带 T-1 前缀的，此条不会误吃
    ['指数涨幅', /指数涨幅[^\d\-+]{0,10}([\-+]?\d+\.?\d*)\s*%/],
    ['参考涨幅', /参考涨幅[^\d\-+]{0,10}([\-+]?\d+\.?\d*)\s*%/],
  ];

  /** 从页面文本提取参考涨幅，返回 { value:number|null, label:string } */
  function pickRefIncrease(text) {
    const t = text || '';
    for (let i = 0; i < REF_PATTERNS.length; i++) {
      const m = t.match(REF_PATTERNS[i][1]);
      if (m) {
        const v = parseFloat(m[1]);
        if (isFinite(v)) return { value: v, label: REF_PATTERNS[i][0] };
      }
    }
    return { value: null, label: '' };
  }

  global.JsaDom = { findTables, extractRow, extractRows, injectColumns, clearInjected, cellText, isLocked, pickRefIncrease, MARK };
})(typeof window !== 'undefined' ? window : globalThis);
