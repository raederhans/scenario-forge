# 开发者工作流全仓审计总览

日期：2026-04-03

## 结论和最短修复路线

当前工程的主要问题不是某一个函数写错了，而是几条核心链路的边界已经散开了：

1. 构筑链和发布链没有完全按 checkpoint 事务边界收口，导致“构建成功”和“产物正确”并不等价。
2. 启动链已经引入 startup bundle，但旧的 preload、旧的 bootstrap、旧的全量 rebuild 入口还在同时工作，重复加载和重复构建都存在。
3. 场景运行时的 chunk 体系已经做出来了，但 bundle、cache、worker、主线程、viewport promotion 之间仍有状态重叠和重复搬运。
4. 外围流水线没有收口到统一契约，按当前脚本边界和 CI 覆盖看，HOI4 和 transport workbench 仍存在“能跑，但不是统一 builder contract”的旁路。

最短修复路线不是继续打补丁，而是按下面顺序收口：

1. 先把锁、checkpoint、publish 变成单一事务边界。
2. 再把 startup 资产构建收成一条链，删除重复裁剪和默认全量 rebuild 入口。
3. 再把 runtime chunk state 从 bundle 对象里剥离，worker 和主线程只传必要 payload。
4. 最后把 HOI4 和 transport 统一到共享 manifest 和 shared checker，再补最小 CI gate。

## 本次审计范围

- bundle 构筑
- 项目启动链
- 数据合成
- 数据传输
- 场景运行时流转
- HOI4 / transport workbench / test / CI 外围链路

## 本次审计方式

- 主线程做全局汇总和证据收口
- 4 个子代理并行看不同部分
- 以静态审计为主，只做轻量证据校对
- 没有执行长时间前台构建
- 没有修改生产代码

## 审计边界说明

- 已确认的问题：来自代码、脚本、产物、CI、测试入口的直接证据。
- 未做完整动态验证的地方：会明确标注为“静态确认，未做长链路复跑”。
- 当前默认 Python 环境缺少 `pytest`，轻量验证命令会直接失败为 `No module named pytest`，所以这次没有把“未跑测试”误写成“代码正确”。

## 一页问题地图

### 1. 构筑与启动链

- `start_dev.bat -> build_data.bat -> init_map_data.py` 默认每次都先跑整条构筑链，再启动 server，开发冷启动成本过高。
- `init_map_data.py` 里旧的 `_legacy_main_impl()` 仍在，说明 orchestrator 已经引入，但单文件仍承担旧时代编排职责。
- `build_primary_topology_bundle()` 明面上接收 stage cache，实际函数开头直接 `del build_stage_cache`，主 stage 没有真正接入缓存增量。
- startup 资产同时由 `tools/build_startup_bootstrap_assets.py` 和 `tools/build_startup_bundle.py` 参与裁剪，规则分裂。

### 2. 数据合成与发布

- `scenario_publish_service.py` 的 `chunk-assets` 发布不是纯 checkpoint -> publish，而是发布时再回头重建 live scenario 目录。
- `startup-assets` 发布依赖根目录 `data/locales.startup.json` 和 `data/geo_aliases.startup.json` 这类全局副产物，不是 checkpoint 自给自足。
- `scenario_build_session.py` 的输入哈希只覆盖少数 canonical 文件，很多外部依赖变化不会让 checkpoint 失效。
- strict publish gate 只覆盖一小部分文件，不能代表整个 scenario bundle 都已被完整校验。

### 3. 运行时加载与数据传输

- `index.html` 既 preload 旧的 base/topology/locales/geo_aliases，又动态 preload startup bundle，存在重复抢带宽。
- 还硬编码 preload 了 `data/scenarios/tno_1962/manifest.json`，这会把默认场景逻辑写死在 shell。
- startup bundle 体量过大。当前实物：
  - `startup.bundle.en.json`: 45,984,688 bytes
  - `startup.bundle.en.json.gz`: 11,850,349 bytes
  - `startup.bundle.zh.json`: 45,994,637 bytes
  - `runtime_topology.bootstrap.topo.json`: 36,838,791 bytes
  - `runtime_topology.topo.json`: 37,208,603 bytes
- worker 与主线程之间通过 `postMessage` 直接传大对象，默认是复制语义，不是共享语义。

### 4. 模块边界与复杂度

- `init_map_data.py` 4141 行，`tools/dev_server.py` 2567 行，`js/core/scenario_resources.js` 2548 行，`js/ui/toolbar.js` 8249 行，模块职责都偏重。
- `js/core/map_renderer.js` 19615 行，已经远超“渲染器”单模块可维护边界。
- service 层和 CLI 层存在反向依赖，`scenario_materialization_service.py` 仍直接借用 `tools/dev_server.py` 的内部函数。

### 5. 逻辑错误与明显风险

- 目录锁实现以“进程内 depth”模拟可重入，但 dev server 使用 `ThreadingMixIn`，这让同进程不同线程有机会绕过真正的排他语义。
- chunk payload load 缺少 promise 级去重；当前只有 `inFlightByChunkId=true` 标记，但并不复用进行中的请求。
- `applyScenarioPoliticalChunkPayload()` 会把 viewport 合成后的 payload 写回 bundle，runtime state 和 cached bundle 状态发生混叠。
- `preloadScenarioCoarseChunks()` 已存在，但没有接到主 apply 链，属于写了一半的性能路径。

## 分卷索引

- `AUDIT_BUILD_AND_STARTUP.md`
- `AUDIT_MUTATION_PUBLISH_AND_LOCKS.md`
- `AUDIT_RUNTIME_LOADING_AND_SCENE_FLOW.md`
- `AUDIT_PERIPHERAL_PIPELINES_AND_COVERAGE.md`

## 建议执行顺序

1. 先修锁、build session、publish 事务边界。
2. 再收 startup 资产链和默认 dev 启动链。
3. 再收 runtime chunk lifecycle 和 worker 数据边界。
4. 最后统一 HOI4 / transport contract 和 CI。

## 外部规范参考

- DVC 对 stage `deps` / `outs` / `dvc.lock` 的收口方式，适合作为 checkpoint 输入输出显式化参考：<https://doc.dvc.org/user-guide/project-structure/dvcyaml-files>
- MDN 对 speculative loading 的建议强调 preload 应只给当前导航真正需要的高优先资源：<https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Speculative_loading>
- MDN 对 `rel=preload` / `modulepreload` 的区分，可直接指导当前入口脚本和数据预取策略：<https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload>
- MDN 对 Web Workers 的说明明确指出消息数据默认是 copied rather than shared，这正是当前大对象传输成本来源之一：<https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers>
