# TNO Bundle 与共享编辑层双轨审查结论与重构方案

## 摘要

- 当前不是“个别脚本偶发写错”，而是边界模型本身有漏洞。核心问题有四个：
  - `tools/patch_tno_1962_bundle.py` 职责过重，已经同时承担规则仓库、阶段编排器、checkpoint 平台适配、startup 资产协调、发布器和 chunk 重建器。
  - `tools/dev_server.py` 里的编辑工具不是在写单一 source-of-truth，而是在直接改发布产物，同时再写 `scenario_manual_overrides`、`city_overrides`、`releasable catalog` 等镜像层，形成多份真相。
  - `stage` 名字和真实副作用不一致。`geo_locale` 阶段会写 startup 全局文件并构建 startup bundle，`write_bundle` 阶段会继续重建 chunk 和改 manifest，所以“有 stage”不等于“边界干净”。
  - 测试更多是在证明“当前多点写入模型能工作”，不是在强约束“只能有一个真相源”。
- 现有开发者工具对地块编辑、tag 创建、汉化、国家名修改、首都修改，不是最优接口。它们短期方便，但长期一定继续制造 bundle 漂移、回滚复杂度和心智负担。
- 推荐双轨推进：
  - 短期先止血，收紧阶段副作用、统一锁语义、停止编辑入口直写发布产物。
  - 中期直接做可破坏式重构，把 scenario 编辑层改成“mutation layer -> materializer -> publish”，不再让编辑器碰正式 bundle 文件。

## 关键结论

- 过重模块需要优先拆：
  - `tools/patch_tno_1962_bundle.py`：应从“大脚本顺序过程”拆成资产单元和薄调度器。
  - `tools/dev_server.py`：应从“直写发布数据的万能编辑器”拆成“mutation API + materialize 触发器”。
  - `map_builder/contracts.py`：保留为 contract registry，但要升级成执行时真实依赖图的来源，不只是描述文档。
- 已知隐患，默认都按真实风险处理，不当作“经验提醒”：
  - `geo_locale` 阶段写根目录 `data/locales.startup.json` 和 `data/geo_aliases.startup.json`，说明 checkpoint 锁的名义范围和真实副作用范围不一致。
  - `write_bundle` 后置重建 chunk，导致 publish 不是终点，而是新的派生阶段入口。
  - `dev_server` 只有线程级 `RLock`，没有跨进程 scenario 级锁；它和 bundle builder 现在不是同一把锁模型。
  - `save_scenario_geo_locale_entry()` 会触发 builder 子过程，其他编辑入口却只是直接改文件，不同编辑入口的一致性策略不统一。
  - `geo_locale` 仍以 `feature_id` 为主身份，feature split/merge 后长期会继续积累 collision、reviewed exceptions 和人工审查面。
  - 文档/contract 已经开始出现和真实代码部分漂移，且当前诊断文档在 Windows shell 下有编码可读性问题，说明知识沉淀链也不稳。
- 采用的外部工程原则，不是要强行引入新框架，而是借其一等公民概念校对本地设计：
  - Bazel 官方文档强调每个 action 都应显式声明输入和输出，且输出状态应位于统一输出根目录，而不是和源树混放。  
    https://bazel.build/versions/8.0.0/remote/caching  
    https://bazel.build/versions/8.0.0/remote/output-directories
  - DVC 官方文档强调 pipeline 由显式依赖图、`deps`、`outs` 和 lock/state 文件驱动，重建时先根据依赖变化判断哪些阶段需要运行。  
    https://doc.dvc.org/command-reference/repro  
    https://doc.dvc.org/user-guide/project-structure/dvcyaml-files
  - Dagster 官方文档把 asset、依赖、asset checks、subset execution 作为一级概念。这里不建议直接迁移 Dagster，但建议借用 asset graph 思维改造本地 bundle。  
    https://docs.dagster.io/  
    https://docs.dagster.io/guides/build/assets/defining-assets

## 设计方案

### 方案对比

- 方案 A：继续维持当前结构，只补测试和 guard。
  - 适合短期止血。
  - 不能解决多份真相和职责混杂，最终还会回到同类问题。
- 方案 B：保留 Python 工具链，但把 bundle 真正改成显式 asset graph。
  - 这是推荐方案。
  - 不引入重编排框架，但要重画边界、明确输入输出、统一 materialize。
- 方案 C：直接把编辑层和 bundle 层一起重做成统一 scenario mutation system。
  - 长期最干净。
  - 改动面最大。
  - 因为当前允许可破坏式重构，所以建议采用 B+C 组合：先按 B 的资产边界拆，再直接把编辑层落到 C 的 mutation 模型上，不再为旧直写模型保长期兼容。

### 新的目标架构

- 引入单一场景真相源：
  - 新增一个 canonical `scenario_mutations.json`，统一承载：
    - `tags`
    - `countries`
    - `assignments_by_feature_id`
    - `capitals`
    - `geo_locale`
    - `district_groups`
  - 删除“编辑器同时写 `countries.json` / `scenario_manual_overrides.json` / `city_overrides.json` / local releasable catalog”的长期模型。
- 将 bundle 产线重组为 7 个资产单元：
  - `source_snapshot`
  - `country_state`
  - `runtime_topology`
  - `geo_locale`
  - `startup_assets`
  - `publish`
  - `chunk_assets`
- 每个资产单元只做一件事：
  - `source_snapshot`：解析 TNO/HGO roots、输入版本指纹、生成 source snapshot metadata。
  - `country_state`：根据 source snapshot 和 scenario mutations 产出 `countries / owners / controllers / cores / scenario manifest state`。
  - `runtime_topology`：根据 `country_state` 产出 runtime topology、water、relief、bootstrap topology。
  - `geo_locale`：根据 runtime topology、全局 locale、scenario locale mutations 产出 `geo_locale_patch` 与 audit。
  - `startup_assets`：根据 bootstrap topology、startup locales、startup aliases、geo locale 产出 startup bundles。
  - `publish`：只做 checkpoint/build outputs -> scenario publish 目录的原子发布。
  - `chunk_assets`：只依据已发布 runtime/bootstrap/manifest 生成 chunks 与 chunk manifest。
