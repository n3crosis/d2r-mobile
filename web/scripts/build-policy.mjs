// 拒绝静态发布输出中的不合规路径与资产；依据 web/scripts 的模块与调用约定。
// Reject disallowed paths and assets in static build output using the module and calling contracts in web/scripts.
export function validateStaticBuild(html, assets) {
  const references = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  if (
    !references.some((name) => name.endsWith(".js")) ||
    !references.some((name) => name.endsWith(".css"))
  ) {
    throw new Error("Missing bundled script or stylesheet");
  }
  for (const reference of references) {
    if (!/^\.\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(reference) || !assets.has(reference.slice(2))) {
      throw new Error("Asset is missing or not a local static bundle");
    }
  }
  for (const [name, content] of assets) {
    if (name.endsWith(".css") && /@(?:apply|theme|source)\b|@import\s/.test(content)) {
      throw new Error("Tailwind directives were not compiled");
    }
    if (
      name.endsWith(".js") &&
      /\bBun\s*\.|(?:from\s*|import\s*\()["'](?:bun|node):/.test(content)
    ) {
      throw new Error("Server runtime API leaked into browser bundle");
    }
  }
}
