export type PublicAppEnvInput = {
  CONVEX_URL?: string
}

export type PublicAppEnv = {
  convexUrl: string
}

export function getPublicAppEnv({ CONVEX_URL }: PublicAppEnvInput): PublicAppEnv {
  const convexUrl = CONVEX_URL?.trim()
  if (!convexUrl) {
    throw new Error("CONVEX_URL is required")
  }

  return { convexUrl }
}
