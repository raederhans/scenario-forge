export function requireFunction(candidate, label) {
  if (typeof candidate !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
  return candidate;
}

export function requireFunctionFrom(source, label, validate = requireFunction) {
  return (name) => validate(source[name], `${label}.${name}`);
}
