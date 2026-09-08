import { test } from 'node:test';
import assert from 'node:assert/strict';
import helper from './e2e/support/input-evidence.js';

const input = { kind: 'redo', armedAt: 90, eventTimeStamp: 100, targetId: 'redoBtn',
  firstVisibleAt: 180, stableAt: 440 };
const event = { name: 'pointerdown', startTime: 100, processingStart: 130,
  processingEnd: 135, queueMs: 30, targetId: 'redoBtn' };
const summarize = (evidence, mode = 'controlled-busy') => helper.summarizeInputEvidence(evidence, { mode });

test('missing EventTiming remains unknown and cannot pass controlled busy', () => {
  const result = summarize({ inputs: [input] }).inputs[0];
  assert.equal(result.queueMs, null);
  assert.equal(result.queuedDuringBusyTask, null);
  assert.equal(result.busyConditionPassed, false);
  assert.match(result.eventTimingStatus, /^unobserved/);
});

test('busy requires actual positive queue interval overlap, including tasks begun before arm', () => {
  for (const busyTasks of [[], [{ startTime: 130, endTime: 160 }], [{ startTime: 20, endTime: 100 }]]) {
    assert.equal(summarize({ inputs: [input], eventTimings: [event], busyTasks }).inputs[0].busyConditionPassed, false);
  }
  const result = summarize({ inputs: [input], eventTimings: [event], busyTasks: [{ startTime: 80, endTime: 125 }] }).inputs[0];
  assert.equal(result.busyConditionPassed, true);
  assert.equal(result.queueMs, 30);
});

test('modes stay separate and natural background does not become controlled busy', () => {
  for (const mode of ['stable', 'controlled-busy', 'natural-background']) {
    const result = summarize({ inputs: [input] }, mode);
    assert.equal(result.measurementMode, mode);
    assert.equal(result.inputs[0].measurementMode, mode);
    assert.equal(result.inputs[0].busyConditionPassed, mode === 'controlled-busy' ? false : null);
  }
  assert.throws(() => summarize({}, 'busy'), /Unknown input measurement mode/);
});

test('wheel remains a separate continuous series with no discrete native timing claim', () => {
  const result = summarize({ inputs: [{ ...input, kind: 'zoom', wheelEvents: [{ timeStamp: 100 }] }], eventTimings: [event] }).inputs[0];
  assert.equal(result.inputSeries, 'continuous-wheel');
  assert.equal(result.eventTimings, null);
  assert.equal(result.inputToVisibleMs, null);
  assert.equal(result.inputToStableMs, null);
  assert.equal(result.busyConditionPassed, null);
  assert.equal(result.wheelEvents.length, 1);
});

test('only uniquely identified pointerdown can associate; other operations cannot donate events', () => {
  const other = { ...input, kind: 'undo', eventTimeStamp: 110, targetId: 'undoBtn' };
  const wrongEvents = [{ ...event, name: 'click' }, { ...event, startTime: 110 }, { ...event, targetId: 'undoBtn' }];
  const result = summarize({ inputs: [input, other], eventTimings: [...wrongEvents, event] });
  assert.deepEqual(result.inputs[0].eventTimings, [event]);
  assert.deepEqual(result.inputs[1].eventTimings, []);
  assert.deepEqual(summarize({ inputs: [input, { ...input, kind: 'fill' }], eventTimings: [event] }).inputs.map(i => i.eventTimings), [[], []]);
  assert.deepEqual(summarize({ inputs: [input], eventTimings: [event, { ...event }] }).inputs[0].eventTimings, []);
});

test('outliers, raw entries, pending failure and errors survive without mutation or clamping', () => {
  const evidence = { inputs: [{ ...input, firstVisibleAt: 1919.6, error: 'sample failure' }],
    eventTimings: [event], pageErrors: ['renderer failed'], pendingInput: { kind: 'fill' } };
  const original = structuredClone(evidence);
  const result = summarize(evidence);
  assert.equal(result.inputs[0].inputToVisibleMs, 1819.6);
  assert.equal(result.inputs[0].error, 'sample failure');
  assert.deepEqual(result.pageErrors, evidence.pageErrors);
  assert.deepEqual(result.pendingInput, evidence.pendingInput);
  assert.deepEqual(result.eventTimings, evidence.eventTimings);
  assert.deepEqual(evidence, original);
  assert.equal(summarize({ inputs: [{ ...input, eventTimeStamp: undefined }] }).inputs[0].inputToVisibleMs, null);
});

test('queue uses the matched event timestamps and missing identity cannot match by undefined', () => {
  assert.equal(summarize({ inputs: [input], eventTimings: [{ ...event, queueMs: 999 }] }).inputs[0].queueMs, 30);
  assert.equal(summarize({ inputs: [input], eventTimings: [{ ...event, processingStart: null }] }).inputs[0].queueMs, null);
  assert.equal(summarize({ inputs: [{ ...input, targetId: undefined }], eventTimings: [{ ...event, targetId: undefined }] }).inputs[0].queueMs, null);
  assert.equal(summarize({ inputs: [{ ...input, targetId: '' }], eventTimings: [{ ...event, targetId: '' }] }).inputs[0].queueMs, 30);
  assert.equal(summarize({ inputs: [input], eventTimings: [{ ...event, startTime: 100.5 }] }).inputs[0].queueMs, null);
});
