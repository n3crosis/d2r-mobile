import createModule from "./dist/texture.mjs";
import { conformance } from "./conformance.mjs";
try {
  const fixtures = await (await fetch("./.build/fixtures.json")).json();
  const result = await conformance(createModule, fixtures);
  self.postMessage({ ok: true, ...result });
} catch (error) {
  self.postMessage({ ok: false, message: error.message });
}
