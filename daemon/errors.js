// Fehler mit festem Code. Der Code landet im Zustand; das Display und später das Portal zeigen den Text.
class FrameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

module.exports = { FrameError };
