import { defineConfig } from "tsdown";

//export default defineConfig({
//  entry: ["src/**/*.ts", "!src/**/*.test.ts"],
//  format: ["esm"],
//  outExtensions: () => ({
//    js: ".js",
//  }),
//});
export default defineConfig({
  entry: "src/index.ts",
  outDir: "dist",
  target: "es2023",
  sourcemap: true,
  dts: true,
  platform: "node",
});
