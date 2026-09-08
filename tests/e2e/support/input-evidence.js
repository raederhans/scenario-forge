// Pure interpretation of real probe records. Raw samples and errors stay intact.
const discreteNames = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'];
const finiteDifference = (end, start) => Number.isFinite(end) && Number.isFinite(start) ? end - start : null;

function summarizeInputEvidence(evidence, { mode }) {
  if (!['stable', 'controlled-busy', 'natural-background'].includes(mode)) {
    throw new Error(`Unknown input measurement mode: ${mode}`);
  }
  const inputs = evidence.inputs || [];
  // The probe records one pointerdown identity. Do not guess pointerup/click
  // ownership from a broad time window when those identities were not captured.
  const captures = input => Number.isFinite(input.eventTimeStamp) && typeof input.targetId === 'string'
    ? [{ name: 'pointerdown', timeStamp: input.eventTimeStamp, targetId: input.targetId }] : [];
  // Fail closed on timestamp mismatch rather than borrowing a nearby event.
  const matches = (event, capture) => discreteNames.includes(event.name)
    && event.name === capture.name && event.targetId === capture.targetId
    && Number.isFinite(event.startTime) && Number.isFinite(capture.timeStamp)
    && event.startTime === capture.timeStamp;
  const eventTimings = evidence.eventTimings || [];
  return { ...evidence, measurementMode: mode, inputs: inputs.map(input => {
    const wheel = input.kind === 'zoom';
    const associated = wheel ? null : eventTimings.filter(event => {
      const owners = inputs.filter(candidate => captures(candidate).some(capture => matches(event, capture)));
      return owners.length === 1 && owners[0] === input
        && captures(input).some(capture => matches(event, capture)
          && eventTimings.filter(candidate => matches(candidate, capture)).length === 1);
    });
    const busyTasks = (evidence.busyTasks || []).filter(task =>
      task.startTime <= input.stableAt && task.endTime >= input.armedAt);
    const queues = (associated || []).map(event => finiteDifference(event.processingStart, event.startTime)).filter(Number.isFinite);
    const queuedDuringBusyTask = associated?.length ? associated.some(event =>
      Number.isFinite(event.processingStart) && event.processingStart > event.startTime
      && busyTasks.some(task => task.startTime < event.processingStart && task.endTime > event.startTime)) : null;
    return { ...input, measurementMode: mode, inputSeries: wheel ? 'continuous-wheel' : 'discrete',
      eventTimings: associated, queueMs: queues.length ? Math.max(...queues) : null,
      inputToVisibleMs: wheel ? null : finiteDifference(input.firstVisibleAt, input.eventTimeStamp),
      inputToStableMs: wheel ? null : finiteDifference(input.stableAt, input.eventTimeStamp),
      busyTasks, queuedDuringBusyTask,
      busyConditionPassed: mode === 'controlled-busy' && !wheel ? queuedDuringBusyTask === true : null,
      eventTimingStatus: wheel ? 'not-applicable-continuous-wheel'
        : associated.length ? 'observed' : 'unobserved-below-threshold-unsupported-or-unmatched',
    };
  }) };
}

module.exports = { summarizeInputEvidence };
