# HOI4、transport workbench、测试与 CI 专题审计

## 结论和修复方案

外围链路当前最大的问题是“都能跑，但不在同一契约世界里”。HOI4 builder、HOI4 checker、transport builders、transport preview、CI gate 现在还是多套半共享结构。建议直接统一成“共享 manifest schema + 共享 validator + 最小场景级 CI”。

最短路线：

1. 把 HOI4 从“单独 builder + 单独 checker”收成共享 scenario contract。
2. 把 transport family 的 manifest 方言统一成一套 schema。
3. 把 `carrier` 从特例资产变成同 schema family。
4. CI 至少覆盖：
  - TNO strict contract
  - HOI4 completeness
  - transport manifest schema

## 已确认问题

### 1. `build_hoi4_scenario.py` 按当前工具边界看还不是自给自足的完整 scenario pack builder

证据：

- `tools/build_hoi4_scenario.py` 负责生成 HOI4 场景主体包
- 但从当前仓库的场景消费方式和测试约束看，城市、capital、geo-locale 相关产物仍依赖主线其他阶段补齐
- 仓库其他测试也明确把 `city_overrides_url`、`capital_hints_url` 视为场景 manifest 的正常组成部分

问题：

- 名字叫 build scenario
- 但按当前静态边界看，它更接近“构建核心场景包”，不是“独立产出完整 pack”

结果：

- 开发者很容易误以为这个脚本可以独立产出完整 pack
- 真实产物完备性仍依赖外部后处理或主线补齐

建议：

- 要么改名，明确它只是 `compile_hoi4_core_bundle.py`
- 要么扩成完整 pack builder，把 manifest 必需资产一次性补齐
- 更推荐后者，因为外围链路已经在按“完整场景包”消费它

### 2. `check_hoi4_scenario_bundle.py` 成了共享 contract 外的私有 checker

证据：

- `tools/check_hoi4_scenario_bundle.py:250-256` 直接读取 `coverage_report.md`
- `tools/check_hoi4_scenario_bundle.py:281-294` 自己定义一套 manifest 必填校验
- `tools/check_hoi4_scenario_bundle.py:480` 把 markdown report 数字和 audit summary 做对比

问题：

- 这不是共享 scenario contract checker
- 而是一个 HOI4 私有 checker，还把 markdown report 也纳进契约

结果：

- checker 逻辑重复
- contract 规则散落
- 如果共享 contract 升级，HOI4 旁路不一定同步

建议：

- 共享 contract 只校验运行时真实消费产物
- `coverage_report.md` 这种报告文件只能做审计参考，不应成为正式 publish 契约的一部分
- HOI4 checker 如果保留，只做 domain-specific rule layer，底层 contract 必须复用 shared checker

### 3. CI 目前只严格收口到 `tno_1962`

证据：

- `.github/workflows/scenario-contract-strict-review.yml:25`
- `.github/workflows/deploy.yml:49`
- 两个 workflow 都是：
  - `python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/tno_1962`

问题：

- HOI4 没进同等级 strict gate
- transport builder 也没进 schema gate

结果：

- 仓库看起来有 CI
- 但 CI 的真实保护范围比文档和结构暗示的要窄得多

建议：

- 增加：
  - `hoi4_1936` 或 `hoi4_1939` strict pack completeness check
  - transport manifest schema validation
- 不需要一上来全量 e2e，只要先收口 contract 层就够

### 4. transport workbench 存在 manifest 方言分裂

证据：

- `js/ui/toolbar.js:2498` 开始读取 `distribution_variants`
- `js/ui/transport_workbench_industrial_zone_preview.js:44-77` 直接围绕 `distribution_variants`、`default_distribution_variant` 做逻辑
- 其他 family 又各自读取：
  - `distribution_tier`
  - `coverage_scope`
  - `source_policy`
  - `feature_counts`
  - 各自专属字段

问题：

- UI 不是在消费“统一 manifest schema”
- 而是在消费“每个 family 自己的一套字段组合”

建议：

- 定义统一字段层：
  - `adapter_id`
  - `recipe_version`
  - `generated_at`
  - `feature_counts`
  - `variants`
  - `source_policy`
  - `distribution_tier`
  - `audit_url`
- family-specific 字段全部挂在 `extensions.{family}` 里

### 5. `carrier` 仍是 transport workbench 的特例资产

证据：

- `js/ui/transport_workbench_carrier.js:1` 默认加载 `data/transport_layers/japan_corridor/carrier.json`
- `docs/regional_observatory/2026-04-01-regional-observatory-design.md:251-257` 已经说明旧 carrier 概念正在被重新定义

问题：

- carrier 仍然是一个特殊基础资产，不是普通 family
- 这会迫使 transport 其余 family 都围着 carrier 特例来写 UI 和 runtime

建议：

- 把 carrier 也纳入统一 asset manifest
- 至少给它补：
  - manifest
  - build audit
  - versioned build metadata

### 6. transport 测试主要偏 UI，缺 builder / schema 级保障

证据：

- 仓库有 transport e2e：
  - `tests/e2e/transport_workbench_port_coverage_tiers.spec.js`
  - `tests/e2e/transport_workbench_label_rotation.spec.js`
- 但没有对应的统一 transport manifest validator test 链

问题：

- UI 通过，不代表 pack schema 稳定
- builder 一旦改字段，前端很可能在局部 family 上才暴露问题

建议：

- 增加 transport family schema tests
- 每个 builder 产物至少跑：
  - manifest schema
  - build audit schema
  - required pack paths existence

## 证据定位

- `tools/build_hoi4_scenario.py`
- `tools/check_hoi4_scenario_bundle.py:250`
- `tools/check_hoi4_scenario_bundle.py:281`
- `.github/workflows/scenario-contract-strict-review.yml:25`
- `.github/workflows/deploy.yml:49`
- `js/ui/toolbar.js:2498`
- `js/ui/transport_workbench_industrial_zone_preview.js:44`
- `js/ui/transport_workbench_carrier.js:1`
- `docs/regional_observatory/2026-04-01-regional-observatory-design.md:251`

## 建议优先顺序

1. HOI4 先统一到底层 shared scenario contract
2. transport 定一份统一 manifest schema
3. carrier 进入同 schema
4. CI 加最小 contract gate
5. 最后再补 family-specific e2e
