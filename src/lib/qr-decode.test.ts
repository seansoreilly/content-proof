import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { decodeQrImageData, type RgbaImage } from "@/lib/qr-decode";

/** Rasterise a QR module matrix into RGBA pixels the way a canvas would. */
function rasterise(text: string, scale = 4, quiet = 4): RgbaImage {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const side = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (x + quiet) * scale + dx;
          const py = (y + quiet) * scale + dy;
          const o = (py * side + px) * 4;
          data[o] = 0;
          data[o + 1] = 0;
          data[o + 2] = 0;
        }
      }
    }
  }
  return { data, width: side, height: side };
}

describe("QR image decoding", () => {
  it("recovers a verification link from a rendered QR code", () => {
    const link =
      "https://contentproof.app/verify#P=2~AbCdEfGhIjKlMnOp~" +
      "ynaStIpiV1kaNshAtSXa9WoVevwJH_X1cX9LO2bkMtA~someone%40example.com~1792808090322~" +
      "vS0UFPUwHc1CiDtNQ_bCqdhrtktHaRS6miowhIyJbsDB-RuIyGYGKS4iHjskA99I4VZrCEyV7bHaFZzpADpQDw";
    expect(decodeQrImageData(rasterise(link))).toBe(link);
  });

  it("returns null for an image with no QR code", () => {
    const blank: RgbaImage = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 };
    expect(decodeQrImageData(blank)).toBeNull();
  });
});
