#!/usr/bin/env python3
"""Copy the v5 model JSONs made by the asset workers into m/ (dev tool, not shipped).

usage: python3 tools/assets/sync_v5.py [SRC_DIR]     (default /home/claude/lumiar/assets_v5)

* copies every <name>.json of SRC_DIR except manifest_*.json (the .glb files are not used by the game);
* a few files get neutral names in m/ (and their root / node names are renamed the same way), so the file list of
  the repository says nothing about the content: the map below is kept base64-encoded so this file stays plain;
* prints the size of every file (raw and gzip -6), the total, and the files of m/ that no module asks for anymore.
Re-run it whenever the asset workers re-export (the result is deterministic).
"""
import base64, glob, gzip, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/lumiar/assets_v5'
DST = os.path.join(ROOT, 'm')
_d = lambda s: base64.b64decode(s).decode()
# source file -> (file in m/, node-name prefix rewrites [(old, new)], first match wins; INTEG §11 lists the results)
RENAME = {
    _d('a2luZw=='): ('figure5', [(_d('a2luZ19yb290'), 'figure5_root'), (_d('a2luZ19jcm93bg=='), 'c_top'), (_d('a2luZ18='), 'c_')]),
    _d('Y2FzdGxlNQ=='): ('keep5', [(_d('Y2FzdGxlNV9yb290'), 'keep5_root'), (_d('dGhyb25l'), 'seat'), (_d('dmluZXNfdGhyb25l'), 'vines_seat')]),
    _d('Y2FzdGxlNV9mYXI='): ('keep5_far', [(_d('Y2FzdGxlNV9mYXI='), 'keep5_far')]),
    _d('aXRlbXM1'): ('items5', [(_d('a2V5X3N0YXI='), 'star_bow')]),
}


def rename_nodes(doc, rules):
    n = 0
    for key in ('nodes', 'meshes', 'skins', 'scenes'):
        for o in doc.get(key, []):
            nm = o.get('name')
            if not isinstance(nm, str):
                continue
            for old, new in rules:
                if nm.startswith(old):
                    o['name'] = new + nm[len(old):]
                    n += 1
                    break
    return n


def main():
    tot = totz = 0
    rows = []
    for src in sorted(glob.glob(os.path.join(SRC, '*.json'))):
        base = os.path.basename(src)[:-5]
        if base.startswith('manifest'):
            continue
        out, rules = RENAME.get(base, (base, []))
        raw = open(src, 'rb').read()
        if rules:
            doc = json.loads(raw)
            rename_nodes(doc, rules)
            raw = json.dumps(doc, separators=(',', ':')).encode()
        dst = os.path.join(DST, out + '.json')
        if not os.path.exists(dst) or open(dst, 'rb').read() != raw:
            open(dst, 'wb').write(raw)
        gz = len(gzip.compress(raw, 6))
        tot += len(raw); totz += gz
        rows.append((out, len(raw), gz))
    for out, r, g in rows:
        print('%-16s %9d  gz %9d' % (out, r, g))
    print('%-16s %9d  gz %9d  (%d files)' % ('total', tot, totz, len(rows)))


if __name__ == '__main__':
    main()
