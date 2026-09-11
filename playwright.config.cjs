const path = require("path");
const { getConfiguredAppOrigin, getWebServerConfig } = require("./tests/e2e/support/playwright-app");

const RELEASE_GATE_LIFECYCLE_EVENTS = new Set([
  "test:e2e:pages-public-release-gate",
  "test:e2e:pages-public-release-gate:deployed",
]);
const isReleaseGateRun = RELEASE_GATE_LIFECYCLE_EVENTS.has(
  String(process.env.npm_lifecycle_event || "")
);
const testIgnore = [
  ...(process.env.CI ? [/[\\/]tests[\\/]e2e[\\/]dev[\\/]/] : []),
  ...(!isReleaseGateRun ? [/[\\/]tests[\\/]e2e[\\/]release[\\/]/] : []),
];

module.exports = {
  // Large map-data PRs can exceed Node's string limit before Playwright truncates
  // its report attachment. GitHub retains the diff; keep default commit metadata.
  captureGitInfo: { diff: false },
  testDir: path.join(__dirname, "tests", "e2e"),
  outputDir: path.join(__dirname, ".runtime", "tests", "playwright"),
  reporter: [
    ["list"],
    ["./tests/e2e/support/reporters/timing-reporter.js"],
    ["./tests/e2e/support/reporters/failure-context-reporter.js"],
  ],
  retries: process.env.CI ? 1 : 0,
  // Keep root-level @dev-tagged cases out of CI; deployed release smoke has an explicit npm-owned lane.
  grepInvert: process.env.CI ? /@dev/ : undefined,
  testIgnore: testIgnore.length ? testIgnore : undefined,
  webServer: getWebServerConfig(),
  use: {
    baseURL: getConfiguredAppOrigin(),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
};
