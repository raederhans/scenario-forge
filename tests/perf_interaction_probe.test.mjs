import assert from "node:assert/strict";
import test from "node:test";
import {
  parseArgs, summarizeLoafWindow, aggregateScenario, buildMarkdownTable,
} from "../tools/perf/interaction_probe.mjs";

test("参数默认值及环境变量优先级", (t) => {
  const original = {
    MAPCREATOR_BASE_URL: process.env.MAPCREATOR_BASE_URL,
    MAPCREATOR_DEV_PORT: process.env.MAPCREATOR_DEV_PORT,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  delete process.env.MAPCREATOR_BASE_URL;
  delete process.env.MAPCREATOR_DEV_PORT;
  const defaults = parseArgs([]);
  assert.equal(defaults.baseUrl, "http://127.0.0.1:8810");
  assert.deepEqual(defaults.scenarios, ["blank_base", "modern_world", "hoi4_1936", "hoi4_1939", "tno_1962"]);
  assert.equal(defaults.runs, 1);
  assert.equal(defaults.tailMs, 30000);
  assert.equal(defaults.urlQuery, "");
  assert.equal(defaults.gpu, true);
  assert.match(defaults.out, /^\.runtime\/reports\/generated\/perf-interaction\/interaction-\d{4}-\d{2}-\d{2}T\d{6}\.\d{3}Z\.json$/);
  process.env.MAPCREATOR_DEV_PORT = "9000";
  assert.equal(parseArgs([]).baseUrl, "http://127.0.0.1:9000");
  process.env.MAPCREATOR_BASE_URL = "http://localhost:9001";
  assert.equal(parseArgs([]).baseUrl, "http://localhost:9001");
});

test("解析所有参数、帮助与未知参数", () => {
  assert.deepEqual(parseArgs([
    "--base-url", "http://localhost:9002", "--scenarios", "blank_base,tno_1962",
    "--runs", "3", "--tail-ms", "250", "--url-query", "political_render_mode=raster",
    "--gpu", "false", "--out", "result.json",
  ]), {
    baseUrl: "http://localhost:9002", scenarios: ["blank_base", "tno_1962"],
    runs: 3, tailMs: 250, urlQuery: "political_render_mode=raster", gpu: false, out: "result.json",
  });
  assert.equal(parseArgs(["--gpu", "true"]).gpu, true);
  assert.deepEqual(parseArgs(["--help"]), { help: true });
  assert.throws(() => parseArgs(["--unknown", "1"]), /未知参数/);
});

test("空长帧窗口与左闭右开边界", () => {
  const empty = { count: 0, totalMs: 0, maxMs: 0, over200Count: 0, top: [] };
  assert.deepEqual(summarizeLoafWindow([], 10, 20), empty);
  const entries = [
    { start: 9, duration: 300, top: "之前" },
    { start: 10, duration: 200, top: "起点" },
    { start: 19, duration: 201, top: "窗口内" },
    { start: 20, duration: 400, top: "终点" },
  ];
  assert.deepEqual(summarizeLoafWindow(entries, 10, 20), {
    count: 2, totalMs: 401, maxMs: 201, over200Count: 1,
    top: [[9, 201, "窗口内"], [0, 200, "起点"]],
  });
  assert.equal(summarizeLoafWindow(entries, 10, 20.001).count, 3);
  assert.deepEqual(summarizeLoafWindow(entries, 30, 40), empty);
});

test("长帧排行最多五条且不改变输入顺序", () => {
  const entries = [60, 400, 100, 300, 200, 500, 70].map((duration, index) => ({
    start: 100 + index, duration, top: `函数${index}@文件.js:${duration}`,
  }));
  const original = structuredClone(entries);
  const result = summarizeLoafWindow(entries, 100, 110);
  assert.equal(result.count, 7);
  assert.equal(result.totalMs, 1630);
  assert.equal(result.maxMs, 500);
  assert.equal(result.over200Count, 3);
  assert.deepEqual(result.top, [5, 1, 3, 4, 2].map((index) => [index, entries[index].duration, entries[index].top]));
  assert.deepEqual(entries, original);
});

function sample(value) {
  return {
    firstFrameMs: value, viewableMs: value, editableMs: value, settledMs: value,
    panSettledMs: value,
    tail: { count: value, totalMs: value, maxMs: value, over200Count: value },
    drag: { longestFrameMs: value, longFrameCount: value, wallMs: value },
    zoomSettledMs: [value, value, value],
  };
}

test("全部数值指标计算中位数，忽略 null 并逐步汇总缩放", () => {
  const expected = (value) => ({ ...sample(value), politicalBackend: null });
  assert.deepEqual(aggregateScenario([sample(9), sample(1), sample(3)]), expected(3));
  assert.deepEqual(aggregateScenario([sample(8), sample(null), sample(2)]), expected(5));
  assert.deepEqual(aggregateScenario([sample(null), sample(null)]), expected(null));
  assert.deepEqual(aggregateScenario([]), expected(null));
  const mixed = [{ ...sample(1), politicalBackend: "raster" }, { ...sample(2), politicalBackend: "vector" },
    { ...sample(3), politicalBackend: "raster" }];
  assert.equal(aggregateScenario(mixed).politicalBackend, "raster/vector");
  const runs = [sample(1), sample(3), sample(9)];
  runs[0].zoomSettledMs = [100, null, 300];
  runs[1].zoomSettledMs = [200, null, 500];
  runs[2].zoomSettledMs = [null, null, 900];
  assert.deepEqual(aggregateScenario(runs).zoomSettledMs, [150, null, 500]);
});

test("表格每剧本一行，使用秒、短帧毫秒和空值占位", () => {
  const first = sample(1500);
  first.firstFrameMs = 1250;
  first.viewableMs = null;
  first.tail = { count: 2, totalMs: 350.4 };
  first.drag.longestFrameMs = 99.6;
  first.zoomSettledMs = [100, 2000, null];
  const second = sample(null);
  second.drag.longestFrameMs = 1200;
  assert.equal(buildMarkdownTable({ scenarios: { blank_base: first, tno_1962: second } }), [
    "| 剧本 | 真实首帧 | API 可见 | settled | 尾巴（个数/合计 ms） | 拖拽最长帧 | 平移 settled | 缩放 settled |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    "| blank_base | 1.3 s | — | 1.5 s | 2/350 | 100 ms | 1.5 s | 0.1 s / 2.0 s / — |",
    "| tno_1962 | — | — | — | —/— | 1.2 s | — | — / — / — |",
  ].join("\n"));
});
