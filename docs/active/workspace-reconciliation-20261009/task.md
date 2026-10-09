# 处理状态

- [x] Fetch 后核对主目录 `f47b36f41`，落后 `origin/main@ab915f9ee` 91 个提交。
- [x] 展开并逐文件比较 1,015 项 WIP：873 与当前 main 一致，41 与主线历史版本一致，101 为混合残余。
- [x] 保存 1,015 个原文件（336,205,547 字节），逐文件 SHA-256 校验通过；保存 binary patch、原索引及固定恢复 stash 引用。
- [x] 主目录快进到 `ab915f9ee`，`main...origin/main=0/0`，工作区干净，`npm run pr:plan -- --json` 退出 0。
- [x] 完整归档 15 个旧工作树并解除 Git 登记；其中 `.runtime` 证据约 42.86 GiB 全部保留。
- [x] 保存恢复引用后清理 36 个旧本地分支及 27 个远端分支。远端 main 未变；临时探针 PR #207 未重新合并。
- [x] HGO 旧 WIP 186 项核对完成：没有发现需要独立交付的产品功能。
- [x] WGI 导航缓存遗漏修复，26 项 owner 行为测试通过。
- [x] 按当前 topology 存储契约恢复 South Asia / Blank Base：23,127 个地块，保留全部 11,322 个旧 ID，179 个来源恢复地块；15 项几何/存储测试、严格场景契约通过。
- [x] data health 无错误（12 条既有大文件提示）；catalog 契约 21 项、sample 契约 22 项、验证元数据 60 项通过；733 条路由和 102 项 heavy test 分类检查通过。
- [x] 浏览器验证通过：Udupi 填色、ownerless、reset、退出后完整状态及像素比较全部通过（1 case，约 1.5 分钟，0 retry）。旧主权 setter 已替换为现行 visual paint；两次快照均在 detail/render settled 后采集，原断言及预算保留。
- [x] 本地验证路由及最终差异检查完成。候选通过正常 PR 交付；远端必需检查、合并提交及发布结果以该 PR/Actions 回执和本地最终收尾报告为准，不将本地通过当作远端通过。

没有整体回放旧 startup-response transport、旧 HGO 共享编辑器、旧 renderer 抽取前版本或旧 gzip 读取实现；这些残余完整保存在恢复快照。
