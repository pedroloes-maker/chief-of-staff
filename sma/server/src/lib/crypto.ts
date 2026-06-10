// Encriptação at-rest pra segredos (Anthropic API keys, etc.).
// Usa Web Crypto subtle (built-in no Bun) com AES-256-GCM — equivalente
// funcional ao libsodium secretbox (authenticated encryption). Sem deps
// externas, evita o bug de packaging do libsodium-wrappers ESM.
//
// Master key vem de SMA_SECRETS_MASTER_KEY (32 bytes = 64 chars hex).
// Gere com `bun run gen-master-key`.

const subtle = crypto.subtle;

let cachedKey: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = (async () => {
    const hex = process.env.SMA_SECRETS_MASTER_KEY;
    if (!hex) {
      throw new Error(
        "SMA_SECRETS_MASTER_KEY não configurada. Gere com `bun run gen-master-key` e cole em sma/.env",
      );
    }
    if (hex.length !== 64) {
      throw new Error(
        `SMA_SECRETS_MASTER_KEY tem ${hex.length} chars — esperado 64 (32 bytes hex)`,
      );
    }
    const raw = hexToBytes(hex);
    return await subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  })();
  return cachedKey;
}

/**
 * Encripta um segredo com AES-256-GCM.
 * Retorna `iv_hex:ciphertext_hex` (ciphertext inclui o tag de autenticação no final).
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV pro GCM
  const cipher = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(cipher))}`;
}

/**
 * Decripta um segredo encriptado com `encryptSecret`. Falha se o MAC não bate.
 */
export async function decryptSecret(encrypted: string): Promise<string> {
  const [ivHex, cipherHex] = encrypted.split(":");
  if (!ivHex || !cipherHex) {
    throw new Error("Formato de segredo inválido (esperado iv:ciphertext)");
  }
  const key = await getKey();
  const iv = hexToBytes(ivHex);
  const cipher = hexToBytes(cipherHex);
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipher,
  );
  return new TextDecoder().decode(plain);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Retorna Uint8Array com ArrayBuffer (não ArrayBufferLike) — exigido
// pelas APIs subtle.* em TS 5.7+.
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) {
    throw new Error(`Hex inválido: ${hex.length} chars (não-par)`);
  }
  const buffer = new ArrayBuffer(hex.length / 2);
  const arr = new Uint8Array(buffer);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return arr;
}
