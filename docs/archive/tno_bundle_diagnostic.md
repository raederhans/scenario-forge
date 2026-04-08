# TNO bundle 崩溃排查（2026-04-03）

本文件把本地可重复执行的最小诊断步骤固定下来，避免再次出现“手工口述通过、但无法快速复现”的情况。

## 结论摘要

1. 目前仓库中的 `tools/patch_tno_1962_bundle.py` 已定义 `SCENARIO_DIR`，不存在 `SCENARIO_DATA_DIR` 常量。之前测试引用 `SCENARIO_DATA_DIR` 会触发 `AttributeError`，属于测试代码错误，而非 bundle 运行时崩溃。
2. 当前 checked-in 数据在 owner-only backfill 触点上是**自洽**的（feature id 不缺失、受影响 tag 的 owner 计数与 `countries.json.feature_count` 一致）。
3. 目前脚本已有 build session 级 `.build.lock`，且 `main()` 与 mutating stage 都在锁保护范围内；同进程可重入、活锁阻塞、stale lock 回收路径都存在代码与测试覆盖。

## 最小诊断命令

```bash
python -m py_compile tools/patch_tno_1962_bundle.py tests/test_tno_bundle_builder.py

python - <<'PY'
import json
from collections import Counter
from tools.patch_tno_1962_bundle import SCENARIO_DIR, TNO_1962_OWNER_ONLY_BACKFILL

owners_payload = json.loads((SCENARIO_DIR / 'owners.by_feature.json').read_text(encoding='utf-8'))
countries_payload = json.loads((SCENARIO_DIR / 'countries.json').read_text(encoding='utf-8'))
owners = owners_payload['owners']
countries = countries_payload['countries']
missing = [fid for fid in TNO_1962_OWNER_ONLY_BACKFILL if fid not in owners]
affected = sorted({*TNO_1962_OWNER_ONLY_BACKFILL.values(), *(str(owners.get(fid) or '').strip() for fid in TNO_1962_OWNER_ONLY_BACKFILL)})
owner_counts = Counter(str(v or '').strip() for v in owners.values())
mismatch = {
    tag: {
        'countries_feature_count': countries.get(tag, {}).get('feature_count'),
        'owners_count': owner_counts[tag],
    }
    for tag in affected
    if countries.get(tag, {}).get('feature_count') != owner_counts[tag]
}
print({'missing_feature_ids': missing, 'count_mismatches': mismatch})
PY

python -m pytest -q tests/test_tno_bundle_builder.py -k 'checkpoint_build_lock or owner_only_backfill_touchset'
```

## 云端接手建议

1. 先只看正式改动文件：
   - `tools/patch_tno_1962_bundle.py`
   - `tests/test_tno_bundle_builder.py`
2. 先跑 bundle 相关测试子集，再决定是否执行 rebuild/publish。
3. 如果要发布 owner-only backfill 到正式数据，再单独做 rebuild/publish，并联动检查 `owners.by_feature.json`、`countries.json` 和 startup bundle 产物。
