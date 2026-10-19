"""Points of interest (fixed + generic), their flat pads, and the road network (A* in Node, then smoothing)."""
import os
import zlib
import json
import subprocess
import numpy as np
from wnoise import sstep, chaikin, resample, bilinear, polyline_dist, dilate_max, fbm

HERE = os.path.dirname(os.path.abspath(__file__))


class Field:
    """helpers over the macro grid."""

    def __init__(self, G, H, R, lake_ids, cloud, mist):
        self.G = G
        self.H = H
        self.R = R  # coarse region raster
        self.L = lake_ids
        self.cloud = cloud
        self.mist = mist
        self.step = (G.n - 1) // (R.shape[0] - 1)
        gz, gx = np.gradient(H, G.cell)
        self.slope = np.hypot(gx, gz)
        # local relief (max-min in a 5x5 window): cliff proximity
        self.relief = dilate_max(H, 2) - (-dilate_max(-H, 2))

    def h(self, x, z):
        return float(bilinear(self.H, np.array([x]), np.array([z]), -self.G.ws, self.G.cell)[0])

    def ij(self, x, z):
        c = self.G.cell
        return int(round((z + self.G.ws) / c)), int(round((x + self.G.ws) / c))

    def coarse(self, A, x, z):
        c = self.G.cell * self.step
        n = A.shape[0]
        j = min(n - 1, max(0, int(round((z + self.G.ws) / c))))
        i = min(n - 1, max(0, int(round((x + self.G.ws) / c))))
        return A[j, i]

    def region(self, x, z):
        return int(self.coarse(self.R, x, z))

    def pad_stats(self, x, z, r):
        """height spread inside the pad, max slope, mean height."""
        rr = max(r, 6.0)
        k = np.linspace(-1, 1, 5)
        px = (x + np.outer(np.ones(5), k) * rr).ravel()
        pz = (z + np.outer(k, np.ones(5)) * rr).ravel()
        m = (np.hypot(px - x, pz - z) <= rr * 1.01)
        hs = bilinear(self.H, px[m], pz[m], -self.G.ws, self.G.cell)
        return float(hs.max() - hs.min()), float(np.median(hs))

    def in_mist(self, x, z, pad=0.0):
        return np.hypot(x - self.mist['x'], z - self.mist['z']) < self.mist['r'] + pad


def settle(F, D, pid, kind, x, z, r, opt, placed, lakes, rivs, cloud_y):
    """move a fixed POI to the best nearby spot (flattest, dry, above the clouds) unless exact."""
    if opt.get('exact') or opt.get('search', 90) == 0:
        y = F.h(x, z)
        if r > 0:
            y = F.pad_stats(x, z, r)[1]
        return x, z, y
    sr = opt.get('search', 90)
    want_reg = F.region(x, z)
    best = None
    R = np.random.RandomState(zlib.crc32(pid.encode()) % (2 ** 31))
    cands = [(x, z)] + [(x + R.uniform(-sr, sr), z + R.uniform(-sr, sr)) for _ in range(160)]
    for (cx, cz) in cands:
        if np.hypot(cx - x, cz - z) > sr:
            continue
        hh = F.h(cx, cz)
        spread, med = F.pad_stats(cx, cz, max(r, 4))
        cost = spread * 2.0 + np.hypot(cx - x, cz - z) / sr * 3.0
        cl = F.coarse(F.cloud, cx, cz)
        if opt.get('underwater'):
            cost = abs(hh + 4.0) + np.hypot(cx - x, cz - z) / sr
            if hh > -1.5:
                cost += 100
        else:
            if hh < cloud_y + 4 and cl > 0.3:
                cost += 100
            if hh < 0.8:
                cost += 100
            lid = int(F.coarse(F.L, cx, cz))
            if lid and hh < lakes[lid - 1]['level'] + 0.6:
                cost += 100
            if F.relief[F.ij(cx, cz)] > 30 and not opt.get('foot_of'):
                cost += 6
        if opt.get('shore'):
            # wants water within ~25 m
            near = False
            for a in np.linspace(0, 2 * np.pi, 10, endpoint=False):
                qx, qz = cx + np.cos(a) * 22, cz + np.sin(a) * 22
                hq = F.h(qx, qz)
                lid = int(F.coarse(F.L, qx, qz))
                if hq < 0.2 or (lid and hq < lakes[lid - 1]['level']):
                    near = True
                    break
            if not near:
                cost += 8
        if opt.get('highest'):
            cost -= hh * 0.05
        if F.region(cx, cz) != want_reg and not opt.get('islet'):
            cost += 20
        if any(np.hypot(cx - p['x'], cz - p['z']) < (p['r'] + r + 6) for p in placed):
            cost += 30
        if best is None or cost < best[0]:
            best = (cost, cx, cz, med if r > 0 else hh)
    return best[1], best[2], best[3]


