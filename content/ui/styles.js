/**
 * 注入样式（Analytics Blue：深蓝 + 琥珀金 + 冷灰）
 * 样式以 JS 字符串内联注入（本仓库无 styles.css / 生成器），直接编辑本文件即可。
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
  user-select:none; -webkit-user-select:none;
}
/* 折叠/展开按钮：加大点击热区，原来只是个小字符很难点中 */
#jsa-panel .jsa-hd .jsa-min{
  display:inline-flex; align-items:center; justify-content:center;
  width:22px; height:22px; flex:0 0 22px;
  border:1px solid rgba(245,182,74,.55); border-radius:6px;
  cursor:pointer; font-size:15px; line-height:1; opacity:.95;
}
#jsa-panel .jsa-hd .jsa-min:hover{ background:rgba(245,182,74,.15); }
#jsa-panel .jsa-bd{ padding:12px 14px 14px; }
/* 折叠态：收成一条窄标题栏，圆角补全，不再遮挡大片表格 */
#jsa-panel.min{ width:210px; }
#jsa-panel.min .jsa-hd{ border-radius:12px; padding:8px 12px; }
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

/* —— 详情页面板：悬浮态限高 + 内部滚动（用户反馈底部看不到） —— */
/* 面板固定在视口右侧时，内容一旦长于视口，底部会被裁掉；这里给上限高与内部滚动条。 */
.jsa-detail-card.jsa-dc-fixed{
  position:fixed; right:18px; top:70px; width:348px; z-index:2147483000;
  margin:0; display:flex; flex-direction:column; max-height:calc(100vh - 92px);
  box-shadow:0 12px 34px rgba(11,27,52,.20);
}
.jsa-detail-card.jsa-dc-fixed .jsa-dc-bd{ overflow:auto; flex:1 1 auto; }
/* 标题栏按钮：收起(−/+) 与 隐藏(×)，热区加大到 20×20 */
.jsa-detail-card .jsa-dc-hd{ gap:8px; }
.jsa-detail-card .jsa-dc-hd .jsa-dc-t{ flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.jsa-detail-card .jsa-dc-hd .jsa-dc-btn{
  flex:0 0 20px; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center;
  border:1px solid rgba(245,182,74,.55); border-radius:5px; cursor:pointer;
  font-size:13px; line-height:1; opacity:.95;
}
.jsa-detail-card .jsa-dc-hd .jsa-dc-btn:hover{ background:rgba(245,182,74,.15); }
/* 收起态：只留标题条 */
.jsa-detail-card.jsa-dc-min .jsa-dc-bd{ display:none; }
/* 隐藏后的恢复入口：贴在视口右缘的竖向小标签 */
#jsa-dc-restore{
  position:fixed; right:0; top:90px; z-index:2147483000; cursor:pointer;
  background:var(--jsa-navy); color:var(--jsa-amber); font-size:12px; font-weight:600;
  padding:10px 6px; border-radius:8px 0 0 8px; writing-mode:vertical-rl; letter-spacing:1px;
  box-shadow:-2px 2px 10px rgba(11,27,52,.2); user-select:none; -webkit-user-select:none;
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;
}
#jsa-dc-restore:hover{ background:#14315c; }
/* 刚被隐藏时脉冲三下：把「恢复入口在哪」明确指出来，避免用户以为面板永久没了 */
@keyframes jsa-chip-pulse{
  0%,100%{ box-shadow:-2px 2px 10px rgba(11,27,52,.2); }
  50%{ box-shadow:-2px 2px 20px rgba(245,182,74,.9); }
}
#jsa-dc-restore{ animation:jsa-chip-pulse 1.1s ease-in-out 3; }

/* —— 轻提示：点了「收起 / 隐藏」这类会让内容消失的按钮后，给一次口头反馈 —— */
#jsa-toast{
  position:fixed; left:50%; bottom:26px; transform:translateX(-50%);
  z-index:2147483003; max-width:78vw;
  background:var(--jsa-navy); color:var(--jsa-amber);
  font-size:12.5px; font-weight:600; line-height:1.5;
  padding:10px 16px; border-radius:9px;
  box-shadow:0 10px 30px rgba(11,27,52,.30);
  font-family:"PingFang SC","Microsoft YaHei",sans-serif;
  pointer-events:none; transition:opacity .6s ease;
}
#jsa-toast.out{ opacity:0; }

/* —— 列表页：单只基金跟踪比调整浮层（点击格子弹出） —— */
#jsa-ratio-pop{
  position:fixed; z-index:2147483002; width:264px;
  background:#fff; border:1px solid #e2e8f0; border-radius:10px;
  box-shadow:0 12px 30px rgba(11,27,52,.22); padding:12px 14px;
  font-family:"PingFang SC","Microsoft YaHei",sans-serif; font-size:12.5px; color:#334155;
}
#jsa-ratio-pop .jp-hd{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
#jsa-ratio-pop .jp-hd b{ color:var(--jsa-navy); flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#jsa-ratio-pop .jp-x{ cursor:pointer; color:#94a3b8; font-size:15px; line-height:1; padding:0 2px; }
#jsa-ratio-pop .jp-x:hover{ color:#475569; }
#jsa-ratio-pop .jp-cur{ font-size:11.5px; color:#64748b; line-height:1.65; margin-bottom:9px; }
#jsa-ratio-pop .jp-row{ display:flex; align-items:center; gap:8px; }
#jsa-ratio-pop input[type=range]{ flex:1; accent-color:var(--jsa-amber); }
#jsa-ratio-pop .jp-v{ min-width:38px; text-align:right; font-weight:600; color:var(--jsa-navy); font-variant-numeric:tabular-nums; }
#jsa-ratio-pop .jp-btns{ display:flex; gap:8px; margin-top:10px; }
#jsa-ratio-pop .jp-btn{ border:1px solid #cbd5e1; background:#f8fafc; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer; color:#334155; }
#jsa-ratio-pop .jp-btn:hover{ background:#eef2f7; }
#jsa-ratio-pop .jp-btn.pri{ background:var(--jsa-navy); color:var(--jsa-amber); border-color:var(--jsa-navy); }
#jsa-ratio-pop .jp-tip{ font-size:11px; color:#94a3b8; line-height:1.6; margin-top:8px; }
`;
  const id = 'jsa-injected-css';
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
})();
