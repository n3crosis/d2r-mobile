import test from 'node:test';
import assert from 'node:assert/strict';
import {safeRelativePath, indexFiles, readRange, inspectNso, fileSource, MAX_READ_BYTES} from '../preflight.mjs';

function fixture() {
  const bytes = new Uint8Array(0x130), v = new DataView(bytes.buffer);
  bytes.set([0x4e, 0x53, 0x4f, 0x30]);
  for (let i = 0; i < 3; i++) {
    v.setUint32(0x10 + i * 16, 0x100 + i * 16, true);
    v.setUint32(0x14 + i * 16, i * 0x1000, true);
    v.setUint32(0x18 + i * 16, 16, true);
  }
  return bytes;
}
const source = bytes => ({size: bytes.length, read: async (o, n) => bytes.slice(o, o + n)});
test('accepts safe paths and rejects cross-platform dangerous paths', () => {
  assert.equal(safeRelativePath('ExeFS/main'), 'ExeFS/main');
  for (const p of ['', '/root', '../x', 'a/../x', 'a//x', 'C:/x', 'a\\b', 'a\0b', 'x.', 'x ', 'CON', 'aux.txt', 'e\u0301']) {
    assert.throws(() => safeRelativePath(p), /Unsafe/);
  }
});
test('indexes metadata without reading bytes and rejects duplicates', () => {
  assert.equal(indexFiles([{path:'RomFS/data/archive.data',size:6 * 1024**3}]).size, 1);
  assert.throws(() => indexFiles([{path:'a',size:1},{path:'A',size:2}]), /Conflicting/);
  assert.throws(() => indexFiles([{path:'a',size:1},{path:'a/b',size:2}]), /conflict/);
  assert.throws(() => indexFiles([{path:'a',size:NaN}]), /size/);
});
test('NSO reads only 256 bytes even for virtual multi-GB input', async () => {
  const calls = [];
  const result = await inspectNso({size:6 * 1024**3, read:async (o,n) => {calls.push([o,n]); return fixture().slice(o,o+n);}});
  assert.deepEqual(calls, [[0,256]]);
  assert.equal(result.segments.length, 3);
  assert.equal(result.versionVerified, false);
});
test('rejects malformed, truncated, out-of-bounds and overlapping NSO', async () => {
  await assert.rejects(inspectNso(source(new Uint8Array(12))), /range/);
  await assert.rejects(inspectNso(source(new Uint8Array(256))), /NSO0/);
  for (const [offset,value] of [[4,1],[12,128],[16,0xfffffff0],[0x20,0x100],[0x24,0]]) {
    const b=fixture(); new DataView(b.buffer).setUint32(offset,value,true);
    await assert.rejects(inspectNso(source(b)));
  }
});
test('read budgets, short reads and cancellation are enforced', async () => {
  await assert.rejects(readRange({size:1e9,read:()=>{throw Error('must not read');}},0,MAX_READ_BYTES+1), /range/);
  await assert.rejects(readRange({size:10,read:async()=>new Uint8Array(1)},0,2), /Short/);
  const c=new AbortController(); c.abort();
  await assert.rejects(readRange(source(fixture()),0,1,c.signal), {name:'AbortError'});
  const d=new AbortController();
  await assert.rejects(readRange({size:1,read:async()=>{d.abort();return new Uint8Array(1);}},0,1,d.signal), {name:'AbortError'});
});
test('Blob adapter returns exact slices', async () => {
  assert.deepEqual(await readRange(fileSource(new Blob([new Uint8Array([1,2,3])])),1,2), new Uint8Array([2,3]));
});
