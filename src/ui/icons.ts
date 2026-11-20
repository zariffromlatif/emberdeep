/** Hand-drawn line icons (24x24, stroke-based). Original artwork for this game. */
const P: Record<string, string> = {
  sword: '<path d="M14.5 3.5 20.5 3.5 20.5 9.5 10 20"/><path d="M4 14 10 20"/><path d="M6.5 16.5 3 20"/><path d="M7 13l4 4"/>',
  dagger: '<path d="M17 3l4 4-9.5 9.5-4-4z"/><path d="M6 11l7 7"/><path d="M8.5 15.5 4 20"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6z"/><path d="M12 7v10"/><path d="M8 11h8"/>',
  boot: '<path d="M7 3h6v8l6 3.5V19H5V3"/><path d="M5 15h14"/><path d="M13 7h-3"/>',
  potion: '<path d="M9.5 3h5"/><path d="M10 3v5.2L6 14a5.5 5.5 0 0 0 4.8 7h2.4A5.5 5.5 0 0 0 18 14l-4-5.8V3"/><path d="M7.2 14.5h9.6"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/><path d="M12 10.5v5M9.5 13h5"/>',
  bolt: '<path d="M13 2 5 13.5h6L10 22l9-12h-6z"/>',
  hood: '<path d="M12 3C7 3 4.5 8 4.5 13.5V21h15v-7.5C19.5 8 17 3 12 3z"/><path d="M8 14c0-3 1.8-5.5 4-5.5s4 2.5 4 5.5"/><path d="M9.5 14.5h1.5M13 14.5h1.5"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  flame: '<path d="M12 21.5c-4 0-6.5-2.7-6.5-6.3 0-4.4 4-6.4 4.2-11.2 2.6 1.6 4 4 4.1 6.2.9-.8 1.5-2 1.6-3.2 2 1.8 3.1 4.6 3.1 7.6 0 4-2.5 6.9-6.5 6.9z"/><path d="M12 21.5c-1.7 0-2.8-1.2-2.8-2.8 0-2 1.8-2.8 2.8-5 1 2.2 2.8 3 2.8 5 0 1.6-1.1 2.8-2.8 2.8z"/>',
  sparkle: '<path d="M12 2.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>',
  fan: '<path d="M4 20 20 8"/><path d="M4 20 16 4"/><path d="M4 20 21 14"/><path d="M15 3.5c3 1.5 5.5 4.6 6.3 10.5"/>',
  mist: '<path d="M4 9h10M7 13h13M3 17h9M15 17h5M9 5h8"/>',
  burst: '<circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
  sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  chime: '<path d="M12 3v3"/><path d="M6.5 17h11l-1.5-2.5V11a4 4 0 0 0-8 0v3.5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M3 9c.5-2 1.5-3.5 3-4.5M21 9c-.5-2-1.5-3.5-3-4.5"/>',
  ankh: '<path d="M12 21v-9"/><path d="M7 12h10"/><path d="M12 12c-2.4-1.6-3.6-3.7-3.6-5.6a3.6 3.6 0 0 1 7.2 0c0 1.9-1.2 4-3.6 5.6z"/>',
  hourglass: '<path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/><path d="M9.5 18h5"/>',
  rest: '<path d="M4 20h16"/><path d="M6 20l12-4M18 20 6 16"/><path d="M12 14c-2 0-3.2-1.4-3.2-3.1 0-2.2 2-3.2 2.1-5.6 1.3.8 2 2 2 3.1.5-.4.8-1 .8-1.6 1 .9 1.5 2.3 1.5 3.8 0 2-1.2 3.4-3.2 3.4z"/>',
  skull: '<path d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.3 4.4 3 5.5V20h9v-4c1.7-1.1 3-2.9 3-5.5A7.5 7.5 0 0 0 12 3z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10.5 20v-2M13.5 20v-2"/>',
  coin: '<ellipse cx="12" cy="7" rx="7.5" ry="3"/><path d="M4.5 7v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V7"/><path d="M4.5 12v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5"/>',
  d20: '<path d="M12 2.5 20.5 7.3v9.4L12 21.5l-8.5-4.8V7.3z"/><path d="M12 2.5 7.5 10h9z"/><path d="M7.5 10 3.5 16.7M16.5 10l4 6.7M7.5 10 12 21.5 16.5 10"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  rotl: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
  rotr: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>',
  fast: '<path d="M3 6l8 6-8 6zM12 6l8 6-8 6z"/>',
  book: '<path d="M4 4.5h6a2 2 0 0 1 2 2V20a2 2 0 0 0-2-2H4z"/><path d="M20 4.5h-6a2 2 0 0 0-2 2V20a2 2 0 0 1 2-2h6z"/>',
  close: '<path d="M5 5l14 14M19 5 5 19"/>',
  helm: '<path d="M5 13c0-4.4 3.1-8 7-8s7 3.6 7 8v6H5z"/><path d="M12 5V2.5"/><path d="M8 12h8M12 12v7"/>',
  mask: '<path d="M3 9c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0-.5 5-3.5 7-6 7-1.6 0-2.4-1-3-2-.6 1-1.4 2-3 2-2.5 0-5.5-2-6-7z"/><path d="M7 11h2.5M14.5 11H17"/>',
  hat: '<path d="M2.5 19h19"/><path d="M5.5 19c1-2 1.5-4 2.5-6.5L12 3l3 6 2.5 2.5-2.5.5 1.5 7"/><path d="M8.5 15.5h7"/>',
  holy: '<circle cx="12" cy="12" r="4"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  question: '<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4.3"/><path d="M12 17.5v.5"/>',
  stairs: '<path d="M3 20h4v-4h4v-4h4V8h4V4h2"/><path d="M3 20h18"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};

export function icon(name: string, cls = ""): string {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? P.question}</svg>`;
}

export const CLASS_ICON: Record<string, string> = { fighter: "helm", rogue: "mask", wizard: "hat", cleric: "holy" };
