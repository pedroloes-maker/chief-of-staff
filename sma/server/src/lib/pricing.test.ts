import { describe, expect, test } from "bun:test";
import {
  defaultRatesForModel,
  estimateUsd,
  type Rates,
  type TokenUsage,
} from "./pricing";

const OPUS: Rates = {
  inputPerMtok: 15,
  outputPerMtok: 75,
  cacheReadPerMtok: 1.5,
  cacheWritePerMtok: 18.75,
};

describe("estimateUsd", () => {
  test("soma input + output por 1M tokens", () => {
    const usage: TokenUsage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
    // 15 + 75
    expect(estimateUsd(OPUS, usage)).toBe(90);
  });

  test("cobra cache read e cache write separados do input", () => {
    const usage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 2_000_000,
      cacheCreationInputTokens: 1_000_000,
    };
    // 2 * 1.5 + 1 * 18.75
    expect(estimateUsd(OPUS, usage)).toBe(21.75);
  });

  test("usage zerado custa zero", () => {
    expect(
      estimateUsd(OPUS, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      }),
    ).toBe(0);
  });

  test("arredonda pra 6 casas decimais", () => {
    const usage: TokenUsage = {
      inputTokens: 1,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
    // 15 / 1e6 = 0.000015
    expect(estimateUsd(OPUS, usage)).toBe(0.000015);
  });
});

describe("defaultRatesForModel", () => {
  test("casa modelo versionado por prefixo", () => {
    expect(defaultRatesForModel("claude-opus-4-7")).toEqual(OPUS);
  });

  test("modelo desconhecido devolve zeros", () => {
    expect(defaultRatesForModel("modelo-inexistente")).toEqual({
      inputPerMtok: 0,
      outputPerMtok: 0,
      cacheReadPerMtok: 0,
      cacheWritePerMtok: 0,
    });
  });
});
