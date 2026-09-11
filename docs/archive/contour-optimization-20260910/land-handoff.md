# 陆地等高线实现交接

已整合 P2/P4：balanced 默认减密与减弱对比；主次线在不同缩放下分级；physicalBase/contextBase 仅保留各自实际样式依赖。默认 atlas_only 保持。

physical_layer_render_owner 使用 projected_geographic_path_cache 提供的 Path2D，按样式聚合后单次 stroke，保留整批 fallback 和零强度不绘制语义。缓存按几何引用及投影 generation 失效，camera/DPR 在重放时应用。drawContourCollection:major/minor 分别记录筛选、样式、路径构建及 stroke 耗时。

目标测试及最终浏览器结果以 task.md 为准；早期交接中的 contour_render_policy/path-string 方案没有进入最终实现。
