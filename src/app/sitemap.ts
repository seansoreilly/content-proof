import type { MetadataRoute } from "next";

const ORIGIN = "https://www.contentproof.app";
const PATHS = ["/", "/verify", "/how-it-works", "/privacy"];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PATHS.map((path) => ({ url: `${ORIGIN}${path === "/" ? "" : path}`, lastModified }));
}
