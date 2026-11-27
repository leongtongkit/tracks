import { describe, expect, it } from 'vitest'
// @ts-expect-error Node is available to Vitest, but not in the browser type configuration.
import { readFileSync } from 'node:fs'
import { parseAbc, abcToProject, exportAbc } from './abc'

const fixture = (name: string): string => readFileSync(`e2e/yue2/${name}.abc`, 'utf8')
const clean = (s: string): string => s.split('\n').filter(l => !l.startsWith('% ')).join('\n')
describe('ABC bridge', () => {
  it.each(['melody', 'score', 'score-jazz'])('imports %s', name => {
    const parsed = parseAbc(fixture(name)); expect(parsed.error).toBeUndefined()
    expect(parsed.voices.find(v => v.name === 'Vocal Melody')?.notes).toHaveLength(56)
    expect(parsed.bpm).toBe(88); expect(parsed.timeSig).toEqual({ num: 4, den: 4 }); expect(parsed.key).toEqual({ root: 0, scale: 'major' })
    expect(parsed.chords).toHaveLength(name === 'melody' ? 0 : 8)
  })
  it.each(['melody','score'])('round trips %s fixture exactly', name => {
    const parsed = parseAbc(fixture(name)); const project = abcToProject(parsed, name)
    const result = exportAbc(project, project.tracks[0].id, project.tracks.find(t => t.name === 'Chords')?.id)
    expect(result.error).toBeUndefined(); expect(result.text).toBe(clean(fixture(name)))
  })
  it('carries accidentals across octaves and ties', () => {
    const p = parseAbc('X:1\nL:1/8\nK:C\n^F2f2|^F8-|F8|')
    expect(p.voices[0].notes.map(n => n.pitch)).toEqual([66,78,66]); expect(p.voices[0].notes[2].dur).toBe(8)
  })
  it('splits 40 bars into clips', () => {
    const parsed = parseAbc('X:1\nL:1/4\nK:C\n' + 'C4|'.repeat(40)); const project = abcToProject(parsed,'long.abc')
    expect(project.tracks[0].clips.map(c=>c.length)).toEqual([64,64,32])
  })
  it('handles junk without throwing', () => { for (const s of ['', 'X:1', '\0\x01', 'x'.repeat(2_000_000)]) expect(parseAbc(s).error).toBeTruthy() })
})

describe('ABC timing and limits', () => {
  it('reads the fixture notes and chord voicings', () => {
    const p = parseAbc(fixture('score')); const notes = p.voices[0].notes
    expect(notes.slice(0, 7).map(n=>[n.pitch,n.start,n.dur])).toEqual([[64,0,.5],[67,.5,.5],[69,1,.5],[67,1.5,.5],[64,2,.5],[62,2.5,.5],[60,3,1]])
    expect([notes[55].pitch,notes[55].start,notes[55].dur]).toEqual([60,31,1])
    expect(p.chords.map(c=>[c.symbol,c.beat,c.dur])).toEqual(['C','G','Am','F','C','F','G','C'].map((s,i)=>[s,i*4,4]))
    expect(p.chords[0].pitches).toEqual([48,52,55]); expect(parseAbc(fixture('score-jazz')).chords[0].pitches).toEqual([48,52,55,59]); expect(p.lyrics).toBe(false)
  })
  it.each([[4,4,0,'major'],[3,4,2,'major'],[6,8,10,'major'],[7,8,6,'minor'],[4,4,3,'minor']] as const)('round trips meter %s/%s and key %s %s', (num,den,root,scale) => {
    const p = abcToProject(parseAbc(fixture('melody')), 'x'); p.timeSig={num,den}; p.key={root,scale}; p.bpm=101
    const t=p.tracks[0];t.clips=[{...t.clips[0],length:32,notes:[{pitch:61,start:0,dur:5,vel:.8},{pitch:72,start:5.125,dur:1.375,vel:.8},{pitch:66,start:8,dur:7.0625,vel:.8}]}]
    const exported=exportAbc(p,t.id); expect(exported.error).toBeUndefined();const parsed=parseAbc(exported.text)
    expect(parsed.voices[0].notes).toEqual(t.clips[0].notes);expect(parsed.bpm).toBe(101);expect(parsed.timeSig).toEqual({num,den});expect(parsed.key).toEqual({root,scale})
  })
  it('handles ordinary ABC and reports omissions', () => {
    const p=parseAbc('X:1\nM:4/4\nK:D dorian\nA/2 (3abc a>b [CEG] {g}A |: A :| !trill!A\nw: words')
    expect(p.error).toBeUndefined();expect(p.key).toEqual({root:2,scale:'chromatic'});expect(p.lyrics).toBe(true)
    expect(p.skipped).toEqual(expect.arrayContaining(['dorian key mode','grace notes','repeat signs (played once)','decorations']))
  })
  it('keeps top notes and warns on arpeggios and tempo changes', () => {
    const p=abcToProject(parseAbc(fixture('score')),'score');const melody=p.tracks[0], chords=p.tracks[1]
    melody.clips[0].notes.push({...melody.clips[0].notes[0],pitch:80});chords.clips[0].notes=[{pitch:60,start:0,dur:1,vel:.6},{pitch:64,start:1,dur:1,vel:.6}];p.tempoMap=[{beat:4,bpm:90}]
    const e=exportAbc(p,melody.id,chords.id);expect(e.notes_dropped).toBe(true);expect(e.chords).toBe(0)
    expect(e.messages).toEqual(expect.arrayContaining(['More than one note played at once in places, so only the top note was kept.',"Chords were left out: that track isn't simple block chords.",'Tempo changes were left out.']))
    melody.clips=[];expect(exportAbc(p,melody.id).error).toBe('That track has no notes to export.')
  })
  it('cuts scores over 20,000 notes and names the cut', () => {
    const p=parseAbc('X:1\nL:1/4\nK:C\n'+'C|'.repeat(20001));expect(p.voices[0].notes).toHaveLength(20000);expect(p.skipped).toContain('the end of the score (cut at bar 20001)')
  })
})