- 明确禁止跨阶段副作用：
  - `geo_locale` 不再写根目录 startup 文件。
  - `write_bundle` 不再重建 chunk。
  - `publish` 之后如果要建 chunk，必须显式调用 `chunk_assets`。
- 所有构建输出都写到统一 build root：
  - 默认 `/.runtime/build/scenario/<scenario_id>/<snapshot_hash>/...`
  - repo 下的 `data/scenarios/<scenario_id>/...` 只作为 publish target，不作为中间工作目录。
- 引入统一 build state 文件：
  - 新增 `scenario_build.lock.json`
  - 记录每个资产单元的输入哈希、输出哈希、代码版本、生成时间
  - 用于决定增量重建和审计，不再依赖“脚本内部大段 if + checkpoint 是否存在”

## 对外接口与工具边界

- 现有 `dev_server` 保存接口全部改语义，不再允许直写发布产物。
- 新接口只允许写 mutation 层：
  - `save_scenario_tag_create_payload` 只注册 tag 元数据，不再自动改 owner/controller/core。
  - `save_scenario_country_payload` 只改 country mutation，不再直接改 `countries.json`。
  - `save_scenario_capital_payload` 只改 capital mutation，不再同时维护 country entry 和 city hints 两份真相。
  - `save_scenario_geo_locale_entry` 只改 locale mutation，不直接运行 patch builder。
  - `save_scenario_ownership_payload` 只改 feature assignment mutation，不再直接重算 `feature_count` 并写回发布文件。
- 新增两个明确命令层：
  - `materialize_scenario_mutations(scenario_id, targets=...)`
  - `publish_scenario_build(scenario_id, build_id, targets=...)`
- tag 创建和地块分配拆成两个动作：
  - “创建 tag”只是注册一个国家实体。
  - “把哪些 feature 分给它”是独立 assignment mutation。
  - 这是必须做的破坏式修正，不能再保留“建 tag 自动重分配一批 feature”的复合接口。
- 首都信息只保留一份 canonical mutation 记录：
  - `capital_feature_id`
  - `capital_city_id`
  - `capital_state_id`
  - `capital_hint`
  - UI 所需的 `city hint` 由 materializer 派生，不再另做平行真相。

## 测试与验收

- 必须新增的 contract 测试：
  - 任一编辑接口调用后，只允许 mutation 层文件变化，不允许 `countries.json`、`owners.by_feature.json`、startup bundles 直接变化。
  - `materialize(country_state)` 后，`feature_count` 与 owner assignments 必须一致。
  - `materialize(geo_locale)` 后，只允许 `geo_locale_patch*` 和其 audit 变化，不允许 startup 文件直接变化。
  - `publish()` 后，只允许 publish target 变化，不允许隐式重建 chunk。
  - `chunk_assets()` 后，新增 chunk 必须全部被 chunk manifest 引用；manifest 引用的 chunk 必须全存在。
  - `dev_server` 和 bundle builder 对同一 scenario 使用同一把跨进程锁；第二个 writer 必须明确失败，而不是静默等待后混写。
- 必须新增的端到端场景：
  - 新建 tag，不分配地块，materialize 后国家存在但 `feature_count` 为 0。
  - 修改 country 名称/汉化，不跑 ownership，不应影响 runtime topology。
  - 修改 capital，只影响 capital materialization 和依赖它的 startup/UI 资产。
  - 修改 geo locale，只重建 geo locale 和 startup assets，不重建 country state。
  - 修改 owner/controller/core，只重建 country state、runtime topology、startup assets、chunk assets。
  - 两个进程同时尝试编辑同一 scenario，一个应被锁拒绝。
- 必须删除或降级的测试：
  - 任何把“当前多点写入模型本身”当正确行为的测试。
  - 这类测试要改成验证 mutation 层与 materialize 结果，不再验证“保存时顺手写了多少发布文件”。

## 交付顺序

- 第一阶段，先做治理止血，不改 UI 交互形态：
  - 引入统一 scenario 级跨进程锁，builder 和 dev_server 共用。
  - 把 `geo_locale` 的 startup 副作用移出。
  - 把 `write_bundle` 的 chunk 重建移出。
  - 新建 `scenario_mutations.json`，但先只接入 tag/country/capital/ownership/geo_locale 5 类编辑。
  - 停止所有编辑入口对发布文件的直写。
- 第二阶段，切换 materialize 链：
  - `country_state -> runtime_topology -> geo_locale -> startup_assets -> publish -> chunk_assets`
  - 让 `tools/patch_tno_1962_bundle.py` 只保留 CLI 参数解析和调度。
- 第三阶段，清理旧模型：
  - 退役 `scenario_manual_overrides.json`、`city_overrides`、scenario-local releasable catalog 镜像作为长期真相源。
  - 它们若还保留，只允许作为一次性迁移输入，不再由编辑器写入。

## 明确假设

- 范围锁定为 `TNO 1962 bundle + 共享 scenario 编辑层`，不扩到整个全局 `init_map_data` 体系的所有 builder。
- 输出采用“双轨并重”：先给短期 hardening，再给中期新架构。
- 迁移策略采用“可破坏式重构”，默认允许旧 dev 工具和旧直写流程失效，不为兼容性保留复杂分支。
- 不引入 Bazel/DVC/Dagster 作为运行时依赖；只吸收它们的工程原则。
