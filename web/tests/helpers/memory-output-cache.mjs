// Synthetic only: emulate the cache byte ownership contract, not filesystem/ledger authenticity.
export function memoryOutputCache() {
  const files = new Map();
  return {
    async read({ kind, key, maxBytes }) {
      const bytes = files.get(`${kind}/${key}`);
      return bytes && bytes.length <= maxBytes ? bytes.slice() : null;
    },
    async write({ kind, key, bytes }) {
      files.set(`${kind}/${key}`, bytes.slice());
      return true;
    },
  };
}
export const assetCacheContext = Object.freeze({
  runtimeManifestSha256: "a".repeat(64),
  profileId: "synthetic-profile",
  artRevision: "synthetic-recipe",
});
