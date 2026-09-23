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
- 数据生成及字节一致性证据位于 `.runtime/reports/generated/water-fill-data/`；生成者已交回所有权，当前由主代理生成最终 Pages 镜像。
- 首次全量重编海域的候选未推广。最终使用独立追加大湖工具，原海域、陆地、政治分块均不变。
- 内置浏览器用 `startup_cache=0` 检查新资产；600%/1200%及回移后八湖内点有色。Atlantropa 改色、水面选择、四岛点击的组合 E2E 已通过。
- 旧 E2E 的坐标辅助函数改用真实投影；Cyprus/Balearics 的 joinMode 按修复前 HEAD 的实际 `none` 断言，Crete/Sicily 仍为 `boolean_weld`，未修改岛屿数据。

## 待续

最终 Pages 镜像完成后，检查 diff 并使用 Lore 提交，建 PR 并按用户授权合并。GitHub origin 为 raederhans/scenario-forge，gh 已登录。其他两个 worktree 不在本轮整合范围。远端要求 PR Verify Required、transport-contract-required、三个 strict scenario contract 与 perf-gate。
