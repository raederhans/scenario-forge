// Chromium 145's ANGLE emits this notice on synchronous image readback, including
// Canvas copies and screenshots. It is not a GL error or a measured regression.
// Pinned source: google/angle@4c0ae3917d4feab6ae1c99d7b750a69cdf3cc96c,
// src/libANGLE/renderer/vulkan/vk_helpers.cpp:10453. Keep the actual pixels,
// network and performance gates, and retain this diagnostic as a test artifact.
const READBACK_NOTICE = /^\[\.WebGL-0x[0-9a-f]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels(?: \(this message will no longer repeat\))?$/i;
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function readConsoleIssue(message) {
  return { type: message.type(), text: message.text(), location: message.location(), argumentCount: message.args().length };
}

function isNativeGpuReadbackDiagnostic(issue, documentUrl) {
  if (issue.type !== "warning" || issue.argumentCount !== 0 || !READBACK_NOTICE.test(issue.text)
    || issue.location?.lineNumber !== 0 || issue.location?.columnNumber !== 0) return false;
  try {
    const source = new URL(issue.location.url), document = new URL(documentUrl);
    return source.origin === document.origin && source.pathname === document.pathname;
  } catch { return false; }
}

async function attachNativeGpuDiagnostics(testInfo, diagnostics) {
  if (!diagnostics.length) return;
  const artifactPath = testInfo.outputPath("native-gpu-readback-diagnostics.json");
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, JSON.stringify(diagnostics, null, 2), "utf8");
  // Each Playwright command clears outputDir. A PR runs several commands before
  // upload, so also archive outside it to preserve diagnostics from earlier runs.
  const archivePath = path.resolve(__dirname, "../../../.runtime/reports/generated/native-gpu-readback-diagnostics", `${randomUUID()}.json`);
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.copyFile(artifactPath, archivePath);
  await testInfo.attach("native-gpu-readback-diagnostics", {
    path: artifactPath, contentType: "application/json",
  });
  return archivePath;
}

module.exports = { readConsoleIssue, isNativeGpuReadbackDiagnostic, attachNativeGpuDiagnostics };
