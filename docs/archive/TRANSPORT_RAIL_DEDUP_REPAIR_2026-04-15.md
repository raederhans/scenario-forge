# TRANSPORT_RAIL_DEDUP_REPAIR_2026-04-15

## Plan
- 修复 rail region/shard 唯一归属，去掉重复 feature。
- 修复 `--shard` 单独使用时的 region 反推。
- 把递归 rail shard manifests 拉回共享契约校验。
- 重建全部 rail shard 与 rail catalog，并重新验证。

## Progress
- [x] 复核 review 问题与现状，确认重复 feature、CLI 回归、递归漏检都能本地复现。
- [x] 修改 rail builder、manifest discovery 和测试。
- [x] 后台串行重建全部 rail shard 与 rail catalog。
- [x] 运行验证并归档文档。

## Verification
- `python -m unittest tests.test_global_transport_builder_contracts tests.test_transport_manifest_contracts tests.test_transport_workbench_manifest_runtime_contract -q`
- `python tools/check_transport_workbench_manifests.py --root data/transport_layers --report-path .runtime/reports/generated/transport_workbench_manifest_report.json`
- 额外确认：全部 checked-in rail `railways.topo.json` 的 feature id 全局唯一，`duplicate_count = 0`。
