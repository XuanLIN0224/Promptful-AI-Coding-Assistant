import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "webview"),
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "media"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "webview/index.html"),
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
    sourcemap: true,
  },
});
