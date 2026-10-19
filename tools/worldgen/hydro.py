"""Lakes (basins with fixed levels), rivers (surface profiles at altitude) and waterfall detection."""
import numpy as np
from wnoise import sstep, chaikin, resample, bilinear, polyline_dist, fbm
from terrainops import lake_sdf, lake_bbox


def apply_lakes(G, H, lakes, log=print):
    """carves every lake basin; returns per-lake records and the coarse lake-id raster source (sdf per lake)."""
    out = []
    for i, lk in enumerate(lakes):
        x0, z0, x1, z1 = lake_bbox(lk)
        m = 160
        wj, wi = G.window(x0 - m, z0 - m, x1 + m, z1 + m)
        X = G.X[wj, wi]
        Z = G.Z[wj, wi]
        s = lake_sdf(G, lk, X, Z)
        h = H[wj, wi].copy()
        level = lk.get('level')
        if level is None:
            ring = (s > 8) & (s < 70)
            inner = s < 0
            level = min(float(np.percentile(h[inner], 30)), float(np.percentile(h[ring], 50))) - 1.4
        level = float(level)
        rmin = max(12.0, float(-s.min()))
        depth = lk.get('depth', 5)
        bed = level - 0.5 - depth * sstep(0, min(rmin * 0.7, 120), -s)
        h = np.where(s < 0, np.minimum(h, bed), h)
        # gentle shore just outside the waterline, and a levee so the flat water never shows over lower ground
        shore = level + 0.35 + np.maximum(s, 0) * 0.14
        band = (s >= 0) & (s < 45)
        h = np.where(band, np.minimum(h, shore), h)
        lev = (s >= 0) & (s < 75)
        h = np.where(lev, np.maximum(h, level + 0.3 + np.maximum(s - 2, 0) * 0.05), h)
        H[wj, wi] = h
        out.append(dict(id=lk['id'], level=round(level, 2), x=float(lk.get('x', (x0 + x1) / 2)),
                        z=float(lk.get('z', (z0 + z1) / 2)), hot=bool(lk.get('hot', False)),
                        bbox=[float(x0), float(z0), float(x1), float(z1)], win=(wj, wi), sdf=s))
        log('lake', lk['id'], 'level %.1f' % level)
    return out


def river_line(rv):
    p = chaikin(rv['pts'], 3)
    return resample(p, 10.0)


def river_profiles(G, H, rivers, lakes, cloud_y, floor, log=print):
    """surface heights along each river, split into reaches (constant-ish slope) and falls (vertical drops)."""
    lk_by_id = {l['id']: l for l in lakes}
    res = []
    for rv in rivers:
        P = river_line(rv)
        n = len(P)
        g = bilinear(H, P[:, 0], P[:, 1], -G.ws, G.cell)
        # lowest terrain in a small cross-section (so a line that grazes a bank does not float)
        d = np.diff(P, axis=0)
        d = np.vstack([d, d[-1:]])
        nrm = np.stack([-d[:, 1], d[:, 0]], 1) / (np.hypot(d[:, 0], d[:, 1])[:, None] + 1e-9)
        for off in (-8.0, 8.0):
            q = P + nrm * off
            g = np.minimum(g, bilinear(H, q[:, 0], q[:, 1], -G.ws, G.cell) + 1.0)
        t = g - 1.2
        src = rv.get('src')
        if src and src in lk_by_id:
            lv = lk_by_id[src]['level']
            i = 0
            while i < n and g[i] < lv + 0.6:
                t[i] = lv
                i += 1
            t = np.minimum(t, lv)
        s = fit_surface(t)
        end_lake = rv.get('lake')
        if end_lake and end_lake in lk_by_id:
            s = np.maximum(s, lk_by_id[end_lake]['level'])
        s = np.maximum(s, 0.0)
        # steep samples (drop > 2.2 m per 10 m) form fall zones
        drop = np.concatenate([[0], s[:-1] - s[1:]])
        steep = drop > 2.2
        falls = []
        i = 1
        while i < n:
            if steep[i]:
                a = i - 1
                b = i
                while b + 1 < n and (steep[b + 1] or (b + 2 < n and steep[b + 2] and s[b] - s[b + 2] > 3)):
                    b += 1
                top = s[a]
                bot = s[b]
                if top - bot >= 7.0:
                    falls.append([a, b])
                i = b + 1
            else:
                i += 1
        # reaches between falls: smooth monotone surface
        sm = s.copy()
        bounds = [0] + [x for f in falls for x in f] + [n - 1]
        for k in range(0, len(bounds), 2):
            a, b = bounds[k], bounds[k + 1]
            if b - a < 3:
                continue
            seg = sm[a:b + 1]
            for _ in range(6):
                t = seg.copy()
                t[1:-1] = (seg[:-2] + seg[1:-1] * 2 + seg[2:]) / 4
                seg = np.minimum(t, s[a:b + 1])
            seg = np.minimum.accumulate(seg)
            sm[a:b + 1] = seg
        # the river ends in the cloud sea: let the last fall go below the cloud deck
        ends_in_cloud = bool(g[-1] < cloud_y and not end_lake and g[-1] > 2.0)
        w0, w1 = rv['w']
        W = w0 + (w1 - w0) * np.linspace(0, 1, n)
        fl = []
        for a, b in falls:
            top = float(sm[a])
            bot = float(sm[b])
            if b == n - 1 and ends_in_cloud:
                bot = min(bot, cloud_y - 25)
            dx, dz = P[min(b, a + 2)] - P[a]
            L = float(np.hypot(dx, dz)) + 1e-9
            fl.append(dict(x=round(float(P[a, 0]), 1), z=round(float(P[a, 1]), 1), dx=round(dx / L, 4),
                           dz=round(dz / L, 4), top=round(top, 2), bottom=round(bot, 2),
                           w=round(float(W[a]) * 1.25, 1), river=rv['id'], ia=int(a), ib=int(b)))
        res.append(dict(id=rv['id'], P=P, s=sm, W=W, falls=fl, ends_in_cloud=ends_in_cloud, g=g))
        fz = fall_mask(res[-1])
        dev = (g - 1.2 - sm)[~fz] if (~fz).any() else np.zeros(1)
        log('river', rv['id'], 'len %.0f m' % (n * 10), 'surf %.0f->%.0f' % (sm[0], sm[-1]),
            'falls', [(round(f['top']), round(f['bottom'])) for f in fl], 'cut %.0f fill %.0f' % (dev.max(), -dev.min()))
    return res


