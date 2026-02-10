import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          environment: "node",
          setupFiles: ["test/test-setup.ts"],
        },
      },
    ],
  },
});
