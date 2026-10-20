# SparkMD5 3.0.2 provenance

This directory vendors SparkMD5, not an independently authored MD5 implementation.
It is used only for legacy archive-format checksums, never authentication,
signatures, passwords, security decisions, or supported-game identification.

- Author/project: André Cruz, [satazor/js-spark-md5](https://github.com/satazor/js-spark-md5).
- Exact npm release: `spark-md5@3.0.2`.
- Registry metadata: <https://registry.npmjs.org/spark-md5/3.0.2>.
- Tarball: <https://registry.npmjs.org/spark-md5/-/spark-md5-3.0.2.tgz>.
- npm-reported gitHead: `9315385868fe11076674d4ddd763005319a462a7`.
- Retrieved and integrity-checked: 2026-10-20.
- Tarball SHA-512 (base64): `wcFzz9cDfbuqe0FZzfi2or1sgyIrsDwmPwfZC4hiNidPdPINjeUwNfv5kldczoEAcjl9Y1L3SM7Uz2PUEQzxQw==`.
- Original `spark-md5.js` SHA-256: `87f7f7804f9e5d55782065d799d75fc8d3b324100b198d1a415632255552736d`.
- Adapted `spark-md5.mjs` SHA-256: `bf574e66f46dca229613e716e02146cd45859f46b92014f2503db535475d9605`.

## License

Upstream declares `(WTFPL OR MIT)`. This project selects the MIT alternative,
preserved verbatim in `LICENSE2`. The npm tarball omits that file; it was retrieved
from the [exact upstream commit](https://raw.githubusercontent.com/satazor/js-spark-md5/9315385868fe11076674d4ddd763005319a462a7/LICENSE2).
Its SHA-256 is `6e7abbd885f650c938cf377a6edcad56c7dcb61de092853af6141d806f8c9f04`.

## Only local source modification

The original UMD outer wrapper, through `}(function (undefined) {`, is replaced
with a provenance comment and `const SparkMD5 = (function (undefined) {`.
The final `}));` becomes `})();`, followed by `export default SparkMD5;`.
The complete factory body is otherwise unchanged, including its formatting.
No hashing algorithm, constants, or buffer operations have been modified.
The adapted module works through native browser ES modules without globals,
CommonJS shims, dynamic evaluation, or additional network dependencies.

The pinned upstream source and license are excluded narrowly from formatting;
the adapter, tests, and this document are still checked. Registry integrity checks
establish matching downloaded bytes, not an independent security audit or proof
of algorithm suitability. Regression tests cover RFC 1321 vectors, exact views,
chunk boundaries, and an independent Node crypto oracle.
