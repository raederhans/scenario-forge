# 交付状态

- [x] 明确合并推送授权；核对当前分支及主工作区 WIP。
- [x] 固定本次交付提交 `d1a032e1f`。
- [x] 整合最新 main 并证明数据保留。
- [x] 本地交付检查。
- [ ] 推送、创建 PR、最终 required checks。
- [ ] 合并与远端状态核实。

整合提交 `f211cfce308d6b7794f1711818e117a5cf75368e` 已推送；交付 PR：[211](https://github.com/raederhans/scenario-forge/pull/211)。本记录的本地验证范围已固定，最终 required checks、合并和自动部署状态以 PR / Actions 回执及任务收尾汇报为准，不把提交时的待运行检查标为通过。

此前功能验收见同目录上级的各区域审核及 asset-size 报告；旧基线的全套测试缺口不冒充本次整合后的验收结果。

合并 main `a1be99c6d` 的三方核对已完成：欧洲 1,427 个地块修改与 main 的 6 个修改及 1 个新增 ID 无碰撞，全部水域更新保留。最终完整源 gzip 为 34,479,976 B，解压为 112,964,820 B；政治粗层 50,788,849 B。解压后保持标准 TopoJSON，坐标、属性及拓扑身份不降低精度。

本地已通过：stage/canonical strict contracts；全部对象逐 feature 精确保留；624 项 vendor 拓扑/mesh/merge/邻接检查；全局 mixed-LOD 完整源覆盖；19 项 catalog contracts；9 项验证路由检查。145 个未受影响详情分片及全部水域分片与 main 字节相同。data health 仅既有 report-only 大文件警告。

完整源采用 gzip 可存储时直接保留输入拓扑；重复执行子弧优化会改变部分 mask 的 vendor merge 结果，因此重建管线不再重复优化已可存储的输入。回归覆盖连续调用不进入优化器，最终 stage 复验 624/624 通过。

最终 Pages 构建为 815,707,977 B（777.92 MiB），通过 1 GiB 限制；新 artifact 根上的完整 Pages suite 67 项全部通过。首页 TNO SVG、WebP 和源记录同步重建，其他首页地图不变。TNO Playwright smoke 1/1 通过（26.6s），控制台与网络问题均为 0；任务服务器已退出。

附带 legacy reader 测试有一个 main 水域既存失败：`tno_gulf_of_oman` 与 `tno_persian_gulf` 距离 0.425536693828°，旧合同上限 0.00005°。它在本次 canonical 整合前读取 main 原始 plain runtime 即失败，本次全部水域坐标/分片保持 main；不降低断言或将其报为通过。远端 CI 结果待后续记录。
