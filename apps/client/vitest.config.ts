import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          // an example of file based convention,
          // you don't have to follow it
          include: ["**/*.test.ts"],
          exclude: ["**/*.browser.test.ts"],
          name: "unit",
          environment: "node",
        },
      },
      {
        test: {
          // an example of file based convention,
          // you don't have to follow it
          include: ["**/*.browser.test.ts"],
          name: "browser",
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
