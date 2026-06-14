// Synth entry = phone gate. Phones get the "use a bigger screen" message; the
// heavy synth bundle only loads on tablet/desktop via synth-app.ts.
// (style.css, which carries the .mobile-block styles, is loaded by synth.html.)
import { isPhone, renderMobileBlock } from './mobile-gate'

if (isPhone()) {
  renderMobileBlock('Synth', [
    { href: 'https://tracks.jfound.net/', label: 'Visit Tracks' },
    { href: 'https://tracks.jfound.net/help/', label: 'Read the guides' },
  ])
} else {
  void import('./synth-app')
}
