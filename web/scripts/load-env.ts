// CLI scripts run outside Next.js, so load .env.local / .env the same way.
import { config } from "dotenv";
import path from "node:path";

const root = path.resolve(__dirname, "..");
config({ path: path.join(root, ".env.local"), quiet: true });
config({ path: path.join(root, ".env"), quiet: true });
