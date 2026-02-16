import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5555,
    strictPort: true,
  },
  preview: {
    port: 5555,
    strictPort: true,
  },
});
