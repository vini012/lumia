"""Writes m/world5.bin, m/world5.json and m/world5.b64.json (layout documented in README.md)."""
import os
import json
import base64
import struct
import numpy as np
from wnoise import resample

H_SCALE = 0.02   # metres per unit
H_OFF = -50.0    # metres at 0


def pack(H, R, LID, M):
    n = H.shape[0]
    n2 = R.shape[0]
    q = np.clip(np.round((H - H_OFF) / H_SCALE), 0, 65535).astype('<u2')
    sections = []
    blobs = []
    off = 16

    def add(name, arr, typ, size):
        nonlocal off
        b = arr.tobytes()
        sections.append(dict(name=name, type=typ, n=size, offset=off, bytes=len(b)))
        blobs.append(b)
        off += len(b)
        pad = (-off) % 4
        if pad:
            blobs.append(b'\0' * pad)
            off += pad

    add('height', q, 'u16', n)
    add('region', R.astype(np.uint8), 'u8', n2)
    add('lake', LID.astype(np.uint8), 'u8', n2)
    for k in ('forest', 'meadow', 'wet', 'cloud'):
        add(k, np.clip(np.round(M[k] * 255), 0, 255).astype(np.uint8), 'u8', n2)
    head = b'LUM5' + struct.pack('<III', 1, n, n2)
    data = head + b''.join(blobs)
    return data, sections


def r1(v):
    return round(float(v), 1)


def r2(v):
    return round(float(v), 2)


def river_json(rv):
    """reaches (between falls) as [[x, z, surface, width], ...] every ~20 m."""
    P, S, W = rv['P'], rv['s'], rv['W']
    n = len(P)
    fm = np.zeros(n, bool)
    for f in rv['falls']:
        fm[f['ia'] + 1:f['ib']] = True
    reaches = []
    i = 0
    while i < n:
        if fm[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and not fm[j + 1]:
            j += 1
        if j - i >= 1:
            idx = list(range(i, j + 1, 2))
            if idx[-1] != j:
                idx.append(j)
            reaches.append([[r1(P[k, 0]), r1(P[k, 1]), r2(S[k]), r1(W[k])] for k in idx])
        i = j + 1
    falls = [{k: f[k] for k in ('x', 'z', 'dx', 'dz', 'top', 'bottom', 'w')} for f in rv['falls']]
    return dict(id=rv['id'], reaches=reaches, falls=falls, cloud=rv['ends_in_cloud'])


def simplify(Q, tol):
    """Douglas-Peucker on an (n, d) array of already-scaled coordinates; returns kept indices."""
    n = len(Q)
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        A, B = Q[a], Q[b]
        AB = B - A
        L2 = float(AB @ AB)
        S = Q[a + 1:b] - A
        t = np.clip((S @ AB) / L2, 0, 1) if L2 > 1e-9 else np.zeros(len(S))
        d = np.linalg.norm(S - t[:, None] * AB, axis=1)
        k = int(np.argmax(d))
        if d[k] > tol or (b - a) > 24:  # also cap segment length (~ 24 samples)
            m = a + 1 + k if d[k] > tol else (a + b) // 2
            keep[m] = True
            stack.append((a, m))
            stack.append((m, b))
    return np.nonzero(keep)[0]


def road_json(rd):
    """road centre line [[x, z, surface], ...], simplified (0.6 m across, 0.2 m in height)."""
    P = np.asarray(rd['P'], np.float64)
    y = np.asarray(rd['y'], np.float64)
    Q = np.column_stack([P[:, 0], P[:, 1], y * 3.0])
    idx = simplify(Q, 0.6)
    return dict(w=rd['w'], pts=[[r1(P[k, 0]), r1(P[k, 1]), r2(y[k])] for k in idx])


def write_all(out_dir, D, G, H, R, LID, M, lakes, rivs, roads, pois, spawn, log=print, extra=None):
    os.makedirs(out_dir, exist_ok=True)
    data, sections = pack(H, R, LID, M)
    with open(os.path.join(out_dir, 'world5.bin'), 'wb') as f:
        f.write(data)
    with open(os.path.join(out_dir, 'world5.b64.json'), 'w') as f:
        json.dump({'b64': base64.b64encode(data).decode('ascii')}, f)
    falls = []
    for rv in rivs:
        for f in rv['falls']:
            falls.append({k: f[k] for k in ('river', 'x', 'z', 'dx', 'dz', 'top', 'bottom', 'w')})
    labels = [dict(text=r['nome'], x=r['x'], z=r['z'], region=i) for i, r in enumerate(D.REGIONS)
              if not r.get('hidden')]
    meta = dict(
        version=1,
        ws=G.ws, cloudY=D.CLOUD_Y, oob=7700,
        raster=dict(file='world5.bin', n=G.n, n2=R.shape[0], cell=G.cell, cell2=G.cell * (G.n - 1) / (R.shape[0] - 1),
                    origin=-G.ws, hScale=H_SCALE, hOff=H_OFF, header=16, sections=sections,
                    note='rows = z (north first), columns = x; height = u16 * hScale + hOff; masks u8 / 255'),
        regions=[dict(id=r['id'], nome=r['nome'], x=r['x'], z=r['z'], hidden=bool(r.get('hidden', False)))
                 for r in D.REGIONS],
        palette=D.PALETTE, sand=D.SAND, dirt=D.DIRT, snow=D.SNOW, sea=list(D.SEA),
        mist=D.MIST,
        spawn=spawn,
        lakes=[dict(id=l['id'], level=l['level'], x=r1(l['x']), z=r1(l['z']), bbox=[r1(v) for v in l['bbox']],
                    hot=l['hot']) for l in lakes],
        rivers=[river_json(rv) for rv in rivs],
        falls=falls,
        roads=[road_json(rd) for rd in roads],
        pois=pois,
        labels=labels,
    )
    # crossings: road/river fords and plank bridges {kind, x, z, y (road/deck), surf, ry, len, w, rw};
    # slots: narrow clefts cut at runtime {x, z, ux, uz (long axis), hl, hw, y (bottom)};
    # pads: extra flat discs [x, z, r, y] (rope-bridge anchors)
    meta.update(extra or {})
    js = json.dumps(meta, separators=(',', ':'), ensure_ascii=False)
    with open(os.path.join(out_dir, 'world5.json'), 'w', encoding='utf-8') as f:
        f.write(js)
    log('wrote world5.bin %.2f MB, world5.json %.0f KB, b64 %.2f MB' % (
        len(data) / 1e6, len(js.encode()) / 1e3, os.path.getsize(os.path.join(out_dir, 'world5.b64.json')) / 1e6))
