import { env } from "../../config";
import { effectiveSecret } from "../../secure-store";
import type { AIProvider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { MockAIProvider } from "./mock";

export function anthropicKey(): string {
  return effectiveSecret("anthropic_api_key", env.anthropicApiKey());
}

/** Mock in MOCK_MODE or when no key is configured — the app always boots (§4.7). */
export function getAIProvider(): AIProvider {
  if (env.mockMode) return new MockAIProvider();
  const key = anthropicKey();
  return key ? new AnthropicProvider(key) : new MockAIProvider();
}

export function aiAvailable(): boolean {
  return env.mockMode || !!anthropicKey();
}

/** Real per-call rate used for estimates even in mock mode, so the cost model is honest. */
export const AI_OWNER_COST_USD = 0.001;
