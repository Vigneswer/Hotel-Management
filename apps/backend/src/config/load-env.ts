import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";

/** Backend commands run from apps/backend; keep the workspace-root .env location consistent. */
export function loadWorkspaceEnv(): void {
  loadDotenv({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });
}
loadWorkspaceEnv();
