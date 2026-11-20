import "./style.css";
import { App } from "./app";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const loading = document.createElement("div");
loading.className = "loading";
loading.innerHTML = `<div class="spark"></div>`;
document.getElementById("app")!.appendChild(loading);

// Let the loading spark paint before the heavy texture generation starts.
// (A timer, not requestAnimationFrame: background tabs never fire rAF, and boot must not stall there.)
setTimeout(() => {
  const app = new App(canvas);
  app.showTitle();
  (window as unknown as { emberdeep: App }).emberdeep = app;
  void app.whenReady().then(() => {
    loading.classList.add("done");
    setTimeout(() => loading.remove(), 900);
  });
}, 30);
