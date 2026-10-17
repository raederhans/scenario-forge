const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const {
  gotoApp,
  waitForScenarioReadyGate,
  readSmokeFailureSnapshot,
  writeFailureContextArtifact,
} = require("./support/playwright-app");
const { mergeSmokeFailureSelectors } = require("./support/playwright-selectors");
const { getConsoleIgnorePatterns } = require("./support/expectations/console-allowlist");
const { readConsoleIssue, isNativeGpuReadbackDiagnostic, attachNativeGpuDiagnostics } = require("./support/native-gpu-diagnostics");

test.setTimeout(120000);
const HOI4_SMOKE_PATH = '/?render_profile=balanced&startup_interaction=readonly&startup_worker=1&startup_cache=1&default_scenario=hoi4_1939';
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readScenarioJson(...relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...relativePath), 'utf8'));
}

test('hoi4 1939 owner-sync smoke', async ({ page }, testInfo) => {
  const consoleIssues = [];
  const networkFailures = [];
  const expectedConsolePatterns = getConsoleIgnorePatterns(__filename);

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      consoleIssues.push(readConsoleIssue(msg));
    }
  });

  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400) {
      networkFailures.push({ url: res.url(), status });
    }
  });

  page.on('requestfailed', (req) => {
    networkFailures.push({
      url: req.url(),
      status: 'failed',
      errorText: req.failure() ? req.failure().errorText : 'requestfailed',
    });
  });

  try {
    await gotoApp(page, HOI4_SMOKE_PATH, { waitUntil: 'domcontentloaded' });
    await waitForScenarioReadyGate(page, { scenarioId: "hoi4_1939", timeout: 120_000 });
    await page.evaluate(() => {
      const details = document.querySelector("details[aria-labelledby='lblScenario']");
      if (details && !details.open) {
        details.open = true;
      }
    });
    await expect(page.locator('#scenarioSelect')).toBeVisible();
    await expect.poll(() => page.locator('#scenarioSelect').inputValue(), { timeout: 20000 }).toBe('hoi4_1939');

    const selectedScenarioId = await page.locator('#scenarioSelect').inputValue();
    const scenarioStatus = await page.locator('#scenarioStatus').innerText();
    const scenarioAuditHint = await page.locator('#scenarioAuditHint').innerText();
    const countries = readScenarioJson('data', 'scenarios', 'hoi4_1939', 'countries.json').countries || {};
    const manifest = readScenarioJson('data', 'scenarios', 'hoi4_1939', 'manifest.json');

    const controllerOnlyCountries = Object.values(countries)
      .filter((entry) => entry && entry.entry_kind === 'controller_only');

    expect(selectedScenarioId).toBe('hoi4_1939');
    const ownerControllerSplitFeatureCount = Number(manifest?.summary?.owner_controller_split_feature_count || 0);
    if (ownerControllerSplitFeatureCount > 0) {
      expect(scenarioAuditHint.toLowerCase()).toContain('split');
      expect(scenarioAuditHint).toContain(String(ownerControllerSplitFeatureCount));
    } else {
      expect(scenarioAuditHint.toLowerCase()).toContain('ownership baseline active');
    }

    expect(controllerOnlyCountries).toHaveLength(Number(manifest?.summary?.controller_rule_count || 0));

    const shotPath = path.join('.runtime', 'browser', 'mcp-artifacts', 'screenshots', 'hoi4_1939_ui_smoke.png');
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    await page.screenshot({ path: shotPath, fullPage: true });

    const nativeGpuDiagnostics = consoleIssues.filter(issue => isNativeGpuReadbackDiagnostic(issue, page.url()));
    await attachNativeGpuDiagnostics(testInfo, nativeGpuDiagnostics);
    const actionableConsoleIssues = consoleIssues.filter(
      (issue) => !nativeGpuDiagnostics.includes(issue) && !expectedConsolePatterns.some((pattern) => pattern.test(issue.text)),
    );
    expect(actionableConsoleIssues, `Console issues: ${JSON.stringify(consoleIssues, null, 2)}`).toEqual([]);
    expect(networkFailures, `Network failures: ${JSON.stringify(networkFailures, null, 2)}`).toEqual([]);

    console.log(JSON.stringify({
      scenarioStatus,
      scenarioAuditHint,
      selectedScenarioId,
      controllerOnlyCount: controllerOnlyCountries.length,
      consoleIssueCount: consoleIssues.length,
      actionableConsoleIssueCount: actionableConsoleIssues.length,
      networkFailureCount: networkFailures.length,
      consoleIssues,
      networkFailures,
      screenshot: shotPath,
    }, null, 2));
  } catch (error) {
    const smokeFailureSnapshot = await readSmokeFailureSnapshot(page, mergeSmokeFailureSelectors(
      "bootShell",
      "scenarioShell",
      "hoi4ScenarioAudit",
    ));
    await writeFailureContextArtifact(testInfo, smokeFailureSnapshot);
    throw error;
  }
});
