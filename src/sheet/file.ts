// Opening and saving .abc files byte for byte: what YuE2 wrote is what comes
// back out. A byte-order mark is kept (YuE2 itself would reject it, and the
// checker says so) rather than quietly dropped.
export function fromFile(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
}

export function toFile(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** a Standard MIDI File starts with MThd */
export const isMidi = (bytes: Uint8Array): boolean =>
  bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64
