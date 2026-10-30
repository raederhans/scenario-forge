import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const quarantine = JSON.parse(readFileSync(new URL("./quarantine.json", import.meta.url), "utf8"));

test("every quarantined test exists and states why it is skipped", () => {
  for (const suite of ["node", "python"]) {
    for (const [entry, reason] of Object.entries(quarantine[suite])) {
      const [file, ...selectors] = entry.split("::");
      assert.ok(existsSync(file), `${file} no longer exists; drop it from tests/quarantine.json`);
      if (selectors.length) {
        const source = readFileSync(file, "utf8");
        for (const [index, selector] of selectors.entries()) {
          assert.ok(selector.length > 0, `${entry} needs a test or class name`);
          const name = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const declaration = index === selectors.length - 1 ? "(?:async\\s+)?def" : "class";
          assert.match(source, new RegExp(`^\\s*${declaration}\\s+${name}\\b`, "m"),
            `${entry} names a missing test or class; drop it from tests/quarantine.json`);
        }
      }
      assert.ok(typeof reason === "string" && reason.trim().length > 10, `${entry} needs a reason`);
    }
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
