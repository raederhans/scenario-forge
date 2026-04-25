# 地图缩放与交互性能回归修复计划

目标：修复上一轮未提交性能改动造成的缩放体感变差，以及刚果湖附近地块缩放后失去填色/错误显示。

阶段：
- 恢复 zoom-end political detail 覆盖，避免 viewport 内邻近块被降级到 optional 后延迟填色。
- 修复 political/context dirty 时复用旧 last-good frame 的错误视觉路径。
- 收紧 benchmark 口径：区分 first interaction 和 fully settled，补交互 probe 汇总。
- 补 Great Lakes Congo 固定地理/像素回归。
- 主线程独占运行验证，子代理只做静态复核。

验收：
- Congo probe 在 zoom 前后都能命中 land feature、resolved color、非背景像素。
- wheel/zoom blackFrameDelta 为 0。
- first interaction 指标能显示真实等待、long task、pan/click/fill 数据。
- 定向 contract/e2e 与 perf probe 通过。
