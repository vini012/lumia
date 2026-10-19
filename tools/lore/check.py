#!/usr/bin/env python3
"""Lumiar text-leak check (dev tool, not shipped).

Scans the repository (every tracked or untracked text file except generated model/binary data) and the commit
messages of the current branch for:
  * narrative sentences from the plaintext source (kept OUTSIDE the repo), compared case-insensitively on
    clauses of 16+ characters;
  * a short list of sensitive words (stored here base64-encoded so this file stays clean);
  * in the workstream's own files and in commit messages, a list of English words that would describe the story in
    comments, string literals and page text (code identifiers are not checked; the technical ids agreed with the
    other workstreams, e.g. POI and world-flag names, are allowed).

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
WORDS = [base64.b64decode(w).decode() for w in ('cmVp', 'cmVpcw==', 'cmFpbmhhIG1hZ2E=', 'bWFnbyBhZG9ybWVjaWRv',
                                                'bWFnbw==', 'bWFnYQ==', 'bWFnb3M=', 'bWFnYXM=')]
SUBS = [base64.b64decode(w).decode() for w in ('Y2FzdGVsbw==', 'Y2hhdmU=')]
_d = lambda b: base64.b64decode(b).decode().split()
EN = set(_d('a2luZyBraW5ncyBxdWVlbiBxdWVlbnMga2luZ2RvbSBjcm93biBjcm93bmVkIHRocm9uZSB0aHJvbmVzIGNhc3RsZSBjYXN0bGVzIHNsZWVwZXIg'
            'c2xlZXBlcnMgYXNsZWVwIHdpemFyZCB3aXphcmRzIHNvcmNlcmVyIHNvcmNlcmVzcyBtYWdlIG1hZ2VzIGtleSBrZXlzIGZpbmFsZSBlbmRpbmcgZW5k'
            'aW5ncyB3YWtlIHdha2VzIHdha2luZyBhd2FrZW4gYXdha2VucyBhd2FrZW5pbmcgYXdha2Ugcm95YWw='))
# contract ids allowed anywhere (as whole ids), and bare ids allowed as a whole string literal or a quoted id in a comment
EN_IDS = _d('Y2FzdGxlX2dhdGUgY2FzdGxlX3NlZW4gY2FzdGxlX3JlYWR5IGNhc3RsZTUgcm95YWxfZm9yZ2UgbWFnZV9tIG1hZ2VfZiBoZXJv'
            'X20gaGVyb19mIGZvcmdlX2tleSBncmlmZmluX3F1ZWVu')
EN_BARE = _d('Y2FzdGxlIHRocm9uZSBhd2FrZSB3b2tl')
EN_SKIP = ('js/lore.js',)  # generated: one long encoded literal
B64 = re.compile(r'^[A-Za-z0-9+/]{6,}={0,2}$')


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
        if re.fullmatch(r'[A-Za-z0-9_.:/-]+', s):
            continue  # technical ids (POI, item, flag names) are not narrative text
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


def js_chunks(text):
    """Comments and string literals of a JS source, as ('c'|'s', text). Small lexer: strings, template literals,
    comments and regex literals (a '/' after an operator or at the start of an expression)."""
    out, i, n, last = [], 0, len(text), ''
    while i < n:
        c = text[i]
        if c == '/' and text.startswith('//', i):
            j = text.find('\n', i); j = n if j < 0 else j
            out.append(('c', text[i + 2:j], i)); i = j; continue
        if c == '/' and text.startswith('/*', i):
            j = text.find('*/', i + 2); j = n if j < 0 else j
            out.append(('c', text[i + 2:j], i)); i = j + 2; continue
        if c in '\'"`':
            j, buf = i + 1, []
            while j < n and text[j] != c:
                if text[j] == '\\':
                    buf.append(text[j:j + 2]); j += 2; continue
                if c != '`' and text[j] == '\n':
                    break
                buf.append(text[j]); j += 1
            out.append(('s', ''.join(buf), i)); i = j + 1; last = 'a'; continue
        if c == '/' and (last == '' or last in '(,=:[!&|?{};+-*%<>~^'):
            j = i + 1; cls = False
            while j < n and text[j] != '\n':
                if text[j] == '\\':
                    j += 2; continue
                if text[j] == '[':
                    cls = True
                elif text[j] == ']':
                    cls = False
                elif text[j] == '/' and not cls:
                    break
                j += 1
            i = j + 1; last = 'a'; continue
        if not c.isspace():
            last = c if not (c.isalnum() or c in '_$') else 'a'
            if last == 'a':  # a keyword before '/' still starts a regex
                m = re.match(r'[\w$]+', text[i:])
                w = m.group(0)
                last = '(' if w in ('return', 'typeof', 'case', 'in', 'of') else 'a'
                i += len(w); continue
        i += 1
    return out


def py_chunks(text):
    import io
    import tokenize
    out, offs = [], [0]
    for l in text.split('\n'):
        offs.append(offs[-1] + len(l) + 1)
    try:
        for t in tokenize.generate_tokens(io.StringIO(text).readline):
            if t.type == tokenize.COMMENT:
                out.append(('c', t.string[1:], offs[t.start[0] - 1] + t.start[1]))
            elif t.type == tokenize.STRING:
                out.append(('s', re.sub(r'^[rbuf]*(\'\'\'|"""|\'|")|(\'\'\'|"""|\'|")$', '', t.string, flags=re.I), offs[t.start[0] - 1] + t.start[1]))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        out.append(('c', text, 0))
    return out


