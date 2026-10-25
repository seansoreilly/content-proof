import type { SignatureRecord } from "@/lib/record";

/**
 * Seal geometry as fractions of the seal's diameter, shared by the SVG
 * component and the canvas routine so both draw the same seal.
 * Ring and text radii are measured from the centre; ring widths are stroke
 * widths; the slot is the white square holding the QR code.
 */
export const SEAL_GEOMETRY = {
  outerRingRadius: 0.47,
  outerRingWidth: 0.012,
  innerRingRadius: 0.34,
  innerRingWidth: 0.006,
  /** Radius of the centre line of the rim text. */
  textRadius: 0.405,
  /** Side of the white square slot. */
  slotSize: 0.44,
  /** Padding inside the slot, as a fraction of the slot side. */
  slotPadding: 0.06,
  /** Letter-spacing in em. */
  tracking: 0.18,
  /** Average uppercase glyph advance in em, used to size the rim text. */
  glyphAdvance: 0.66,
  minFontSize: 0.024,
  maxFontSize: 0.06,
} as const;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `ContentProof · attested · YYYY-MM-DD HH:MM UTC · <k> ·` */
export function rimTextFor(record: Pick<SignatureRecord, "t" | "k">): string {
  const d = new Date(record.t);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return `ContentProof · attested · ${date} ${time} UTC · ${record.k} ·`;
}

/**
 * Rim font size as a fraction of the diameter: the text-radius circumference
 * divided by (characters x (glyph advance + tracking)), clamped.
 */
export function rimFontSizeFraction(charCount: number): number {
  const g = SEAL_GEOMETRY;
  const circumference = 2 * Math.PI * g.textRadius;
  const raw = circumference / (Math.max(charCount, 1) * (g.glyphAdvance + g.tracking));
  return Math.min(g.maxFontSize, Math.max(g.minFontSize, raw));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = (): void => resolve(img);
    img.onerror = (): void => reject(new Error("composeSealPng: could not load the QR image"));
    img.src = src;
  });
}

export async function composeSealPng(options: {
  qrDataUrl: string;
  rimText: string;
  size?: number;
  colors: { paper: string; accent: string };
}): Promise<string> {
  const size = options.size ?? 1024;
  const { paper, accent } = options.colors;
  const g = SEAL_GEOMETRY;
  const fontSize = rimFontSizeFraction(options.rimText.length) * size;
  const font = `600 ${fontSize}px 'Bricolage Grotesque', sans-serif`;

  if (typeof document.fonts?.load === "function") {
    try {
      await document.fonts.load(font);
    } catch {
      // fall back to whatever is loaded
    }
  }
  const qr = await loadImage(options.qrDataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("composeSealPng: 2D canvas is not available");

  const c = size / 2;

  // Paper disc.
  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  // Rings.
  ctx.strokeStyle = accent;
  ctx.lineWidth = g.outerRingWidth * size;
  ctx.beginPath();
  ctx.arc(c, c, g.outerRingRadius * size, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = g.innerRingWidth * size;
  ctx.beginPath();
  ctx.arc(c, c, g.innerRingRadius * size, 0, Math.PI * 2);
  ctx.stroke();

  // Rim text, glyph by glyph, clockwise from the top.
  const glyphs = Array.from(options.rimText.toUpperCase());
  const radius = g.textRadius * size;
  const tracking = g.tracking * fontSize;
  ctx.font = font;
  ctx.fillStyle = accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const widths = glyphs.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, w) => a + w + tracking, 0);
  const circumference = 2 * Math.PI * radius;
  // Spread any slack evenly so the text closes the circle.
  const slack = Math.max(0, (circumference - total) / Math.max(glyphs.length, 1));
  let arc = 0;
  glyphs.forEach((ch, i) => {
    const w = widths[i] ?? 0;
    const angle = -Math.PI / 2 + (arc + w / 2) / radius;
    ctx.save();
    ctx.translate(c + Math.cos(angle) * radius, c + Math.sin(angle) * radius);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    arc += w + tracking + slack;
  });

  // White slot and QR, unchanged.
  const slot = g.slotSize * size;
  const pad = g.slotPadding * slot;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(c - slot / 2, c - slot / 2, slot, slot);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, c - slot / 2 + pad, c - slot / 2 + pad, slot - 2 * pad, slot - 2 * pad);

  return canvas.toDataURL("image/png");
}
