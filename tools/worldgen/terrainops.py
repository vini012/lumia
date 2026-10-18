"""Height-field construction primitives (tables, canyons, ramps, lakes) on the macro grid."""
import os
import zlib
import hashlib
import numpy as np
from wnoise import fbm, ridged, sstep, poly_sdf, polyline_dist, seg_dist, chaikin


class Grid:
    def __init__(self, n=1025, ws=8000.0):
        self.n = n
        self.ws = ws
        self.cell = 2 * ws / (n - 1)
        a = -ws + np.arange(n) * self.cell
        self.X, self.Z = np.meshgrid(a, a)  # rows = z (north at row 0), cols = x
        self.axis = a

    def window(self, x0, z0, x1, z1):
        c = self.cell
        i0 = max(0, int(np.floor((x0 + self.ws) / c)))
        i1 = min(self.n, int(np.ceil((x1 + self.ws) / c)) + 1)
        j0 = max(0, int(np.floor((z0 + self.ws) / c)))
        j1 = min(self.n, int(np.ceil((z1 + self.ws) / c)) + 1)
        return slice(j0, j1), slice(i0, i1)


def warp_coords(X, Z, amp, freq, seed, second=True):
    if amp <= 0:
        return X, Z
    wx = X + (fbm(X * freq + 3.1, Z * freq - 1.7, 3, seed + 1) - .5) * 2 * amp
    wz = Z + (fbm(X * freq - 7.3, Z * freq + 5.2, 3, seed + 2) - .5) * 2 * amp
    if second:
        f2 = freq * 3.7
        a2 = amp * 0.32
        wx2 = wx + (fbm(X * f2 - 1.3, Z * f2 + 4.4, 2, seed + 3) - .5) * 2 * a2
        wz2 = wz + (fbm(X * f2 + 6.1, Z * f2 - 2.9, 2, seed + 4) - .5) * 2 * a2
        return wx2, wz2
    return wx, wz


def shape_sdf(shape, X, Z):
    if isinstance(shape, tuple) and shape[0] == 'circle':
        _, x, z, r = shape
        return np.hypot(X - x, Z - z) - r
    return poly_sdf(X, Z, chaikin(shape, 2, closed=True))


def shape_bbox(shape):
    if isinstance(shape, tuple) and shape[0] == 'circle':
        _, x, z, r = shape
        return x - r, z - r, x + r, z + r
    p = np.asarray(shape)
    return p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max()


def cliff_drop(s, k, D1, W1, D2=None, W2=None):
    """drop below the top as a function of the outward distance s>=0: steep faces separated by ledges."""
    s = np.maximum(s, 0)
    s1 = D1 / k
    out = np.where(s < s1, k * s, D1 + (s - s1) * 0.12)
    s2 = s1 + W1
    if D2 is None:
        return np.where(s < s2, out, D1 + W1 * 0.12 + (s - s2) * k)
    base2 = D1 + W1 * 0.12
    s3 = s2 + np.maximum(D2 - base2, 0) / k
    out = np.where(s < s2, out, np.where(s < s3, base2 + (s - s2) * k, D2 + (s - s3) * 0.12))
    s4 = s3 + W2
    return np.where(s < s4, out, D2 + W2 * 0.12 + (s - s4) * k)


