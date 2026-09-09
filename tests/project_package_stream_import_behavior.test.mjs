import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "../vendor/fflate.browser.js";
import { prepareProjectImportFile } from "../js/core/project_package_io.js";

const project = { schemaVersion: 21, timestamp: 123 };
const projectBytes = strToU8(JSON.stringify(project));
const asZip = (bytes) => new Blob([bytes], { type: "application/zip" });

test("streaming ZIP returns parsed preview payload without materializing another file", async () => {
  const prepared = await prepareProjectImportFile(asZip(zipSync({ "map_project.json": projectBytes })), {
    materializeFile: false,
  });
  assert.deepEqual(prepared.projectPayload, project);
  assert.equal(prepared.file, null);
  assert.equal(prepared.preview.entryCount, 1);
});

test("streaming ZIP counts discovered files before accepting the package", async () => {
  const entries = { "map_project.json": projectBytes };
  for (let index = 0; index < 128; index += 1) entries[`extra-${index}`] = new Uint8Array(0);
  await assert.rejects(prepareProjectImportFile(asZip(zipSync(entries))), /contains too many files/);
});

test("streaming ZIP enforces actual expansion even when local uncompressed size lies", async () => {
  const bytes = zipSync({
    "map_project.json": projectBytes,
    "large.bin": new Uint8Array(65 * 1024 * 1024),
  });
  const view = new DataView(bytes.buffer);
  for (let offset = 0; offset < bytes.length - 30; offset += 1) {
    if (view.getUint32(offset, true) === 0x04034b50) view.setUint32(offset + 22, 1, true);
  }
  await assert.rejects(prepareProjectImportFile(asZip(bytes)), /expands beyond/);
});

test("streaming ZIP rejects truncated archives even after the project entry is complete", async () => {
  const bytes = zipSync({ "map_project.json": projectBytes });
  await assert.rejects(prepareProjectImportFile(asZip(bytes.subarray(0, bytes.length - 22))), /incomplete or damaged/);
});

test("streaming ZIP rejects malformed project JSON", async () => {
  await assert.rejects(prepareProjectImportFile(asZip(zipSync({ "map_project.json": strToU8("{") }))), SyntaxError);
});

test("cancelled preparation does not read or return an import payload", async () => {
  const controller = new AbortController();
  controller.abort();
  let read = false;
  await assert.rejects(prepareProjectImportFile({
    name: "project.zip", arrayBuffer() { read = true; },
  }, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(read, false);
});

test("streaming ZIP yields to cancellation during expansion", async () => {
  const bytes = zipSync({
    "map_project.json": projectBytes,
    "large.bin": new Uint8Array(60 * 1024 * 1024),
  });
  // Resolve in a microtask: the abort timer can only run once inflation yields,
  // rather than during Blob.arrayBuffer's asynchronous file read.
  const file = { name: "project.zip", size: bytes.length, arrayBuffer: async () => bytes.buffer };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 0);
  try {
    await assert.rejects(prepareProjectImportFile(file, { signal: controller.signal }), { name: "AbortError" });
  } finally {
    clearTimeout(timer);
  }
});
