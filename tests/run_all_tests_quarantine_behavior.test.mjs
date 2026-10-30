import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const quarantine = JSON.parse(readFileSync(new URL("./quarantine.json", import.meta.url), "utf8"));

// The test ids pytest actually collects from these files, as --deselect sees them.
function collectedPythonTestIds(files) {
  const result = spawnSync(process.execPath, ["tools/run_python.mjs", "-m", "pytest", "--collect-only", "-q",
    "-p", "no:cacheprovider", "-p", "no:xdist", ...files], { encoding: "utf8" });
  assert.ok([0, 5].includes(result.status), `pytest collection failed:\n${result.stdout}\n${result.stderr}`);
  return new Set(result.stdout.split(/\r?\n/).map(line => line.trim().replace(/\\/g, "/")).filter(line => line.includes("::")));
}

test("every quarantined test exists and states why it is skipped", () => {
  for (const suite of ["node", "python"]) {
    for (const [entry, reason] of Object.entries(quarantine[suite])) {
      const [file] = entry.split("::");
      assert.ok(existsSync(file), `${file} no longer exists; drop it from tests/quarantine.json`);
      assert.ok(typeof reason === "string" && reason.trim().length > 10, `${entry} needs a reason`);
    }
  }
  const selected = Object.keys(quarantine.python).filter(entry => entry.includes("::"));
  if (!selected.length) return;
  const collected = collectedPythonTestIds([...new Set(selected.map(entry => entry.split("::")[0]))]);
  for (const entry of selected) {
    assert.ok(collected.has(entry) || [...collected].some(id => id.startsWith(`${entry}[`)),
      `${entry} is not a test pytest collects; drop or fix it in tests/quarantine.json`);
  }
});

test("slow lists name existing files once and never overlap the quarantine", () => {
  for (const [list, suite] of [["nodeSlow", "node"], ["pythonSlow", "python"]]) {
    const files = quarantine[list].files;
    assert.ok(quarantine[list]._reason, `${list} needs a reason`);
    assert.equal(new Set(files).size, files.length, `${list} has duplicates`);
    for (const file of files) {
      assert.ok(existsSync(file), `${file} no longer exists; drop it from ${list}`);
      assert.ok(!(file in quarantine[suite]), `${file} is both slow and quarantined`);
    }
  }
});
