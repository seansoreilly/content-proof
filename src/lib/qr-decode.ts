import jsQR from "jsqr";

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Decode the text of a QR code from RGBA pixels, or null if none is found. */
export function decodeQrImageData(image: RgbaImage): string | null {
  const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
  return result?.data ?? null;
}

/**
 * Browser-only: rasterise an image file to a canvas and decode any QR code in
 * it. Large photos are scaled down so decoding stays fast.
 */
export async function decodeQrFile(file: Blob, maxSide = 1600): Promise<string | null> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    throw new Error("QR image decoding is only available in the browser");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return decodeQrImageData(ctx.getImageData(0, 0, width, height));
  } finally {
    bitmap.close();
  }
}
