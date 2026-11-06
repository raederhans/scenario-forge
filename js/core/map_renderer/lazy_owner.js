// Lazily created renderer owners. map_renderer.js wires each owner once, on first
// use, because its dependencies are only complete after the module has loaded.
export function lazyOwner(create) {
  let instance = null;
  const get = () => {
    if (instance === null) instance = create();
    return instance;
  };
  // The current instance, without creating one.
  get.peek = () => instance;
  return get;
}