def table_field(G, t, floor):
    """returns (window, f, sdf) with f = the table's surface (top minus edge drop) inside its window."""
    edge = t.get('edge', 'cliff')
    h = t['h']
    k = t.get('k', 11)
    x0, z0, x1, z1 = shape_bbox(t['poly'])
    warp = t.get('warp', (0, 0))
    ca = t.get('coast', (0, 0))[0] * 1.3
    if edge == 'slope':
        margin = min(3600, (h - floor) / t.get('tan', 0.1) + warp[0] * 2 + 100 + ca)
    else:
        margin = (h - floor) / k + 140 + warp[0] * 2 + 60 + ca
        for sz in t.get('soft', []):
            margin = max(margin, min(2600, (h - floor) / sz[3] * 0.8))
    wj, wi = G.window(x0 - margin, z0 - margin, x1 + margin, z1 + margin)
    X = G.X[wj, wi]
    Z = G.Z[wj, wi]
    sd = t.get('seed', 0)
    wx, wz = warp_coords(X, Z, warp[0], warp[1], sd)
    s = shape_sdf(t['poly'], wx, wz)
    jag = t.get('jag', 0)
    if jag:
        s = s + (fbm(X / 70. + 11, Z / 70. - 4, 3, sd + 7) - .5) * 2 * jag
    # fractal coastline: spurs (fingers) along ridged-noise lines and narrow bays cut into the edge
    fing = t.get('fingers', 0)
    bays = t.get('bays', 0)
    if fing or bays:
        band = 1 - sstep(max(fing, bays) * 0.8, max(fing, bays) * 2.2, np.abs(s))
        for (cx, cz, cr) in t.get('nofinger', []):
            band = band * sstep(cr * 0.6, cr, np.hypot(X - cx, Z - cz))
        if fing:
            r1 = ridged(X / 650. + 13.7, Z / 650. - 2.1, 3, sd + 51)
            s = s - fing * sstep(0.5, 0.9, r1) * band
        if bays:
            r2 = ridged(X / 480. - 8.3, Z / 480. + 6.6, 3, sd + 53)
            s = s + bays * sstep(0.58, 0.92, r2) * band
    s = s + (fbm(X / 330. - 3, Z / 330. + 1, 2, sd + 9) - .5) * 2 * t.get('wob', 0)
    ca, cl = t.get('coast', (0, 0))
    if ca:
        cw = np.ones_like(s)
        for (cx, cz, cr) in t.get('calm', []):
            cw = np.minimum(cw, sstep(cr * 0.55, cr, np.hypot(X - cx, Z - cz)))
        n = fbm(X / cl + 31.1, Z / cl - 17.7, 5, sd + 61, gain=0.52) - .5
        s = s + n / 0.125 * ca * cw
    # top surface
    gx, gz = t.get('grad', (0, 0))
    gref = t.get('gref', ((x0 + x1) / 2, (z0 + z1) / 2))
    # the tilt plane is clamped to its range over the shape's bbox, so a tilted table never rises again
    # outside its own footprint (that produced seams at the window borders)
    tilt = gx * (X - gref[0]) + gz * (Z - gref[1])
    cv = [gx * (cx - gref[0]) + gz * (cz - gref[1]) for cx in (x0, x1) for cz in (z0, z1)]
    top = h + np.clip(tilt, min(cv), max(cv))
    a1 = t.get('amp1', 0)
    a2 = t.get('amp2', 0)
    if a1:
        top = top + (fbm(X / 1700. + 5, Z / 1700. - 3, 3, sd + 11) - .5) * 2 * a1
    if a2:
        top = top + (fbm(X / 430. - 2, Z / 430. + 8, 3, sd + 13) - .5) * 2 * a2
    for (bx, bz, br, dh) in t.get('bumps', []):
        d = np.hypot(X - bx, Z - bz)
        top = top + dh * (1 - sstep(0, br, d)) ** 1.15
    for st in t.get('steps', []):
        sx, sz, sr, dh = st[:4]
        k2 = st[4] if len(st) > 4 else 7.0
        qx, qz = warp_coords(X, Z, sr * 0.45, 1 / (sr * 1.6), (int(sx * 7 + sz * 3) & 1023) + sd)
        ss = np.hypot(qx - sx, qz - sz) - sr + (fbm(X / 50., Z / 50., 2, sd + 31) - .5) * 14
        v = np.clip(-ss * k2, 0, abs(dh))
        top = top + np.sign(dh) * v
    for (px, pz, pr, dh) in t.get('peaks', []):
        d = np.hypot(X - px, Z - pz)
        tt = np.clip(1 - d / pr, 0, 1)
        rid = ridged(X / 520. + px * .001, Z / 520., 4, sd + 17)
        prof = tt ** 1.5 * (0.55 + 0.6 * rid) + 0.12 * tt ** 6
        top = top + dh * prof
    for (rp, rw, dh) in t.get('ridges', []):
        q = np.asarray(rp, dtype=np.float64)
        rx, rz = warp_coords(X, Z, rw * 0.35, 1 / (rw * 1.3), sd + 77)
        d, along, total = polyline_dist(rx, rz, q)
        tt = np.clip(1 - d / rw, 0, 1)
        crest = 0.7 + 0.3 * np.sin(along / total * np.pi) + (fbm(along / 600., d * 0 + 3.3, 3, sd + 79) - .5) * 0.7
        rid = ridged(X / 380. + 2.2, Z / 380. - 1.1, 4, sd + 81)
        prof = tt ** 1.25 * (0.75 + 0.35 * rid)
        top = top + dh * np.clip(crest, 0.25, 1.2) * prof
    # edge profile
    if edge == 'slope':
        tn = t.get('tan', 0.1)
        R = 40.0
        drop = tn * (np.sqrt(np.maximum(s, 0) ** 2 + R * R) - R)
    else:
        kk = k * (0.8 + 0.45 * fbm(X / 260. + 1, Z / 260. + 2, 2, sd + 21))
        lf = t.get('ledge', 0.0)
        nl = t.get('ledges', 1)
        n1 = fbm(X / 340. + 7, Z / 340. - 7, 2, sd + 23)
        n2 = fbm(X / 210. - 5, Z / 210. + 3, 2, sd + 25)
        D1 = 45 + 110 * n1
        W1 = np.clip((n2 - (1 - lf)) * 3.0, 0, 1) * 34
        if nl >= 2:
            D2 = D1 + 60 + 60 * n2
            W2 = np.clip((n1 - (1 - lf)) * 3.0, 0, 1) * 26
            drop = cliff_drop(s, kk, D1, W1, D2, W2)
        else:
            drop = cliff_drop(s, kk, D1, W1)
        if t.get('soft'):
            ws = np.zeros_like(s)
            slope = np.zeros_like(s)
            for (sx, szz, sr, stn) in t['soft']:
                w = 1 - sstep(sr * 0.35, sr, np.hypot(X - sx, Z - szz) + (fbm(X / 300., Z / 300., 2, sd + 41) - .5) * sr * 0.5)
                m = w > ws
                slope = np.where(m, stn, slope)
                ws = np.maximum(ws, w)
            R = 50.0
            sd2 = slope * (np.sqrt(np.maximum(s, 0) ** 2 + R * R) - R)
            drop = drop * (1 - ws) + sd2 * ws
    f = top - drop
    # safety taper: the field must reach the floor at its window border (except at the world edge)
    nj, ni = f.shape
    jj = np.arange(nj)[:, None]
    ii = np.arange(ni)[None, :]
    big = 1e9
    dj0 = jj if wj.start > 0 else big
    dj1 = (nj - 1 - jj) if wj.stop < G.n else big
    di0 = ii if wi.start > 0 else big
    di1 = (ni - 1 - ii) if wi.stop < G.n else big
    db = np.minimum(np.minimum(dj0, dj1), np.minimum(di0, di1)) * G.cell
    f = np.minimum(f, floor + db * 6.0)
    return (wj, wi), f, s, top


