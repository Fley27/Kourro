import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:4200",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist" },
});
