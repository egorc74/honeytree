/** Deterministic SVG placeholder art so the mocks need no network or asset files. */

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PALETTES: [string, string, string][] = [
  ["#F5B700", "#D98E04", "#3B2414"],
  ["#FFD45C", "#6A8D3A", "#3B2414"],
  ["#D98E04", "#B23A1E", "#FFF8E1"],
  ["#6A8D3A", "#3B2414", "#FFD45C"],
  ["#6B4226", "#F5B700", "#FFF8E1"],
  ["#B23A1E", "#F5B700", "#FFF8E1"],
  ["#FDEBB3", "#D98E04", "#3B2414"],
  ["#3B2414", "#D98E04", "#FFD45C"],
];

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}

export function placeholderImage(seed: string, label: string, w = 640, h = 360): string {
  const hash = hashString(seed);
  const [a, b, fg] = PALETTES[hash % PALETTES.length];
  const hexes: string[] = [];
  for (let i = 0; i < 9; i++) {
    const hh = hashString(seed + i);
    const r = 24 + (hh % 60);
    hexes.push(
      `<polygon points="${hexPoints((hh >>> 3) % w, (hh >>> 7) % h, r)}" fill="${fg}" opacity="${0.08 + ((hh >>> 11) % 18) / 100}"/>`,
    );
  }
  const text = label.replace(/[<>&"]/g, "").slice(0, 28);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>${hexes.join("")}` +
    `<text x="50%" y="52%" text-anchor="middle" font-family="Fredoka, system-ui, sans-serif" font-weight="600" font-size="${Math.round(h / 8)}" fill="${fg}">${text}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function placeholderAvatar(seed: string, label: string): string {
  return placeholderImage(seed, label.slice(0, 2).toUpperCase(), 160, 160);
}
