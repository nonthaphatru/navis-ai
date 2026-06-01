import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://nonthaphatru.github.io/navis-ai/ on GitHub Pages,
// so assets must be referenced under the /navis-ai/ base path.
export default defineConfig({
  plugins: [react()],
  base: "/navis-ai/",
});
