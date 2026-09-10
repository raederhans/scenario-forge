# 海洋与陆地等值线优化

## 目标与范围

按用户 2026-09-10 授权实施前四项优先级：P1 海洋几何正确性；P2 陆地显示减密及样式缓存依赖；P3 粗中细几何资产和实际按需加载；P4 依据分项测量优化几何路径、裁剪与筛选缓存。

保留当前默认 atlas_only、项目导入/导出、情景水陆边界、强度场和既有交互事务。全球海深覆盖扩建、TNO 新水位/海底模型不在本轮范围。

## 实施与所有权

- ocean_geometry_fix：P1 规范化 helper、生成器必要衔接及回归测试。
- land_analysis：P2 默认/显示策略、physical render owner、pass signature；P4 陆地几何缓存及目标测试。
- ocean_analysis：P3 离线派生资产、registry/catalog、loader/bootstrap/UI load selection，相关测试。
- 主代理：map_renderer 唯一写者，P4 海洋缓存、接口整合、浏览器测量、构建与 dist、最终验证。

## 验收

1. 已知异常 bathymetry 面经规范化后球面范围合理，外环/洞/多面语义正确、不突变输入；现实和 TNO 海深无跨大洋错误色带。
2. 低缩放只绘稀疏主线，次线出现更晚且不过分增强政治底色对比；样式变更仅失效实际依赖 pass。
3. 粗/中/细几何进入真实运行链；世界视图不请求整份细次线；升级与异步切换无旧结果覆盖。
4. 缓存复用有行为测试，投影/几何变更正确失效；记录 cold/warm/zoom 分项观测，不把局部改善冒充全项目性能保证。
5. 对应目标测试、数据健康、相关构建/dist 检查通过；记录未覆盖项。

## 风险与约束

当前原工作区存在城市/海域 WIP。所有实施仅在独立 worktree C:/Users/raede/Desktop/dev/mapcreator-contours、分支 codex/contour-optimization，起点 24169584。不拷贝或覆盖原目录未提交修改。本轮不提交、推送、合并或发布。
