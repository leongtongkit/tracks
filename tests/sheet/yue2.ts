// YuE2's own score checker (e2e/yue2/abc_tools.py, copied from the YuE repository),
// for the sheet tests to hold Tracks' scores to.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VoiceName } from '../../src/sheet/yue-abc'

export const root = (p: string): string => fileURLToPath(new URL('../../' + p, import.meta.url))

export interface Verdict { ok: boolean; error?: string; notes?: Record<VoiceName, string[]> }
/** run YuE2's own parse() on each text; notes as "onset:pitch:duration" in quarter notes */
export function yue2(texts: string[]): Verdict[] {
  const driver = `
import json, sys
sys.path.insert(0, sys.argv[1])
import abc_tools
out = []
for text in json.load(sys.stdin):
    try:
        score = abc_tools.parse(text)
        out.append({"ok": True, "notes": {n: [f"{t}:{p}:{d}" for t, p, d in v.notes] for n, v in score.voices.items()}})
    except abc_tools.AbcError as e:
        out.append({"ok": False, "error": str(e)})
print(json.dumps(out))
`
  const run = spawnSync('python3', ['-I', '-c', driver, root('e2e/yue2')], { input: JSON.stringify(texts), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(run.stderr)
  return JSON.parse(run.stdout) as Verdict[]
}

/** YuE2's command-line check, exactly as its guide runs it */
// a real file: on Linux, Node hands a child its input through a socket, which /dev/stdin can't open
const scratch = mkdtempSync(join(tmpdir(), 'yue2-'))
let files = 0
export function inspectCli(text: string): number {
  const file = join(scratch, `score-${++files}.abc`)
  writeFileSync(file, text)
  return spawnSync('python3', ['-I', root('e2e/yue2/abc_tools.py'), 'inspect', file], { encoding: 'utf8' }).status ?? -1
}
