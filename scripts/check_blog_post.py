#!/usr/bin/env python3
"""Dedup gate for the Tracks Guides blog.

Compares a candidate slug against the existing posts in public/blog/posts.json
using Jaccard similarity over title + dek + tags tokens. Stdlib-only.

Usage:
    python3 scripts/check_blog_post.py <slug> [--title "..."] [--dek "..."] [--tags "a,b,c"]

A slug that is already in posts.json (or already has an article on disk) is an
exact duplicate and fails immediately — republishing it would overwrite the live
article and add a second hub entry.

Exit codes:
    0 = clear to publish (no near-duplicate found)
    2 = duplicate: slug already published, or too similar to an existing post
    1 = usage / input error
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTICLES = os.path.join(ROOT, "public", "blog")
POSTS = os.path.join(ARTICLES, "posts.json")
THRESHOLD = 0.55  # Jaccard >= this against any existing post => duplicate

STOP = set(
    "a an the to in of for and or your you with no how is it on at by from "
    "make making made music browser online free tracks studio".split()
)


def tokens(*parts):
    text = " ".join(p for p in parts if p).lower()
    raw = re.findall(r"[a-z0-9]+", text)
    return {t for t in raw if t not in STOP and len(t) > 1}


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def load_posts():
    if not os.path.exists(POSTS):
        return []
    with open(POSTS, encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--title", default="")
    ap.add_argument("--dek", default="")
    ap.add_argument("--tags", default="")
    args = ap.parse_args()

    posts = load_posts()

    # Exact collision is the most literal duplicate there is, and it is the one a
    # similarity score can never catch: re-publishing a live slug overwrites the
    # article and prepends a second posts.json entry. Fail before comparing.
    if any(p.get("slug") == args.slug for p in posts):
        print(f"DUPLICATE: slug '{args.slug}' is already published in posts.json. Pick a new slug.")
        return 2
    if os.path.exists(os.path.join(ARTICLES, f"{args.slug}.html")):
        print(f"DUPLICATE: public/blog/{args.slug}.html already exists. Pick a new slug.")
        return 2

    title, dek, tags = args.title, args.dek, args.tags.split(",") if args.tags else []

    if not (title or dek or tags):
        print(f"error: no fields to compare for slug '{args.slug}'", file=sys.stderr)
        return 1

    cand = tokens(title, dek, " ".join(tags))
    worst = 0.0
    worst_slug = None
    for p in posts:
        sim = jaccard(cand, tokens(p.get("title", ""), p.get("dek", ""), " ".join(p.get("tags", []))))
        if sim > worst:
            worst, worst_slug = sim, p.get("slug")

    if worst >= THRESHOLD:
        print(f"DUPLICATE: '{args.slug}' is {worst:.0%} similar to '{worst_slug}'. Pick a different angle.")
        return 2
    print(f"OK: '{args.slug}' nearest existing post is '{worst_slug}' at {worst:.0%} (< {THRESHOLD:.0%}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
