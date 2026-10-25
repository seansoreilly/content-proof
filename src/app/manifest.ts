import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ContentProof",
    short_name: "ContentProof",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F7F4",
    theme_color: "#5B3FA3",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
