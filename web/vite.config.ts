import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Метка сборки: попадает в код приложения и в /version.json, по ней приложение
// замечает, что на сервере новая версия, и перезагружается.
const BUILD_ID = Date.now().toString(36);

function versionFile(): Plugin {
  return {
    name: "version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    // Локально API отдаёт `npm run dev:server` (порт 3000).
    proxy: { "/api": "http://localhost:3000" },
  },
});
