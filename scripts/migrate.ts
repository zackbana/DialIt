import "dotenv/config";
import { openDatabase, migrate } from "../src/lib/database";
const db = openDatabase();
try { migrate(db); console.log("SQLite migrations applied"); }
finally { db.close(); }