def _src_hash():
    h = hashlib.sha1()
    here = os.path.dirname(os.path.abspath(__file__))
    for fn in ('terrainops.py', 'wnoise.py'):
        h.update(open(os.path.join(here, fn), 'rb').read())
    return h.hexdigest()


def cached_table(G, t, floor, cache_dir):
    key = hashlib.sha1((repr(sorted(t.items(), key=lambda kv: kv[0])) + _src_hash() + '%d/%g/%g' % (
        G.n, G.ws, floor)).encode()).hexdigest()[:20]
    fn = os.path.join(cache_dir, t['id'].replace(':', '_') + '_' + key + '.npz') if cache_dir else None
    if fn and os.path.exists(fn):
        z = np.load(fn)
        j0, j1, i0, i1 = [int(v) for v in z['win']]
        return (slice(j0, j1), slice(i0, i1)), z['f'].astype(np.float64), z['s'].astype(np.float64)
    (wj, wi), f, s, top = table_field(G, t, floor)
    f = f.astype(np.float32)
    s = s.astype(np.float32)
    if fn:
        os.makedirs(cache_dir, exist_ok=True)
        np.savez(fn, f=f, s=s, win=np.array([wj.start, wj.stop, wi.start, wi.stop]))
    return (wj, wi), f.astype(np.float64), s.astype(np.float64)


def apply_tables(G, H, tables, floor, owner=None, cache_dir=None):
    """max-composite every table; owner (int16 grid) records which table index won each cell."""
    info = {}
    for ti, t in enumerate(tables):
        (wj, wi), f, s = cached_table(G, t, floor, cache_dir)
        cur = H[wj, wi]
        if owner is not None:
            win = f > cur
            o = owner[wj, wi]
            o[win] = ti
            owner[wj, wi] = o
        H[wj, wi] = np.maximum(cur, f)
        info[t['id']] = ((wj, wi), s)
    return info


