import test from "node:test";
import assert from "node:assert/strict";
import { createPhysicalViewportCacheOwner } from "../js/core/renderer/physical_viewport_cache_owner.js";

function fixture(options = {}) {
  const h = { snapshot: { key: "a", sourceKey: "source", layout: { pixelWidth: 20, pixelHeight: 10 },
    reference: { x: 1, y: 2, k: 2.5 } }, cache: { dirty: { physicalBase: true }, canvases: {} },
    canvases: [], draws: [], resources: [], errors: [], ready: 0, admitted: [], admit: true, failure: null, gate: null };
  h.owner = createPhysicalViewportCacheOwner({
    readSnapshot: () => h.snapshot, readCache: () => h.cache,
    createCanvas() {
      const canvas = { width: 0, height: 0, getContext(type) {
        assert.equal(type, "2d"); return { canvas };
      } };
      h.canvases.push(canvas); return canvas;
    },
    async yieldControl() { assert.equal(h.inDraw, undefined); await h.gate; },
    draw(context, snapshot) {
      h.inDraw = true;
      try {
        if (h.failure) throw h.failure;
        h.draws.push({ context, snapshot });
      } finally { delete h.inDraw; }
    },
    canAllocate(bytes) { h.admitted.push(bytes); return h.admit; },
    onResource(bytes) { h.resources.push(bytes); }, onReady() { h.ready++; },
    onError(error) { h.errors.push(error); }, ...options,
  });
  h.view = (key, extra = {}) => {
    h.snapshot = { ...h.snapshot, key, ...extra }; h.cache.dirty.physicalBase = true;
  };
  h.commit = () => {
    const job = h.owner.takeReady(), previous = h.cache.canvases.physicalBase;
    assert.ok(job);
    h.cache.canvases.physicalBase = job.canvas; h.cache.dirty.physicalBase = false;
    const retained = h.owner.noteCommitted(job, previous);
    if (previous && previous !== job.canvas && !retained) { previous.width = 1; previous.height = 1; }
    return { job, previous, retained };
  };
  return h;
}

test("native preparation yields before drawing, transfers accounting and deduplicates a clean committed view", async () => {
  const h = fixture(), pending = h.owner.prepare();
  assert.equal(h.owner.prepare(), pending);
  assert.equal(h.owner.getPendingPromise(), pending);
  assert.equal(h.owner.getPendingBytes(), 800);
  assert.equal(h.owner.takeReady(), null);
  assert.equal(h.draws.length, 0);
  await pending;
  assert.equal(h.draws.length, 1);
  assert.equal(h.draws[0].snapshot, h.snapshot);
  assert.equal(h.owner.getPendingPromise(), null);
  const { job } = h.commit();
  assert.equal(job.canvas.width, 20); assert.equal(job.canvas.height, 10);
  assert.equal(job.sourceKey, "source");
  assert.equal(job.reference, h.snapshot.reference);
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.owner.prepare(), null);
  assert.deepEqual(h.resources, [800, 0]);
  assert.throws(() => h.owner.noteCommitted(job), /taken physical viewport/);
  assert.equal(h.owner.getStats().cacheMisses, 1);
});

test("exact viewport hits reuse the original complete canvas with no redraw or resampling", async () => {
  const h = fixture();
  await h.owner.prepare(); const a = h.commit().job;
  h.view("b"); await h.owner.prepare();
  assert.equal(h.commit().retained, true);
  assert.equal(h.owner.getPendingBytes(), 800);
  assert.equal(a.canvas.width, 20);
  h.view("a"); assert.equal(h.owner.prepare(), null);
  assert.equal(h.owner.getPendingPromise(), null);
  const hit = h.commit();
  assert.equal(hit.job.canvas, a.canvas);
  assert.equal(hit.retained, true);
  assert.equal(h.draws.length, 2);
  assert.equal(h.canvases.length, 2);
  assert.equal(h.owner.getStats().cacheHits, 1);
  assert.equal(h.owner.getStats().inactiveBytes, 800);
  assert.equal(h.owner.getStats().entries, 2);
});

test("LRU bounds active and inactive rasters and never shrinks a retained or active canvas", async () => {
  const h = fixture();
  await h.owner.prepare(); const a = h.commit().job;
  h.view("b"); await h.owner.prepare(); const b = h.commit().job;
  h.view("c"); await h.owner.prepare(); const c = h.commit().job;
  assert.equal(h.owner.getStats().entries, 3);
  assert.equal(a.canvas.width, 20); assert.equal(b.canvas.width, 20);
  h.view("d"); const pending = h.owner.prepare();
  assert.equal(a.canvas.width, 1, "the least recent inactive surface leaves before allocation");
  assert.equal(b.canvas.width, 20); assert.equal(c.canvas.width, 20);
  await pending; h.commit();
  assert.equal(h.owner.getStats().entries, 3);
  assert.equal(h.owner.getPendingBytes(), 1600);
});

test("cancellation retains the reservation until cleanup and never draws or publishes a stale view", async () => {
  const h = fixture();
  let finish;
  h.gate = new Promise(resolve => { finish = resolve; });
  const pending = h.owner.prepare();
  h.view("b"); assert.equal(h.owner.prepare(), pending);
  assert.equal(h.owner.getPendingBytes(), 800);
  finish(); await pending;
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.canvases.length, 0);
  assert.equal(h.draws.length, 0);
  assert.equal(h.owner.takeReady(), null);
  h.gate = null; await h.owner.prepare();
  h.view("c"); assert.equal(h.owner.takeReady(), null);
  assert.equal(h.canvases[0].width, 1);
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.deepEqual(h.errors, []);
});

