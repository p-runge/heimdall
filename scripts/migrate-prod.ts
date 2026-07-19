import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// No top-level await: tsx transpiles this file to CJS (package.json has no
// "type": "module"), where top-level await is a hard esbuild error.
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await sql.end();
}

main().catch((err) => {
  console.error("prod migration failed:", err);
  process.exit(1);
});
