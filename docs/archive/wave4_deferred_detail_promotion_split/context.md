# Context

- 任务目标：静态分析 Wave 4 下一刀，将 js/main.js 中 detail promotion 相关 owner 逻辑尽量小心地下沉到 js/bootstrap/deferred_detail_promotion.js。
- 约束：只做静态分析，不跑测试，不改生产代码。
- 关键发现：仓库里已经存在 js/bootstrap/deferred_detail_promotion.js owner，同时 main.js 仍保留一整套同名 detail promotion 本地实现，当前 boundary test 还拦不住这类双轨并存。
- 最小安全切口：把 detail topology 加载、状态提交、promotion 后地图刷新、idle 调度与模块内句柄统一收口到 deferred_detail_promotion owner；main.js 保留 ready-state 编排、startup readonly policy、render boundary/state facade 绑定。
- 重点测试缺口：需要新增 deferred detail promotion boundary contract，并在 startup data pipeline / startup scenario boot 现有测试里补 detail 初始化与 handoff 断言。