def apply_canyons(G, H, canyons, bridges, floor):
    BR = np.zeros(H.shape)
    for (ax, az, bx, bz, w) in bridges:
        wj, wi = G.window(min(ax, bx) - w, min(az, bz) - w, max(ax, bx) + w, max(az, bz) + w)
        d, _ = seg_dist(G.X[wj, wi], G.Z[wj, wi], ax, az, bx, bz)
        BR[wj, wi] = np.maximum(BR[wj, wi], 1 - sstep(w / 2 - 4, w / 2 + 6, d))
    for c in canyons:
        p = np.asarray(c['pts'], dtype=float)
        wmax = max(c['w']) * 1.4 + 600
        wj, wi = G.window(p[:, 0].min() - wmax, p[:, 1].min() - wmax, p[:, 0].max() + wmax, p[:, 1].max() + wmax)
        X = G.X[wj, wi]
        Z = G.Z[wj, wi]
        sd = c.get('seed', 0)
        wx, wz = warp_coords(X, Z, 70, 1 / 600., sd)
        d, along, total = polyline_dist(wx, wz, p)
        tt = along / max(total, 1)
        w = c['w'][0] + (c['w'][1] - c['w'][0]) * tt
        w = w * (0.78 + 0.44 * fbm(X / 300., Z / 300., 2, sd + 3))
        fl = c['floor']
        if isinstance(fl, tuple):
            fl = fl[0] + (fl[1] - fl[0]) * tt
        s = d - w / 2 + (fbm(X / 60., Z / 60., 2, sd + 5) - .5) * 16
        k = c.get('k', 12) * (0.8 + 0.4 * fbm(X / 240., Z / 240., 2, sd + 7))
        if c.get('ledge'):
            n1 = fbm(X / 300. + 3, Z / 300., 2, sd + 9)
            n2 = fbm(X / 200., Z / 200. + 5, 2, sd + 11)
            # walls with ledges seen from the floor: invert the cliff profile
            W1 = np.clip((n2 - (1 - c['ledge'])) * 3.0, 0, 1) * 30
            hc = fl + rise_profile(np.maximum(s, 0), k, 60 + 120 * n1, W1)
        else:
            hc = fl + k * np.maximum(s, 0)
        new = np.minimum(H[wj, wi], hc)
        b = BR[wj, wi]
        H[wj, wi] = new * (1 - b) + H[wj, wi] * b
    return BR


def rise_profile(s, k, D1, W1):
    s1 = D1 / k
    return np.where(s < s1, k * s, np.where(s < s1 + W1, D1 + (s - s1) * 0.12, D1 + W1 * 0.12 + (s - s1 - W1) * k))


def ramp_ends(G, H, r):
    def pct(x, z, q):
        wj, wi = G.window(x - 60, z - 60, x + 60, z + 60)
        return float(np.percentile(H[wj, wi], q))
    lo = pct(r['lo'][0], r['lo'][1], 30)
    hi = pct(r['hi'][0], r['hi'][1], 70)
    return lo, hi


def apply_ramps(G, H, ramps, log=None):
    for r in ramps:
        pts = [r['lo']] + list(r.get('via', [])) + [r['hi']]
        p = np.asarray(pts, dtype=float)
        acc = np.concatenate([[0], np.cumsum(np.hypot(np.diff(p[:, 0]), np.diff(p[:, 1])))])
        lo, hi = ramp_ends(G, H, r)
        hs = lo + (hi - lo) * acc / acc[-1]
        r['resolved'] = [round(float(lo), 1), round(float(hi), 1), round(float((hi - lo) / acc[-1]), 3)]
        if log:
            log('ramp %s %.0f -> %.0f grade %.2f' % (r['id'], lo, hi, (hi - lo) / acc[-1]))
        w = r['w']
        kc = r.get('cut_k', 2.2)
        kf = r.get('fill_k', 1.1)
        m = 420
        wj, wi = G.window(p[:, 0].min() - m, p[:, 1].min() - m, p[:, 0].max() + m, p[:, 1].max() + m)
        X = G.X[wj, wi]
        Z = G.Z[wj, wi]
        d, along, total = polyline_dist(X, Z, p)
        y = np.interp(along, acc, hs)
        e = np.maximum(d - w / 2, 0)
        h = H[wj, wi]
        new = np.clip(h, y - e * kf, y + e * kc)
        # beyond the ends the corridor fades out
        endd = np.where(along <= 0.01, d, np.where(along >= total - 0.01, d, 0))
        fade = 1 - sstep(0, 60, endd)
        H[wj, wi] = h + (new - h) * fade


def lake_sdf(G, lk, X, Z):
    sd = zlib.crc32(lk['id'].encode()) % 1000
    if 'poly' in lk:
        wx, wz = warp_coords(X, Z, 60, 1 / 500., sd)
        return poly_sdf(wx, wz, lk['poly'])
    c = np.cos(lk.get('rot', 0))
    s = np.sin(lk.get('rot', 0))
    wx, wz = warp_coords(X, Z, min(lk['rx'], lk['rz']) * 0.25, 1 / (lk['rx'] * 1.5), sd)
    dx = wx - lk['x']
    dz = wz - lk['z']
    lx = dx * c + dz * s
    lz = -dx * s + dz * c
    q = np.hypot(lx / lk['rx'], lz / lk['rz'])
    return (q - 1) * min(lk['rx'], lk['rz'])


def lake_bbox(lk):
    if 'poly' in lk:
        p = np.asarray(lk['poly'])
        return p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max()
    r = max(lk['rx'], lk['rz'])
    return lk['x'] - r, lk['z'] - r, lk['x'] + r, lk['z'] + r