def place_fixed(F, D, lakes, rivs, cloud_y, log=print):
    out = []
    for (pid, kind, x, z, r, opt) in D.POIS:
        if opt.get('foot_of'):
            rv = [q for q in rivs if q['id'] == opt['foot_of']][0]
            if rv['falls']:
                f = rv['falls'][-1]
                ib = f['ib']
                x, z = float(rv['P'][min(ib + 3, len(rv['P']) - 1)][0]), float(rv['P'][min(ib + 3, len(rv['P']) - 1)][1])
                # beside the plunge pool, not in it
                x += -f['dz'] * 30
                z += f['dx'] * 30
        if opt.get('span'):
            c = [q for q in D.CANYONS if q['id'] == opt['span']][0]
            p = np.asarray(c['pts'], float)
            # middle of the canyon polyline, or the segment nearest to opt['at']
            k = len(p) // 2
            x, z = float((p[k - 1][0] + p[k][0]) / 2), float((p[k - 1][1] + p[k][1]) / 2)
            if opt.get('at'):
                x, z = map(float, opt['at'])
                k = 1 + int(np.argmin([np.hypot((p[q][0] + p[q + 1][0]) / 2 - x, (p[q][1] + p[q + 1][1]) / 2 - z)
                                       for q in range(len(p) - 1)]))
            dx, dz = p[k] - p[k - 1]
            opt = dict(opt, ry=float(np.arctan2(dz, dx)))  # bridge runs across the canyon
            # rim height: highest ground 150 m to either side
            nx, nz = -dz / np.hypot(dx, dz), dx / np.hypot(dx, dz)
            ends = []
            for sgn in (-1, 1):
                d = 20.0
                while d < 400 and F.h(x + nx * sgn * d, z + nz * sgn * d) < 300:
                    d += 4.0
                # past the rounded lip: walk on until the ground is gentle
                while d < 460 and (F.h(x + nx * sgn * (d + 4), z + nz * sgn * (d + 4)) -
                                   F.h(x + nx * sgn * d, z + nz * sgn * d)) / 4.0 > 0.3:
                    d += 4.0
                ends.append((x + nx * sgn * (d + 6), z + nz * sgn * (d + 6)))
            (ax, az), (bx, bz) = ends
            ya, yb = F.h(ax, az), F.h(bx, bz)
            x, z = (ax + bx) / 2, (az + bz) / 2
            out.append(dict(id=pid, kind=kind, x=round(x, 1), z=round(z, 1), y=round(float(min(ya, yb)), 2),
                            ry=round(opt['ry'], 4), r=0, flat=0, span=round(float(np.hypot(bx - ax, bz - az)), 1),
                            x0=round(ax, 1), z0=round(az, 1), y0=round(ya, 2), x1=round(bx, 1), z1=round(bz, 1),
                            y1=round(yb, 2)))
            continue
        sx, sz, y = settle(F, D, pid, kind, x, z, r, opt, out, lakes, rivs, cloud_y)
        out.append(dict(id=pid, kind=kind, x=round(float(sx), 1), z=round(float(sz), 1), y=round(float(y), 2),
                        ry=round(float(opt.get('ry', 0.0)), 4), r=float(r), flat=float(r if r > 0 else 0)))
    # the Annecy viewpoint (generic id, fixed spot)
    a = D.ANNECY
    sx, sz, y = settle(F, D, 'p_annecy', 'viewpoint', a['x'], a['z'], 5, dict(search=80), out, lakes, rivs, cloud_y)
    out.append(dict(id='p_annecy', kind='viewpoint', x=round(sx, 1), z=round(sz, 1), y=round(y, 2),
                    ry=round(float(np.arctan2(a['look'][0] - sx, a['look'][1] - sz)), 4), r=5.0, flat=5.0))
    for p in out:
        p['region'] = F.region(p['x'], p['z'])
    log('fixed POIs', len(out))
    return out


