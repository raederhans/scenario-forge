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
