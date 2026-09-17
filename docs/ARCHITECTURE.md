# 架构与技术原理（写给任何人或 Agent 的精确说明）

> 本文件是 **`jisilu-arbitrage`**（集思录 QDII/LOF/ETF 套利增强插件）的**唯一技术真相源**。
> 读完它，你应该能回答三件事：
> 1. **这个插件做了什么** —— 见 §1、§8；
> 2. **背后是怎么计算的** —— 见 §2（溢价率）、§3（跟踪比）、§4（套利建议）、§5（持仓加权）；
> 3. **采用了哪些数据** —— 见 §6（数据源总表）、§7（数据流）。
>
> 配套文档：立项可行性研究 `docs/feasibility-study.html`（各免费源实测结论）；
> 友好入口与截图在 `README.md`。
> 仓库根目录**就是插件本体**：`chrome://extensions` → 加载已解压的扩展程序 → 指向本仓库根即可，无需进子目录。

---

## 0. 一句话总览

在集思录的 QDII/LOF/ETF 列表页与详情页，**注入基金的「实时净值」与「实时溢价」两列/面板**，
用**交易所官方 IOPV**、或**海外期货锚点（第三方）**、或**基于昨净值+跟踪比的自算（仅兜底）**
三种口径之一，算出"现在市价比基金实际值贵/便宜多少"，并讲清每个数怎么来的、套利可行性与风险。

**原则**：能拿到交易所真值就绝不用估算；一切第三方值都显式声明"非官方"；免费、纯前端、离线加载、不上传任何数据。

---

## 1. 插件做了什么（功能清单）

### 1.1 列表页（`/data/qdii/`、`/data/lof/`、`/data/etf/`、`/data/fund/`）

在表格**末尾**注入 2 列（由 `content/jisilu-list.js` 的 `buildCols()` 定义）：

| 注入列 | 含义 | 怎么算（详见 §2） |
| --- | --- | --- |
| **实时净值** | 这只基金"此刻"值多少钱 | ● 交易所 IOPV / ◐ 海外期货锚点 / ○ 自算推算（三档自适应，见 §2.1） |
| **实时溢价** | 市价相对实际值的贵贱 | `(现价 − 实时净值) ÷ 实时净值`（§2.2） |

- **两列自适应档位**：有 IOPV → ●；无 IOPV 但有期货锚点 → ◐；都没有 → ○。**绝不留空**。
- **冻结左两列**：`代码 / 名称` 设 `position: sticky`，横向滚动到最右也知道看的是哪只（`freezeLeadingCols`）。
- **浮动控制面板**（默认折叠成窄标题条，`content/ui/panel.js`）：
  - 全局跟踪比滑杆（0.5~1.5，**只影响 ○ 自算档的兜底默认**，见 §3）；
  - 刷新频率（10/15/30/60s/关闭）；开关；立即刷新；
  - ●/◐/○ 图例 + 本页档位统计 + 最新行情时间。
- **每只基金跟踪比独立生效**，列表页**点击该基金的「实时净值/实时溢价」格子**即弹出就地调校浮层（`JsaUI.openRatioEditor`），写入 `jsa.overrides[code]` 立即生效，不必进详情页。
- **悬停讲原理**：净值列讲 IOPV 怎么来 / LOF 为什么没有 / ◐ 为什么期货才对；溢价列讲完整计算过程 + 套利建议。

### 1.2 详情页（`/data/{qdii|lof|etf|fund}/detail/{code}`）

页面顶部注入独立决策面板（`content/jisilu-detail.js`），**不依赖页面表格结构**：

- 关键指标：现价 / 实时净值（●◐○ 与列表页同一口径）/ 溢价率 / 最新净值 / **真实净值日期** / 估算净值（仅 ○ 档）/ 参考涨幅来源；
- **前十大持仓·盘中涨幅汇总**：按权重加权平均涨幅 + 逐只贡献度排序（持仓为季报，滞后>45 天显式警示"可能已调仓"）；
- **净值波动特征**：无历史表时用真实净值序列给出近 5/10/20 日日均涨跌、波动率、上涨占比；
- **历史跟踪比**：有历史表时算近 5/10/20 日**过原点最小二乘跟踪比**（§3.2），附 R² 与残差标准差，可一键写成本基金手动值；
- **面板可收起/隐藏**：标题栏 `−/+` 收起、`×` 隐藏（隐藏后视口右缘留"套利面板"竖条可恢复）；两种操作都给 3 秒轻提示说明"东西去哪了、怎么回来"（避免"点一下东西没了"被当 bug）。

