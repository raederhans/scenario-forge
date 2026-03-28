# MapCreator 低风险推进进度留档

日期：2026-03-28

## 1. 本轮实际已落地内容

### 1.1 第 0 周：治理面补齐

- 已在基线文档中补上持续追踪表：
  - 问题编号
  - 当前状态
  - 权威文件
  - 验收命令
  - 下一步负责人
- 当前只覆盖三类治理对象：
  - `data/` 资产分类
  - build/scenario stage ownership
  - 前端高风险状态 owner

对应文件：
- `docs/BUILD_AND_SCENARIO_CONTRACT_BASELINE_2026-03-28.md`

### 1.2 第 1 周：契约检查分层

- `tools/check_scenario_contracts.py` 现在显式分成两层：
  - 默认模式：非 strict 阻塞层
  - `--strict`：审查层
- strict 模式已支持结构化 repair report 落盘。
- 当前固定输出四类 repair tracks：
  - `owners/controllers` keyset
  - `owners/cores` keyset
  - `runtime_topology` extra ids
  - `geo_locale` collision candidates
- `deploy.yml` 的 `verify` 已接入非 strict 场景契约检查。
- 新增独立 strict 手工审查 workflow，不阻塞 deploy。

对应文件：
- `tools/check_scenario_contracts.py`
- `.github/workflows/deploy.yml`
- `.github/workflows/scenario-contract-strict-review.yml`
- `package.json`

### 1.3 第 2 周：第一类 TNO strict 数据修复

- 本轮只修了一类 strict 差异：
  - TNO 希腊粗粒度 ADM1 要素在 `controllers/cores/runtime_topology` 已存在，但 `owners` 缺失
- 修法限定在 TNO 专用 patch 层，不改共享 HOI4 编译链。
- 已新增 TNO 专用 owner backfill helper，并要求：
  - feature 必须真实存在
  - controller 必须存在且一致
  - core 必须存在且一致
- 已同步更新 repo-tracked 数据文件：
  - `data/scenarios/tno_1962/owners.by_feature.json`
  - `data/scenarios/tno_1962/controllers.by_feature.json`
  - `data/scenarios/tno_1962/countries.json`
  - `data/scenarios/tno_1962/manifest.json`
  - `data/scenarios/tno_1962/audit.json`

对应文件：
- `tools/patch_tno_1962_bundle.py`
- `tests/test_tno_bundle_builder.py`

## 2. 当前验证结果

### 2.1 已通过

```text
python -m unittest discover -s tests -q
=> Ran 85 tests
=> OK

npm run test:e2e:smoke
=> 4 passed

python tools/check_scenario_contracts.py --scenario-dir data/scenarios/tno_1962
=> OK
```

### 2.2 strict 仍未通过，但已明显收敛

```text
python tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/tno_1962.strict_contract_report.json
=> FAILED
```

当前 strict 剩余问题：

- `owners/controllers` 只剩 `RU_ARCTIC_FB_*` 缺口
- `owners/cores` 只剩 `RU_ARCTIC_FB_*` 缺口
- `geo_locale` 仍有大量 collision candidates，需要审查，不适合现在硬塞进默认阻塞

本轮修复后的收敛效果：

- `owners/controllers` 的 `controller_only` 从 `401` 降到 `390`
- `owners/cores` 的 `core_only` 从 `29` 降到 `18`
- `runtime_topology extra ids` 中希腊粗粒度项已清零

## 3. 当前结论

这轮方向是对的，原因有三点：

1. 没有去改弱 strict 规则，而是保留规则、修实际数据。
2. 没有把修复扩散到共享编译链，只收在 TNO 专用 patch 层。
3. strict 差异是按问题类型缩减的，不是从一个文件漂移到另一个文件。

## 4. 下一步方案

下一步不建议切到前端主线 B，也不建议现在去碰 `init_map_data.py` 的大编排 seam。

最小、最稳的下一刀应该是继续主线 A，只处理 `RU_ARCTIC_FB_*`：

1. 先确认这批 `RU_ARCTIC_FB_*` 的语义到底是什么：
   - 纯 runtime shell fragment
   - 需要 owner 的真实政治要素
2. 如果它们是 shell/runtime-only：
   - 修 TNO patch 层和 strict 解释，使 `owners/controllers/cores` 不再错误携带它们
3. 如果其中一部分是真实政治要素：
   - 只补那一部分的 owner，并同步计数/摘要文件
4. `geo_locale` 继续留在 strict 审查层，不进默认 gate

## 5. 为什么下一步先打 RU_ARCTIC

- 这是 strict 当前最大的剩余结构性差异。
- 它仍然属于主线 A，不会打破“同一周只走一条主线”的节奏。
- 它和前端边界、交互 funnel 没有直接耦合，现在切去前端只会把主线打散。
- 只要把 `RU_ARCTIC_FB_*` 这一类再收掉，strict 会继续大幅收敛，届时再判断是否该进入下一周或是否继续清理 `geo_locale` 人工审查项。

## 6. 你下一步预期会看到的效果

如果下一刀处理正确，你会看到：

- strict 报告里不再出现大批 `RU_ARCTIC_FB_*` 的 keyset 差异
- `owners/controllers` 和 `owners/cores` 的数量差再缩一截，最好直接归零
- 默认 `verify` 仍保持稳定，不会因为 strict 审查项被误塞进 deploy 而变脆
- 场景数据修复仍然只限于 TNO，不会误伤 `hoi4_1936/1939`

如果这一步完成后 strict 只剩 `geo_locale` 审查项，那时才适合判断：

- 是继续做数据审查清单
- 还是切到前端主线 B，开始做 `interaction_funnel.js` 的第一刀
