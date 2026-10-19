// Hilfen für Wochenraster und Tagesansicht.

export const DOW_SHORT = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"];
export const DOW_LONG = ["MONTAG", "DIENSTAG", "MITTWOCH", "DONNERSTAG", "FREITAG", "SAMSTAG", "SONNTAG"];
export const MONTHS = ["JANUAR", "FEBRUAR", "MÄRZ", "APRIL", "MAI", "JUNI", "JULI", "AUGUST", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DEZEMBER"];

export const pad = n => String(n).padStart(2, "0");
export const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const icon = name => `<svg class="icon" viewBox="0 0 24 24"><use href="assets/icons.svg#i-${name}"></use></svg>`;

// Montag = 0 … Sonntag = 6
export const dowIndex = d => (d.getDay() + 6) % 7;

// Weiche Trennstellen für lange Wörter. Chromium hat auf dem Pi offline kein Trenn-Wörterbuch, daher eine
// einfache Regel: zwischen zwei Vokalen vor dem letzten Konsonanten trennen (Stei-ge-rungs-läu-fen, Rü-cken).
// Diphthonge und ch, ck, sch, ph, qu bleiben zusammen; vorn und hinten bleiben mindestens 3 Zeichen.
const SHY = "­";
const UNIT = /sch|ch|ck|ph|qu|ei|ie|au|eu|äu|ai|./gi;
const isVowel = unit => /[aeiouäöüy]/i.test(unit[0]);

function hyphenateWord(word) {
  const units = word.match(UNIT);
  const breaks = new Set();
  for (let i = 0; i < units.length; i++) {
    if (!isVowel(units[i])) continue;
    let j = i + 1;
    while (j < units.length && !isVowel(units[j])) j++;
    if (j < units.length && j - i > 1) {
      // "sch" beginnt fast immer eine Silbe (Rü-cken-schwim-men).
      const sch = units.slice(i + 1, j).findIndex(u => u.toLowerCase() === "sch");
      breaks.add(sch >= 0 ? i + 1 + sch : j - 1);
    }
    i = j - 1;
  }
  let out = "", pos = 0;
  units.forEach((unit, k) => {
    if (breaks.has(k) && pos >= 3 && word.length - pos >= 3) out += SHY;
    out += unit;
    pos += unit.length;
  });
  return out;
}

export const hyphenate = (text, minLength = 10) =>
  String(text).replace(/[A-Za-zÄÖÜäöüß]+/g, w => (w.length < minLength ? w : hyphenateWord(w)));
