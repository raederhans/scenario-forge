import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const quarantine = JSON.parse(readFileSync(new URL("./quarantine.json", import.meta.url), "utf8"));

test("every quarantined test exists and states why it is skipped", () => {
  for (const suite of ["node", "python"]) {
    for (const [file, reason] of Object.entries(quarantine[suite])) {
      assert.ok(existsSync(file), `${file} no longer exists; drop it from tests/quarantine.json`);
      assert.ok(typeof reason === "string" && reason.length > 10, `${file} needs a reason`);
    }
  }
});

test("slow lists name existing files once and never overlap the quarantine", () => {
  for (const [list, suite] of [["nodeSlow", "node"], ["nodeWindowsOnly", "node"], ["pythonSlow", "python"]]) {
    const files = quarantine[list].files;
    assert.ok(quarantine[list]._reason, `${list} needs a reason`);
    assert.equal(new Set(files).size, files.length, `${list} has duplicates`);
    for (const file of files) {
      assert.ok(existsSync(file), `${file} no longer exists; drop it from ${list}`);
      assert.ok(!(file in quarantine[suite]), `${file} is both slow and quarantined`);
    }
  }
});
