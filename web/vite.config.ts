import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Локально API отдаёт `npm run dev:server` (порт 3000).
    proxy: { "/api": "http://localhost:3000" },
  },
});
