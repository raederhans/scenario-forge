# 当前事实与交接

工作目录 C:/Users/raede/Desktop/dev/mapcreator，分支 main；实施阶段先完成本地实现；后续推送合并授权见下节。开始时存在昼夜/湖泊等 WIP，已保留副本与补丁在 `.runtime/tmp/ui-rebuild-20260926/`，不得回滚或混入本轮所有权声明。

## 2026-09-26 推送合并授权

用户已授权提交、推送和合并，可适当放宽合并条件。主代理使用隔离工作树 `C:/Users/raede/.codex/worktrees/editor-ui-merge-20260926/mapcreator`，分支 `codex/editor-ui-renewal-20260926`，基线 `origin/main@2e127eb4`（包含已合并湖泊 PR #169）。仅提取本轮 UI 增量，未带入主工作区昼夜、renderer metrics、startup pipeline 等并行 WIP；完整词典只合入相对开工快照的 104 个 UI 键，启动词典基于隔离后的完整词典生成。

主代理独占本轮 Pages 构建、测试、浏览器和 Git 集成。构建命令 `python tools/build_pages_dist.py`，工作目录为上面的隔离工作树，输出 `dist/`，日志 `.runtime/reports/generated/ui-merge-build.log`；退出 0 且目标 artifact 检查通过视为完成，非零停止检查原因，不自动重复。目标 Node/Python 检查无服务端口。若需要浏览器，仅主代理启动隔离工作树 localhost:8012，记录在后续回执。review 子代理只读源代码，不运行共享进程。

## 工作所有权

- 主代理：共享 HTML/CSS/sidebar/toolbar/bootstrap、新 editor workspace controller、整合、浏览器和跨模块测试。
- language_refresh（Sol）：i18n.js、water_special_region_controller.js、project_support_diagnostics_controller.js、专属语言测试；保留水域 WIP。
- progressive_states（Sol）：special_zones_workbench_controller.js、strategic_values_owner.js、layer_status_diagnostics.js、layer_panel_contracts.js 和对应目标测试。
- shell_contract_map（Luna）：只读整合契约调查。
- CLI GLM-4.5-Air：只读工程文案分类；任务 8c330e278b594b1b905d519879856f0c，provider 默认推理，read_only，parent_decides；余额未知，未采用已耗尽 GLM-5.3。

## 进程所有权

所有浏览器/dev server/跨模块 E2E 仅主代理启动与停止。子代理只运行其文件范围的无共享资源 node/Python 测试。服务使用 `python tools/dev_server.py --port 8000`，`MAPCREATOR_OPEN_BROWSER=0`；浏览器指向 localhost。

## 完成状态与设计约定

四阶段已落地，24 个相关浏览器用例分批通过。左侧保留用户当前任务；在地图中选对象仅更新右侧属性，不强制离开调色板/图层。列表主动导航同步选择快照，避免延迟刷新抢回旧属性。旧业务 DOM ID、原生 select 和既有 owner 保留。

工作区还在发生并行改动：map_renderer/source metrics、startup pipeline/data loader/legend/content state、city lights 等均非本轮所有，不回滚、不纳入 UI 改动声明。初始五个共享文件的湖泊/夜光修改也保留。CLI 只提供文案分类，不把其建议或执行状态当作已验证事实。

## 本轮浏览器 owner
主代理独占 Python dev server 127.0.0.1:8000，MAPCREATOR_OPEN_BROWSER=0，服务输出由 exec session 保留；所有浏览器/e2e 由主代理执行，证据在 .runtime/browser/ui-renewal-20260926 和 .runtime/tests/playwright。收尾已关闭本次两张预览标签并停止本次服务；无遗留本轮运行进程。

## 隔离集成验证回执

在 `origin/main@2e127eb4` 上重新验证：91 项 Node、119 项 Python、70 项 E2E 结构工具检查和 11 项真实浏览器用例通过；Pages 构建成功。浏览器包含工作区 9 项、真实导出和交通应用，使用独占 localhost:8012。新增 spec 已登记至 E2E 清单并重新生成依赖图；清单、导入图和超时 guardrail 均通过。移除条件跳过，统一使用 60 秒单测超时。

dist 从该隔离工作树完整生成，其中也同步了已在主线合并的湖泊/轮廓代码；未从主工作区复制 renderer WIP。旧静态检查仍有 4 条源码 token 断言失败（HGO hover、legend action、project support callback/listener），均已在原实现基线复核；旧 dist 差异失败已消除。不据此声明全量测试通过，也不修改分支保护。

PR #171 的第一轮 CI 检出三份启动词典变更遗漏 snapshot 校验值更新。按现有 snapshot 生成函数补齐 `build_snapshot.json`、manifest fingerprint 与 audit 引用，并断言实际变化的 artifact 只有 `locales.startup.json`；未重建剧本地理数据。三个严格剧本契约本地通过，catalog 重新生成后无内容差异，19 项 catalog 单测通过。远端第一轮 UI smoke 与 transport contract 通过，后续结果以 PR 当前提交为准。

后续 CI 检出图例分页行为失败：共享 controller 中有三行并行 legend cache 改动在初次提取时混入，调用依赖了未迁入本分支的 helper 签名。已从隔离分支剔除这三行，父工作区保持不变；支持/语言 34 项测试通过。新增 E2E 的 canonical selector route 也已补齐，路由覆盖、依赖图和超时检查通过。受影响 child-safe 集合执行 63 个命令，唯一失败是 Windows power-scheme journal 临时文件 Replace IOException，对该失败用例独立复跑通过；保留原失败与复跑日志，不改写原回执。

性能 CI 的 3/5 样本角色校验失败，尚未进行性能差值比较。只读分析指向延后启用 workspace 尺寸引发的启动 resize：现将 body workspace class 与顶部预留高度放在初始 HTML/CSS，保留原有控件挂载时序。新增浏览器用例先延迟主脚本，断言初始化前后的 mapContainer 坐标和尺寸严格相等；该用例、默认工作区及尺寸回归 3/3 通过。发布产物重新生成，性能结果以新提交的标准五轮 CI 为准，不放宽采样角色校验。
