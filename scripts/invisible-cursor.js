// Erzeugt ein unsichtbares Xcursor-Theme (1 × 1 transparentes Pixel) für den Kiosk; scripts/kiosk.sh ruft es auf.
// Übernommen von der Slotmaschine (deploy/make_invisible_cursor.py), hier in Node, weil Node ohnehin da ist.
// Aufruf: node invisible-cursor.js <ziel-ordner> → <ziel-ordner>/cursors/<name> und index.theme
const fs = require("fs");
const path = require("path");

// Gängige Namen: cage/wlroots nimmt „default“ bzw. „left_ptr“, Chromium je nach CSS „pointer“, „text“ …
const NAMES = [
  "default", "left_ptr", "arrow", "top_left_arrow", "pointer", "hand1", "hand2", "text", "xterm", "ibeam",
  "wait", "watch", "progress", "left_ptr_watch", "crosshair", "cross", "move", "grab", "grabbing", "fleur",
  "not-allowed", "help", "context-menu", "cell", "all-scroll", "col-resize", "row-resize"
];
const IMAGE_TYPE = 0xfffd0002;
const NOMINAL_SIZE = 24;

function cursorBytes() {
  const buf = Buffer.alloc(16 + 12 + 36 + 4);
  // Kopf: Magic, Kopfgröße, Version, Anzahl Einträge
  buf.write("Xcur", 0, "ascii");
  buf.writeUInt32LE(16, 4);
  buf.writeUInt32LE(0x10000, 8);
  buf.writeUInt32LE(1, 12);
  // Inhaltsverzeichnis: Typ, Größe, Position
  buf.writeUInt32LE(IMAGE_TYPE, 16);
  buf.writeUInt32LE(NOMINAL_SIZE, 20);
  buf.writeUInt32LE(28, 24);
  // Bild: Kopfgröße, Typ, Größe, Version, Breite, Höhe, Hotspot x/y, Verzögerung; danach ein ARGB-Pixel (0 = transparent)
  [36, IMAGE_TYPE, NOMINAL_SIZE, 1, 1, 1, 0, 0, 0].forEach((v, i) => buf.writeUInt32LE(v, 28 + i * 4));
  return buf;
}

const target = process.argv[2];
if (!target) {
  console.error("Aufruf: node invisible-cursor.js <ziel-ordner>");
  process.exit(1);
}
fs.mkdirSync(path.join(target, "cursors"), { recursive: true });
const data = cursorBytes();
for (const name of NAMES) fs.writeFileSync(path.join(target, "cursors", name), data);
fs.writeFileSync(path.join(target, "index.theme"), "[Icon Theme]\nName=frame-invisible\nComment=Unsichtbarer Mauszeiger für den Kiosk\n");
