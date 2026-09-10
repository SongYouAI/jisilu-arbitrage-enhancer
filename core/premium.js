/**
 * 溢价率双轨计算
 *
 * 轨道 A（真值）：有 IOPV 的品种，直接用交易所发布的实时净值估值
 *   溢价率 = (现价 − IOPV) / IOPV
 *
 * 轨道 B（估算）：无 IOPV 的品种（多为 QDII，净值 T-2 滞后）
 *   估算净值 = 最新净值 × (1 + 参考涨幅 × 跟踪比)
 *   溢价率   = (现价 − 估算净值) / 估算净值
 *
 * 采用规则：IOPV > 0 用轨道 A，否则轨道 B；两轨道都算出来用于交叉显示。
 */
(function (global) {
  'use strict';

  const F = global.JsaFormat;

  /**
   * @param {Object} row 行数据
   *   code, name, price, nav, navDate, refIncreaseRt(百分数), iopv, iopvPremium
   * @param {Object} opts { trackRatio: number, fxAdjust: number(百分数,可选) }
   */
  function compute(row, opts) {
    const ratio = opts && typeof opts.trackRatio === 'number' ? opts.trackRatio : 1;
    const fx = opts && typeof opts.fxAdjust === 'number' ? opts.fxAdjust : 0;

    const price = F.number(row.price);
    const nav = F.number(row.nav);
    const refInc = F.number(row.refIncreaseRt); // 百分数，如 -1.56
    const iopv = F.number(row.iopv);
    const haoNav = F.number(row.haoEtfNav);     // HaoETF 期货锚点实时估值（第三方估算）

    const out = {
      price,
      nav,
      navDate: row.navDate || '',
      navLagDays: F.daysAgo(row.navDate),
      refInc,
      iopv,
      haoNav,
      trackRatio: ratio,
      estNav: null,
      realPremium: null,   // 轨道 A：交易所 IOPV
      haoPremium: null,    // 轨道 A2：HaoETF 期货锚点估值
      estPremium: null,    // 轨道 B：跟踪比自算
      staticPremium: F.number(row.tencentPremium), // 腾讯按「净值/IOPV」算的静态溢价
      premium: null,       // 最终采用
      source: 'NONE',
      reason: '',
    };

    // —— 轨道 A：真实 IOPV ——
    if (iopv !== null && iopv > 0 && price !== null) {
      out.realPremium = ((price - iopv) / iopv) * 100;
      out.premium = out.realPremium;
      out.source = 'IOPV';
      out.reason = `IOPV 实时净值估值 ${iopv}（交易所 15 秒刷新）`;
    }

    // —— 轨道 A2：HaoETF 期货锚点估值 ——
    // 跨境品种在 A 股盘中海外休市，用「A 股现货指数 × 跟踪比」推算在方法论上就是错的，
    // 正确锚点是海外期货。此源给的是「T-1 估值 + 实时期货」，属第三方估算，非交易所官方值。
    if (out.source !== 'IOPV' && haoNav !== null && haoNav > 0 && price !== null) {
      out.haoPremium = ((price - haoNav) / haoNav) * 100;
      out.premium = out.haoPremium;
      out.source = 'HAOETF';
      out.reason = `HaoETF 实时估值 ${haoNav}（T-1 估值 + 实时期货，第三方估算）`;
    }

    // —— 轨道 B：跟踪比估算 ——
    // 无参考涨幅时（如货币 ETF 页面不给指数涨幅）降级为「官方净值直接比价」，
    // 效果等价于按昨净值算的静态溢价，仍诚实标注为 ○。
    // 仅在 A / A2 都拿不到时使用。
    if (nav !== null && nav > 0 && price !== null) {
      const inc = refInc === null ? 0 : refInc;
      const growth = (inc / 100) * ratio + fx / 100;
      out.estNav = nav * (1 + growth);
      out.estPremium = out.estNav > 0 ? ((price - out.estNav) / out.estNav) * 100 : null;
      if (out.source !== 'IOPV' && out.source !== 'HAOETF') {
        out.premium = out.estPremium;
        out.source = refInc === null ? 'NAV' : 'EST';
        out.reason = refInc === null
          ? `无参考涨幅，直接用官方净值 ${nav}（${out.navDate || '日期不详'}）比价，未修正今日涨跌`
          : `估算净值 ${out.estNav.toFixed(4)} = 净值 ${nav} × (1 + ${refInc}% × ${ratio}${fx ? ` + 汇率${fx}%` : ''})`;
      }
    }

    if (out.premium === null) {
      out.reason = row.nav ? '缺少净值数据' : '页面未提供净值数据';
    }
    return out;
  }

  /**
   * 数据来源的三级标记（唯一真相源，列表页与悬停都从这里取，防止两处漂移）
   *   ●  IOPV     —— 交易所官方实时净值估值
   *   ◐  HAOETF   —— HaoETF 期货锚点实时估值（第三方估算）
   *   ○  EST/NAV  —— 本插件自算推算 / 官方净值静态比价
   */
  const MARKS = { IOPV: '●', HAOETF: '◐', EST: '○', NAV: '○', NONE: '' };
  const LABELS = {
    IOPV: '● 交易所官方',
    HAOETF: '◐ 期货锚点·第三方估算',
    EST: '○ 自算估算',
    NAV: '○ 静态比价（未修正今日涨跌）',
    NONE: '无数据',
  };
  function markOf(source) { return MARKS[source] || ''; }
  function labelOf(source) { return LABELS[source] || LABELS.NONE; }

  /**
   * 第二列「实时净值」取哪个值，三级降级：
   *   IOPV（交易所官方） > HAOETF（期货锚点，第三方估算） > EST/NAV（自算推算/静态）
   * @returns {{value:number|null, source:'IOPV'|'HAOETF'|'EST'|'NAV'|'NONE'}}
   */
  function pickNav(res) {
    if (res.iopv !== null && res.iopv > 0) return { value: res.iopv, source: 'IOPV' };
    if (res.haoNav !== null && res.haoNav > 0) return { value: res.haoNav, source: 'HAOETF' };
    if (res.estNav !== null && res.estNav > 0) return { value: res.estNav, source: res.source === 'NAV' ? 'NAV' : 'EST' };
    if (res.nav !== null && res.nav > 0) return { value: res.nav, source: 'NAV' };
    return { value: null, source: 'NONE' };
  }

  /**
   * 折溢价套利建议（诚实分层：机构能做什么 / 你能做什么 / 什么情况下别碰）
   */
  function advice(res, row) {
    const p = res.premium;
    const out = [];
    if (p === null || !isFinite(p)) {
      out.push('🎯 套利建议');
      out.push('数据不足，无法给出建议');
      return out;
    }
    const a = Math.abs(p);
    const st = (row && row.applyStatus) || '';
    const blocked = /限|停|暂|额|封闭/.test(st);

    out.push('🎯 套利建议');
    if (a < 1) {
      out.push(`溢价 ${F.pct(p)}，在 ±1% 正常波动内，没有明显套利空间，按正常价格买卖即可。`);
      out.push('（套利至少要覆盖申购/赎回费 + 买卖佣金 + 两天净值波动，1% 以内基本白干。）');
    } else if (p > 0) {
      out.push(`⚠️ 溢价 ${p.toFixed(2)}%：现在买入，每 100 元要多付 ${p.toFixed(2)} 元。`);
      out.push('机构做法：买一篮子成分股 → 申购成基金 → 场内卖出，把这个差价赚走。');
      out.push('你做不了：申购门槛通常 30 万~100 万份起，还要 T+2 才能卖出。');
      out.push('✅ 你能做的：① 别在这个价位买，等回落到 1% 以内；② 手里有货的可以趁高溢价先卖。');
    } else {
      out.push(`💰 折价 ${a.toFixed(2)}%：现在买入，每 100 元省 ${a.toFixed(2)} 元。`);
      out.push('机构做法：场内买入 → 赎回换回一篮子股票 → 卖出，赚这个差价。同样百万门槛 + T+2。');
      out.push('✅ 你能做的：折价买入确实占便宜，但要先扣掉赎回费和两天净值波动；');
      out.push('折价品种往往流动性差，买卖价差会把利润吃掉。');
    }
    if (blocked) {
      out.push(`🚫 该基金申购状态「${st}」—— 套利资金进不来，高溢价可能长期不回落，别赌它收敛。`);
    }
    out.push('⚠️ 只讲原理与风险，不构成投资建议；溢价只在交易时段更新，盘后是收盘值。');
    return out;
  }

  /**
   * 白话解读溢价：告诉我贵还是便宜、意味着什么
   */
  function decode(p) {
    if (p === null || !isFinite(p)) return '';
    const a = Math.abs(p);
    if (a < 0.3) return `📌 解读：市价与基金实际价值基本贴合（差 ${a.toFixed(2)}%），无套利空间。`;
    if (p > 0) {
      return `📌 解读：市价比基金实际价值贵 ${p.toFixed(2)}% —— 买入要额外付 ${a.toFixed(2)}% 的溢价；已持有则卖出划算。`;
    }
    return `📌 解读：市价比基金实际价值便宜 ${a.toFixed(2)}% —— 相当于打折买入，是套利玩家关注的折价机会。`;
  }

  /** 第二列「实时净值」悬停：这数从哪来、怎么算的、为什么有的基金没有 */
  function tooltipNav(res, row) {
    const L = [];
    const nav = pickNav(res);
    L.push(`【${row.name || ''} ${row.code || ''}】`);
    L.push('');
    L.push(`现价：${res.price === null ? '—' : res.price} 元`);
    if (nav.source === 'IOPV') {
      L.push(`实时净值（IOPV）：${nav.value}　● 交易所官方`);
      L.push('');
      L.push('🧮 它到底怎么算出来的？');
      L.push('IOPV =（Σ 成分股数量 × 最新价 + 现金差额）÷ 基金总份额');
      L.push('① 基金公司每天公布「申赎篮子」：每只成分股多少股 + 现金差额多少');
      L.push('② 交易所拿这些股票的实时成交价加权求和，再加上现金');
      L.push('③ 除以总份额，每 15 秒重算一次');
      L.push(`→ 交易所算好直接发布（官方数据，不是插件算的），插件只读结果：${nav.value}`);
      L.push('（篮子明细只有交易所和基金公司有，免费拿不到，不再硬展开）');
      L.push('');
      L.push('⏱ 只在交易时段更新，盘后看到的是收盘值');
      if (res.price !== null && res.price > 0) {
        const diff = res.price - nav.value;
        const word = diff >= 0 ? '多付' : '便宜';
        L.push('');
        L.push('💡 顺手算笔账');
        L.push(`每份比净值${word}：${res.price} − ${nav.value} = ${Math.abs(diff).toFixed(4)} 元`);
        L.push(`买 1 万元：${word} ${Math.abs(diff / res.price * 10000).toFixed(0)} 元`);
      }
    } else if (nav.source === 'HAOETF') {
      L.push(`实时估值：${nav.value}　◐ 期货锚点（第三方估算）`);
      L.push('');
      L.push('💡 这个数是怎么来的？');
      L.push('跨境基金在 A 股盘中，海外市场是休市的 —— 海外股票根本不交易。');
      L.push('所以「A 股现货指数 × 跟踪比」这种推算，方法论上就是错的。');
      L.push('正确做法是看**海外期货**：期货几乎 24 小时交易，能提前反映海外开盘后的走势。');
      L.push('');
      L.push('🧮 数据提供方的算法（HaoETF 公开说明）：');
      L.push('　最新估值 = T-2 日净值 + 跟踪指数（T-1 日）');
      L.push('　实时估值 = 最新估值 + 实时期货（道指 / 纳指100 / 标普500 / 原油 / 黄金）');
      L.push('　仓位用移动平均法估算，净值涨跌超 1% 时重新估算');
      L.push(`→ 插件只负责取回这个数：${nav.value}`);
      L.push('');
      L.push('⚠️ 诚实声明：这是第三方站点的自行估算，不是交易所官方数据，');
      L.push('也不等于基金公司公布的净值。它的优点是锚点正确（期货），');
      L.push('缺点是仓位靠估算、跟踪指数可能有偏差。请当「参考值」用，别当承诺。');
      if (res.price !== null && res.price > 0) {
        const diff = res.price - nav.value;
        const word = diff >= 0 ? '多付' : '便宜';
        L.push('');
        L.push('💡 顺手算笔账');
        L.push(`每份比实时估值${word}：${res.price} − ${nav.value} = ${Math.abs(diff).toFixed(4)} 元`);
        L.push(`买 1 万元：${word} ${Math.abs(diff / res.price * 10000).toFixed(0)} 元`);
      }
      if (res.estNav !== null) {
        L.push('');
        L.push(`对照·本插件自算推算：${res.estNav.toFixed(4)}（按 ${res.navDate || '—'} 净值 × 指数涨幅 × 跟踪比），`);
        L.push('两者接近说明口径一致；相差大时优先信期货锚点这个。');
      }
    } else if (nav.value !== null) {
      L.push(`推算净值：${nav.value.toFixed(4)}　○ 估算`);
      L.push('');
      L.push('💡 为什么这只没有 IOPV？');
      L.push('ETF 是实物申赎：基金公司每天公开「申赎篮子」，交易所能按实时股价算出净值。');
      L.push('LOF / QDII 是现金申赎：没有公开的实时篮子，持仓只在季报露面 —— 交易所算不出来。');
      L.push('所以这类基金只能靠推算，我会诚实标成 ○ 并标灰。');
      L.push('');
      L.push('🧮 怎么推算的？');
      if (res.source === 'NAV') {
        L.push(`页面没有提供参考涨幅，直接用最新官方净值 ${res.nav}（${res.navDate || '日期不详'}）比价，`);
        L.push('未修正今天的涨跌 —— 效果等同于集思录自带的静态口径。');
      } else {
        L.push(`官方净值 ${res.nav}（${res.navDate || '日期不详'}${res.navLagDays !== null ? `，滞后 ${res.navLagDays} 天` : ''}）`);
        L.push(`×（1 + 今日参考涨幅 ${res.refInc === null ? '—' : res.refInc + '%'} × 跟踪比 ${res.trackRatio}）`);
        L.push(`= ${res.estNav.toFixed(4)}`);
      }
      L.push('');
      L.push('⚠️ 这是估算：跟踪误差、停牌股、仓位偏离都会带来偏差。跟踪比可在右下面板调节。');
    } else {
      L.push('净值：—');
      L.push('');
      L.push(res.reason || '暂无净值数据');
    }
    return L.join('\n');
  }

  /** 第三列「实时溢价」悬停：怎么算的 + 解读 + 套利建议 */
  function tooltipPremium(res, row) {
    const L = [];
    const nav = pickNav(res);
    const navTxt = nav.value === null ? '—' : (nav.source === 'IOPV' ? String(nav.value) : nav.value.toFixed(4));
    L.push(`【${row.name || ''} ${row.code || ''}】`);
    L.push('');
    L.push(`现价：${res.price === null ? '—' : res.price} 元`);
    if (nav.value !== null) {
      if (nav.source === 'IOPV') L.push(`实时净值（IOPV）：${navTxt}　● 交易所官方`);
      else if (nav.source === 'HAOETF') L.push(`实时估值：${navTxt}　◐ 期货锚点（第三方估算）`);
      else L.push(`推算净值：${navTxt}　○ 自算估算（由 ${res.navDate || '—'} 官方净值推算）`);
    }
    L.push(`溢价率：${F.pct(res.premium)}（${labelOf(nav.source)}）`);
    L.push('');
    L.push('🧮 怎么算的？');
    if (nav.value !== null && res.price !== null) {
      L.push(`(${res.price} − ${navTxt}) ÷ ${navTxt} = ${F.pct(res.premium)}`);
    } else {
      L.push(res.reason || '—');
    }
    L.push('');
    L.push('📖 为什么会有溢价？（原理）');
    L.push('同一只基金同时存在两个价格：');
    L.push('　① 场内市价 —— 由买卖供需决定（你在盘口看到的价）');
    L.push('　② 基金净值 —— 由持仓股票决定（它实际值多少）');
    L.push('两边由不同的人、在不同的市场定价，必然出现偏差，这个偏差就是折溢价。');
    L.push('');
    L.push('谁把它拉回来？套利者。');
    L.push('溢价高时：买一篮子成分股 → 申购成基金 → 场内卖出，供给变多，价格被压回净值附近；折价时反向操作。');
    L.push('什么时候拉不回来？限购 / 暂停申购 —— 套利通道被堵死，溢价可以长期挂着不回落（纳指 ETF 常年 10%+ 溢价就是这么来的）。');
    L.push('所以溢价不只是「贵了」，它同时是「申赎通道是否通畅」+「场内情绪有多热」的温度计。');
    L.push('');
    L.push(decode(res.premium));
    L.push('');
    advice(res, row).forEach((s) => L.push(s));
    if (row.pagePremium !== null && row.pagePremium !== undefined) {
      L.push('');
      L.push(`❓ 和集思录自带的「净值溢价率」${F.pct(row.pagePremium)} 怎么不一样？`);
      L.push('集思录拿昨天的官方净值直接比价（静态），把今天的指数涨跌也混算成了折溢价；');
      L.push('本列先把今天的涨跌修正掉再比价。两者之差 ≈ 今日跟踪指数涨跌。');
    }
    return L.join('\n');
  }

  global.JsaPremium = {
    compute,
    tooltip: tooltipPremium,
    tooltipNav,
    tooltipPremium,
    advice,
    pickNav,
    markOf,
    labelOf,
    decode,
  };
})(typeof window !== 'undefined' ? window : globalThis);
