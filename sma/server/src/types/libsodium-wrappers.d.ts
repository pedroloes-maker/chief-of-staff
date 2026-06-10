// Shim mínimo: o pacote `libsodium-wrappers` tem `types` no package.json
// mas não no campo `exports`, então TS com moduleResolution=bundler não
// encontra. Esse shim resolve sem dependência externa.
//
// Tipagem é `any` — perdemos autocomplete mas os nomes da API libsodium
// são estáveis (crypto_secretbox_easy, from_hex, to_hex, ready, etc.).
declare module "libsodium-wrappers";
