import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

let plugins = [react()];
let build = {
  sourcemap: false,
};

if (process.env.NODE_ENV !== "production") {
  // Add visualizer plugin
  const visualizer = await import("rollup-plugin-visualizer").then((m) =>
    // @ts-ignore
    m.default.visualizer({
      filename: "dist/stats.html",
      template: "treemap",
      gzipSize: true,
      brotliSize: true,
    }),
  );

  plugins.push(visualizer);

  // Build sourcemap
  build = {
    sourcemap: true,
  };
}

const cors = {
  origin:
    /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\]|[^:\. ]+\.onrender\.com)(?::\d+)?$/,
};

const allowedHosts = ["localhost", ".onrender.com"];

const config = {
  build,
  plugins,
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    cors,
    allowedHosts,
  },
  preview: {
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    host: true,
    cors,
    allowedHosts,
  },
};

export default defineConfig(config);