def place_generic(F, D, fixed, lakes, rivs, cloud_y, log=print, walk=None):
    out = []
    allp = list(fixed)
    G = F.G
    rng = np.random.RandomState(4242)
    step = F.step
    n2 = F.R.shape[0]
    cc = G.cell * step
    for reg, kinds in enumerate(D.GENERIC):
        js, is_ = np.nonzero(F.R == reg)
        n_ok = 0
        for kind in kinds:
            placed = False
            for attempt in range(900):
                k = rng.randint(len(js))
                x = -G.ws + is_[k] * cc + rng.uniform(-cc / 2, cc / 2)
                z = -G.ws + js[k] * cc + rng.uniform(-cc / 2, cc / 2)
                if abs(x) > 7500 or abs(z) > 7500:
                    continue
                hh = F.h(x, z)
                if hh < cloud_y + 6 and F.coarse(F.cloud, x, z) > 0.3:
                    continue
                if hh < 1.5:
                    continue
                if reg == 15 and not F.in_mist(x, z, -150):
                    continue
                if reg != 15 and F.in_mist(x, z, 120):
                    continue
                lid = int(F.coarse(F.L, x, z))
                if lid and hh < lakes[lid - 1]['level'] + 1.0:
                    continue
                if walk is not None and reg != 8 and kind != 'bridge' and not walk[F.ij(x, z)]:
                    continue  # every generic POI outside the islets must be reachable on foot
                r = 10.0 if kind not in ('flowerfield', 'standing_stones', 'camp') else 16.0
                spread, med = F.pad_stats(x, z, r)
                if spread > (6 if kind != 'cave' else 30):
                    continue
                dmin = 240 if attempt < 600 else 140
                if any(np.hypot(x - p['x'], z - p['z']) < dmin for p in allp):
                    continue
                rel = F.relief[F.ij(x, z)]
                if kind == 'viewpoint':
                    # near a cliff top: ground drops > 60 m within 70 m in some direction
                    drops = [hh - F.h(x + np.cos(a) * 70, z + np.sin(a) * 70) for a in np.linspace(0, 6.28, 12)]
                    if max(drops) < (60 if reg != 2 else 35) or spread > 4:
                        continue
                elif kind == 'cave':
                    # at the foot of a cliff: ground rises > 40 m within 50 m
                    rises = [F.h(x + np.cos(a) * 50, z + np.sin(a) * 50) - hh for a in np.linspace(0, 6.28, 12)]
                    if max(rises) < 40 or F.slope[F.ij(x, z)] > 0.5:
                        continue
                elif kind in ('pier',):
                    near = False
                    for a in np.linspace(0, 6.28, 16, endpoint=False):
                        qx, qz = x + np.cos(a) * 40, z + np.sin(a) * 40
                        hq = F.h(qx, qz)
                        l2 = int(F.coarse(F.L, qx, qz))
                        if hq < 0 or (l2 and hq < lakes[l2 - 1]['level'] - 0.5):
                            near = True
                    if not near:
                        continue
                elif kind == 'bridge':
                    ok = False
                    for rv in rivs:
                        d = np.hypot(rv['P'][:, 0] - x, rv['P'][:, 1] - z)
                        k2 = int(d.argmin())
                        if d[k2] < 30 and not any(f['ia'] - 3 <= k2 <= f['ib'] + 3 for f in rv['falls']):
                            x, z = float(rv['P'][k2, 0]), float(rv['P'][k2, 1])
                            ok = True
                            break
                    if not ok:
                        continue
                    hh = float(rv['s'][k2]) + 1.2
                    med = hh
                    r = 0.0
                else:
                    if rel > 30 and kind not in ('cave',):
                        continue
                n_ok += 1
                pid = 'p_r%d_%d' % (reg + 1, n_ok)
                ry = float(rng.uniform(-np.pi, np.pi))
                if kind == 'bridge':
                    dx, dz = rv['P'][min(k2 + 1, len(rv['P']) - 1)] - rv['P'][max(k2 - 1, 0)]
                    ry = float(np.arctan2(dx, dz)) + np.pi / 2
                p = dict(id=pid, kind=kind, region=reg, x=round(float(x), 1), z=round(float(z), 1),
                         y=round(float(med), 2), ry=round(ry, 4), r=r, flat=(r if kind != 'cave' else 0.0))
                out.append(p)
                allp.append(p)
                placed = True
                break
            if not placed:
                log('  generic', kind, 'not placed in region', reg + 1)
    counts = np.bincount([p['region'] for p in out], minlength=16)
    log('generic POIs', len(out), counts.tolist())
    return out


def pad_weight(d, r):
    fade = max(8.0, r * 0.6)
    return 1 - sstep(r, r + fade, d)


def apply_pads(G, H, pads):
    for p in pads:
        r = p['flat']
        if r <= 0:
            continue
        fade = max(8.0, r * 0.6)
        m = r + fade + G.cell
        wj, wi = G.window(p['x'] - m, p['z'] - m, p['x'] + m, p['z'] + m)
        d = np.hypot(G.X[wj, wi] - p['x'], G.Z[wj, wi] - p['z'])
        w = pad_weight(d, r)
        H[wj, wi] = H[wj, wi] * (1 - w) + p['y'] * w


