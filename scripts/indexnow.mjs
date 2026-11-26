#!/usr/bin/env node
// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver and others share
// one endpoint) which pages changed, so they re-crawl them without waiting.
//
//   node scripts/indexnow.mjs --changed <base-commit>   blog pages changed since <base-commit>
//   node scripts/indexnow.mjs --all                      every URL in both sitemaps
//   add --dry-run to print the URLs without sending
//
// The key is public by design: engines confirm it by fetching
// https://<host>/<KEY>.txt, served from public/ on both hosts.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KEY = '15ca66bb0604b7c67111e9fb2327fefc'
export const SITE = 'https://freetracks.app'
const ENDPOINT = 'https://api.indexnow.org/indexnow'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// public/blog/<slug>.html is served at /blog/<slug>, and index.html at /blog/.
// A new or changed post also changes the blog index, so that is sent too.
export function urlsForChangedFiles(files) {
  const urls = new Set()
  for (const f of files) {
    const m = /^public\/blog\/([a-z0-9-]+)\.html$/.exec(f.trim())
    if (!m) continue
    urls.add(m[1] === 'index' ? `${SITE}/blog/` : `${SITE}/blog/${m[1]}`)
    urls.add(`${SITE}/blog/`)
  }
  return [...urls]
}

export function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
}

// IndexNow wants one host per request.
export function byHost(urls) {
  const groups = new Map()
  for (const u of urls) {
    const host = new URL(u).host
    if (!groups.has(host)) groups.set(host, [])
    groups.get(host).push(u)
  }
  return groups
}

function changedSince(base) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' })
  let from = base
  try {
    if (!from || /^0+$/.test(from)) throw new Error('no base')
    git('cat-file', '-e', `${from}^{commit}`)
  } catch {
    from = 'HEAD~1' // first push of a branch, or a base this clone does not have
  }
  return git('diff', '--name-only', from, 'HEAD', '--', 'public/blog').split('\n').filter(Boolean)
}

async function submit(host, urlList) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key: KEY, keyLocation: `https://${host}/${KEY}.txt`, urlList }),
  })
  // 200 = accepted; 202 = accepted, key check still pending
  console.log(`indexnow ${host}: HTTP ${res.status} for ${urlList.length} URL(s)`)
  return res.status === 200 || res.status === 202
}

async function main(argv) {
  const dry = argv.includes('--dry-run')
  let urls
  if (argv.includes('--all')) {
    urls = ['public/sitemap.xml', 'public/sitemap-synth.xml'].flatMap((p) =>
      sitemapUrls(readFileSync(join(root, p), 'utf8')),
    )
  } else if (argv.includes('--changed')) {
    urls = urlsForChangedFiles(changedSince(argv[argv.indexOf('--changed') + 1]))
  } else {
    console.error('usage: indexnow.mjs --changed <base-commit> | --all [--dry-run]')
    return 2
  }
  if (!urls.length) {
    console.log('indexnow: no blog pages changed, nothing to send')
    return 0
  }
  let ok = true
  for (const [host, list] of byHost(urls)) {
    if (dry) {
      console.log(`indexnow ${host} (dry run):\n  ${list.join('\n  ')}`)
      continue
    }
    for (let i = 0; i < list.length; i += 10000) ok = (await submit(host, list.slice(i, i + 10000))) && ok
  }
  return ok ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
