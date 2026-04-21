// Boot state defaults.
// 这里收口 startup/boot 壳层和只读解锁相关默认 shape，
// 保持 state.js 继续作为公开 facade。

export function createDefaultStartupBootCacheState() {
  return {
    enabled: false,
    baseTopology: "idle",
    localization: "idle",
    scenarioBootstrap: "idle",
  };
}

export function createDefaultBootState() {
  return {
    bootPhase: "shell",
    bootMessage: "Starting workspace…",
    bootProgress: 0,
    bootBlocking: true,
    bootPreviewVisible: false,
    bootError: "",
    bootCanContinueWithoutScenario: false,
    startupInteractionMode: "readonly",
    startupReadonly: false,
    startupReadonlyReason: "",
    startupReadonlyUnlockInFlight: false,
    startupReadonlySince: 0,
    bootMetrics: {},
    startupBootCacheState: createDefaultStartupBootCacheState(),
  };
}
