import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@/lib": path.resolve(__dirname, "./src/lib"), "@": path.resolve(__dirname, "./src") } },
  server: { proxy: { "/api": "http://localhost:3100" } },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
});
