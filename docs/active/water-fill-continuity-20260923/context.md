# 执行上下文

基线 `8b875c72`，工作区 `C:/Users/raede/Desktop/dev/mapcreator`，当前修复分支见 task。原有未跟踪 `.playwright-mcp/` 保留。

## 已确认

- 内层 water 图片不检查移动后的覆盖，模拟画布可复现移入后 30 次外层重绘仍无 fill；现要求内层 exact transform，保留 Path2D。
- 外层 scenario pass 的 960px/24 次阈值不保证覆盖，现同时检查实际画过的 padding 与当前视口。
- Atlantropa 两条 sea getter 已使用 ocean base。盐滩、浅滩未改。
- 纠正初始假设：NE selector 已匹配多个名字字段，无需修 selector。全球数据已有 Ladoga/Onega，漏在 TNO 克隆白名单。
- bootstrap 空 land/context mask 是现有分块设计；本轮不加载约90MB full topology，不扩大启动载荷，用独立水域面修湖面。

## 验证与运行证据

- 主代理的 localhost:8000 服务及两个内置浏览器检视标签已经关闭。日志在 `.runtime/browser/water-fill/`。
- 数据生成及字节一致性证据位于 `.runtime/reports/generated/water-fill-data/`；首轮 CI 要求的全局 manifest 与场景 snapshot 同步已完成，三个 strict 场景通过、六场景快照匹配，主代理正在刷新 Pages 镜像。
- 首次全量重编海域的候选未推广。最终使用独立追加大湖工具，原海域、陆地、政治分块均不变。
- 内置浏览器用 `startup_cache=0` 检查新资产；600%/1200%及回移后八湖内点有色。Atlantropa 改色、水面选择、四岛点击的组合 E2E 已通过。
- 旧 E2E 的坐标辅助函数改用真实投影；Cyprus/Balearics 的 joinMode 按修复前 HEAD 的实际 `none` 断言，Crete/Sicily 仍为 `boolean_weld`，未修改岛屿数据。

## 待续

PR #151 已推送行为及数据修正。首轮 smoke、perf-gate、transport 与 quick-fill 通过；第二轮已确认TNO、两个HOI4 strict与footprint通过。新测试分组已补齐；最后三个场景的manifest/audit共享拓扑引用也已更新，并有完整strict通过证据。刷新镜像、推送后等待最终必需检查再普通merge，仓库不支持auto-merge。其他两个worktree不在本轮整合范围。
