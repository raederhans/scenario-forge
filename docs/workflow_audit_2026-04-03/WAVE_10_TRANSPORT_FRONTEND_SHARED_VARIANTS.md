# Wave 10 - Transport 前端 shared manifest v1 收口

日期：2026-04-03

## 目标

- 让 transport 前端正式以 `default_variant` / `variants` 作为唯一运行时 variant 契约
- 保留 manifest 中的 legacy variant 字段一波，但前端不再读取它们
- 不改 transport builders
- 不改 deploy gate / peripheral review workflow

## 本波范围

1. 新增一个极小的 shared helper，统一解析 transport manifest 的：
   - `default_variant`
   - `variants`
   - `variants[*]`
2. 迁移 `js/ui/transport_workbench_port_preview.js`
3. 迁移 `js/ui/transport_workbench_industrial_zone_preview.js`
4. 迁移 `js/ui/toolbar.js` 中 transport summary card、port inspector、industrial inspector 的 variant 读取
5. 补静态 contract test
6. 只新增一个 focused industrial e2e；保留现有 `transport_workbench_port_coverage_tiers.spec.js`

## 明确不做

- 不删除 manifest 里的 `coverage_variants` / `distribution_variants`
- 不新增 UI 级 legacy fallback
- 不改 `config.coverageTier` / `config.variant` 这两个现有 UI 配置名
- 不改 `carrier` 专属前端逻辑

## 验收

- `port` 预览只从 shared `default_variant` / `variants` 取 variant
- `industrial_zones` 预览只从 shared `default_variant` / `variants` 取 variant
- toolbar / inspector 不再读取 `default_coverage_tier`、`default_distribution_variant`、`coverage_variants`、`distribution_variants`
- 现有 port coverage tiers e2e 继续通过
- 新增 industrial focused e2e 通过
