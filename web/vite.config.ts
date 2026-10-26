import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Локально API отдаёт `wrangler dev` (порт 8787).
    proxy: { "/api": "http://localhost:8787" },
  },
});
