export function walk(node, visit) {
  for (const child of node.children || []) {
    visit(child);
    walk(child, visit);
  }
}

export function findFirst(root, predicate) {
  let result = null;
  walk(root, (node) => {
    if (!result && predicate(node)) result = node;
  });
  return result;
}

export function findAll(root, predicate) {
  const result = [];
  walk(root, (node) => {
    if (predicate(node)) result.push(node);
  });
  return result;
}
