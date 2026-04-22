export type AppRole = "admin" | "engineer"

export type AccessConfig = {
  adminEmails: string[]
  allowedDomains: string[]
  allowedEmails: string[]
}

type ViewerAccess = {
  canManageDocuments: boolean
  isAllowed: boolean
  role: AppRole
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function splitCsv(value?: string) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

export function readAccessConfig(): AccessConfig {
  return {
    adminEmails: splitCsv(process.env.ADMIN_EMAILS),
    allowedDomains: splitCsv(process.env.ALLOWED_EMAIL_DOMAINS),
    allowedEmails: splitCsv(process.env.ALLOWED_EMAILS)
  }
}

export function canManageDocuments(role: AppRole) {
  return role === "admin"
}

export function computeViewerAccess(email: string, config = readAccessConfig()): ViewerAccess {
  const normalizedEmail = normalizeEmail(email)
  const domain = normalizedEmail.split("@")[1] ?? ""
  const role: AppRole = config.adminEmails.includes(normalizedEmail) ? "admin" : "engineer"
  const allowAll = config.allowedEmails.length === 0 && config.allowedDomains.length === 0
  const isAllowed =
    allowAll ||
    config.adminEmails.includes(normalizedEmail) ||
    config.allowedEmails.includes(normalizedEmail) ||
    config.allowedDomains.includes(domain)

  return {
    canManageDocuments: canManageDocuments(role) && isAllowed,
    isAllowed,
    role
  }
}
