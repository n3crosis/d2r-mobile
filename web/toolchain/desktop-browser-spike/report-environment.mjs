import { appendFile } from "node:fs/promises";
import os from "node:os";
import process from "node:process";
const summary = `Synthetic desktop Chromium environment: ${os.platform()} ${os.release()} ${os.arch()}, Node ${process.version}.\n\nIndividual proof steps and their logs determine pass/fail and record the actual Chromium version. The checks cover small synthetic OPFS commit/reread, cancellation, quota rejection, sealed Emscripten conversion and fail-closed preload errors.\n\nThis is Playwright Chromium, not installed Chrome or Edge. It does not automate or validate an OS save picker, multi-GB disk endurance, all Windows/macOS versions, game inputs, real keys, IPA installation or device compatibility. Only public generated runtime files are transferred between jobs; no user data is read or uploaded.\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
