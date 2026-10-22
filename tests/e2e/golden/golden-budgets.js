// Performance budgets for the golden flows. They catch large regressions, not small
// drift. Measured on a fast desktop (2026-10-22): cold startup 31 s, fill click 128 ms.
// GitHub runners are roughly 2x slower, so each limit leaves about 2-3x headroom beyond
// that. Tighten them as the rewrite makes the app faster.
const PERF_BUDGETS = Object.freeze({
  startupMs: 120_000,
  fillInteractionMs: 800,
});

module.exports = { PERF_BUDGETS };
