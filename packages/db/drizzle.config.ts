import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "mysql://hkharp:change_me@127.0.0.1:3306/hkharp_pos",
  },
});
