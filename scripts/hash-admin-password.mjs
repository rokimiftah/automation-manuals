import { argon2id } from "hash-wasm"

const password = process.argv[2]?.trim()

if (!password) {
  console.error('Usage: node scripts/hash-admin-password.mjs "your-strong-password"')
  process.exit(1)
}

const hash = await argon2id({
  password: new TextEncoder().encode(password),
  salt: new Uint8Array(16),
  iterations: 2,
  memorySize: 19_456,
  parallelism: 1,
  hashLength: 32,
  outputType: "encoded"
})

console.log(hash)
