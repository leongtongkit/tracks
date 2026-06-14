// Studio entry = phone gate. Phones get the "use a bigger screen" message and
// the heavy studio bundle is never downloaded; everyone else lazy-loads boot.ts.
// (style.css, which carries the .mobile-block styles, is loaded by studio.html.)
import { isPhone, renderMobileBlock } from '../mobile-gate'

if (isPhone()) {
  renderMobileBlock('Tracks Studio', [
    { href: '/help/', label: 'Read the guides' },
    { href: '/', label: 'Back to home' },
  ])
} else {
  void import('./boot')
}
