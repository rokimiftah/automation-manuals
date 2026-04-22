async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function verifyMineruChecksum(args: { checksum: string; content: string; seed: string; uid: string }) {
  const expected = await sha256Hex(`${args.uid}${args.seed}${args.content}`)
  return expected === args.checksum
}
