import { describe, expect, it } from 'vitest'
import { pageHeaders } from '../../worker.js'

describe('framing headers', () => {
  it('allows only the embed page to be framed anywhere', () => {
    for (const path of ['/embed', '/embed.html']) expect(pageHeaders(path, 'text/html')).toEqual({ 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': 'frame-ancestors *' })
    for (const path of ['/', '/studio', '/privacy']) expect(pageHeaders(path, 'text/html; charset=utf-8')).toEqual({ 'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' })
    expect(pageHeaders('/assets/a.js', 'application/javascript')).toEqual({})
  })
})
