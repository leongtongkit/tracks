// Opening and saving .abc files byte for byte: what YuE2 wrote is what comes
// back out. A byte-order mark is kept (YuE2 itself would reject it, and the
// checker says so) rather than quietly dropped.
export function fromFile(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
}

export function toFile(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}
