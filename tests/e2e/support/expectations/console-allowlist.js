const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const CITY_RUNTIME_CONSOLE_SPECS = Object.freeze([
  "tests/e2e/city_points_urban_runtime.spec.js",
  "tests/e2e/city_reveal_plan_regression.spec.js",
  "tests/e2e/river_layer_regression.spec.js",
]);

const CONSOLE_ALLOWLIST = Object.freeze([]);

function normalizeSpecPath(specPath) {
  if (!specPath) return "";
  const candidate = path.isAbsolute(specPath)
    ? path.relative(PROJECT_ROOT, specPath)
    : specPath;
  return String(candidate).replace(/\\/g, "/").replace(/^\.\//, "");
}

function entryMatchesSpec(entry, specPath) {
  const normalizedSpecPath = normalizeSpecPath(specPath);
  if (entry.scope === "global") return true;
  return Array.isArray(entry.specPaths) && entry.specPaths.includes(normalizedSpecPath);
}

function getConsoleAllowlistEntries(specPath) {
  return CONSOLE_ALLOWLIST.filter((entry) => entryMatchesSpec(entry, specPath));
}

function getConsoleIgnorePatterns(specPath) {
  return getConsoleAllowlistEntries(specPath).map((entry) => entry.pattern);
}

module.exports = {
  CONSOLE_ALLOWLIST,
  CITY_RUNTIME_CONSOLE_SPECS,
  normalizeSpecPath,
  getConsoleAllowlistEntries,
  getConsoleIgnorePatterns,
};
