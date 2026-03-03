# QA-027: Ocean Mask Fallback + Visual Delta Boost

**Date:** 2026-02-24  
**Environment:** `http://localhost:8000/` (quick smoke + static checks)  
**Related:** `./026_ocean_hit_and_ocean_style_upgrade.md`

---

## 1) 修复点清单（按文件）

### `js/core/map_renderer.js`
- 新增海洋 mask 决策逻辑：
  - `state.oceanMaskMode`: `topology_ocean | sphere_minus_land`
  - `state.oceanMaskQuality`: `ocean_bbox_area / sphere_bbox_area`
- 新增 `resolveOceanMask()`：
  - 当 `quality >= 0.35` 使用 `topology_ocean`。
  - 当 `quality < 0.35` 自动降级为 `sphere_minus_land`。
- 新增 `applyOceanClipMask()`：
  - `topology_ocean`：沿用 `state.oceanData` clip。
  - `sphere_minus_land`：`Sphere + Land` 路径后 `clip("evenodd")`，实现海洋区域裁剪。
- 强化海洋样式可区分度：
  - 提升三种非 flat 预设的渐变对比度。
  - 提升 contour / hachure 线条强度、密度与 alpha 曲线。

### `js/core/state.js`
- 新增状态字段：
  - `oceanMaskMode`
  - `oceanMaskQuality`
- 调整默认海洋参数：
  - `opacity: 0.55 -> 0.72`
  - `contourStrength: 0.60 -> 0.75`

### `js/ui/toolbar.js`
- 同步默认值与回退值，避免 UI 初始化将新默认覆盖回旧值：
  - opacity fallback 调整为 `0.72`
  - contourStrength fallback 调整为 `0.75`

### `init_map_data.py`
- 新增 ocean 覆盖质量门禁与 fallback：
  - `ensure_ocean_coverage(...)`
  - `_build_ocean_fallback_from_land(...)`
- 规则：
  - Global build 下要求 ocean bbox `width >= 220°` 且 `height >= 90°`。
  - 不达标时强制使用 `world_bbox - unary_union(land_bg)` 生成 ocean。
- 执行时机：
  - 初次加载 ocean + land_bg 后（`initial`）。
  - 最终写拓扑前（`pre-topology`）。

### `docs/ARCH_SYSTEM_REFERENCE.md`
- 补充 Ocean Mask Fallback 架构说明与阈值策略。

---

## 2) 证据（按要求顺序）

## Console
- quick smoke（`2026-02-24 16:56`）未发现地图主页渲染阻断错误。
- 记录到已知噪音（文档页/README 路由）：
  - `GET /data/favicon.ico 404`
  - `TypeError: $(...).ready is not a function`

- 拓扑抽样：当前 `objects.ocean` 合并 bbox 比例约 `0.064679`（明显低于 `0.35` 阈值），会触发 runtime fallback。

## Network
- 地图主页相关检查未出现新增关键 4xx/5xx 失败。

## Screenshots

历史截图与临时证据文件已在文档清理阶段移除；结论以 canonical summary 为准。

## Reproduction / Verification
1. 运行数据构建：`python3 init_map_data.py`
2. 启动服务：`python3 tools/dev_server.py`（或任意静态服务器）
3. 打开地图主页，依次切换：`flat / bathymetry_soft / bathymetry_contours / wave_hachure`
4. 在北大西洋、北太平洋、印度洋观察样式是否生效（不应再仅里海变化）
5. 在陆地上色，确认海洋纹理未污染陆地填色

## Minimal Patch Direction
- 根因是前端 ocean 样式层被“覆盖范围异常小的 ocean 几何”裁剪。
- 本次采用 Hybrid：
  - 前端 runtime fallback 立即修复显示范围。
  - 数据管线质量门禁确保后续拓扑输出稳定。

---

## 3) 风险与后续

1. `sphere_minus_land` 依赖 `evenodd` clip；在极旧 Canvas 实现上可能退化为普通 clip。
2. 当前 bathymetry 仍是程序化视觉模拟，非真实海深数据。
3. 若后续切回区域地图（非 global bounds），建议将 bbox 阈值改为配置化比例阈值。

> 历史截图与临时证据文件已在文档清理阶段移除；结论以 canonical summary 为准。
