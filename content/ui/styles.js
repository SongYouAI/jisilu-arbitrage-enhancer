/**
 * 注入样式（Analytics Blue：深蓝 + 琥珀金 + 冷灰）
 * 该文件由 content/ui/styles.css 生成，请勿直接编辑 —— 见 tools/gen-styles-js.js
 */
(function () {
  'use strict';
  const CSS = `
:root{
  --jsa-up:#d93025;
  --jsa-down:#0f9960;
  --jsa-flat:#64748b;
  --jsa-navy:#0b1b34;
  --jsa-amber:#f5b64a;
}
/* 冻结左侧代码/名称列：横向滚动时始终可见（背景色由 JS 按行色写入，保证不透明） */
td.jsa-sticky, th.jsa-sticky{
  position: sticky !important;
  z-index: 3 !important;
}
/* 注入列表头：深蓝底 + 琥珀金，与原生区分 */
table th.jsa-th{
  background:var(--jsa-navy) !important;
  color:var(--jsa-amber) !important;
  font-weight:600 !important;
  border-left:1px solid rgba(245,182,74,.35) !important;
}
table td.jsa-td{ font-variant-numeric:tabular-nums; }
/* 溢价数字 */
.jsa-prem{ font-weight:600; }
.jsa-badge{
  display:inline-block; margin-left:3px; font-size:10px; line-height:1;
  vertical-align:1px; opacity:.85;
}
/* 浮动控制面板 */
#jsa-panel{
  position:fixed; right:18px; bottom:18px; z-index:2147483000;
  width:268px; background:#fff; border:1px solid #e2e8f0; border-radius:12px;
  box-shadow:0 10px 34px rgba(11,27,52,.18); font-size:13px; color:#334155;
  font-family:"PingFang SC","Microsoft YaHei",-apple-system,sans-serif;
}
#jsa-panel .jsa-hd{
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:11px 14px; background:var(--jsa-navy); color:var(--jsa-amber);
  border-radius:12px 12px 0 0; font-weight:600; font-size:13px; cursor:move;
}
#jsa-panel .jsa-hd .jsa-min{ cursor:pointer; opacity:.85; font-size:15px; line-height:1; }
#jsa-panel .jsa-bd{ padding:12px 14px 14px; }
#jsa-panel.min .jsa-bd{ display:none; }
#jsa-panel .jsa-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; }
#jsa-panel .jsa-row label{ flex:0 0 auto; color:#64748b; }
#jsa-panel .jsa-val{ font-variant-numeric:tabular-nums; color:var(--jsa-navy); font-weight:600; min-width:38px; text-align:right; }
#jsa-panel input[type=range]{ flex:1; accent-color:var(--jsa-amber); }
#jsa-panel .jsa-sw{ display:flex; align-items:center; gap:6px; }
#jsa-panel input[type=checkbox]{ accent-color:var(--jsa-navy); }
#jsa-panel .jsa-meta{ font-size:11.5px; color:#94a3b8; line-height:1.6; border-top:1px dashed #e2e8f0; padding-top:9px; margin-top:2px; }
#jsa-panel .jsa-btn{
  border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px; padding:3px 9px;
  font-size:12px; cursor:pointer; color:#334155;
}
#jsa-panel .jsa-btn:hover{ background:#eef2f7; }
#jsa-panel .jsa-tag{
  display:inline-block; padding:1px 6px; border-radius:4px; font-size:11px;
  background:#eef2f7; color:#475569; margin-right:4px;
}
/* 悬停提示：加宽到 500px + 限高滚动，超长内容（溢价原理+套利建议）也能看全 */
#jsa-tip{
  position:fixed; z-index:2147483001; max-width:500px; max-height:calc(100vh - 16px);
  overflow-y:auto; background:#0b1b34; color:#e2e8f0;
  border:1px solid #1d3f68; border-radius:8px; padding:9px 12px; font-size:12px; line-height:1.75;
  white-space:pre-wrap; overflow-wrap:break-word; box-shadow:0 8px 24px rgba(0,0,0,.3);
  pointer-events:none; display:none;
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;
}
/* 详情页面板 */
.jsa-detail-card{
  margin:16px 0; background:#fff; border:1px solid #e2e8f0; border-left:4px solid var(--jsa-amber);
  border-radius:10px; box-shadow:0 2px 12px rgba(11,27,52,.06);
  font-family:"PingFang SC","Microsoft YaHei",sans-serif; color:#334155; font-size:13px;
}
.jsa-detail-card .jsa-dc-hd{
  background:var(--jsa-navy); color:var(--jsa-amber); padding:10px 16px;
  border-radius:6px 6px 0 0; font-weight:600; display:flex; justify-content:space-between; align-items:center;
}
.jsa-detail-card .jsa-dc-bd{ padding:14px 16px; }
.jsa-detail-card table{ width:100%; border-collapse:collapse; font-size:12.5px; }
.jsa-detail-card th{ background:#f1f5f9; color:#475569; text-align:left; padding:6px 8px; font-weight:600; }
.jsa-detail-card td{ padding:5px 8px; border-top:1px solid #eef2f7; font-variant-numeric:tabular-nums; }
.jsa-kv{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:14px; }
.jsa-kv > div{ background:#f8fafc; border:1px solid #eef2f7; border-radius:8px; padding:9px 12px; }
.jsa-kv .k{ font-size:11.5px; color:#94a3b8; }
.jsa-kv .v{ font-size:17px; font-weight:700; color:var(--jsa-navy); font-variant-numeric:tabular-nums; }
.jsa-note{ font-size:11.5px; color:#94a3b8; line-height:1.7; margin-top:10px; }
.jsa-warn{ color:#b45309; }
`;
  const id = 'jsa-injected-css';
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
})();
