export class TestClassList {
  constructor(node) {
    this.node = node;
  }

  add(...tokens) {
    const values = new Set(String(this.node.className || "").split(/\s+/).filter(Boolean));
    tokens.forEach((token) => values.add(token));
    this.node.className = Array.from(values).join(" ");
  }

  remove(...tokens) {
    const removals = new Set(tokens);
    const values = String(this.node.className || "").split(/\s+/).filter((token) => token && !removals.has(token));
    this.node.className = values.join(" ");
  }

  contains(token) {
    return String(this.node.className || "").split(/\s+/).includes(token);
  }

  toggle(token, force) {
    const shouldEnable = force === undefined ? !this.contains(token) : !!force;
    if (shouldEnable) {
      this.add(token);
    } else {
      this.remove(token);
    }
    return shouldEnable;
  }
}
