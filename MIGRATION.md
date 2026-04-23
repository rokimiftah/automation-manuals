# Migration Guide: Public Workspace with Admin-Only Auth

This project no longer uses Convex Auth for the runtime product flow. The current target architecture is:

- `/` is the public engineer workspace
- `/admin` is protected by a minimal server-enforced admin session
- public chat and retrieval flows no longer pretend that visitors are authenticated users

## Final Runtime Surface

### Public route

- `src/pages/index.astro` renders the engineer workspace directly
- no login, role gate, allowlist, or `/auth` route is required for asking grounded questions

### Admin route

- `src/pages/admin/index.astro` renders the admin console behind `AdminSessionGate`
- login uses username + password
- successful login returns an opaque session token
- the raw token is stored only in `sessionStorage`
- Convex stores only the token hash and metadata

## Backend Auth Surface

The runtime admin auth API is intentionally narrow:

- `adminAuth.signIn` - public action used by the `/admin` login form
- `adminAuth.validateSession` - public query used to validate the locally stored admin token
- `adminAuth.signOut` - public mutation used to revoke the current admin session

Every protected admin read or write function requires a `sessionToken` argument and verifies it on the server before doing work.

Protected functions currently include:

- `documents.listAdmin`
- `documents.create`
- `ingestion.listJobs`
- `ingestion.enqueue`
- `ingestion.retry`
- `evaluations.seedDefaults`

Public functions remain public:

- `search.ask`
- `assets.resolveViewerAsset`
- public chat queries used by the engineer workspace

## Schema Changes

### Removed auth-era assumptions

- the Convex Auth tables are gone
- public chat records no longer store fake user ownership
- admin-owned records store explicit admin metadata instead

### Current admin session tables

```ts
adminSessions: defineTable({
  createdAt: v.number(),
  expiresAt: v.number(),
  revokedAt: v.optional(v.number()),
  tokenHash: v.string(),
  username: v.string()
}).index("by_token_hash", ["tokenHash"])

adminLoginAttempts: defineTable({
  createdAt: v.number(),
  successful: v.boolean(),
  username: v.string()
}).index("by_username_and_created_at", ["username", "createdAt"])
```

### Public chat shape

```ts
chatSessions: defineTable({
  title: v.string(),
  createdAt: v.number(),
  updatedAt: v.number()
})

chatMessages: defineTable({
  sessionId: v.id("chatSessions"),
  role: messageRoleValidator,
  content: v.string(),
  answerabilityStatus: v.optional(answerabilityStatusValidator),
  createdAt: v.number()
})
```

## Environment Variables

### Removed auth-era variables

- `AUTH_RESEND_KEY`
- `AUTH_EMAIL_FROM`
- `ADMIN_EMAILS`
- `ALLOWED_EMAILS`
- `ALLOWED_EMAIL_DOMAINS`

### Current admin auth variables

| Variable | Purpose |
| --- | --- |
| `ADMIN_USERNAME` | Admin username for `/admin` access |
| `ADMIN_PASSWORD_HASH` | Encoded Argon2id hash used for password verification |
| `ADMIN_SESSION_TTL_MS` | Session lifetime in milliseconds |

The public client only requires `CONVEX_URL`. Optional MinerU callback settings stay server-side.

## Password Hash Setup

Generate the admin password hash with:

```bash
node scripts/hash-admin-password.mjs "your-strong-password"
```

This prints the encoded Argon2id hash string to store in `ADMIN_PASSWORD_HASH`.

## Operational Verification

After configuration, verify the following:

1. Visit `/` and confirm the engineer workspace loads without any auth gate.
2. Visit `/admin` and confirm the login form is shown.
3. Sign in with the configured admin credentials.
4. Confirm document registration and ingestion actions work only with a valid admin session.
5. Confirm expired or revoked admin sessions are rejected and the UI returns to the login form.

## Notes on Legacy Files

The target architecture no longer depends on Convex Auth, role gates, or public-user viewer models. If any legacy auth-era helper files are still present in the repository, treat them as cleanup candidates rather than part of the intended runtime design.
