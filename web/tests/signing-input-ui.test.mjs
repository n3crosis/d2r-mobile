// 合成本地凭据与界面契约测试，不构成原生签名、浏览器或设备验证。
// Synthetic local-credential and UI contract tests, not native signing, browser or device proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { signWithLocalFiles } from "../signing-input.mjs";
import { IPA_SIGNING_LIMITS } from "../ipa-signing-contract.mjs";
const inputs = () => ({
  unsigned: { blob: new Blob(["unsigned IPA"]), fileName: "unsigned.ipa" },
  identityFile: new Blob(["p12"]),
  profileFile: new Blob(["profile"]),
  password: "local secret",
});
test("local signing reads bounded credentials, wipes buffers and leaves unsigned fallback intact", async () => {
  const options = inputs(),
    expected = await options.unsigned.blob.text();
  let credentials;
  const result = { blob: new Blob(["verified signed"]), fileName: "D2RMobile-signed.ipa" };
  assert.equal(
    await signWithLocalFiles({
      ...options,
      async sign(value) {
        assert.equal(value.ipa, options.unsigned.blob);
        credentials = value.credentials;
        assert.equal(credentials.password, options.password);
        assert.equal(new TextDecoder().decode(credentials.identity), "p12");
        return result;
      },
    }),
    result,
  );
  assert.ok(new Uint8Array(credentials.identity).every((byte) => byte === 0));
  assert.ok(new Uint8Array(credentials.profile).every((byte) => byte === 0));
  assert.equal(await options.unsigned.blob.text(), expected);
});
test("signing rejection and cancellation preserve original unsigned bytes and wipe owned reads", async () => {
  for (const cancel of [false, true]) {
    const options = inputs(),
      controller = new AbortController();
    let buffers;
    await assert.rejects(
      signWithLocalFiles({
        ...options,
        signal: controller.signal,
        async sign({ credentials }) {
          buffers = [credentials.identity, credentials.profile];
          if (cancel) {
            controller.abort();
            controller.signal.throwIfAborted();
          }
          throw new Error("native failure");
        },
      }),
    );
    assert.ok(buffers.every((buffer) => new Uint8Array(buffer).every((byte) => byte === 0)));
    assert.equal(await options.unsigned.blob.text(), "unsigned IPA");
  }
});
test("invalid credential sizes fail before reading and late cancellation wipes first read", async () => {
  let calls = 0;
  const options = inputs();
  await assert.rejects(
    signWithLocalFiles({
      ...options,
      identityFile: new Blob([new Uint8Array(IPA_SIGNING_LIMITS.identityBytes + 1)]),
      sign() {
        calls++;
      },
    }),
    /SIGNING_INPUT_INVALID/,
  );
  assert.equal(calls, 0);
  const controller = new AbortController(),
    bytes = new Uint8Array([7, 8]).buffer;
  class LateFile extends Blob {
    async arrayBuffer() {
      controller.abort();
      return bytes;
    }
  }
  await assert.rejects(
    signWithLocalFiles({
      ...options,
      identityFile: new LateFile(["id"]),
      signal: controller.signal,
      sign() {
        calls++;
      },
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(new Uint8Array(bytes), new Uint8Array(2));
  assert.equal(calls, 0);
});
test("UI preloads signing before credentials and keeps signing errors outside packaging failure", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /get\("signing"\) === "1"/);
  assert.match(source, /astcPreset,\s*signing,\s*signal:/);
  assert.match(source, /setSigningReady\(value.signingReady\)/);
  assert.match(source, /disabled=\{!signingReady \|\| !ready \|\| busy\}/);
  assert.ok(
    source.indexOf("downloadPreparation.current.retain(result.download)") <
      source.indexOf("await signWithLocalFiles"),
  );
  const signing = source.slice(
    source.indexOf("await signWithLocalFiles"),
    source.indexOf("} catch (error) {", source.indexOf("await signWithLocalFiles")),
  );
  assert.match(signing, /dmWebSigningCancelled/);
  assert.match(signing, /dmWebSigningFailed/);
  assert.match(signing, /prepareDownload\(false\)/);
  assert.match(signing, /setStatus\(t\("dmWebUnsignedReady"\)\)/);
  assert.match(source, /const signedDownload = download\?\.fileName === "D2RMobile-signed.ipa"/);
  assert.match(signing, /clearSigningInputs\(\)/);
  assert.doesNotMatch(signing, /packagingFailure|setResourceOutcome|setLegacyStatus/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.match(source, /autoComplete="off"/);
});

test("terminal UI cleanup closes the captured packager without losing completed downloads", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /const jobPackager = packager.current/);
  assert.match(source, /await jobPackager.generate\(/);
  const cleanup = source.slice(
    source.indexOf("} finally {\n      acceptingProgress = false;"),
    source.indexOf("  return (\n    <main"),
  );
  assert.match(cleanup, /await jobPackager.close\(\)/);
  assert.match(cleanup, /catch \{[\s\S]*?dmWebCleanupWarning/);
  assert.match(cleanup, /setStatus\(\(previous: string\) =>/);
  assert.doesNotMatch(
    cleanup,
    /downloadPreparation.current.dispose|setDownload\(null\)|setResourceOutcome\(|setLegacyStatus\(/,
  );
  assert.ok(cleanup.indexOf("await jobPackager.close()") < cleanup.indexOf("operation.finish()"));
  assert.match(
    source,
    /dmWebSigningCancelled" : "dmWebSigningFailed"[\s\S]*?setStatus\(t\("dmWebUnsignedReady"\)\)/,
  );
});