test("source changes clear historical rasters and fence old active ownership even for the same viewport key", async () => {
  const h = fixture();
  await h.owner.prepare(); const a = h.commit().job;
  h.view("b"); await h.owner.prepare(); const b = h.commit().job;
  h.view("a", { sourceKey: "new-source" });
  const pending = h.owner.prepare();
  assert.equal(a.canvas.width, 1);
  assert.equal(b.canvas.width, 20, "the pass still owns its active surface");
  await pending;
  const replacement = h.commit();
  assert.equal(replacement.retained, false);
  assert.equal(replacement.job.sourceKey, "new-source");
  assert.equal(h.owner.getStats().cacheHits, 0);
  assert.equal(h.draws.length, 3);
});

test("budget admission uses total private bytes, evicts inactive first and suppresses a denied key", async () => {
  const h = fixture({ maxBytes: 1600 });
  await h.owner.prepare(); h.commit();
  h.view("b"); await h.owner.prepare(); h.commit();
  h.view("c"); await h.owner.prepare(); h.commit();
  assert.equal(h.owner.getPendingBytes(), 1600);
  const old = h.canvases[0];
  h.admit = false; h.view("d");
  assert.equal(h.owner.prepare(), null);
  assert.equal(old.width, 1);
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.canvases.length, 3);
  h.admit = true; assert.equal(h.owner.prepare(), null);
  assert.ok(h.admitted.includes(1600));
  h.view("e"); await h.owner.prepare();
  assert.equal(h.commit().retained, false, "native fallback may have repainted the old active surface");
  const tiny = fixture({ maxBytes: 799 });
  assert.equal(tiny.owner.prepare(), null);
  assert.equal(tiny.canvases.length, 0);
});

test("clear releases inactive and candidates, preserves active size and permits the same key again", async () => {
  const h = fixture();
  await h.owner.prepare(); const a = h.commit().job;
  h.view("b"); await h.owner.prepare(); const b = h.commit().job;
  h.view("c"); await h.owner.prepare();
  assert.equal(h.owner.clear(), null);
  assert.equal(a.canvas.width, 1); assert.equal(h.canvases[2].width, 1);
  assert.equal(b.canvas.width, 20);
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.owner.takeReady(), null);
  await h.owner.prepare(); assert.equal(h.commit().retained, false);
  h.snapshot = null;
  const wakes = h.ready;
  assert.equal(h.owner.prepare(), null); assert.equal(h.owner.prepare(), null);
  assert.equal(h.ready, wakes, "idle clear cannot schedule an empty render loop");
});

test("unowned previous canvases are not retained, while draw failures release and suppress until clear", async () => {
  const h = fixture();
  h.cache.canvases.physicalBase = { width: 20, height: 10 };
  await h.owner.prepare(); assert.equal(h.commit().retained, false);
  h.failure = new Error("native draw failed"); h.view("b");
  await h.owner.prepare();
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.errors.length, 1);
  assert.equal(h.canvases[1].width, 1);
  h.failure = null; assert.equal(h.owner.prepare(), null);
  h.owner.clear(); await h.owner.prepare(); h.commit();
  assert.equal(h.errors.length, 1);
});

test("clear fences suspended preparation and asynchronous draw callbacks are rejected", async () => {
  const h = fixture();
  let finish;
  h.gate = new Promise(resolve => { finish = resolve; });
  const pending = h.owner.prepare();
  assert.equal(h.owner.clear(), pending);
  assert.equal(h.owner.getPendingBytes(), 800);
  assert.equal(h.owner.prepare(), pending);
  finish(); await pending;
  assert.equal(h.owner.getPendingBytes(), 0);
  assert.equal(h.draws.length, 0);
  const asynchronous = fixture({ draw: () => Promise.resolve() });
  await asynchronous.owner.prepare();
  assert.match(asynchronous.errors[0].message, /must be synchronous/);
  assert.equal(asynchronous.owner.takeReady(), null);
  assert.equal(asynchronous.owner.getPendingBytes(), 0);
});

test("a previously denied view cannot relabel a later native repaint as its old committed viewport", async () => {
  const h = fixture();
  await h.owner.prepare(); h.commit();
  h.admit = false; h.view("b");
  assert.equal(h.owner.prepare(), null);
  h.admit = true; h.view("c");
  await h.owner.prepare(); const c = h.commit().job;
  h.view("b");
  assert.equal(h.owner.prepare(), null, "the denied key remains suppressed after C succeeds");
  h.owner.noteNativeDraw(c.canvas);
  c.canvas.pixels = "native-b";
  h.cache.dirty.physicalBase = false;
  assert.equal(c.canvas.width, 20, "revocation does not resize the active surface");
  h.view("d"); await h.owner.prepare();
  assert.equal(h.commit().retained, false, "B pixels cannot enter inactive under the old C key");
  const before = h.draws.length;
  h.view("c"); const pending = h.owner.prepare();
  assert.ok(pending, "C must draw afresh instead of hitting the repainted canvas");
  await pending;
  const fresh = h.commit().job;
  assert.notEqual(fresh.canvas, c.canvas);
  assert.equal(h.draws.length, before + 1);
  assert.equal(h.owner.getStats().cacheHits, 0);
  const inactiveBytes = h.owner.getStats().inactiveBytes;
  h.owner.noteNativeDraw(fresh.canvas);
  assert.equal(h.owner.getStats().inactiveBytes, inactiveBytes, "other inactive viewports survive revocation");
  h.view("b");
  assert.equal(h.owner.prepare(), null, "native notification preserves the failed-key suppression");
});
