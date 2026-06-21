import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Proxy the REST API to the long-running server in dev (avoids CORS hassle).
    proxy: {
      "/api": { target: process.env.VITE_API_TARGET ?? "http://localhost:8787", changeOrigin: true },
    },
  },
});
