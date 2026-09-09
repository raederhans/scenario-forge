import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectImportCompletion } from '../js/core/interaction_funnel/import_completion.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('required recovery retry resumes dependencies, renders and publishes editable state', async () => {
  const calls = [];
  let fail = true;
  const job = createProjectImportCompletion({
    required: [
      { name: 'document', run: () => calls.push('document') },
      { name: 'runtime', run: () => { calls.push('runtime'); if (fail) throw Error('offline'); } },
      { name: 'owners', run: () => calls.push('owners') },
    ], optional: [{ name: 'rivers', run: () => calls.push('rivers') }],
    isCurrent: () => true, finalize: () => calls.push('render'),
  });
  assert.equal(await job.start(), false);
  assert.equal(job.getState().phase, 'blocked');
  assert.equal(job.getState().editable, false);
  assert.equal(job.cancel(), false, 'cannot unlock inconsistent required runtime');
  fail = false;
  assert.equal(await job.retry('runtime'), true);
  assert.deepEqual(calls, ['document', 'runtime', 'runtime', 'owners', 'render', 'rivers', 'render']);
  assert.equal(job.getState().phase, 'complete');
  assert.equal(job.getState().editable, true);
  assert.deepEqual(job.getState().warnings, []);
});

test('optional completion is detached; cancelling stops a hung wait and late commit', async () => {
  const load = deferred();
  let commits = 0;
  const job = createProjectImportCompletion({ required: [],
    optional: [{ name: 'resource', run: async ({ isCurrent }) => { await load.promise; if (isCurrent()) commits++; } }],
    isCurrent: () => true, finalize: () => {},
  });
  assert.equal(await job.start(), true);
  const done = job.startOptional();
  await Promise.resolve();
  assert.equal(job.getState().editable, true);
  job.cancel();
  assert.equal((await done).phase, 'cancelled');
  load.resolve();
  await Promise.resolve();
  assert.equal(commits, 0);
});

test('timeout revokes only that attempt, successful retry renders and leaves old late work inert', async () => {
  const load = deferred();
  let attempts = 0;
  let commits = 0;
  let renders = 0;
  const job = createProjectImportCompletion({ required: [], optionalTimeoutMs: 10,
    optional: [{ name: 'rivers', run: async ({ isCurrent }) => {
      if (++attempts === 1) await load.promise;
      if (isCurrent()) commits++;
    } }], isCurrent: () => true, finalize: () => { renders++; },
  });
  await job.start();
  await job.startOptional();
  assert.equal(job.getState().phase, 'partial');
  assert.match(job.getState().warnings[0].message, /timed out/);
  const before = renders;
  assert.equal(await job.retry('rivers'), true);
  assert.equal(renders, before + 1);
  assert.equal(commits, 1);
  load.resolve();
  await Promise.resolve();
  assert.equal(commits, 1);
  assert.equal(job.getState().phase, 'complete');
});

test('new document identity disables retries and final render from an old job', async () => {
  const load = deferred();
  let current = true;
  let renders = 0;
  const job = createProjectImportCompletion({ required: [],
    optional: [{ name: 'rivers', run: () => load.promise }],
    isCurrent: () => current, finalize: () => { renders++; },
  });
  await job.start();
  const done = job.startOptional();
  current = false;
  load.resolve();
  await done;
  assert.equal(renders, 1);
  assert.equal(await job.retry('rivers'), false);
  assert.equal(job.getState().phase, 'cancelled');
});

test('initial UI/render failure remains restricted until its retry completes', async () => {
  let fail = true;
  let optionalCalls = 0;
  const job = createProjectImportCompletion({
    required: [{ name: 'owners', run: () => {} }],
    optional: [{ name: 'rivers', run: () => { optionalCalls++; } }],
    isCurrent: () => true, finalize: () => { if (fail) throw Error('render unavailable'); },
  });
  assert.equal(await job.start(), false);
  assert.equal(job.getState().editable, false);
  assert.equal(job.getState().phase, 'blocked');
  assert.equal(job.cancel(), false);
  assert.equal(optionalCalls, 0);
  fail = false;
  assert.equal(await job.retry('project-ui'), true);
  assert.equal(optionalCalls, 1);
  assert.equal(job.getState().phase, 'complete');
});

test('optional retry waits for the remaining resource queue and runs only once', async () => {
  const load = deferred();
  const entered = deferred();
  const calls = [];
  let attempts = 0;
  const job = createProjectImportCompletion({ required: [], optional: [
    { name: 'rivers', run: () => { calls.push('rivers'); if (++attempts === 1) throw Error('offline'); } },
    { name: 'cities', run: async () => { entered.resolve(); await load.promise; calls.push('cities'); } },
  ], isCurrent: () => true, finalize: () => calls.push('render') });
  await job.start();
  const done = job.startOptional();
  await entered.promise;
  const retry = job.retry('rivers');
  await Promise.resolve();
  assert.equal(attempts, 1);
  assert.equal(await job.retry('rivers'), false);
  load.resolve();
  await done;
  assert.equal(await retry, true);
  assert.deepEqual(calls, ['render', 'rivers', 'cities', 'render', 'rivers', 'render']);
  assert.equal(job.getState().phase, 'complete');
});