### 1.3 为什么要做这个插件

集思录官方的 IOPV/溢价率是**会员列**，未登录显示"登录/会员"；QDII 净值普遍 **T-2 滞后**，
只看静态数据会错过盘中套利窗口。插件把这两块补上，且**优先用交易所真值**。

---

## 2. 背后怎么算的：溢价率（核心计算）

所有逻辑在 `core/premium.js` 的 `compute(row, { trackRatio })` 与 `pickNav(res)`。

### 2.1 实时净值的三个来源（唯一真相源 `pickNav`）

按优先级取第一个有效值：

| 档 | 来源 | 判定条件 | 标记 | 性质 |
| --- | --- | --- | --- | --- |
| **● IOPV** | 交易所每 15 秒发布的持仓实时估值 | `iopv > 0` | ● | **官方真值，零估算误差** |
| **◐ 期货锚点** | HaoETF：`T-1 估值 + 海外实时期货` | `haoNav > 0` 且通过自洽校验 | ◐ | 第三方估算（跨境专用） |
| **○ 自算** | 由昨净值推算（见 2.3） | 上面都没有 | ○ | 插件自算（仅兜底） |
| （退化） | 连参考涨幅都没有时，直接用官方净值静态比价 | — | ○ | 等价于集思录静态口径 |

> 为什么跨境必须用◐而不是 A 股指数硬推：QDII 跟踪海外，A 股盘中海外休市，
> 用"A 股指数涨跌"推海外基金净值是拿不相关变量做外推。正确锚点是**海外期货**
> （道指/纳指100/标普500/原油/黄金），HaoETF 正是这么算的。腾讯行情取不到期货
> （`hf_GC/hf_CL/hf_NQ` 实测全空），故◐是**目前唯一可得的免费期货锚点**。
> 所有 ◐ 值在 UI 与悬停里都带"第三方估算、非官方"声明。

### 2.2 溢价率公式（双轨）

```
溢价率 = (现价 − 实时净值) ÷ 实时净值 × 100%      —— 单位：百分点
```

- **轨道 A（真值）**：有 IOPV 时 `realPremium = (price − iopv)/iopv × 100`，`source = 'IOPV'`。
- **轨道 A2（期货锚点）**：无 IOPV 但 `haoNav>0` 时 `haoPremium = (price − haoNav)/haoNav × 100`，`source = 'HAOETF'`。
- **轨道 B（自算）**：无 IOPV 且 `nav>0` 时，先算估算净值（下式），再 `estPremium = (price − estNav)/estNav × 100`，
  `source = refInc==null ? 'NAV' : 'EST'`。

最终采用 `premium` = 三个轨道中**第一个算得出的值**（优先级 IOPV > HAOETF > EST/NAV）。

### 2.3 自算估算净值公式（○ 档，仅兜底）

```
估算净值 estNav = nav × (1 + growth)
growth       = (refInc / 100) × ratio + (fx / 100)
```

- `nav`：最新官方单位净值（腾讯 [81] 或页面 `fund_nav`）；
- `refInc`：**参考涨幅（百分数）**，来自页面 `T-1指数涨幅 / 指数涨幅 / 重仓涨幅 / 参考涨幅` 之一（见 §6.1 字段优先级）；
- `ratio`：**本基金的跟踪比**（见 §3，四级优先级链得出）；
- `fx`：汇率修正（百分数，默认 0；跨境外币持仓可用 `window.__jsaFxOverride` 手动覆盖——免费汇率源实测不可用，故仅留钩子，不自动接）。

> 无参考涨幅（`refInc == null`）时退化为 `growth = 0`，即直接用昨净值静态比价，
> 等价于集思录自带的静态溢价率（已诚实标注）。

---

## 3. 背后怎么算的：跟踪比（四级优先级链 + 最小二乘）

跟踪比 `k` 的物理定义：**基金当天净值涨跌 ≈ k × 指数/持仓当天涨跌**。
`k=1` 紧跟指数；`>1` 比指数猛；`<1` 比指数温和；`≈0` 基本不跟指数（此时 ○ 自算不可靠）。

### 3.1 四级优先级链（唯一真相源 `P.pickRatio`）

> **这是跨页一致性的关键**：列表页与详情页**都调用同一个函数** `core/premium.js::pickRatio`，
> 且"回归值/股票占比"都归一到**共享缓存**（`jsa.autoRatio` / `jsa.stockPct`）。
> 因此同一只基金在两处显示的跟踪比**数值与档位文案必然一致**。

