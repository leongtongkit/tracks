import type { Project } from '../daw/project'
export let pendingSong: Project | null = null
export function setPendingSong(song: Project): void { pendingSong = song }
