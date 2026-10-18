#!/usr/bin/env python3
"""Lumiar text-leak check (dev tool, not shipped).

Scans the repository (every tracked or untracked text file except generated model/binary data) and the commit
messages of the current branch for:
  * narrative sentences from the plaintext source (kept OUTSIDE the repo), compared case-insensitively on
    clauses of 16+ characters;
  * a short list of sensitive words (stored here base64-encoded so this file stays clean).

usage: python3 tools/lore/check.py [SRC_JSON] [--all-commits]
Exit status 1 when a file owned by the text/journal workstream (OWN below) or one of its commits leaks.
Hits in other files are listed as 'other' so their owners can fix them.
"""
import base64
import json
import os
import re
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.environ.get('LUMIAR_LORE_SRC', '/home/claude/v5docs/story_src.json')
OWN = ('tools/lore/', 'js/lore.js', 'js/story.js', 'js/storyui.js', 'dev/story', 'assets/fonts/')
SKIP_DIRS = {'.git', 'node_modules', 'm', 'lib'}
SKIP_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.glb', '.bin', '.woff2', '.woff', '.ttf', '.mp3', '.ogg', '.wav', '.ico'}
# sensitive words, base64 (whole-word match, accents ignored) + substrings that must never appear at all
WORDS = [base64.b64decode(w).decode() for w in ('cmVp', 'cmVpcw==', 'cmFpbmhhIG1hZ2E=', 'bWFnbyBhZG9ybWVjaWRv')]
SUBS = [base64.b64decode(w).decode() for w in ('Y2FzdGVsbw==', 'Y2hhdmU=')]


def norm(s):
    s = unicodedata.normalize('NFKD', s.lower())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', s)


def strings(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if not k.startswith('_'):
                yield from strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from strings(v)
    elif isinstance(o, str):
        yield o


def clauses(src):
    with open(src, encoding='utf-8') as f:
        data = json.load(f)
    out = set()
    for s in strings(data):
        for part in re.split(r'[.!?;:\n—]+', s):
            p = norm(part).strip(' ,"\'')
            if len(p) >= 16:
                out.add(p)
    return sorted(out)


def files():
    try:
        r = subprocess.run(['git', 'ls-files', '-co', '--exclude-standard'], cwd=ROOT, capture_output=True, text=True, check=True)
        names = r.stdout.split('\n')
    except Exception:
        names = []
        for d, dirs, fs in os.walk(ROOT):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            names += [os.path.relpath(os.path.join(d, f), ROOT) for f in fs]
    for n in names:
        if not n or n.split('/')[0] in SKIP_DIRS or os.path.splitext(n)[1].lower() in SKIP_EXT:
            continue
        if os.path.isfile(os.path.join(ROOT, n)):
            yield n


def scan_text(text, cl, wre):
    t = norm(text)
    hits = [('frase', c) for c in cl if c in t]
    hits += [('palavra', m.group(0)) for m in wre.finditer(t)]
    hits += [('palavra', s) for s in SUBS if s in t]
    return hits


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    src = args[0] if args else SRC
    cl = clauses(src)
    wre = re.compile(r'(?<![\w])(' + '|'.join(re.escape(norm(w)) for w in WORDS) + r')(?![\w])')
    bad_own, other = [], []
    for n in files():
        try:
            with open(os.path.join(ROOT, n), encoding='utf-8') as f:
                text = f.read()
        except (UnicodeDecodeError, OSError):
            continue
        for kind, what in scan_text(text, cl, wre):
            line = next((i + 1 for i, l in enumerate(text.split('\n')) if what in norm(l)), 0)
            (bad_own if n.startswith(OWN) else other).append(f'{n}:{line}: {kind} [{what[:40]}]')
    rng = [] if '--all-commits' in sys.argv else ['origin/v5..HEAD']
    try:
        base = subprocess.run(['git', 'merge-base', 'HEAD', 'v5'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        rng = [] if '--all-commits' in sys.argv else ([base + '..HEAD'] if base else [])
        log = subprocess.run(['git', 'log', '--format=%h %B%x00'] + rng, cwd=ROOT, capture_output=True, text=True).stdout
    except Exception:
        log = ''
    for msg in log.split('\x00'):
        for kind, what in scan_text(msg, cl, wre):
            bad_own.append(f'commit {msg.strip()[:9]}: {kind} [{what[:40]}]')
    print(f'{len(cl)} clauses checked, {len(bad_own)} hits in own files/commits, {len(other)} in other files')
    for h in bad_own:
        print('  OWN  ', h)
    for h in other:
        print('  other', h)
    sys.exit(1 if bad_own else 0)


if __name__ == '__main__':
    main()
