const objectIdentityTokenCache = new WeakMap();
let nextObjectIdentityToken = 1;

// Weak keys retain identity across frames without retaining geometry collections.
export function getObjectIdentityToken(value, prefix = "obj") {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return `${prefix}:none`;
  let token = objectIdentityTokenCache.get(value);
  if (!token) {
    token = `${prefix}:${nextObjectIdentityToken++}`;
    objectIdentityTokenCache.set(value, token);
  }
  return token;
}
