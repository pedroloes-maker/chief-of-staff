import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envDir = resolve(here, "../..");

// Carrega .env primeiro, depois .env.local sobrescreve (Vite convention).
// Falhas silenciosas se arquivos não existirem — dotenv não throw.
config({ path: resolve(envDir, ".env") });
config({ path: resolve(envDir, ".env.local"), override: true });
