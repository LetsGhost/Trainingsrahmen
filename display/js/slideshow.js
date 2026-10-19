// Slideshow: zwei <img>, das nächste Bild wird vorab dekodiert, überblendet wird nur über opacity.
// Das DOM bleibt stehen, solange die Slideshow läuft; render() aktualisiert nur die Uhr.
import { hhmm } from "./util.js";

const INTERVAL_MS = 12000;

let mounted = false;
let timer = null;
let list = [];
let index = 0;
let front = 0;

async function next(frame) {
  if (!mounted || !list.length) return;
  const imgs = frame.querySelectorAll(".slide");
  const back = imgs[1 - front];
  back.src = `/api/slides/${encodeURIComponent(list[index++ % list.length])}`;
  try {
    await back.decode();
  } catch {}
  if (!mounted) return;
  back.classList.add("visible");
  imgs[front].classList.remove("visible");
  front = 1 - front;
  timer = setTimeout(() => next(frame), INTERVAL_MS);
}

async function mount(frame) {
  mounted = true;
  front = 0;
  frame.innerHTML = `
    <section class="slideshow">
      <img class="slide" alt=""><img class="slide" alt="">
      <div class="slide-clock"></div>
    </section>`;
  try {
    list = await (await fetch("/api/slides", { cache: "no-store" })).json();
  } catch {
    list = [];
  }
  // Nicht jedes Mal mit demselben Bild beginnen.
  index = list.length ? Math.floor(Math.random() * list.length) : 0;
  next(frame);
}

export function showSlideshow(frame, d) {
  if (!mounted) mount(frame);
  frame.querySelector(".slide-clock").textContent = hhmm(d);
}

export function stopSlideshow() {
  mounted = false;
  clearTimeout(timer);
}
