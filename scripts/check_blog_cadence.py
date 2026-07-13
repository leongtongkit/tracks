#!/usr/bin/env python3
"""Cadence monitor for the Tracks Guides blog.

The blog is published by an unattended daily routine. When that routine silently
stops (it has: no posts landed 2026-06-28 through 06-30), nothing notices — the
site just quietly goes stale. This script fails when the newest post in
public/blog/posts.json is older than the allowed age, so a scheduled CI run turns
a silent outage into a visible failure. Stdlib-only.

Usage:
    python3 scripts/check_blog_cadence.py [--max-age-days N] [--today YYYY-MM-DD]
                                          [--posts PATH]

Exit codes:
    0 = cadence healthy (newest post within --max-age-days)
    2 = STALE: the daily routine has missed at least one run
    1 = usage / input error (missing or unreadable posts.json)
"""
import argparse
import datetime as dt
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS = os.path.join(ROOT, "public", "blog", "posts.json")

# The routine publishes daily at ~03:07 UTC. A 2-day window tolerates one late or
# in-flight run without crying wolf, while still catching a real multi-day outage.
DEFAULT_MAX_AGE_DAYS = 2


def parse_date(s):
    try:
        return dt.date.fromisoformat(str(s).strip())
    except (ValueError, AttributeError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-age-days", type=int, default=DEFAULT_MAX_AGE_DAYS)
    ap.add_argument("--today", default=None, help="override today's UTC date (testing)")
    ap.add_argument("--posts", default=POSTS, help="path to posts.json (testing)")
    args = ap.parse_args()

    if not os.path.exists(args.posts):
        print(f"error: {args.posts} not found", file=sys.stderr)
        return 1
    try:
        with open(args.posts, encoding="utf-8") as f:
            posts = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"error: cannot read posts.json: {e}", file=sys.stderr)
        return 1

    dates = [d for d in (parse_date(p.get("date")) for p in posts) if d]
    if not dates:
        print("error: posts.json has no post with a valid date", file=sys.stderr)
        return 1

    today = parse_date(args.today) if args.today else dt.datetime.now(dt.timezone.utc).date()
    if today is None:
        print(f"error: --today is not a YYYY-MM-DD date: {args.today}", file=sys.stderr)
        return 1

    newest = max(dates)
    age = (today - newest).days

    if age > args.max_age_days:
        print(
            f"STALE: newest post is '{newest}' — {age} days old "
            f"(limit {args.max_age_days}). The daily blog routine has missed a run.\n"
            f"Check the claude.ai cloud routine 'tracks-blog-daily' and re-run it."
        )
        return 2

    print(f"OK: newest post is '{newest}' ({age} day(s) old, limit {args.max_age_days}). {len(dates)} posts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
