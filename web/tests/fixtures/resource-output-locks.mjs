export function resourceOutputLocks() {
  let active = false;
  return {
    async request(_name, _options, callback) {
      if (active) return callback(null);
      active = true;
      try {
        return await callback({});
      } finally {
        active = false;
      }
    },
  };
}
