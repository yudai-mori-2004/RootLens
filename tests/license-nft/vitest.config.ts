import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,             // 既存 mocha 流の describe/it/before をそのまま使えるように
    include: ["**/*.spec.ts"],
    testTimeout: 60_000,       // devnet 実打 spec がある (block confirm 待ち)
    hookTimeout: 60_000,
    pool: "forks",             // chain state を共有する spec があるため、 並列実行を避ける
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
