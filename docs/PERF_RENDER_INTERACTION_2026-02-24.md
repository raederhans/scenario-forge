# 渲染与交互专项评估（2026-02-24）

## 1. 渲染主链路拆解

### 1.1 触发源

- 初始化：`initMap -> setMapData -> render`。
- 缩放：`zoom` 事件内通过 rAF 调度 `updateMap -> drawCanvas`（`js/core/map_renderer.js:1669-1688`）。
- 填色/擦除：`handleClick -> refreshColorState({renderNow:true}) -> render`（`js/core/map_renderer.js:1570-1618`）。
- 自动填色：`autoFillMap -> refreshColorState({renderNow:true})`（`js/core/map_renderer.js:1493-1568`）。

### 1.2 每次 `drawCanvas()` 做的事

1. 全画布清理和变换设置（`js/core/map_renderer.js:1293-1304`）。
2. 绘制海洋（sphere + ocean layer）。
3. 遍历所有政治 feature 填色（`js/core/map_renderer.js:1323-1358`）。
4. 再绘制层级边界 mesh（`js/core/map_renderer.js:1238-1281`）。

这意味着：交互期每帧都有“全量 feature fill + 多层 border stroke”的固定成本。

## 2. 当前主要瓶颈

## 2.1 Feature 全量遍历

- 当前 draw loop 以全量遍历为主。
- `pathBoundsInScreen` 存在，但当前主绘制路径没有使用可见裁剪列表（`js/core/map_renderer.js:544` 仅定义）。

## 2.2 交互与全量重绘耦合

- 点击一个区也会触发全图重绘。
- 缩放期间每帧重绘全量要素。

## 2.3 命中测试在大数据下会放大抖动

- spatial grid 已经比 naive 检测好，但 `rankCandidates` 里会做 `geoContains`。
- 高频 hover 情况下，CPU 占用会和 draw loop 竞争主线程预算。

## 2.4 边界绘制成本不可忽视

- mesh 虽缓存，但 `pathCanvas(mesh)` 和 stroke 是每帧执行。
- 在高缩放频率下，边界层是可感知负担。

## 3. 数据规模对渲染成本的影响

本地核算（基于当前数据）：

- `single/admin0`：199 feature。
- `composite`：预测 8415 feature。
- 点量近似：
  - detail：约 285,519 arc points
  - primary fallback：约 47,835 arc points
  - composite 合计约 **333,354 points**

在“每次交互重画全量”的模型下，这个量级天然会把帧预算压满。

## 4. 性能极限模型（推算）

## 4.1 预算定义

- 60fps：每帧 16.7ms。
- 30fps：每帧 33.3ms。

## 4.2 结合当前架构的可达区间

- `single/admin0`：较容易进入 50fps+ 区间。
- `composite(8k+)`：更接近 18-35fps（高端机器，交互期间）。
- 若继续上探到“多国家 ADM2 高密度”而不改渲染策略，通常会跌到不可接受区间（<15fps）。

> 说明：这是结构性推算，不是本机浏览器实测帧。实测流程见文末。

## 5. 推荐优化路径（按收益/风险排序）

### P0（先做）

1. **交互期降级绘制**
- 拖拽/缩放中只绘制简化层（如只画主轮廓/低细节），结束后补全高质量层。

2. **可见集预计算**
- 以 viewport + zoom band 维护 draw-list，替代每帧全量遍历 + runtime skip。

3. **分层缓存**
- 静态层（海洋/背景/部分边界）缓存到 offscreen，颜色层单独增量更新。

### P1（随后）

1. **交互命中颜色拾取化（color picking）**
- hover/click 优先 O(1) 像素读取，spatial grid 退为 fallback。

2. **填色增量更新策略**
- country 粒度填色时，按受影响 id 集合更新，不立即触发全量重画。

### P2（并行）

1. **边界层细分开关与 LOD**
- 高缩放才开 local border，低缩放仅 country/province。

2. **统一渲染状态机**
- 明确 `idle/interacting/settling` 三态，避免功能加法继续扩大每帧成本。

## 6. 与你当前重构的冲突点

- 显示/缩放/填色正在重构，正好命中性能主链路。
- 若继续在“无预算约束”下叠功能，后续每个功能都要做性能返工。

建议：先锁性能约束，再推进功能重构细节。

## 7. 浏览器实测流程（你本机执行）

> 我这边 Playwright 环境存在外部 CDN 被拦截，不适合给你出可信帧率；下面是你本机可复现实测标准流程。

1. 打开 Chrome DevTools Performance。
2. 分别测试两组 URL：
- `http://127.0.0.1:8000/?detail_layer=off`
- `http://127.0.0.1:8000/`（默认 composite）
3. 每组做 3 轮，每轮 20 秒：
- 10 秒连续平移+缩放
- 5 秒连续填色（点击多区）
- 5 秒 hover 扫描
4. 记录指标：
- FPS（平均/P95）
- Main thread Long Task 次数
- `drawCanvas` 热点占比
- Interaction to Next Paint 延迟

## 8. 验收阈值（建议）

- 开发默认档（轻量）：交互期平均 FPS >= 50。
- 重数据档（composite）：交互期平均 FPS >= 30，P95 帧耗时 <= 45ms。
- 单次填色：P95 响应 <= 100ms。
