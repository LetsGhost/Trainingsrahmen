// Prüft Server-URL und API-Key bei der Einrichtung. Der regelmäßige Sync kommt mit Phase 6.
const { FrameError } = require("./errors");

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = function createBackend({ dev, sim }) {
  return {
    async check({ url, apiKey }) {
      if (dev) {
        await delay(400);
        if (sim.keyRejected) throw new FrameError("KEY_REJECTED", "Server lehnt den API-Key ab");
        return;
      }
      let res;
      try {
        res = await fetch(url.replace(/\/+$/, "") + "/data", {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(10000)
        });
      } catch {
        throw new FrameError("SERVER_UNREACHABLE", "Server nicht erreichbar");
      }
      if (res.status === 401 || res.status === 403) throw new FrameError("KEY_REJECTED", "Server lehnt den API-Key ab");
      if (!res.ok) throw new FrameError("SERVER_ERROR", `Server antwortet mit ${res.status}`);
    }
  };
};
