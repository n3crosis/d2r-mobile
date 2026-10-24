// 只导入打包配置，以可变注册表模拟逐项检查独立下载固定值；禁止真实网络、构建及二进制执行。
// Import packaging configuration only, varying a mocked registry to check each independent download pin, without real network, builds or binary execution.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { resolveShellProfile } from "../../shell-profiles.mjs";

const currentProfiles = new Map(
  ["v2.0.0-ios26", "v2.0.0-ios18"].map((id) => [id, resolveShellProfile(id)]),
);
let drift;
let networkCalls = 0;
mock.method(globalThis, "fetch", () => {
  networkCalls++;
  throw new Error("UNEXPECTED_NETWORK");
});
mock.module("../../shell-profiles.mjs", {
  namedExports: {
    resolveShellProfile(id) {
      const profile = structuredClone(currentProfiles.get(id));
      if (drift?.id === id) {
        if (drift.field === "archivePath") profile.archivePath = "profile/legacy-shell.zip";
        else if (drift.field === "archiveBytes") profile.evidence.archiveBytes++;
        else if (drift.field === "sourceUrl") profile.evidence.sourceUrl += "?untrusted";
        else profile.evidence.sha256 = "0".repeat(64);
      }
      return profile;
    },
  },
});

for (const id of currentProfiles.keys()) {
  for (const field of ["archivePath", "archiveBytes", "sourceUrl", "sha256"]) {
    test(`${id} ${field} drift fails before any download`, async () => {
      drift = { id, field };
      await assert.rejects(
        import(`../../runtime-build/package.mjs?drift=${id}-${field}`),
        /Pinned public shell registry drift/,
      );
      assert.equal(networkCalls, 0);
    });
  }
}

test("unchanged registry remains importable without downloading or assembling", async () => {
  drift = undefined;
  const { SHELL_BUILD_INPUTS } = await import("../../runtime-build/package.mjs?drift=none");
  assert.deepEqual(
    SHELL_BUILD_INPUTS.map((input) => input.profileId),
    [...currentProfiles.keys()],
  );
  assert.equal(networkCalls, 0);
});
