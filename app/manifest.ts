import type { MetadataRoute } from "next";

/**
 * Web manifest: installable bookmark metadata. The icons are the alpha-
 * recovered GEBO mark (app/icon.png conventions already serve the favicon
 * set); theme colors are the product's ink canvas and gold accent.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GEBO — verification-first agent registry for BNB Smart Chain",
    short_name: "GEBO",
    description:
      "Is this agent alive, what can it do to my wallet, and did hiring it beat doing the job myself. Measured, not asserted.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0c0f",
    theme_color: "#0a0c0f",
    icons: [
      { src: "/icon.png", sizes: "256x256", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
