/**
 * Parse a "provider:modelId" string into its two halves.
 *
 * modelId may legitimately contain slashes (e.g. openrouter ids like
 * `amazon/nova-micro-v1`), so we split on the first colon only.
 *
 * Rejects:
 * - Missing colon
 * - Empty halves (including whitespace-only halves)
 * - Control characters (< 0x20) anywhere in either half
 */
export function parseModelString(model: string): { provider: string; modelId: string } {
  const idx = model.indexOf(':');
  if (idx <= 0 || idx === model.length - 1) {
    throw new Error(
      `Invalid model string ${JSON.stringify(model)}: expected "provider:modelId"`,
    );
  }
  const provider = model.slice(0, idx).trim();
  const modelId = model.slice(idx + 1).trim();
  if (provider === '' || modelId === '') {
    throw new Error(
      `Invalid model string ${JSON.stringify(model)}: provider and modelId must be non-empty`,
    );
  }
  if (hasControlChars(provider) || hasControlChars(modelId)) {
    throw new Error(
      `Invalid model string ${JSON.stringify(model)}: contains control characters`,
    );
  }
  return { provider, modelId };
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 0x20) return true;
  }
  return false;
}
