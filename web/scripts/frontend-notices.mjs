import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const FRONTEND_NOTICES_FILE = "third-party-notices.txt";

// Copy installed/public notices only. This does not import or execute package code.
export async function writeFrontendNotices(outputDirectory) {
  const [shadcn, lucide] = await Promise.all([
    readFile(new URL("../SHADCN_LICENSE.md", import.meta.url), "utf8"),
    readFile(new URL("../node_modules/lucide-react/LICENSE", import.meta.url), "utf8"),
  ]);
  await writeFile(
    resolve(outputDirectory, FRONTEND_NOTICES_FILE),
    `Frontend third-party notices\n\nshadcn/ui\n\n${shadcn}\nLucide React (including applicable Feather notices)\n\n${lucide}`,
  );
}
