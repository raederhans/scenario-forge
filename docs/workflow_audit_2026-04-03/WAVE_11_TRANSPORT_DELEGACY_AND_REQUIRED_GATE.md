# 第十一波：Transport De-Legacy 与 Required Gate

日期：2026-04-03

## 结论

这一波不再继续做 transport 的功能扩展，而是把外围 contract 收到真正可执行的 shared-only 边界：

1. `japan_port` 和 `japan_industrial_zones` 不再产出 legacy variant 字段
2. checked-in manifest 不再保留 legacy variant 字段
3. transport manifest validator 从“shared/legacy 对照”切到“shared-only，legacy 直接报错”
4. 新增独立的 `transport-contract-required.yml`，把 transport contract 从 review lane 提升为真正的轻量 required gate

## 实际改动

- `map_builder/transport_workbench_contracts.py`
  - 新增 legacy variant 字段黑名单
  - validator 不再要求 shared 字段与 legacy 字段一致
  - manifest 一旦出现 legacy variant 字段就直接失败
- `tools/build_transport_workbench_japan_ports.py`
  - 停止写 `default_coverage_tier`
  - 停止写 `coverage_variants`
  - `finalize_transport_manifest(...)` 直接消费 shared `variants`
- `tools/build_transport_workbench_japan_industrial_zones.py`
  - 停止写 `default_distribution_variant`
  - 停止写 `distribution_variants`
  - `finalize_transport_manifest(...)` 直接消费 shared `variants`
- checked-in data
  - `data/transport_layers/japan_port/manifest.json` 去掉 legacy variant 字段
  - `data/transport_layers/japan_industrial_zones/manifest.json` 去掉 legacy variant 字段
- CI
  - 新增 `.github/workflows/transport-contract-required.yml`
  - 只跑 transport manifest validator 和两组轻量 Python contract tests
  - 不接 Playwright，不碰 deploy 主 workflow

## 验证

- `python -m py_compile map_builder/transport_workbench_contracts.py tools/check_transport_workbench_manifests.py tools/build_transport_workbench_japan_ports.py tools/build_transport_workbench_japan_industrial_zones.py tests/test_transport_manifest_contracts.py`
- `python -m unittest tests.test_transport_manifest_contracts tests.test_transport_workbench_manifest_runtime_contract -q`
- `python tools/check_transport_workbench_manifests.py --root data/transport_layers --report-path .runtime/reports/generated/transport_workbench_manifest_report.json`
- 静态确认：
  - `tools/build_transport_workbench_japan_ports.py`
  - `tools/build_transport_workbench_japan_industrial_zones.py`
  - `data/transport_layers/japan_port/manifest.json`
  - `data/transport_layers/japan_industrial_zones/manifest.json`
  均已不再包含 legacy variant 键

## 剩余风险

- `peripheral-contract-review.yml` 里 transport review 还保留着，所以短期内会和新 required gate 有一层重复；这是刻意保守，不在这一波顺手去重
- HOI4 仍然停留在 review lane，没有进入 required gate；这是下一波单独处理的事情