def pav_dec(y):
    """least-squares non-increasing fit (pool-adjacent-violators)."""
    sums, cnts = [], []
    for v in y:
        sums.append(float(v))
        cnts.append(1)
        while len(sums) > 1 and sums[-2] / cnts[-2] < sums[-1] / cnts[-1]:
            s1 = sums.pop()
            c1 = cnts.pop()
            sums[-1] += s1
            cnts[-1] += c1
    out = np.empty(len(y))
    k = 0
    for sm, c in zip(sums, cnts):
        out[k:k + c] = sm / c
        k += c
    return out


def fit_surface(t, max_fill=7.0):
    """monotone river surface close to the terrain: cuts through bumps, fills dips by at most max_fill."""
    s = pav_dec(t)
    s = np.minimum(s, t + max_fill)
    return np.minimum.accumulate(s)


def fall_mask(r):
    """boolean per sample: True inside a fall zone."""
    m = np.zeros(len(r['P']), bool)
    for f in r['falls']:
        m[f['ia']:f['ib'] + 1] = True
    return m


def carve_rivers(G, H, rivs):
    """macro valley along each reach so that coarse meshes still show the water."""
    for r in rivs:
        P = r['P']
        fm = fall_mask(r)
        # split into reaches (runs of non-fall samples)
        runs = []
        a = None
        for i in range(len(P)):
            if not fm[i] and a is None:
                a = i
            if (fm[i] or i == len(P) - 1) and a is not None:
                b = i if not fm[i] else i - 1
                if b - a >= 1:
                    runs.append((a, b))
                a = None
        for a, b in runs:
            Q = P[a:b + 1]
            S = r['s'][a:b + 1]
            W = r['W'][a:b + 1]
            m = 420
            wj, wi = G.window(Q[:, 0].min() - m, Q[:, 1].min() - m, Q[:, 0].max() + m, Q[:, 1].max() + m)
            X = G.X[wj, wi]
            Z = G.Z[wj, wi]
            d, along, total = polyline_dist(X, Z, Q)
            k = np.clip((along / 10.0).astype(int), 0, len(Q) - 1)
            s = S[k]
            w = W[k]
            # bank profile: a gentle 60 m shoulder, then steeper walls, so a reach far below the land around it
            # (e.g. below a fall) cuts a gorge, never a window-shaped trench
            e = np.maximum(0, d - w / 2 - 4)
            cut = s - 1.0 + 0.13 * np.minimum(e, 60) + 0.8 * np.clip(e - 60, 0, 120) + 3.0 * np.maximum(e - 180, 0)
            # beyond the ends of a reach (round caps: a lip, a fall foot, a lake or the sea) only the channel is cut,
            # otherwise the cap cone would bite a notch into the cliff the river falls from
            cap = (along <= 0.5) | (along >= total - 0.5)
            cut = np.where(cap & (e > 0), 1e9, cut)
            h = H[wj, wi]
            h = np.minimum(h, cut)
            fill = s + 0.4 - np.maximum(0, d - w / 2 - 10) * 0.35
            bank = (d > w / 2 + 4) & (d < w / 2 + 40)
            h = np.where(bank, np.maximum(h, fill), h)
            H[wj, wi] = h


def lake_id_raster(G, lakes, n2, margin=30.0):
    """coarse (n2 x n2) raster: lake index + 1 where the lake (plus a margin) covers the cell."""
    out = np.zeros((n2, n2), np.uint8)
    step = (G.n - 1) // (n2 - 1)
    for i, lk in enumerate(lakes):
        wj, wi = lk['win']
        s = lk['sdf']
        cov = s < margin
        jj, ii = np.nonzero(cov)
        jj = (jj + wj.start) // step
        ii = (ii + wi.start) // step
        jj = np.clip(jj, 0, n2 - 1)
        ii = np.clip(ii, 0, n2 - 1)
        out[jj, ii] = i + 1
    return out