def en_hits(kind, chunk):
    t = chunk.strip()
    if kind == 's' and (t.lower() in EN_BARE or B64.match(t)):
        return []
    low = re.sub(r'https?://\S+', ' ', chunk.lower())
    for w in EN_IDS:
        low = re.sub(r'(?<![\w])' + re.escape(w) + r'(?![\w])', ' ', low)
    tech = kind == 's' and re.fullmatch(r'[\w.:/-]+', t) is not None  # an id literal such as 'note:<poi id>'
    for w in EN_BARE:
        low = re.sub(r'([\'"`])' + re.escape(w) + r'\1', ' ', low)
        if tech:
            low = re.sub(r'(?<![a-z0-9])' + re.escape(w) + r'(?![a-z0-9])', ' ', low)
    return [w for w in re.split(r'[^a-z]+', low) if w in EN]


def scan_en(name, text):
    if name in EN_SKIP or not name.startswith(OWN):
        return []
    ext = os.path.splitext(name)[1].lower()
    if ext == '.js':
        chunks = js_chunks(text)
    elif ext == '.py':
        chunks = py_chunks(text)
    elif ext in ('.html', '.css', '.md', '.txt', '.json'):
        chunks = [('c', text, 0)]
    else:
        return []
    return sorted({(text.count('\n', 0, at) + 1 + c[:c.lower().find(w) if w in c.lower() else 0].count('\n'), w) for k, c, at in chunks for w in en_hits(k, c)})


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
        for line, w in scan_en(n, text):
            bad_own.append(f'{n}:{line}: english [{w}]')
    try:
        base = subprocess.run(['git', 'merge-base', 'HEAD', 'v5'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        rng = [] if '--all-commits' in sys.argv else ([base + '..HEAD'] if base else [])
        log = subprocess.run(['git', 'log', '--format=%h %B%x00'] + rng, cwd=ROOT, capture_output=True, text=True).stdout
    except Exception:
        log = ''
    for msg in log.split('\x00'):
        for kind, what in scan_text(msg, cl, wre):
            bad_own.append(f'commit {msg.strip()[:9]}: {kind} [{what[:40]}]')
        for w in sorted(set(en_hits('c', msg))):
            bad_own.append(f'commit {msg.strip()[:9]}: english [{w}]')
    print(f'{len(cl)} clauses checked, {len(bad_own)} hits in own files/commits, {len(other)} in other files')
    for h in bad_own:
        print('  OWN  ', h)
    for h in other:
        print('  other', h)
    sys.exit(1 if bad_own else 0)


if __name__ == '__main__':
    main()
