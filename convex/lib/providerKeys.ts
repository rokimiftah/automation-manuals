export type ProviderName = "jina" | "inception"

export type ProviderKey = { id: string; secret: string }

const providerEnvNames: Record<ProviderName, string> = {
  inception: "INCEPTION_API_KEYS",
  jina: "JINA_API_KEYS"
}

export function buildProviderKeyPool(provider: ProviderName, rawKeys: string[]): ProviderKey[] {
  const keys = rawKeys.map((key) => key.trim()).filter(Boolean)

  if (keys.length === 0) {
    throw new Error(`${providerEnvNames[provider]} is required`)
  }

  return keys.map((secret, index) => ({
    id: `${provider}:${index + 1}`,
    secret
  }))
}

export function resolveProviderKey(pool: ProviderKey[], keyId: string) {
  const key = pool.find(({ id }) => id === keyId)
  if (!key) {
    throw new Error(`Provider key ${keyId} is not configured`)
  }

  return key.secret
}
