export const productionCsp =
  "default-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'";

export function validateStaticBuild(html, assets) {
  if (!html.includes(`content="${productionCsp}"`) || html.includes("__APP_CSP__")) {
    throw new Error("Production CSP is missing or changed");
  }
  if (/<style\b|\sstyle\s*=|<script\b(?![^>]*\bsrc\s*=)/i.test(html)) {
    throw new Error("Inline script or style is not permitted");
  }
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
