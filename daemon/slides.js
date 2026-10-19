// Bilder für die Slideshow auf der Daten-Partition. Das Admin-Panel verkleinert sie vor dem Hochladen
// im Browser auf 800 × 480; hier wird nur geprüft, dass es wirklich ein Bild ist, und die Anzahl begrenzt.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { FrameError } = require("./errors");

const MAX_SLIDES = 200;
const MAX_BYTES = 3 * 1024 * 1024;
const NAME = /^[0-9a-z-]+\.(jpg|png|webp)$/;

// Erkennung am Dateianfang statt am Content-Type des Browsers.
function detectType(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function createSlides(dataDir) {
  const dir = path.join(dataDir, "slides");
  fs.mkdirSync(dir, { recursive: true });

  // Älteste zuerst; der Dateiname beginnt mit dem Zeitstempel.
  const list = () => fs.readdirSync(dir).filter(n => NAME.test(n)).sort();

  return {
    MAX_SLIDES,
    MAX_BYTES,
    list,
    count: () => list().length,
    file: name => (NAME.test(name) ? path.join(dir, name) : null),

    add(buf) {
      if (buf.length > MAX_BYTES) throw new FrameError("TOO_LARGE", "Bild ist zu groß (max. 3 MB)");
      const type = detectType(buf);
      if (!type) throw new FrameError("NOT_AN_IMAGE", "Nur JPEG, PNG oder WebP");
      if (list().length >= MAX_SLIDES) throw new FrameError("TOO_MANY", `Höchstens ${MAX_SLIDES} Bilder`);
      const name = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}.${type}`;
      fs.writeFileSync(path.join(dir, name + ".tmp"), buf);
      fs.renameSync(path.join(dir, name + ".tmp"), path.join(dir, name));
      return name;
    },

    remove(name) {
      if (!NAME.test(name)) throw new FrameError("NOT_FOUND", "Bild nicht gefunden");
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        throw new FrameError("NOT_FOUND", "Bild nicht gefunden");
      }
    }
  };
}

module.exports = { createSlides };
