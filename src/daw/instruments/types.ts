// Common surface every non-synth instrument presents to a track channel.
// (The synth Engine predates this and is adapted by TrackChannel directly.)

export interface Instrument {
  readonly output: AudioNode
  noteOn(pitch: number, vel: number, t: number): void
  noteOff(pitch: number, t: number): void
  allNotesOff(): void
  setBend(semitones: number): void
  dispose(): void
}
