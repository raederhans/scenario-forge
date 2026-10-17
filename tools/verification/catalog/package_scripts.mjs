import fs from "node:fs";

// package.json is the executable source of truth; do not maintain a shadow copy.
export const PACKAGE_SCRIPTS = JSON.parse(
  fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
).scripts;
