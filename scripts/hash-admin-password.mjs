import argon2 from "argon2"

const password = process.argv[2]?.trim()

if (!password) {
  console.error('Usage: node scripts/hash-admin-password.mjs "your-strong-password"')
  process.exit(1)
}

const hash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
})

console.log(hash)