def route_roads(F, D, pois, lakes, rivs, cloud_y, scratch, log=print):
    G = F.G
    H = F.H
    n = G.n
    pen = np.zeros(H.shape, np.float32)
    # blocked: ocean, water, cloud-level ground, mist interior, world edge
    clo = np.kron(F.cloud, np.ones((F.step, F.step)))[:n, :n]
    blocked = (H < 1.0) | ((H < cloud_y + 4) & (clo > 0.3))
    lid = np.kron(F.L, np.ones((F.step, F.step), np.uint8))[:n, :n]
    for i, lk in enumerate(lakes):
        blocked |= (lid == i + 1) & (H < lk['level'] + 0.4)
    blocked |= np.hypot(G.X - F.mist['x'], G.Z - F.mist['z']) < F.mist['r'] - 30
    blocked |= (np.abs(G.X) > 7600) | (np.abs(G.Z) > 7600)
    pen += np.clip((F.relief - 25) / 20.0, 0, 3).astype(np.float32)
    # meandering: roads bend around soft 'noise hills' instead of running in straight lines
    pen += (2.2 * fbm(G.X / 340. + 4, G.Z / 340. - 2, 3, 951) + 0.8 * fbm(G.X / 90., G.Z / 90., 2, 953)).astype(np.float32)
    # rivers: crossing costs a bit (fords / small bridges)
    for rv in rivs:
        P = rv['P']
        ii = np.clip(np.round((P[:, 0] + G.ws) / G.cell).astype(int), 0, n - 1)
        jj = np.clip(np.round((P[:, 1] + G.ws) / G.cell).astype(int), 0, n - 1)
        pen[jj, ii] += 3.0
    pen[blocked] = -1
    hf = os.path.join(scratch, 'astar_h.f32')
    pf = os.path.join(scratch, 'astar_p.f32')
    H.astype('<f4').tofile(hf)
    pen.astype('<f4').tofile(pf)
    byid = {p['id']: p for p in pois}
    legs = []
    meta = []
    for ri, r in enumerate(D.ROUTES):
        st = []
        for s in r['stops']:
            if isinstance(s, str) and s[-2:] in (':a', ':b'):
                q = byid[s[:-2]]
                k = '0' if s[-1] == 'a' else '1'
                st.append((q['x' + k], q['z' + k]))
            elif isinstance(s, str):
                st.append((byid[s]['x'], byid[s]['z']))
            else:
                st.append(s)
        for a, b in zip(st[:-1], st[1:]):
            legs.append([float(a[0]), float(a[1]), float(b[0]), float(b[1])])
            meta.append(ri)
    job = dict(n=n, cell=G.cell, ws=G.ws, hFile=hf, penFile=pf, maxGrade=0.5, gradeW=16, share=0.6, routes=legs)
    jf = os.path.join(scratch, 'astar_job.json')
    json.dump(job, open(jf, 'w'))
    res = subprocess.run(['node', os.path.join(HERE, 'astar.js'), jf], capture_output=True, text=True, check=True)
    paths = json.loads(res.stdout)
    fails = res.stderr.count('no path')
    log('roads: %d legs, %d failed' % (len(legs), fails))
    for line in res.stderr.splitlines():
        if 'no path' in line:
            log('  ' + line)
    # merge legs per route, smooth, resample, grade heights
    roads = []
    for ri, r in enumerate(D.ROUTES):
        segs = [np.asarray(paths[k]) for k in range(len(legs)) if meta[k] == ri and paths[k]]
        for seg in segs:
            if len(seg) < 2:
                continue
            P = chaikin(seg, 4)
            P = resample(P, 6.0)
            # small lateral wiggle so roads wind organically
            roads.append(dict(w=r['w'], P=P, route=ri))
    for rd in roads:
        P = rd['P']
        y = bilinear(H, P[:, 0], P[:, 1], -G.ws, G.cell)
        for _ in range(10):
            y2 = y.copy()
            y2[1:-1] = (y[:-2] + y[1:-1] + y[2:]) / 3
            y = y2
        rd['y'] = y
    return roads


def apply_roads(G, H, roads):
    """cut-and-fill the macro grid gently along the roads (the runtime does the fine version)."""
    for rd in roads:
        P = resample(rd['P'], 18.0)
        yy = np.interp(np.linspace(0, 1, len(P)), np.linspace(0, 1, len(rd['y'])), rd['y'])
        m = 30
        wj, wi = G.window(P[:, 0].min() - m, P[:, 1].min() - m, P[:, 0].max() + m, P[:, 1].max() + m)
        d, along, _ = polyline_dist(G.X[wj, wi], G.Z[wj, wi], P)
        k = np.clip(np.round(along / 18.0).astype(int), 0, len(P) - 1)
        y = yy[k]
        w = 1 - sstep(rd['w'] / 2 + 2, rd['w'] / 2 + 14, d)
        h = H[wj, wi]
        H[wj, wi] = h + (y - h) * w * 0.85
