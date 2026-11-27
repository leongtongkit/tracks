import { defaultProject, migrateProject, newId, newTrack, projectEndBeat, type KeySig, type Note, type Project } from './project'
import { collectEvents } from './transport'

export interface AbcImport { title: string; bpm?: number; timeSig?: { num: number; den: number }; key?: KeySig; voices: { name: string; notes: Note[] }[]; chords: { beat: number; dur: number; symbol: string; pitches: number[] }[]; skipped: string[]; lyrics: boolean; error?: string }
export interface AbcExport { text: string; notes: number; chords: number; notes_dropped: boolean; messages: string[]; error?: string }
const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const qualities: Record<string, number[]> = { '': [0,4,7], m:[0,3,7], dim:[0,3,6], aug:[0,4,8], '7':[0,4,7,10], maj7:[0,4,7,11], m7:[0,3,7,10], dim7:[0,3,6,9], m7b5:[0,3,6,10], sus4:[0,5,7], sus2:[0,2,7], '6':[0,4,7,9], m6:[0,3,7,9], '7sus4':[0,5,7,10], 'm(maj7)':[0,3,7,11] }
const majorKeys = ['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#']
const minorKeys = ['Abm','Ebm','Bbm','Fm','Cm','Gm','Dm','Am','Em','Bm','F#m','C#m','G#m','D#m','A#m']
const sharpNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
function pc(s: string): number { return (natural[s[0].toUpperCase()] + (s.includes('#') ? 1 : s.includes('b') ? -1 : 0) + 12) % 12 }
function keyInfo(s: string): { key: KeySig; acc: Record<string, number>; count: number; mode: string } {
  const m = /^\s*([A-Ga-g])([#b]?)(?:\s*(major|maj|minor|min|m|dorian|dor|phrygian|phr|lydian|lyd|mixolydian|mix|aeolian|aeo|ionian|ion|locrian|loc))?/i.exec(s)
  const root = m ? m[1].toUpperCase()+m[2] : 'C'; const mode = (m?.[3] ?? '').toLowerCase()
  const modeOffset: Record<string, number> = { dorian:2,dor:2,phrygian:4,phr:4,lydian:5,lyd:5,mixolydian:7,mix:7,aeolian:9,aeo:9,locrian:11,loc:11 }
  const minor = ['m','min','minor','aeolian','aeo'].includes(mode)
  const special = !!modeOffset[mode] && !['aeolian','aeo'].includes(mode)
  const key: KeySig = { root: pc(root), scale: special ? 'chromatic' : minor ? 'minor' : 'major' }
  let count = (minorKeys.indexOf(root+'m') - 7)
  if (!minor) count = majorKeys.indexOf(root)-7
  if (special) { const majorPc = (pc(root)-modeOffset[mode]+12)%12; const candidates = majorKeys.map((x,i)=>({x,i})).filter(x=>pc(x.x)===majorPc); count = (candidates.sort((a,b)=>Math.abs(a.i-7)-Math.abs(b.i-7))[0]?.i ?? 7)-7 }
  if (count < -7) count = 0
  const acc: Record<string, number> = {}; for (const c of 'CDEFGAB') acc[c]=0
  for (const c of (count > 0 ? 'FCGDAEB' : 'BEADGCF').slice(0,Math.abs(count))) acc[c]=count > 0 ? 1 : -1
  return { key, acc, count, mode: special ? mode : '' }
}
function chord(symbol: string, skipped: string[]): number[] | null {
  const m = /^([A-G](?:#|b)?)(.*?)(?:\/([A-G](?:#|b)?))?$/.exec(symbol); if (!m) return null
  let q=m[2]; const aliases: Record<string,string>={min:'m','-':'m',M7:'maj7',maj:'','°':'dim','ø':'m7b5','+':'aug',sus:'sus4'}; q=aliases[q] ?? q
  if (!qualities[q]) { q=/^(m(?!aj)|min|-)/.test(q)?'m':''; add(skipped,'unusual chord symbols (played as simple chords)') }
  const root=48+pc(m[1]); const result=qualities[q].map(n=>root+n)
  if(m[3]) { let b=48+pc(m[3]); while(b>=root)b-=12; result.unshift(b) }
  return result
}
function add(a: string[], s: string): void { if (!a.includes(s)) a.push(s) }
function duration(s: string): number { if(!s)return 1; const m=/^(\d+)?(\/*)(\d*)$/.exec(s); if(!m)return 1; return Number(m[1]||1)/(m[2] ? (m[3] ? Number(m[3]) : 2**m[2].length) : 1) }

type VoiceState = { name: string; notes: Note[]; beat: number; acc: Record<string,number>; key: ReturnType<typeof keyInfo>; pending?: { note: Note; written: number }; bar: number }
export function parseAbc(text: string): AbcImport {
  const out: AbcImport = { title:'', voices:[], chords:[], skipped:[], lyrics:false }
  try {
    if (text.length > 1024*1024 || new TextEncoder().encode(text).length > 1024*1024) { out.error='That file is too large.'; return out }
    let meter={num:4,den:4}, unit=0.5, explicitUnit=false, key=keyInfo('C'), started=false, tune=false, noteCount=0, cut=false
    const states = new Map<string,VoiceState>(); let id=''; let state: VoiceState | undefined
    const ensure=(): VoiceState => { if(!state){ id=id||'Melody'; state=states.get(id); if(!state){state={name:id,notes:[],beat:0,acc:{},key,bar:1};states.set(id,state)} } return state }
    const lines=text.replace(/\\\s*\n/g,'').split(/\r?\n/)
    for(const raw of lines) {
      const line=raw.replace(/%.*$/,'').trim(); if(!line)continue
      const field=/^([A-Za-z]):\s*(.*)$/.exec(line)
      if(field) {
        const [,f,v]=field
        if(f==='X'){if(tune){add(out.skipped,'extra tunes'); break} tune=true}
        else if(f==='T'&&!started&&!out.title) out.title=v
        else if(f==='M'){const m=/^(\d+)\/(\d+)/.exec(v); if(m)meter={num:Number(m[1]),den:Number(m[2])};else if(v==='C')meter={num:4,den:4};else if(v==='C|')meter={num:2,den:2}; if(!started)out.timeSig={...meter}; if(!explicitUnit)unit=meter.num/meter.den<.75?.25:.5}
        else if(f==='L'){const m=/^1\/(\d+)/.exec(v); if(m){unit=4/Number(m[1]);explicitUnit=true}}
        else if(f==='Q'){const m=/(?:(\d+)\/(\d+)\s*=\s*)?(\d+)/.exec(v); if(m){if(started)add(out.skipped,'tempo changes after the start');else out.bpm=Number(m[3])*(m[1]?4*Number(m[1])/Number(m[2]):1)}}
        else if(f==='K'){key=keyInfo(v); if(key.mode)add(out.skipped,`${key.mode} key mode`); if(!started){out.key=key.key;for(const v of states.values()){v.key=key;v.acc={}}} else if(state){state.key=key;state.acc={}}}
        else if(f==='V'){const m=/^(\S+)(.*)$/.exec(v); if(m){id=m[1];state=states.get(id);if(!state){state={name:id,notes:[],beat:0,acc:{},key,bar:1};states.set(id,state)} const n=/\bname="([^"]+)"/.exec(m[2]);if(n)state.name=n[1]}}
        else if(f==='w'||f==='W')out.lyrics=true
        continue
      }
      started=true; const st=ensure(); let i=0, tuplet=0, factor=1, broken=1
      while(i<line.length&&!cut){const rest=line.slice(i); let m: RegExpExecArray | null
        if(/^\s/.test(rest)){i++;continue}
        if((m=/^\[K:([^\]]+)\]/.exec(rest))){st.key=keyInfo(m[1]);st.acc={};if(st.key.mode)add(out.skipped,`${st.key.mode} key mode`);i+=m[0].length;continue}
        if((m=/^"([^"]*)"/.exec(rest))){if(!/^[\^_<>@]/.test(m[1])){const pitches=chord(m[1],out.skipped);if(pitches)out.chords.push({beat:st.beat,dur:0,symbol:m[1],pitches});else add(out.skipped,'unreadable symbols')}i+=m[0].length;continue}
        if((m=/^(?:\|:|:\||::|\[\d+)/.exec(rest))){add(out.skipped,'repeat signs (played once)');if(m[0].includes('|')){st.acc={};st.bar++}i+=m[0].length;continue}
        if((m=/^(?:\|\||\|\]|\[\||\|)/.exec(rest))){st.acc={};st.bar++;i+=m[0].length;continue}
        if((m=/^\{[^}]*\}/.exec(rest))){add(out.skipped,'grace notes');i+=m[0].length;continue}
        if((m=/^(?:![^!]*!|\+[^+]*\+|[~.HLMOPSTuv])/.exec(rest))){add(out.skipped,'decorations');i+=m[0].length;continue}
        if((m=/^\((\d+)/.exec(rest))){const n=Number(m[1]);tuplet=n;factor=({2:1.5,3:2/3,4:.75,5:2/5,6:2/3,7:2/7,8:.75,9:2/9} as Record<number,number>)[n]??1;i+=m[0].length;continue}
        if(rest[0]==='('||rest[0]===')'){add(out.skipped,'slurs');i++;continue}
        if((m=/^Z(\d*)/.exec(rest))){st.beat+=(Number(m[1])||1)*meter.num*4/meter.den;i+=m[0].length;continue}
        const stack=/^\[([^\]]+)\]([\d/]*)/.exec(rest)
        const token=stack ? null : /^(\^{1,2}|_{1,2}|=)?([A-Ga-gzx])([,']*)([\d/]*)(-?)/.exec(rest)
        if(stack||token){const body=stack?stack[1]:'';const len=duration(stack?stack[2]:token![4])*unit*(tuplet?factor:1)*broken;broken=1
          const pieces=stack ? [...body.matchAll(/(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)/g)] : [token!]
          for(const p of pieces){const letter=p[2];if(letter==='z'||letter==='x')continue;const l=letter.toUpperCase();const written=60+natural[l]+(letter===l?0:12)+12*((p[3].match(/'/g)||[]).length-(p[3].match(/,/g)||[]).length);let acc=st.acc[l]??st.key.acc[l];if(p[1]){acc=p[1]==='='?0:p[1][0]==='^'?p[1].length:-p[1].length;st.acc[l]=acc}let pitch=written+acc
            if(st.pending&&st.pending.written===written&&!p[1])pitch=st.pending.note.pitch
            if(st.pending&&st.pending.note.pitch===pitch&&Math.abs(st.pending.note.start+st.pending.note.dur-st.beat)<1e-8){st.pending.note.dur+=len;st.pending=undefined} else {const n={pitch,start:st.beat,dur:len,vel:.8};st.notes.push(n);noteCount++;if(noteCount>20000){st.notes.pop();add(out.skipped,`the end of the score (cut at bar ${st.bar})`);cut=true;break}}
            if(!stack&&token![5])st.pending={note:st.notes[st.notes.length-1],written}
          }
          st.beat+=len;if(tuplet)tuplet--;i+=(stack||token)![0].length
          const rhythm=/^([<>]+)/.exec(line.slice(i));if(rhythm){const n=rhythm[1].length; const long=2-1/2**n,short=1/2**n;const first=rhythm[1][0]==='>'?long:short; const delta=len*(first-1); for(const p of st.notes)if(Math.abs(p.start+p.dur-st.beat)<1e-8)p.dur+=delta;st.beat+=delta;broken=rhythm[1][0]==='>'?short:long;i+=n}continue
        }
        add(out.skipped,'unreadable symbols');i++
      }
      if(cut)break
    }
    out.voices=[...states.values()].map(({name,notes})=>({name,notes}))
    out.chords.sort((a,b)=>a.beat-b.beat); const end=Math.ceil(Math.max(0,...out.voices.flatMap(v=>v.notes.map(n=>n.start+n.dur)))/(meter.num*4/meter.den))*(meter.num*4/meter.den)
    out.chords.forEach((c,i)=>{c.dur=Math.max(0,(out.chords[i+1]?.beat??end)-c.beat)})
    if(!out.voices.some(v=>v.notes.length))out.error='No notes found in that file.'
  } catch { out.error='No notes found in that file.' }
  return out
}

export function abcToProject(parsed: AbcImport, fileName: string): Project {
  const p=defaultProject();p.tracks=[];p.name=parsed.title||fileName.replace(/\.abc$/i,'')||'Sheet music'
  if(parsed.bpm!==undefined)p.bpm=Math.max(40,Math.min(240,parsed.bpm));if(parsed.timeSig)p.timeSig=parsed.timeSig;if(parsed.key)p.key=parsed.key
  if(p.bpm !== parsed.bpm && parsed.bpm !== undefined) add(parsed.skipped, 'tempo adjusted to fit the studio')
  if(p.name.length > 60) add(parsed.skipped, 'the song name shortened')
  if(p.timeSig.num < 1 || p.timeSig.num > 32 || ![1,2,4,8,16].includes(p.timeSig.den)) { p.timeSig = { num: Math.max(1, Math.min(32, Math.round(p.timeSig.num))), den: [1,2,4,8,16].includes(p.timeSig.den) ? p.timeSig.den : 4 }; add(parsed.skipped, 'time signature adjusted to fit the studio') }
  const bar=p.timeSig.num*4/p.timeSig.den
  const voices=parsed.voices.filter(v=>v.notes.length);if(voices.length>23)add(parsed.skipped,'extra voices')
  const put=(name:string,notes:Note[],preset:string):void=>{const t=newTrack(name,{preset});if(name.length>24)add(parsed.skipped,'track names shortened');const end=Math.ceil(Math.max(...notes.map(n=>n.start+n.dur))/bar);let start=0
    while(start<end&&t.clips.length<256&&start*bar<=100000){let bars=Math.min(16,end-start);const from=start*bar
      while(bars>1&&notes.filter(n=>n.start>=from&&n.start<(start+bars)*bar).length>4096)bars--
      if(notes.some(n=>n.start < (start+bars)*bar && n.start+n.dur > (start+bars)*bar)) add(parsed.skipped,'long notes split at clip boundaries')
      if(notes.some(n=>n.dur>256)) add(parsed.skipped,'very long notes split into shorter notes')
      let selected=notes.filter(n=>n.start<(start+bars)*bar&&n.start+n.dur>from).flatMap(n=>{const a=Math.max(n.start,from), b=Math.min(n.start+n.dur,(start+bars)*bar);const parts:Note[]=[];for(let x=a;x<b;x+=256)parts.push({...n,start:x-from,dur:Math.min(256,b-x)});return parts})
      if(selected.length>4096){selected=selected.slice(0,4096);add(parsed.skipped,`some notes in bar ${start+1}`)}
      if(selected.some(n=>n.dur<1/32))add(parsed.skipped,'very short notes made a little longer')
      if(selected.some(n=>n.pitch<0||n.pitch>127))add(parsed.skipped,'notes outside the playable range adjusted')
      t.clips.push({id:newId(),start:from,length:bars*bar,notes:selected});start+=bars
    }
    if(start<end)add(parsed.skipped,`the end of the score (cut at bar ${start+1})`);p.tracks.push(t)
  }
  for(const v of voices.slice(0,23))put(v.name,v.notes,'Retro Solo')
  if(parsed.chords.length){const notes=parsed.chords.flatMap(c=>c.pitches.map(pitch=>({pitch,start:c.beat,dur:c.dur,vel:.6})));put('Chords',notes,'EP Glow')}
  return migrateProject(JSON.parse(JSON.stringify(p)))
}

export function exportAbc(project: Project, melodyTrackId: string, chordTrackId?: string | null): AbcExport {
  const out:AbcExport={text:'',notes:0,chords:0,notes_dropped:false,messages:[]}
  try {
    const track=project.tracks.find(t=>t.id===melodyTrackId); if(!track){out.error='That track has no notes to export.';return out}
    const events=collectEvents([track],0,projectEndBeat(project)).sort((a,b)=>a.startBeat-b.startBeat||b.pitch-a.pitch)
    if(!events.length){out.error='That track has no notes to export.';return out}
    const mono: {start:number;end:number;pitch:number}[]=[]
    for(const e of events){const n={start:e.startBeat,end:e.startBeat+e.durBeats,pitch:e.pitch};const last=mono[mono.length-1];if(last&&n.start<last.end){out.notes_dropped=true;if(n.pitch<=last.pitch)continue;last.end=n.start;if(last.end<=last.start)mono.pop()}mono.push(n)}
    if(out.notes_dropped)out.messages.push('More than one note played at once in places, so only the top note was kept.')
    if(project.tempoMap.length)out.messages.push('Tempo changes were left out.')
    let chordEvents:{beat:number;symbol:string}[]=[]
    const ct=project.tracks.find(t=>t.id===chordTrackId)
    if(ct){const ev=collectEvents([ct],0,projectEndBeat(project));const groups=new Map<number,number[]>();for(const e of ev){const k=Math.round(e.startBeat*16)/16;groups.set(k,[...(groups.get(k)??[]),e.pitch])}
      let bad=false;for(const [beat,pitches] of [...groups.entries()].sort((a,b)=>a[0]-b[0])){const pcs=[...new Set(pitches.map(x=>x%12))];if(pcs.length<2){bad=true;break}const bass=Math.min(...pitches)%12;let found='';for(const root of [bass,...pcs.filter(x=>x!==bass)]){for(const [q,intervals] of Object.entries(qualities)){const expected=intervals.map(x=>(x+root)%12);if(expected.length===pcs.length&&expected.every(x=>pcs.includes(x))){found=sharpNames[root]+q+(root===bass?'':'/'+sharpNames[bass]);break}}if(found)break}if(!found){bad=true;break}chordEvents.push({beat,symbol:found})}
      if(bad){chordEvents=[];out.messages.push("Chords were left out: that track isn't simple block chords.")}
    }
    let grid=4;const all=[...mono.flatMap(n=>[n.start,n.end]),...chordEvents.map(c=>c.beat)];while(grid<16&&all.some(x=>Math.abs(x*grid-Math.round(x*grid))>1e-7))grid*=2
    if(all.some(x=>Math.abs(x*grid-Math.round(x*grid))>1e-7))out.messages.push('Some notes were moved slightly to fit the grid.')
    const ns=mono.map(n=>({start:Math.round(n.start*grid),end:Math.max(Math.round(n.start*grid)+1,Math.round(n.end*grid)),pitch:n.pitch}));const cs=chordEvents.map(c=>({...c,beat:Math.round(c.beat*grid)}));const bar=project.timeSig.num*4/project.timeSig.den*grid
    if(!Number.isInteger(bar)||bar<=0)throw new Error('meter')
    const bars=Math.max(1,Math.ceil(Math.max(...ns.map(n=>n.end),...cs.map(c=>c.beat+1))/bar))
    const keysMajor=['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'], keysMinor=['Cm','C#m','Dm','Ebm','Em','Fm','F#m','Gm','G#m','Am','Bbm','Bm'];const key=project.key.scale==='minor'?keysMinor[project.key.root]:project.key.scale==='major'?keysMajor[project.key.root]:'C';const info=keyInfo(key)
    const head=['X:1','T:',`M:${project.timeSig.num}/${project.timeSig.den}`,`L:1/${grid*4}`,`Q:1/4=${Math.round(project.bpm)}`,'V: Vocal clef=treble name="Vocal Melody" snm="Vocal"','V: Ins clef=treble name="Ins Melody" snm="Inst."',`K:${key}`]
    const tokens=[48,32,24,16,12,8,6,4,3,2,1];let body='';let accidental:Record<string,number>={}
    function spelling(pitch:number): {letter:string;alter:number;written:number} {const candidates:{letter:string;alter:number;written:number;score:number}[]=[];for(const letter of 'CDEFGAB')for(let alter=-1;alter<=1;alter++){const written=pitch-alter;if(((written-60-natural[letter])%12+12)%12)continue;const inKey=info.acc[letter]===alter;const score=(inKey?0:10)+(alter!==0&&((info.count<0&&alter>0)||(info.count>=0&&alter<0))?4:0)+(['B','E'].includes(letter)&&alter===1||['C','F'].includes(letter)&&alter===-1?2:0);candidates.push({letter,alter,written,score})}return candidates.sort((a,b)=>a.score-b.score)[0]}
    function noteName(pitch:number):string {const s=spelling(pitch),current=accidental[s.letter]??info.acc[s.letter];let prefix='';if(current!==s.alter){prefix=s.alter===0?'=':s.alter>0?'^':'_';accidental[s.letter]=s.alter}const octave=Math.floor((s.written-60)/12);const letter=octave>=1?s.letter.toLowerCase():s.letter;return prefix+letter+(octave>=1?"'".repeat(octave-1):','.repeat(-octave))}
    for(let b=0;b<bars;b++){accidental={};let pos=b*bar;const end=pos+bar
      while(pos<end){const n=ns.find(n=>n.start<=pos&&n.end>pos);const nextNote=ns.find(n=>n.start>pos);const c=cs.find(c=>c.beat===pos);const nextChord=cs.find(c=>c.beat>pos);let limit=Math.min(end,n?.end??nextNote?.start??end,nextChord?.beat??end);if(limit<=pos)limit=pos+1
        if(c)body+=`"${c.symbol}"`;let len=limit-pos;while(len>0){const chunk=tokens.find(x=>x<=len)!;body+=(n?noteName(n.pitch):'z')+(chunk===1?'':chunk);len-=chunk;if(n&&(len>0||limit<n.end))body+='-'}pos=limit
      }
      body+='|';if((b+1)%4===0||b===bars-1){const group=b%4+1;head.push('V: Vocal',body,'V: Ins',`Z${group===1?'':group}|`);body=''}
    }
    out.text=head.join('\n')+'\n';out.notes=ns.length;out.chords=cs.length
  } catch {out.error='Could not export that sheet music.'}
  return out
}
