import sodium from "libsodium-wrappers";

// Espera libsodium inicializar antes do primeiro uso.
const ready = sodium.ready;

function masterKey(): Uint8Array {
  const hex = process.env.SMA_SECRETS_MASTER_KEY;
  if (!hex) {
    throw new Error(
      "SMA_SECRETS_MASTER_KEY não configurada. Gere com `bun run gen-master-key` e cole em sma/.env",
    );
  }
  const key = sodium.from_hex(hex);
  if (key.length !== sodium.crypto_secretbox_KEYBYTES) {
    throw new Error(
      `SMA_SECRETS_MASTER_KEY tem ${key.length} bytes — esperado ${sodium.crypto_secretbox_KEYBYTES} (gere uma nova com gen-master-key)`,
    );
  }
  return key;
}

/**
 * Encripta um segredo (e.g. Anthropic API key) com libsodium secretbox.
 * Retorna `nonce_hex:ciphertext_hex`.
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  await ready;
  const key = masterKey();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  return `${sodium.to_hex(nonce)}:${sodium.to_hex(ciphertext)}`;
}

/**
 * Decripta um segredo encriptado com `encryptSecret`.
 * Throw se o formato ou o MAC falharem.
 */
export async function decryptSecret(encrypted: string): Promise<string> {
  await ready;
  const [nonceHex, ciphertextHex] = encrypted.split(":");
  if (!nonceHex || !ciphertextHex) {
    throw new Error("Formato de segredo inválido (esperado nonce:ciphertext)");
  }
  const key = masterKey();
  const nonce = sodium.from_hex(nonceHex);
  const ciphertext = sodium.from_hex(ciphertextHex);
  const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  return sodium.to_string(plaintext);
}
