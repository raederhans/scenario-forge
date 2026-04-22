function normalizeBusListener(listener) {
  return typeof listener === "function" ? listener : null;
}

const listenersByEvent = new Map();

export function on(eventName, listener) {
  const normalizedListener = normalizeBusListener(listener);
  if (!eventName || !normalizedListener) return null;
  let listeners = listenersByEvent.get(eventName);
  if (!listeners) {
    listeners = new Set();
    listenersByEvent.set(eventName, listeners);
  }
  listeners.add(normalizedListener);
  return normalizedListener;
}

export function off(eventName, listener = null) {
  const listeners = listenersByEvent.get(eventName);
  if (!listeners) return;
  if (listener == null) {
    listenersByEvent.delete(eventName);
    return;
  }
  listeners.delete(listener);
  if (!listeners.size) {
    listenersByEvent.delete(eventName);
  }
}

export function emit(eventName, payload) {
  const listeners = listenersByEvent.get(eventName);
  if (!listeners || !listeners.size) return [];
  return Array.from(listeners).map((listener) => listener(payload));
}

export function once(eventName, listener) {
  const normalizedListener = normalizeBusListener(listener);
  if (!eventName || !normalizedListener) return null;
  const wrappedListener = (payload) => {
    off(eventName, wrappedListener);
    return normalizedListener(payload);
  };
  on(eventName, wrappedListener);
  return wrappedListener;
}
