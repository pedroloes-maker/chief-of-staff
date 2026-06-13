// Estimativa de custo de sessions Anthropic em USD.
//
// Fase 1: a Anthropic devolve usage cumulativo por session (sem webhook de
// billing local), então capturamos por polling e convertemos pra USD com a
// tabela `model_pricing` (editável). `estimateUsd` é pura — testável sem DB.

import { eq } from "drizzle-orm";
import { modelPricing } from "../db/schema";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

export type Rates = {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok: number;
  cacheWritePerMtok: number;
};

const ZERO_RATES: Rates = {
  inputPerMtok: 0,
  outputPerMtok: 0,
  cacheReadPerMtok: 0,
  cacheWritePerMtok: 0,
};

// USD por 1M tokens. Valores de referência das famílias Claude 4.x; ajustáveis
// na tabela model_pricing sem mexer no código.
export const DEFAULT_PRICING: Record<string, Rates> = {
  "claude-opus-4": {
    inputPerMtok: 15,
    outputPerMtok: 75,
    cacheReadPerMtok: 1.5,
    cacheWritePerMtok: 18.75,
  },
  "claude-sonnet-4": {
    inputPerMtok: 3,
    outputPerMtok: 15,
    cacheReadPerMtok: 0.3,
    cacheWritePerMtok: 3.75,
  },
  "claude-haiku-4": {
    inputPerMtok: 1,
    outputPerMtok: 5,
    cacheReadPerMtok: 0.1,
    cacheWritePerMtok: 1.25,
  },
};

/**
 * Custo em USD a partir do usage cumulativo e das taxas (por 1M tokens).
 * Função pura — sem I/O. Cache read e cache write (creation) são cobrados
 * separados do input normal.
 */
export function estimateUsd(rates: Rates, usage: TokenUsage): number {
  const usd =
    (usage.inputTokens * rates.inputPerMtok) / 1_000_000 +
    (usage.outputTokens * rates.outputPerMtok) / 1_000_000 +
    (usage.cacheReadInputTokens * rates.cacheReadPerMtok) / 1_000_000 +
    (usage.cacheCreationInputTokens * rates.cacheWritePerMtok) / 1_000_000;
  // 6 casas — alinha com a coluna numeric(12,6).
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * Acha as taxas default pra um modelo por prefixo (ex. "claude-opus-4-7"
 * casa com "claude-opus-4"). Retorna zeros se desconhecido.
 */
export function defaultRatesForModel(model: string): Rates {
  const key = Object.keys(DEFAULT_PRICING).find((k) => model.startsWith(k));
  return key ? DEFAULT_PRICING[key] : ZERO_RATES;
}

function rowToRates(row: typeof modelPricing.$inferSelect): Rates {
  return {
    inputPerMtok: Number(row.inputPerMtok),
    outputPerMtok: Number(row.outputPerMtok),
    cacheReadPerMtok: Number(row.cacheReadPerMtok),
    cacheWritePerMtok: Number(row.cacheWritePerMtok),
  };
}

/**
 * Taxas pra um modelo a partir da tabela editável. Se o modelo ainda não
 * existe, insere uma linha (com defaults conhecidos ou zeros) pra ficar
 * visível/editável e devolve essas taxas.
 */
export async function getRatesForModel(model: string): Promise<Rates> {
  // Import tardio: mantém as funções puras (estimateUsd etc.) livres do
  // db/client, que lança no import se DATABASE_URL não estiver setada — assim
  // o teste unitário não precisa de banco.
  const { db } = await import("../db/client");
  const [existing] = await db
    .select()
    .from(modelPricing)
    .where(eq(modelPricing.model, model));
  if (existing) return rowToRates(existing);

  const seeded = defaultRatesForModel(model);
  await db
    .insert(modelPricing)
    .values({
      model,
      inputPerMtok: String(seeded.inputPerMtok),
      outputPerMtok: String(seeded.outputPerMtok),
      cacheReadPerMtok: String(seeded.cacheReadPerMtok),
      cacheWritePerMtok: String(seeded.cacheWritePerMtok),
    })
    .onConflictDoNothing();
  return seeded;
}

/** Custo em USD pra um modelo + usage, lendo as taxas da tabela. */
export async function priceUsage(
  model: string,
  usage: TokenUsage,
): Promise<number> {
  const rates = await getRatesForModel(model);
  return estimateUsd(rates, usage);
}
