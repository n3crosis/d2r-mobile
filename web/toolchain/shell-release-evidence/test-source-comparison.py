"""诊断证据工具测试，不代表生产兼容性。
Tests for the diagnostic evidence tool, not production compatibility."""

import importlib.util
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("comparison", HERE / "compare-source.py")
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)


class EvidenceTests(unittest.TestCase):
    def test_pinned_public_source(self):
        result = comparison.report()
        self.assertEqual(result["release"]["computedChain"], "c675d3fa7c90")
        self.assertEqual(result["release"]["headerChain"], "15cf7ca29eaf")
        self.assertTrue(result["chainInputsIdentical"])
        self.assertFalse(result["release"]["headerMatchesCommittedInputs"])
        self.assertFalse(result["releaseComputedChainMatchesShell"])
        self.assertFalse(result["releaseHeaderMatchesShell"])
        self.assertFalse(result["productionCompatibilityEstablished"])
        self.assertEqual(len(result["release"]["chainInputSha256"]), 11)

    def test_archive_tamper_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "tampered.zip"
            archive.write_bytes(b"not the pinned public archive")
            with self.assertRaisesRegex(ValueError, "SHA-256 differs"):
                comparison.report(archive)

    def test_literal_extraction_not_execution(self):
        source = "raise RuntimeError('never execute')\nFILES = ['one', 'two']\n"
        self.assertEqual(comparison.literal_assignment(source, "FILES"), ["one", "two"])
        with self.assertRaises(ValueError):
            comparison.literal_assignment("FILES = run_untrusted_code()", "FILES")


if __name__ == "__main__":
    unittest.main()
