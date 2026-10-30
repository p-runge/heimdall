import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Heimdall — All-Seeing Site Watch",
    short_name: "Heimdall",
    description:
      "Uptime, deploy drift, SEO rank and compliance monitoring for every website you maintain.",
    start_url: "/",
    display: "standalone",
    background_color: "#05070d",
    theme_color: "#05070d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
