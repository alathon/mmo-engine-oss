import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "src/index.ts",
  outDir: "dist",
  target: "es2023",
  sourcemap: true,
  dts: true,
});