```
pickRatio({ code, overrides, autoRatio, pageReg, stockPct, globalRatio }):
  ① 手动设定   : overrides[code] 存在      → clampRatio(它)        文案"手动设定"
  ② 历史回归   : pageReg.ok && 样本≥3       → clampRatio(pageReg.avg)  文案"历史回归·近N日（k样本）"
                 否则 autoRatio[code] 存在   → clampRatio(它.ratio)     文案"历史回归·缓存"
  ③ 股票占比   : stockPct > 0               → clampRatio(stockPct/100) 文案"股票占比 X%"
  ④ 全局滑杆   : 其它                        → clampRatio(globalRatio)  文案"全局默认"
```

- `clampRatio(v)`：`Number` 非数→回落 1；否则 `min(1.5, max(0.05, round2(v)))`，夹在 [0.05, 1.5]。
- **① 手动设定**：用户在列表页点格子 / 详情页"跟踪比"区块调，写 `jsa.overrides[code]`，优先级最高。
- **② 历史回归**：详情页解析历史表自动算（§3.2），写入 `jsa.autoRatio[code]`（带 `win/samples`），列表页读取——两页同源。
- **③ 股票占比**：列表页权威列 `stock_ratio`（÷100）。依据 `净值涨跌 ≈ 仓位 × 持仓涨幅`，
  对**被动指数基金是严格成立的比例关系**；对**主动基金**相当于假设 β=1（ weaker，已在 UI 诚实说明）。
- **④ 全局滑杆**：设置里的 `trackRatio`，兜底默认。

### 3.2 历史回归的数学：过原点最小二乘（OLS through origin）

实现在 `core/track.js::average(records, n)`。模型：`navInc = k × indexInc + ε`。

**为什么不用"逐日比值求平均"**：旧实现取 `mean(yᵢ/xᵢ)`，
小 `|xᵢ|` 的日子（如指数只动 0.35%）比值爆炸、把均值拽偏，有偏且不是最小方差。

**新口径（本插件采用）**：

```
过滤：只保留 |indexInc| ≥ 0.3% 的样本（分母太小则比值噪声爆炸）
k̂  = Σ(xᵢ · yᵢ) / Σ(xᵢ²)          —— 过原点最小二乘估计
      （模型 y=kx+ε 的极大似然解 = 最小二乘解；也是金融里无截距 β 的标准算法；
        分母 Σx² 恒 > 0 数值稳定，且天然按 x² 加权：波动大的日子信号强、权重高）
R² = 1 − Σ(yᵢ − k̂·xᵢ)² / Σyᵢ²     —— 拟合优度，越接近 1 越说明"这只基金确实按这个指数走"
残差σ = √( Σ(yᵢ − k̂·xᵢ)² / n )    —— 残差标准差（百分点），衡量估计不确定性
avgRatio（旧口径 mean(y/x)）仍保留在返回值里，仅作对比回溯，不参与采用。
```

示例：给定真值 `k=0.875` 的含噪样本，旧口径误差约 0.035~0.060，新口径约 0.011~0.014（准 3~5 倍）。

### 3.3 历史表两种格式（`core/track.js::extractFromTable`）

集思录详情页历史表有两种结构，必须分别处理：

- **格式一（净值涨幅 + 指数涨幅）**：直接读取这两列即可。
- **格式二（净值 + 重仓涨幅，LOF/QDII 详情页实测格式）**：
  按**净值日期**对齐相邻两期净值，用 `(nav_t − nav_{t-1})/nav_{t-1} × 100` 算净值涨幅；
  参考涨幅取**同一净值日期当天**的重仓/指数涨幅。
  ⚠️ QDII 净值滞后 T-2，**必须按净值日期对齐，不能按行错位配对**（否则会把当行其它涨幅错配）。

---

## 4. 套利建议逻辑（`core/premium.js::advice`）

纯启发式、不构成投资建议，分三档：

- `|溢价| < 1%`：正常波动内，无套利空间（套利至少要覆盖申赎费+佣金+两天净值波动）。
- `溢价 > 0`：市价贵。讲机构做法（买一篮子→申购→卖出赚差价，百万门槛+T+2）；
  你能做的：别在这价位买、有货趁高卖。
- `折价 < 0`：市价便宜。讲机构反向套利；你能做的：折价买入占便宜，但扣赎回费+两天波动+流动性风险。
- 若 `申购状态` 命中 `限/停/暂/额/封闭`：提示"套利通道堵死，高溢价可能长期不回落，别赌收敛"。

