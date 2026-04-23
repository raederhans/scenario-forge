const path = require("path");
const { getConfiguredAppOrigin, getWebServerConfig } = require("./tests/e2e/support/playwright-app");

module.exports = {
  testDir: path.join(__dirname, "tests", "e2e"),
  outputDir: path.join(__dirname, ".runtime", "tests", "playwright"),
  reporter: "list",
  retries: process.env.CI ? 1 : 0,
  grepInvert: process.env.CI ? /@dev/ : undefined,
  webServer: getWebServerConfig(),
  use: {
    baseURL: getConfiguredAppOrigin(),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
};
