# Jina and Mercury Provider Migration Runbook

Use this runbook for the Jina embeddings and Mercury answer-generation migration.
Historical design docs may still mention Mistral; runtime code and runtime config
must not.

## Required Environment

Set these Convex backend environment variables before deploying migrated code:

- `MINERU_API_TOKEN`: required. MinerU is the only extraction provider.
- `JINA_API_KEYS`: required comma-separated Jina key pool. Production target is 10 keys.
- `INCEPTION_API_KEYS`: required comma-separated Inception key pool for Mercury. Production target is 10 keys.

Optional safety-limit env vars should normally stay at project defaults:

- `JINA_EMBED_MODEL=jina-embeddings-v5-text-small`
- `JINA_RPM_PER_KEY=90`
- `JINA_TPM_PER_KEY=90000`
- `JINA_MAX_CONCURRENT_PER_KEY=2`
- `INCEPTION_BASE_URL=https://api.inceptionlabs.ai/v1`
- `INCEPTION_CHAT_MODEL=mercury-2`
- `INCEPTION_REASONING_EFFORT=medium`
- `INCEPTION_MAX_TOKENS=8192`
- `INCEPTION_TEMPERATURE=0.75`
- `INCEPTION_RPM_PER_KEY=90`
- `INCEPTION_INPUT_TPM_PER_KEY=90000`
- `INCEPTION_OUTPUT_TPM_PER_KEY=9000`
- `INCEPTION_MAX_CONCURRENT_PER_KEY=1`

Do not set `MISTRAL_*` variables. Mistral OCR fallback is removed.

## Provider Limits And Margins

- Jina target pool: 10 keys.
- Jina provider limit per key: 100 RPM, 100000 TPM, 2 concurrent requests.
- Jina project safety margin per key: 90 RPM, 90000 TPM, 2 concurrent requests.
- Mercury target pool: 10 keys.
- Mercury provider target per configured key slot: 100 RPM, 100000 input TPM, 10000 output TPM.
- Mercury project safety margin per key: 90 RPM, 90000 input TPM, 9000 output TPM, 1 concurrent request.

The lower project limits reserve headroom for retry jitter, clock skew, and manual
operator activity against the same provider accounts.

Before assuming 10x aggregate Mercury throughput, confirm the target Inception
account enforces limits per key rather than only at account or organization level.
If the provider applies account-level caps, lower the per-key project limits so
the total reserved capacity stays below the account limit.

## Database Reset Prerequisite

Reset the target database before deploying this migration. This is destructive.
Do not reset production or shared staging until the operator has confirmed the
target deployment, captured a database backup or export, recorded the current env
vars in the secret manager, and received approval for the reset window.

The migration does not support mixed Mistral and Jina vector spaces, and new
embedding rows require Jina metadata fields. Preserve external source information
and any operational data needed to re-ingest or restore the previous deployment.

## Deployment Order

1. Confirm the target deployment, backup/export, restore point, and reset approval.
2. Reset the target database only after the approval gate is complete.
3. Set `MINERU_API_TOKEN`, `JINA_API_KEYS`, and `INCEPTION_API_KEYS` in the target Convex deployment.
4. Keep provider key order stable before first traffic reaches the deployment.
5. Deploy the migrated code.
6. Confirm runtime code/config has no Mistral references.
7. Re-ingest required manuals through MinerU.
8. Seed evaluation cases after re-ingestion.
9. Run ingestion, search, and evaluation smoke checks.

## Runtime States

`embedding_waiting_rate_limit` means parsed pages and chunks were staged, but a
Jina embedding batch is waiting for provider capacity. Jina `429` during
embedding is not document failure. The batch should retry automatically after the
cooldown and the document should remain recoverable.

Mercury answer generation is synchronous for user search. Mercury all-key
cooldown should surface a temporary capacity error, not fabricate an answer and
not require a runtime provider toggle.

Required review assertions:

- Mistral OCR fallback is removed.
- MinerU is the only extraction provider.
- Jina `429` during embedding is not document failure.
- Mercury all-key cooldown should surface a temporary capacity error.

## Key Cooldown Checks

Use the Convex `providerApiKeyStates` table to inspect provider key state without
exposing secrets:

- Filter `provider` by `jina` or `inception`.
- Read only stable `keyId` values such as `jina:1` or `inception:4`.
- Check `cooldownUntil`, `lastRateLimitedAt`, `disabledAt`, and `disabledReason`.
- Never paste, log, screenshot, or query raw `JINA_API_KEYS` or `INCEPTION_API_KEYS` values.

The persisted `keyId` maps to the key slot position in the comma-separated env
var. For example, `jina:3` is the third entry in `JINA_API_KEYS`.

## Key Rotation

Preserve key order. Runtime state is keyed by slot id, not by raw secret.

- To replace `jina:2`, replace only the second value in `JINA_API_KEYS`.
- To replace `inception:5`, replace only the fifth value in `INCEPTION_API_KEYS`.
- Do not sort keys, move healthy keys forward, or delete a middle slot.
- For routine capacity rotation, if a slot has no replacement, leave the old key until the database can be reset or an operator explicitly accepts slot renumbering.
- For compromised, suspected-leaked, or revoked keys, revoke the provider key immediately and disable that slot in `providerApiKeyStates` until a same-position replacement is configured.

After changing provider env vars, allow the deployment to pick up the new env and
then run the internal/admin equivalent of `providerRateLimits.resetProviderKeyState`
for the replaced slot if it was previously blocked. If no admin wrapper is
available, clear only `cooldownUntil`, `disabledAt`, `disabledReason`, and
`lastRateLimitedAt` for the specific `provider` and `keyId`.

## Quota Exhaustion Recovery

When a key is marked quota-exhausted, only that slot should be disabled. If all
slots for a provider are disabled or exhausted, add capacity before retrying.

1. Top up the provider account for the exhausted key or replace the secret in the same slot.
2. Confirm the env var still has the same comma-separated order.
3. Run the internal/admin equivalent of `providerRateLimits.resetProviderKeyState` for that `provider` and `keyId`.
4. Wait for the current one-minute provider window to pass if RPM or TPM was also saturated.
5. For ingestion, confirm pending or rate-limited `embeddingBatches` resume and the job reaches `ready`.
6. For search, retry the same question and confirm Mercury returns an answer or a normal grounded refusal.

## Manual Ingestion Smoke Test

1. Sign in to the admin UI.
2. Queue the GuardLogix sample manual from an official vendor URL.
3. Confirm the job uses MinerU only and transitions through provider processing states.
4. Confirm no Mistral OCR fallback is invoked or configured.
5. If `embedding_waiting_rate_limit` appears, confirm the document is not marked failed and the batch retries.
6. Confirm the document reaches `ready` and current chunks have Jina embedding metadata.

## Search Smoke Test

After the smoke manual is ready, ask:

- `Where should the 1756-L7SP safety partner be installed relative to the primary controller?`
- `What does a solid red OK LED on the 1756-L7SP mean?`
- `What is the torque value for terminal block X99 in this manual?`

Expected results:

- Supported questions return grounded answers with citations.
- The unsupported question returns a refusal instead of guessing.
- If all Mercury keys are cooling down, the user sees a temporary capacity error.

## Runtime Mistral Absence Check

Expected runtime state:

- No `MISTRAL_*` env vars are required or used.
- No `@mistralai/mistralai` dependency is present.
- No runtime imports of `./lib/mistral` are present.
- MinerU is the only extraction provider.
- Mistral OCR fallback is removed.

Use a focused search against runtime/config files only. Historical docs are allowed
to mention the migration history.

## Rollback

Rollback is code-level only: there is no runtime provider toggle to switch back to
Mistral.

Use this sequence:

1. Stop or pause ingestion and search traffic.
2. Revert the migration code and redeploy the previous application version.
3. Restore the matching pre-migration environment variables from the secret manager.
4. Restore the pre-reset database snapshot if the old deployment needs existing data.
5. If no snapshot is restored, reset again and re-ingest data that matches the reverted code path.
6. Discard or archive data ingested after the Jina/Mercury migration unless an operator has validated that it is safe for the reverted code.

## Seeded Evaluation

After re-ingestion, seed the default evaluation cases using the admin evaluation
flow or `evaluations.seedDefaults` with a valid admin session token. Run every
seeded question against the re-ingested corpus and verify:

- Expected answerable cases return citations for the expected document and pages.
- Expected refusal cases refuse without invented evidence.
- Results are recorded only after the Jina re-ingestion is complete.

Do not paste admin session tokens into tickets, logs, screenshots, chat tools, or
shell history.
