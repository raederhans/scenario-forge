export function validateScenarioSnapshot(snapshot, stateKeys, moduleName, operation) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError(`[${moduleName}] snapshot must be an object`);
  }
  const values = snapshot.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new TypeError(`[${moduleName}] snapshot.values must be an object`);
  }
  for (const key of stateKeys) {
    if (!Object.hasOwn(values, key)) {
      throw new Error(`[${moduleName}] ${operation} missing snapshot key: ${key}`);
    }
  }
  if (!Array.isArray(snapshot.presentKeys) && !(snapshot.presentKeys instanceof Set)) {
    throw new TypeError(`[${moduleName}] snapshot.presentKeys must be an array or Set`);
  }
  const presentKeys = Array.from(snapshot.presentKeys);
  const allowedKeys = new Set(stateKeys);
  for (const key of presentKeys) {
    if (!allowedKeys.has(key)) {
      throw new Error(`[${moduleName}] ${operation} contains unknown present key: ${key}`);
    }
  }
  return { values, presentKeys: new Set(presentKeys) };
}

export function restoreScenarioFields(target, values, presentKeys, keys) {
  for (const key of keys) {
    if (presentKeys.has(key)) target[key] = values[key];
    else delete target[key];
  }
}
