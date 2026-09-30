import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-diff",
              test: /node_modules[\\/](@git-diff-view|highlight\.js|lowlight)[\\/]/,
              priority: 40,
              maxSize: 350_000,
            },
            {
              name: "vendor-codemirror",
              test: /node_modules[\\/](@codemirror[\\/](state|view|language|commands|merge|search|autocomplete|lint)|@lezer[\\/](common|highlight|lr)|codemirror|crelt|style-mod|w3c-keyname|@marijn)[\\/]/,
              priority: 30,
              maxSize: 350_000,
            },
            { name: "vendor-dnd", test: /node_modules[\\/]@dnd-kit[\\/]/, priority: 20 },
            { name: "vendor-query", test: /node_modules[\\/]@tanstack[\\/]/, priority: 20 },
            {
              name: "vendor-radix",
              test: /node_modules[\\/](@radix-ui|radix-ui|cmdk|@floating-ui|react-remove-scroll|aria-hidden)[\\/]/,
              priority: 20,
            },
            {
              name: "vendor-react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
