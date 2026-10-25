import { describe, expect, it } from "vitest";
import { generateQrCodeDataUrl } from "@/lib/qr";

describe("QR code generation", () => {
  it("renders text as a PNG data URL", async () => {
    const url = await generateQrCodeDataUrl("https://contentproof.app/verify#P=test", { width: 64 });
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(url.length).toBeGreaterThan(100);
  });
});
