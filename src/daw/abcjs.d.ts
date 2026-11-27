// abcjs ships one bundle with its synth and editor; importing only the renderer
// keeps the lazily loaded sheet music chunk smaller. Its types live on 'abcjs'.
declare module 'abcjs/src/api/abc_tunebook_svg' {
  const renderAbc: typeof import('abcjs').renderAbc
  export default renderAbc
}
