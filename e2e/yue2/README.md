# YuE2 example scores

`melody.abc`, `score.abc` and `score-jazz.abc` are copied unchanged from the
`examples/` folder of the YuE repository
(https://github.com/multimodal-art-projection/YuE, commit 1116bea76032).
They are licensed under the Apache License 2.0; a copy is in `LICENSE` here.
The import and export tests use them to check that Tracks reads and writes
the same score format YuE2 uses.

`abc_tools.py` is YuE2's own score checker, copied unchanged from the
`skills/yue2-music/scripts/` folder of the same repository at the same commit,
under the same licence. The sheet music editor's tests run it (with
`python3 -I e2e/yue2/abc_tools.py inspect <file>`, or its `parse()`) to make
sure every score the editor writes is one YuE2 accepts, with the same notes.
