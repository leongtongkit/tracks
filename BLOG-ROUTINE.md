# Tracks Guides — weekly blog routine

Mirrors the Fader / jfound-marketing engines. One post per run; product voice
(approachable, practical), bylined **Tongkit Leong**. Topic: high-intent SEO/GEO
for free browser music production. Goal: organic traffic that opens the studio.

## Steps (one post per run)

1. **Pick a topic.** Take the FIRST unchecked item from `BLOG-BACKLOG.md`. If the
   backlog has ≤5 unchecked items, append 10 fresh on-lane topics before continuing.
   If empty, stop and report — no filler.

2. **Dedup gate.** Decide a slug, then run:
   ```
   python3 scripts/check_blog_post.py <slug> --title "..." --dek "..." --tags "a,b,c"
   ```
   Exit 2 = too similar to an existing post → pick a different angle. Exit 0 = clear.

3. **Write the article.** Clone an existing file in `public/blog/` as the chrome
   template (nav, footer, ad slots, JSON-LD blocks) and replace the content. Rules:
   - Open with a **direct, quotable lede** that answers the query in 1–2 sentences
     (GEO — get cited by AI answers).
   - Use clear `<h2>`/`<h3>` structure, short paragraphs, and a real FAQ where it fits.
   - Add `BlogPosting` **or** `HowTo` JSON-LD + a `BreadcrumbList`. Keep the two
     `ad-slot` divs (`blog-top`, `blog-bottom`) and the closing `cta-card` → `/studio`.
   - Internal-link to the studio and 1–2 sibling guides.
   - Honest: no invented features. Match the real studio (see `README.md`).

4. **Register the post.** Prepend an entry to `public/blog/posts.json`
   (`slug`, `title`, `dek`, `date` = today UTC, `tags`, `readingTime`). Add the
   URL to `public/sitemap.xml` (`/blog/<slug>`, monthly, priority 0.7).

5. **Update the backlog.** Check off the topic in `BLOG-BACKLOG.md`.

6. **Commit + deploy.** Author `jfound`, NO `Co-Authored-By` trailer. Stage only
   blog paths + sitemap + backlog. Push to `main` → GitHub Actions builds and
   deploys both workers. Verify the new URL returns 200.

## Notes
- Blog is static HTML served by Workers Static Assets — no build step for posts.
  Clean URLs (`/blog/<slug>`) resolve to `<slug>.html` automatically.
- Voice = product/landing voice, NOT Jay's personal aphoristic voice.
- Tracks is LOCAL-ONLY: never imply cloud storage of user projects.
