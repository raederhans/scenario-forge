import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import "../js/core/json_resource_decoder_shared.js";
import { loadMeasuredJsonResource } from "../js/core/data_loader.js";

test("plain JSON preserves non-ASCII text", async (t) => {
  const payload = {
    city: "München / 北京 / Paris",
    flag: "🇩🇪 🇨🇳 🇫🇷",
    description: "Multi-byte UTF-8 test with unicode characters and emoji",
  };
  const jsonString = JSON.stringify(payload);
  t.mock.method(globalThis, "fetch", async () => new Response(jsonString));
  const result = await loadMeasuredJsonResource("data/cities.json", { label: "cities" });
  assert.deepEqual(result.payload, payload);
});

test("explicit gzip JSON decodes non-ASCII text", async (t) => {
  const payload = {
    type: "FeatureCollection",
    features: [
      { id: "FR", properties: { name: "France", chefLieu: "Paris", devise: "Liberté, Égalité, Fraternité" } },
      { id: "CN", properties: { name: "中国", capital: "北京", note: "空间分块测试" } },
    ],
  };
  const jsonString = JSON.stringify(payload);
  const compressedGz = zlib.gzipSync(jsonString);
  t.mock.method(globalThis, "fetch", async () => new Response(compressedGz));
  const result = await loadMeasuredJsonResource("data/regions.json.gz", { label: "geo" });
  assert.deepEqual(result.payload, payload);
});

test("loadMeasuredJsonResource avoids double decoding when HTTP Content-Encoding already decompressed explicit gzip URL", async (t) => {
  const payload = { test: "already-decompressed-by-http-layer", note: "no gzip magic bytes in body" };
  const jsonString = JSON.stringify(payload);
  const utf8Bytes = new TextEncoder().encode(jsonString);

  // Server sent chunk.json.gz, but browser/HTTP stack handled Content-Encoding: gzip transparently
  t.mock.method(globalThis, "fetch", async () => new Response(utf8Bytes));

  const result = await loadMeasuredJsonResource("data/chunks/detail.json.gz?cache=1", { label: "chunk" });
  assert.deepEqual(result.payload, payload);

  const m = result.metrics;
  assert.equal(m.compressed, false, "Must not be marked compressed since DecompressionStream was bypassed");
});

test("loadMeasuredJsonResource throws explicit decompress-failed error on corrupt gzip payload and does not fall through to unchecked fallback", async (t) => {
  // Starts with gzip magic bytes 0x1f, 0x8b, followed by invalid corrupted data
  const corruptGz = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0x00, 0x12, 0x34]);

  t.mock.method(globalThis, "fetch", async () => new Response(corruptGz));

  await assert.rejects(
    loadMeasuredJsonResource("data/corrupt.json.gz", { label: "corrupt_test" }),
    (error) => {
      assert.equal(error.code, "decompress-failed");
      assert.match(error.message, /Failed to decompress/);
      return true;
    },
    "Corrupt gzip must throw explicit decompress-failed error and never be swallowed"
  );
});
