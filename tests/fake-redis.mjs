// In-memory stand-in for the few Redis commands the friends API uses.
export function fakeRedis() {
  const kv = new Map();
  const sets = new Map();
  const set = (k) => {
    if (!sets.has(k)) sets.set(k, new Set());
    return sets.get(k);
  };
  const run = ([name, ...a]) => {
    switch (name.toUpperCase()) {
      case "GET": return kv.has(a[0]) ? kv.get(a[0]) : null;
      case "SET": {
        const nx = a.slice(2).map((x) => String(x).toUpperCase()).includes("NX");
        if (nx && kv.has(a[0])) return null;
        kv.set(a[0], String(a[1]));
        return "OK";
      }
      case "INCR": {
        const v = Number(kv.get(a[0]) || 0) + 1;
        kv.set(a[0], String(v));
        return v;
      }
      case "DEL": {
        let n = 0;
        for (const k of a) n += (kv.delete(k) ? 1 : 0) + (sets.delete(k) ? 1 : 0);
        return n;
      }
      case "MGET": return a.map((k) => (kv.has(k) ? kv.get(k) : null));
      case "SADD": { const s = set(a[0]); const before = s.size; a.slice(1).forEach((m) => s.add(m)); return s.size - before; }
      case "SREM": { const s = set(a[0]); let n = 0; a.slice(1).forEach((m) => { if (s.delete(m)) n++; }); return n; }
      case "SMEMBERS": return [...set(a[0])];
      case "SCARD": return set(a[0]).size;
      default: throw new Error(`fake redis: ${name} not supported`);
    }
  };
  return {
    kv, sets,
    async cmd(...args) { return run(args); },
    async pipe(cmds) { return cmds.map(run); },
  };
}
