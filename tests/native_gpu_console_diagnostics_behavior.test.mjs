import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const { isNativeGpuReadbackDiagnostic, attachNativeGpuDiagnostics } = require("./e2e/support/native-gpu-diagnostics.js");

test("only proven native readback provenance is separated from actionable console issues", () => {
  const document = "http://127.0.0.1:8810/app/?sample=tno";
  const native = { type: "warning", argumentCount: 0,
    text: "[.WebGL-0x33c0a2e4a00]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels",
    location: { url: document, lineNumber: 0, columnNumber: 0 } };
  assert.equal(isNativeGpuReadbackDiagnostic(native, document), true);
  assert.equal(isNativeGpuReadbackDiagnostic({ ...native, text: native.text + " (this message will no longer repeat)" }, document), true);
  for (const change of [
    { type: "error" }, { argumentCount: 1 },
    { text: "WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost" },
    { text: native.text.replace("ReadPixels", "invalid framebuffer") },
    { text: "application warning: " + native.text },
    { location: { ...native.location, url: "http://other.test/app/" } },
    { location: { ...native.location, url: "http://127.0.0.1:8810/app/js/app.js" } },
    { location: { ...native.location, lineNumber: 12 } },
    { location: { ...native.location, columnNumber: 1 } },
    { location: undefined },
  ]) assert.equal(isNativeGpuReadbackDiagnostic({ ...native, ...change }, document), false, JSON.stringify(change));
});

test("classified diagnostics remain intact in an attached JSON artifact", async () => {
  const diagnostics = [{ type: "warning", text: "original native text", location: { lineNumber: 0 }, argumentCount: 0 }];
  const attachments = [];
  const directory = path.resolve(".runtime/tmp", `native-gpu-diagnostic-${process.pid}-${Date.now()}`);
  const artifactPath = path.join(directory, "native-gpu-readback-diagnostics.json");
  try {
    await attachNativeGpuDiagnostics({ outputPath: () => artifactPath, attach: async (...args) => attachments.push(args) }, diagnostics);
    assert.equal(attachments[0][0], "native-gpu-readback-diagnostics");
    assert.equal(attachments[0][1].path, artifactPath);
    assert.deepEqual(JSON.parse(await fs.readFile(artifactPath, "utf8")), diagnostics);
    assert.equal(attachments[0][1].contentType, "application/json");
  } finally {
    await fs.unlink(artifactPath).catch(() => {});
    await fs.rmdir(directory).catch(() => {});
  }
  await attachNativeGpuDiagnostics({ attach: () => assert.fail("empty diagnostics should not attach") }, []);
});
