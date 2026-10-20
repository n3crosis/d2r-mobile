// Constructed from the vendored decoder, not extracted from any game.
// Maxwell control/scheduling word, followed by unconditional EXIT (PT, CC.T).
export const code = new Uint8Array(16);
new DataView(code.buffer).setBigUint64(8, 0xe30000000007000fn, true);
export const job = Object.freeze({
  key: "synthetic-exit",
  stage: "cs",
  local: [1, 1, 1],
  shared: 0,
  tex: {},
  img: {},
  attr: {},
  fout: {},
  debug: true,
  reduced: false,
});
