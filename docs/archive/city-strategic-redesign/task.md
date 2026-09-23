# Progress

- [x] City hierarchy and density policy
- [x] Flat symbols
- [x] City controls and config persistence
- [x] Strategic panel and load/query feedback
- [x] TNO source assessment
- [x] Targeted tests and localhost browser check
- [x] Correct the reproduced city status count (settled markers were visible while the panel reported zero).

Validation: city renderer/policy/persistence batch 54/54 passed; latest label/strategic-owner/color/signature integration batch 51/51 passed; five Python renderer boundary tests passed. Earlier city-control, view-model and palette checks also passed after updating obsolete theme-reset assertions. These batches overlap and are not a unique total.

Local browser: TNO flat symbols at 400%, density preserved across palette change, bilingual controls; HOI4 1936 steel and HOI4 1939 infrastructure loaded with live legend and queries. 1939 search FRA narrowed to 29 regions plus placeholder; s1 infrastructure = 2, coverage 810/986. No warning/error console entries on final page. TNO remains explicitly unsupported for strategic mapping.

Known separate observation: HOI4 sea areas receive political fill even with strategic shading disabled; root cause not established. Do not infer this is a strategic-data or city-marker regression. No scenario data, production release or commits were made by this task.

Completion: status diagnostics/contract tests 15/15 passed; refreshed browser showed 27 visible markers rather than a false zero. Chinese capital/count/status copy was aligned across runtime catalog and locale sources; JSON parsing and copy-consistency check passed. Scoped diff check passed. All requested implementation stages are complete, with TNO mapping and the separate sea-fill observation explicitly remaining outside the delivered data integration.
