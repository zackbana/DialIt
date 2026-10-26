import { copyFileSync, existsSync, constants } from "node:fs";
if (!existsSync(".env")) copyFileSync(".env.example", ".env", constants.COPYFILE_EXCL);
