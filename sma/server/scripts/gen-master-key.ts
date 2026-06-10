import { randomBytes } from "node:crypto";

// libsodium secretbox usa chave de 32 bytes. Geramos hex (64 chars).
const key = randomBytes(32).toString("hex");

console.log(key);
console.log(`\n(${key.length} chars hex = 32 bytes — cole em sma/.env como:`);
console.log(`SMA_SECRETS_MASTER_KEY=${key})`);
