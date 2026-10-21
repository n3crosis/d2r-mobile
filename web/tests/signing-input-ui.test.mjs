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
  assert.match(source, /astcPreset,[\s\S]*?signing,\s*signal:/);
  assert.match(source, /setSigningReady\(value.signingReady\)/);
  assert.match(
    source,
    /disabled=\{!signingReady \|\| \(!ready && !signingRetryAvailable\) \|\| busy\}/,
  );
  assert.ok(
    source.indexOf("downloadPreparation.current.retain(result.download)") <
      source.indexOf("await runSigning(jobPackager, result.download"),
  );
  const signing = source.slice(
    source.indexOf("await signWithLocalFiles"),
    source.indexOf("  async function retrySigning()"),
  );
  assert.match(signing, /dmWebSigningCancelled/);
  assert.match(signing, /dmWebSigningFailed/);
  assert.match(signing, /prepareDownload\(false\)/);
  assert.match(signing, /setStatus\(t\("dmWebUnsignedReady"\)\)/);
  assert.match(source, /const signedDownload = download\?\.fileName === "D2RMobile-signed.ipa"/);
  assert.match(signing, /clearSigningInputs\(\)/);
  assert.match(signing, /setSigningStatus\(signingMessage\)/);
  assert.equal((signing.match(/appendActivity\(signingMessage, true\)/g) ?? []).length, 1);
  assert.doesNotMatch(signing, /appendActivity\(signingError/);
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
    /dmWebSigningCancelled"[\s\S]*?dmWebSigningFailed"[\s\S]*?setStatus\(t\("dmWebUnsignedReady"\)\)/,
  );
});

// 只映射封闭错误码；不展示证书名称或原始错误消息。
// Map only the closed error code; never display certificate names or raw error messages.
test("signing mismatch has a fixed actionable label without stronger verification claims", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /signingError instanceof Error &&\s*signingError.message === "SIGNING_PROFILE_MISMATCH"/,
  );
  assert.match(
    source,
    /controller.signal.aborted[\s\S]*?dmWebSigningCancelled[\s\S]*?SIGNING_PROFILE_MISMATCH[\s\S]*?dmWebSigningProfileMismatch[\s\S]*?dmWebSigningFailed/,
  );
  assert.doesNotMatch(source, /setSigningStatus\(signingError|t\(signingError/);
  const table = await readFile(new URL("../../dm/i18n/ui_text.tsv", import.meta.url), "utf8");
  const row = (key) =>
    table
      .split("\n")
      .find((line) => line.startsWith(key + "\t"))
      .split("\t");
  assert.match(
    row("dmWebSigningProfileMismatch")[2],
    /mismatched or expired.*Unsigned IPA retained/,
  );
  assert.match(row("dmWebSigningComplete")[2], /created and ready to download.*not guaranteed/);
  assert.doesNotMatch(row("dmWebSigningComplete")[2], /verified/);
  assert.match(row("dmWebSigningWorking")[2], /checking the archive locally/);
});

// 重试只复用已提交的 Blob，输入与一次性线程每次重新拥有。
// Retry reuses only the committed Blob; inputs and the one-shot worker have fresh ownership each time.
test("UI signing retry initializes before reads and retains no conversion lifecycle", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const attempt = source.slice(
    source.indexOf("  async function runSigning("),
    source.indexOf("  async function retrySigning()"),
  );
  assert.ok(
    attempt.indexOf("await jobPackager.prepareSigning") <
      attempt.indexOf("await signWithLocalFiles"),
  );
  assert.match(attempt, /sign: attempt.sign/);
  assert.match(attempt, /finally \{\s*attempt\?\.close\(\);\s*clearSigningInputs\(\)/);
  assert.match(attempt, /unsignedForSigning.current = null/);
  const retry = source.slice(
    source.indexOf("  async function retrySigning()"),
    source.indexOf("  async function generate()"),
  );
  assert.match(retry, /const unsigned = unsignedForSigning.current/);
  assert.match(retry, /operationGate.current.begin\(\)/);
  assert.match(retry, /await runSigning\(jobPackager, unsigned,/);
  assert.match(retry, /if \(!keepSigningFactory \|\| !current\(\)\) await jobPackager.close\(\)/);
  assert.doesNotMatch(retry, /\.generate\(|setResourceOutcome|setLegacyStatus|fetch\(/);
  assert.match(retry, /setCancelling\(false\)/);
  assert.match(source, /onClick=\{retrySigning\} disabled=\{busy \|\| !credentialsSelected\}/);
});

test("sequential signing attempts keep the same unsigned Blob and wipe fresh credentials", async () => {
  const unsigned = inputs().unsigned;
  const consumed = [];
  for (let i = 0; i < 2; i++) {
    const operation = signWithLocalFiles({
      ...inputs(),
      unsigned,
      async sign({ ipa, credentials }) {
        assert.equal(ipa, unsigned.blob);
        consumed.push(credentials);
        if (i === 0) throw new Error("SIGNING_PROFILE_MISMATCH");
        return { blob: new Blob(["signed"]), fileName: "D2RMobile-signed.ipa" };
      },
    });
    if (i === 0) await assert.rejects(operation, /SIGNING_PROFILE_MISMATCH/);
    else assert.equal((await operation).fileName, "D2RMobile-signed.ipa");
  }
  assert.notEqual(consumed[0].identity, consumed[1].identity);
  for (const credentials of consumed) {
    assert.ok(new Uint8Array(credentials.identity).every((byte) => byte === 0));
    assert.ok(new Uint8Array(credentials.profile).every((byte) => byte === 0));
  }
  assert.equal(await unsigned.blob.text(), "unsigned IPA");
});