---

## 5. 前十大持仓加权涨幅（`core/holdings.js`）

```
加权平均涨幅 = Σ( 权重ᵢ × 涨幅ᵢ ) / Σ(权重ᵢ)      （权重缺失时退化为等权）
单只贡献     = 涨幅ᵢ × 权重ᵢ / 100
```

- 持仓股**实时涨幅**来自腾讯行情 `qt.gtimg.cn` 批量（与 §6.2 同源）；
- 权重/名称来自天天基金 `FundArchivesDatas.aspx`（§6.4），**扩展环境下大概率拿不到**（Referer 禁头），
  拿不到时整块不渲染，不占位。

---

## 6. 采用了哪些数据（数据源总表）

> 全部**免费、公开、不绕会员权限**。以下"解析坑"是实测踩过、已在代码里处理的，Agent 改代码时务必保留。

| # | 数据 | 来源 URL | 关键字段 | 可靠性 | 降级 | 解析坑（已处理） |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 列表页行数据 | `https://www.jisilu.cn/data/{qdii\|lof\|etf\|fund}/` 已渲染 DOM | `td[data-name=price/fund_nav/iopv/ref_increase_rt/stock_ratio/apply_status/nav_dt/...]` | 高（页面给的） | — | 游客只渲染前 20 行；`isLocked()` 识别"登录/会员"占位跳过 |
| 2 | **IOPV 实时净值** | `https://qt.gtimg.cn/q={symbols}`（**GBK**） | [78] IOPV、[77] 溢价率、[81] 单位净值、[3] 现价、[30] 时间 | 高（交易所） | 无则走 ◐/○ | 以 `~CNY~` 为锚向前定位 [81]/[78]/[77]，防字段增删整体位移；GBK 必须 `TextDecoder('gbk')` |
| 3 | **◐ 期货锚点估值** | `https://www.haoetf.com/`（服务端渲染 HTML） | `rtNav`(T-1估值+期货)、`rtPrem`、`applyLimit` | 中（第三方估算） | 无则 ○ | 表头 23 列但数据行仅 20 `<td>`（部分列被 `<!-- -->` 注释）；先剔注释，再"头6+尾4+中段按两个 MM-DD 日期定位"；`checked` 自洽校验 `(现价−rtNav)/rtNav≈rtPrem`（容差 0.06pp），`checked=false` 宁可不用 |
| 4 | **历史净值序列** | `https://fund.eastmoney.com/pingzhongdata/{code}.js` | `Data_netWorthTrend`: {x:时间戳, y:净值, equityReturn} | 高 | 无则详情页改用波动特征 | **无需 Referer**（区别于 #5）；取 `Data_netWorthTrend` 数组段解析；时间戳按 UTC+8 换算日期 |
| 5 | 前十大持仓 | `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=10` | 代码/名称/占净值比/涨跌幅 | 中（季报） | **扩展内基本拿不到** | **强制校验 Referer**，而 Referer 是浏览器禁用头、JS `fetch` 无法伪造 → 后台取不到，整块不渲染 |
| 6 | 持仓股实时涨幅 | `https://qt.gtimg.cn/q={symbols}`（同 #2） | [3] 现价、[32] 涨跌幅 | 高 | — | 同 #2 的 GBK 与锚点定位 |
| 7 | 详情页参考涨幅/净值日期 | 详情页 `document.body.innerText` 正则 | `参考涨幅[:：]X%`、`净值日期 XXXX-XX-XX`、`申购状态` | 中（依赖登录态） | 无则退 ○ | 正文常有"重仓涨幅/T-1指数涨幅/指数涨幅"候选，按优先级取（见 `core/dom.js::REF_PATTERNS`） |

### 6.1 参考涨幅字段优先级（`core/dom.js::REF_PATTERNS`）

集思录各板块字段名不同，漏配会**把溢价方向判反**，故逐一覆盖：
`重仓涨幅`（LOF）> `T-1指数涨幅`（QDII）> `指数涨幅`（ETF）> `参考涨幅`。
列表页行内另按 `ref_increase_rt / index_increase_rt / stock_increase_rt / fund_increase_rt / increase_rt` 顺序取（兼容 `/data/fund/` 防御性适配）。

### 6.2 腾讯代码前缀

`5/6/9`→`sh`，`1/0/3`→`sz`，`4/8`→`bj`；批量每批 ≤50 只（`BATCH_SIZE`）。

---

## 7. 整体数据流（从页面到屏幕）

