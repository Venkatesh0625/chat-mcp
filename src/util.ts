/** URL-safe random token from Bun's Web Crypto. */
export const randomToken = (bytes: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url')

export const sha256 = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('base64url')
