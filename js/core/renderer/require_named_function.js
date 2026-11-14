export function requireFunction(source, name, label) {
  const candidate = source?.[name];
  if (typeof candidate !== "function") {
    throw new TypeError(`${label}.${name} must be a function.`);
  }
  return candidate;
}
