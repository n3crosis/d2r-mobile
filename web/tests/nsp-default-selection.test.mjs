import assert from "node:assert/strict";
import test from "node:test";
import { selectDefaultNspNames } from "../nsp-default-selection.mjs";
import { D2R_APPLICATION_ID, D2R_PATCH_ID, D2R_WARLOCK_ID } from "../d2r-expansion-policy.mjs";

const named = (label, id) => `${label} [${id.toString(16).padStart(16, "0")}].nsp`;
const base = named("Base", D2R_APPLICATION_ID);
const update = named("Update", D2R_PATCH_ID);
const dlc = named("Warlock", D2R_WARLOCK_ID);
const unrelated = "Other [0100000000000000].nsp";

test("recognized base/update preselect canonical optional Warlock, not unrelated titles", () => {
  const names = Object.freeze([unrelated, dlc, update, base, "Unknown DLC.nsp"]);
  assert.deepEqual(selectDefaultNspNames(names), [base, update, dlc]);
  assert.deepEqual(selectDefaultNspNames([base, update, unrelated]), [base, update]);
  assert.deepEqual(selectDefaultNspNames([base, update, "DLC [0100726014353002].nsp"]), [
    base,
    update,
  ]);
});

test("missing or ambiguous base and missing update preserve the existing all-name fallback", () => {
  for (const names of [
    [],
    [update, dlc, unrelated],
    [base, named("Copy", D2R_APPLICATION_ID), update, dlc, unrelated],
    [base, dlc, unrelated],
  ]) {
    assert.deepEqual(selectDefaultNspNames(names), names);
  }
});

test("case and multiple update versions preserve every recognized candidate for later authentication", () => {
  const upper = [base, update, dlc].map((name) => name.toUpperCase());
  assert.deepEqual(selectDefaultNspNames([...upper, unrelated]), upper);
  const secondUpdate = named("Update v2", D2R_PATCH_ID);
  const secondDlc = named("Warlock v2", D2R_WARLOCK_ID);
  assert.deepEqual(selectDefaultNspNames([secondUpdate, secondDlc, base, update, dlc, unrelated]), [
    base,
    secondUpdate,
    update,
    secondDlc,
    dlc,
  ]);
});

test("exact bracket markers are hints, not filename authenticity checks", () => {
  assert.deepEqual(
    selectDefaultNspNames([
      base,
      update,
      "Warlock 0100726014353001.nsp",
      "Warlock [01007260143530010].nsp",
    ]),
    [base, update],
  );
  const spoof = named("Untrusted contents", D2R_WARLOCK_ID);
  assert.deepEqual(selectDefaultNspNames([base, update, spoof]), [base, update, spoof]);
});

test("new DLC hints reject multiple title markers without changing base/update or fallback selection", () => {
  const mixed = `Other [0100000000000000] ${dlc}`;
  const repeated = `Copy [0100726014353001] ${dlc}`;
  const secondDlc = named("Warlock v2", D2R_WARLOCK_ID);
  assert.deepEqual(selectDefaultNspNames([base, update, mixed, repeated, dlc, secondDlc]), [
    base,
    update,
    dlc,
    secondDlc,
  ]);
  assert.deepEqual(selectDefaultNspNames([update, mixed]), [update, mixed]);
  const oldBaseHint = `Other [0100000000000000] ${base}`;
  assert.deepEqual(selectDefaultNspNames([oldBaseHint, update, mixed]), [oldBaseHint, update]);
});