```
[集思录页面加载]
   └─ content/jisilu-list.js::init()
        ├─ Repo.getSettings / getOverrides / getAutoRatios / getStockPcts   (chrome.storage.local)
        └─ run(full):
             ① refreshStored()            读共享缓存（详情页可能已写入回归/股票占比）
             ② refreshQuotes() ──runtime──► background::handleQuotes ──► qt.gtimg.cn (GBK)
             ③ paint(full) 先画两列（● 来自 IOPV，○ 用昨净值×涨幅×跟踪比）
             ④ refreshHaoEtf() ─runtime──► background::handleHaoEtf ──► haoetf.com
                  └─ 命中跨境品种 → 补画 ◐ 档（有变化才 paint(false)，不重排整表）
        └─ startSelfHeal()  MutationObserver + 5s 轮询，页面 30s 自动刷新后自愈
        └─ scheduleRefresh() 按 refreshSec 周期 run(false)

[详情页]
   └─ content/jisilu-detail.js::build(code)
        ├─ 页面 DOM 取 名称/参考涨幅/申购状态/净值日期
        ├─ handleQuotes(code)          → 现价/IOPV/净值
        ├─ handleHaoEtf(code)          → ◐ 估值（单只）
        ├─ handleNavSeries(code)       → 真实净值序列（补净值日期/波动特征）
        ├─ T.extractFromTable(所有 table) → 历史表 records（格式一/二）
        ├─ T.average(records,10)       → reg10（OLS 跟踪比）
        ├─ 写 jsa.autoRatio[code]（样本≥3）   ← 供列表页同源
        ├─ 读 jsa.stockPct[code]（优先）       ← 与列表页同源
        └─ P.pickRatio(...)            → 生效跟踪比（与列表页同一函数）
```

### 7.1 缓存策略（`background/service-worker.js`）

| 类型 | TTL | 说明 |
| --- | --- | --- |
| 行情 quote | 15s | 跟随 IOPV 15 秒刷新周期 |
| 历史净值 nav | 6h | 每日只更新一次 |
| HaoETF haoetf | 5min | 随海外期货变动，不必更频 |
| 成功结果 | 7d | 默认 |
| 失败结果 | 5min | 避免一次失败锁死一周 |

- 所有抓取走 `fetchText`（**8 秒 AbortController 硬超时**）——第三方源假死时消息必须能返回，绝不让前台整表不渲染；
- `chrome.storage.local` **二级持久缓存**：SW 被系统回收后内存 Map 清空，启动时异步预加载有效条目回 Map，`put` 时双写 storage（storage 不可用自动降级内存缓存）。

### 7.2 存储键（`storage/repository.js`）

| 键 | 内容 |
| --- | --- |
| `jsa.settings` | 启用/全局跟踪比/刷新频率/面板折叠 |
| `jsa.overrides` | **手动跟踪比覆写** `{ code: 比值 }`（跨页同源，优先级最高） |
| `jsa.autoRatio` | **历史回归自动缓存** `{ code: {ratio, samples, win, at} }`（详情页写、列表页读） |
| `jsa.stockPct` | **股票占比共享缓存** `{ code: 百分比 }`（列表页权威回写、详情页读，保证两页同源） |
| `jsa.watchlist` | 自选（预留） |

---

## 8. 目录结构与模块职责（代码地图）

