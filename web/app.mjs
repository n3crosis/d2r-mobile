import {inspectNso, fileSource} from './preflight.mjs';
const $ = id => document.getElementById(id);
const canPick = globalThis.isSecureContext && typeof globalThis.showDirectoryPicker === 'function';
$('capability').textContent = canPick
  ? 'Local folder access available. Direct-to-disk IPA output is planned, not implemented.'
  : 'Folder selection needs a supporting desktop Chromium browser and HTTPS or localhost. The synthetic demo is still available.';
$('select').disabled = !canPick;
let active;
function busy(value) {
  $('demo').disabled=value; $('select').disabled=value || !canPick; $('cancel').disabled=!value;
}
async function run(task) {
  if (active) return;
  active=new AbortController(); busy(true); $('output').textContent='Working locally…';
  try { $('output').textContent=await task(active.signal); }
  catch (error) { $('output').textContent=error.name==='AbortError' ? 'Cancelled. No files were written.' : `Stopped: ${error.message}`; }
  finally {active=undefined;busy(false);}
}
$('cancel').addEventListener('click',()=>active?.abort());
$('demo').addEventListener('click',()=>run(async signal=> {
  const bytes=new Uint8Array(256),view=new DataView(bytes.buffer); let read=0;
  bytes.set([0x4e,0x53,0x4f,0x30]);
  for(let i=0;i<3;i++) {
    view.setUint32(0x10+i*16,256+i*16,true);
    view.setUint32(0x14+i*16,i*4096,true);
    view.setUint32(0x18+i*16,16,true);
  }
  const result=await inspectNso({size:6*1024**3,read:async(o,n)=>{read+=n;return bytes.slice(o,o+n);}},signal);
  return `SYNTHETIC DEMO ONLY\nVirtual input: 6 GiB (not allocated)\nBytes requested: ${read}\nSegments described: ${result.segments.length}\nNo game data, uploads or output files.\nHeader structure passes. Supported game version: NOT verified.\nIPA generation: NOT implemented.`;
}));
$('select').addEventListener('click',()=>run(async signal=> {
  const root=await showDirectoryPicker({mode:'read'});signal.throwIfAborted();
  const exefs=await root.getDirectoryHandle('ExeFS');
  const lines=['LOCAL HEADER CHECK ONLY'];
  for(const name of ['main','sdk','subsdk0']) {
    signal.throwIfAborted();
    const handle=await exefs.getFileHandle(name),file=await handle.getFile();
    const header=await inspectNso(fileSource(file),signal);
    lines.push(`${name}: header structure passes; module ID ${header.moduleId}`);
  }
  lines.push('Read 768 bytes total. Bulk resource files were not opened.',
    'Game version, content hashes and patch compatibility: NOT verified.',
    'No conversion, uploads or output files. IPA generation is NOT implemented.');
  return lines.join('\n');
}));
