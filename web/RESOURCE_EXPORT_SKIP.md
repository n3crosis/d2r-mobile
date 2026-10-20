# Optional original resource export

[简体中文](RESOURCE_EXPORT_SKIP.zh-CN.md)

`generate({exportResources: false, ...})` explicitly skips only the original
RomFS resource-folder copy when rebuilding an IPA. The default is `true`; other
value types reject before folder permission checks or job consumption.

Success and failure outcomes use `resources: {status: "skipped", reason:
"user-requested"}`. No resource completion event is emitted. This does not inspect,
verify, reuse or claim to have exported any existing directory. Existing resources
must still be independently suitable for the game; the caller chooses to omit
this copy.

NSP authentication, authenticated asset reads, program/assets/shader generation,
IPA validation, folder permissions and output destination remain unchanged.
Enabled Legacy Device Pack export is mandatory and is not skipped. Its failure
still prevents IPA completion. No source files are changed, no uploads or signing
are added. Focused synthetic policy and source-wiring tests are not browser proof.