```
jisilu-arbitrage/
├── manifest.json                  MV3 清单；content_scripts 顺序：format→quotes→premium→dom→holdings→nav→track→runtime→repository→ui→list→detail
├── background/service-worker.js   行情/持仓/HaoETF 抓取 + 缓存（GBK 解码，按条目分 TTL，storage 二级持久化）
├── core/
│   ├── quotes.js      腾讯行情解析（GBK 解码、CNY 锚点定位 [78]/[77]/[81]、批量 50）
│   ├── premium.js     ★ 计算核心：双轨溢价 compute() + pickNav() + 档位 MARKS/LABELS 唯一真相源 + 跟踪比四级链 pickRatio()（唯一真相源）+ clampRatio + 套利建议 advice() + 悬停说明
│   ├── haoetf.js      HaoETF 跨境实时估值解析（剔注释 + 头尾锚点 + 内容特征定位 + 自洽校验）
│   ├── nav.js         历史净值序列解析（pingzhongdata）+ 近 N 日波动统计
│   ├── dom.js         列表页自适应适配（data-name 契约）+ 参考涨幅字段优先级 REF_PATTERNS + 幂等注入列
│   ├── holdings.js    天天基金持仓解析（正则，无 DOM）+ 加权涨幅
│   ├── track.js       ★ 跟踪比历史统计：extractFromTable（格式一/二、净值日期对齐）+ average（过原点最小二乘 k̂/R²/残差/avgRatio）
│   ├── runtime.js     chrome API 安全封装（contextAlive / safeSendMessage，列表/详情页共用）
│   └── format.js      数值/百分比格式化、涨跌配色、hhmm 时间（已导出，供面板统计）
├── content/
│   ├── jisilu-list.js     列表页增强：2 列注入 + 冻结列 + 控制面板 + 就地调跟踪比浮层 + 自愈 + 刷新
│   ├── jisilu-detail.js   详情页决策面板：指标 + 持仓 + 波动特征 + 历史跟踪比 + 收起/隐藏 + 写共享缓存
│   └── ui/
│       ├── panel.js       浮动控制面板组件 + 悬停提示 tip + 轻提示 toast + 跟踪比浮层 openRatioEditor
│       └── styles.js      注入样式（Analytics Blue：深蓝+琥珀金），含 toast/恢复竖条/收起态/限高滚动
├── storage/repository.js  设置/自选/覆写/回归缓存/股票占比缓存（Promise 兼容回调式 chrome.storage）
├── tools/                 图标生成 make-icons.py + 真页验证 verify-live.cjs / verify-detail.cjs
├── tests/                 单测（82 项）+ 真实抓取样本 fixtures
├── examples/screenshots/  实机运行截图（README 引用）
└── docs/
    ├── ARCHITECTURE.md          本文件（精确技术说明）
    └── feasibility-study.html   立项可行性研究（各免费源实测结论）
```

> **两个"唯一真相源"铁律**（改代码前必读）：
> 1. 档位标记 `●◐○` 与文案只在 `core/premium.js` 的 `MARKS/LABELS` 定义，列表页与详情页都从 `markOf/labelOf` 取，禁止硬编码（有单测拦）。
> 2. 跟踪比四级链只在 `core/premium.js::pickRatio`，列表页与详情页都调它，禁止各写一套（曾因此出现两页不一致 bug）。

---

## 9. 已知限制（诚实声明，非缺陷）

1. 游客态集思录只渲染前 20 行，插件只能处理页面上已渲染的行。
2. ◐ 仅覆盖约 40 只跨境品种；部分因"无相关期货"仍回落 ○（如 501312 华宝海外科技）。
3. ◐ 是第三方估算，**不是官方净值**，已在 UI 显式声明。
4. QDII 自算档存在真实偏差（净值 T-2 + 参考涨幅 T-1 + 汇率），仅参考。
5. 前十大持仓在扩展内大概率拿不到（Referer 禁头），拿不到整块不渲染。
6. 季报持仓天然滞后（实测约 72 天），据此算的涨幅精度未必高于"指数×跟踪比"。
7. LOF 基本无 IOPV（品种机制决定，非缺陷）。
8. 深度实值/长期停牌品种估算可能失真。

---

## 10. 如何验证（测试与真机验收）

```bash
npm test                  # 82 项单元测试：行情解析 / 三级降级 / 档位唯一真相源 /
                          #   跨页跟踪比一致 / 第三方源健壮性 / 净值序列 / 参考涨幅 /
                          #   持仓 / 就地调跟踪比 / 跟踪比最小二乘与 R² / 格式化导出契约 / 清单完整性
npm run verify:live       # 真页注入验证：QDII 列表几何+计算+●◐○ 分布+就地调+跨页一致
npm run verify:detail     # 详情页离线验证（默认 161028，○ 档）
npm run verify:detail -- 160140   # 跨境品种，验 ◐ 期货锚点档
```

- `verify:detail` **不可并发**（agent-browser 共用同一页面，须 `&&` 串行）。
- 真页验证断言：表头/表体注入列数 == 2、各行一致、●◐○ 计数、冻结列 computed style、
  **点格子→浮层→应用→写 `jsa.overrides`** 全链路、跨页一致性（列表裁决 vs 详情等效裁决同值同文案）、
  历史回归 OLS 显示与一键采用。

---

## 11. 安装与加载

1. `chrome://extensions/` → 开"开发者模式"；
2. "加载已解压的扩展程序" → 选**含 `manifest.json` 的仓库根目录**；
3. 打开集思录列表页，`Cmd+R` 刷新；
4. 改代码后在扩展页点 ↻ 重载（改 `manifest.json` **必须**重载）。

> 仓库根 = 插件本体，无需进子目录即可加载。
