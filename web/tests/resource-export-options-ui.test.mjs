// 源码约束测试，不宣称浏览器交互或设备验证。
// Source-contract tests do not claim browser interaction or device validation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { catalog } from "../i18n-catalog.mjs";
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
test("resource skip is opt-in, resets with selection, and has a distinct outcome", () => {
  assert.match(app, /\[skipResources, setSkipResources\] = useState\(false\)/);
  assert.match(app, /exportResources: !skipResources/);
  assert.match(app, /if \(!current\(\)\) return;\s+setSkipResources\(false\)/);
  assert.doesNotMatch(app, /setSelectedNsps|package-selection/);
  assert.match(app, /result.resources.status === "skipped"/);
  assert.match(app, /report\?\.resources\?\.status === "skipped"/);
  assert.match(app, /skipResources &&/);
  assert.match(app, /legacyAstc \? ` \$\{t\("dmWebSkipKeepsLegacy"\)\}` : ""/);
  assert.match(catalog.dmWebSkipResourcesHelp[0], /same game, update and DLC/);
  assert.match(catalog.dmWebResourcesSkipped[0], /skipped; device files were not checked/);
});
test("storage estimate is nonblocking and excludes invented requirements", () => {
  assert.match(
    app,
    /setReady\(true\);[\s\S]*?void readOpfsStorageAdvisory\(\{ signal: controller.signal \}\)/,
  );
  assert.match(
    app,
    /controller.signal.aborted \|\| !mounted.current \|\| estimate.status === "cancelled"/,
  );
  assert.match(catalog.dmWebStorageEstimate[0], /Not destination disk space or a reservation/);
  assert.match(catalog.dmWebStorageUnknown[0], /you can continue/);
});
