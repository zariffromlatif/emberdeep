import type { Theme } from "./map";

export const THEMES: Theme[] = [
  {
    name: "The Cellars of Hollowmere",
    subtitle: "Depth I",
    wall: "#8a7a68", floor: "#6f6458", ambient: "#2b3550", torch: "#ffad5c", fog: 0.035, accent: "#ffb066",
  },
  {
    name: "The Ossuary",
    subtitle: "Depth II",
    wall: "#8d8a80", floor: "#66625a", ambient: "#2a3a48", torch: "#ffc27a", fog: 0.04, accent: "#d9d2b8",
  },
  {
    name: "The Drowned Forge",
    subtitle: "Depth III",
    wall: "#6e7480", floor: "#555c66", ambient: "#1f3a4a", torch: "#ff9a4a", fog: 0.045, accent: "#7fd1ff",
  },
  {
    name: "The Gloomvaults",
    subtitle: "Depth IV",
    wall: "#6f6878", floor: "#57525e", ambient: "#2b2448", torch: "#ffb070", fog: 0.05, accent: "#b58cff",
  },
  {
    name: "The Ember Throne",
    subtitle: "Depth V",
    wall: "#7a5a50", floor: "#5a443e", ambient: "#3a1c1c", torch: "#ff7a3a", fog: 0.05, accent: "#ff5a2a",
  },
];
