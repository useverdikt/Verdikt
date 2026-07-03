import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  if (mode === "production" && !String(process.env.VITE_API_BASE || "").trim()) {
    throw new Error(
      "VITE_API_BASE must be set for production builds (e.g. https://your-backend.up.railway.app)"
    );
  }

  return {
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{js,jsx}"],
    clearMocks: true
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
      "@useverdikt/shared": path.resolve(__dirname, "../shared")
    }
  },
  server: {
    port: 5174,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:8787", changeOrigin: true }
    }
  },
  // Same proxy as dev — `vite preview` does not inherit `server.proxy` without this.
  preview: {
    port: 4174,
    strictPort: false,
    host: "127.0.0.1",
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:8787", changeOrigin: true }
    }
  }
};
});
