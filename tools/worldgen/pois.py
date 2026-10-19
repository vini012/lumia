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
            # the canyon segment nearest to opt['at'] (default: the middle of the canyon)
            k = len(p) // 2
            x, z = float((p[k - 1][0] + p[k][0]) / 2), float((p[k - 1][1] + p[k][1]) / 2)
            if opt.get('at'):
                x, z = map(float, opt['at'])
                k = 1 + int(np.argmin([np.hypot((p[q][0] + p[q + 1][0]) / 2 - x, (p[q][1] + p[q + 1][1]) / 2 - z)
                                       for q in range(len(p) - 1)]))
            dx, dz = p[k] - p[k - 1]
            L = float(np.hypot(dx, dz))
            ux, uz = dx / L, dz / L            # along the canyon (the slot's long axis)
            nx, nz = -uz, ux                   # across the canyon (the bridge's span)
            gap = float(opt.get('slot', 14.0))
            half = 10.0                        # props5 rope_bridge: 20 m, ends at +-10 m
            # the deck sits on the natural rock bridge left uncarved over the canyon (D.BRIDGES); choose the spot
            # along the bridge where both rims (+-half) are level with each other
            best = None
            for sh in np.arange(-24.0, 24.1, 2.0):
                cx, cz = x + nx * sh, z + nz * sh
                ya, yb = F.h(cx - nx * half, cz - nz * half), F.h(cx + nx * half, cz + nz * half)
                yc = F.h(cx, cz)
                cost = abs(ya - yb) + 0.2 * abs(yc - (ya + yb) / 2) + 0.02 * abs(sh)
                if best is None or cost < best[0]:
                    best = (cost, cx, cz, ya, yb)
            _, x, z, ya, yb = best
            y = float((ya + yb) / 2)
            ax, az, bx, bz = x - nx * half, z - nz * half, x + nx * half, z + nz * half
            out.append(dict(id=pid, kind=kind, x=round(x, 1), z=round(z, 1), y=round(y, 2),
                            ry=round(float(np.arctan2(nx, nz)), 4), r=0, flat=0, span=round(2 * half, 1),
                            gap=gap, x0=round(ax, 1), z0=round(az, 1), y0=round(y, 2), x1=round(bx, 1),
                            z1=round(bz, 1), y1=round(y, 2),
                            # runtime slot cut through the rock bridge: centre, long axis (u), half length,
                            # half width, bottom height; anchor pads keep both rims at the deck height
                            slot=dict(x=round(x, 1), z=round(z, 1), ux=round(ux, 4), uz=round(uz, 4), hl=60.0,
                                      hw=gap / 2, y=round(y - 160.0, 1)),
                            pads=[[round(ax - nx * 2.5, 1), round(az - nz * 2.5, 1), 3.5, round(y, 2)],
                                  [round(bx + nx * 2.5, 1), round(bz + nz * 2.5, 1), 3.5, round(y, 2)]]))
            log('rope bridge: rims %.1f / %.1f m (diff %.1f), gap %.0f m, deck y %.1f' % (ya, yb, abs(ya - yb), gap, y))
            continue
        sx, sz, y = settle(F, D, pid, kind, x, z, r, opt, out, lakes, rivs, cloud_y)
        out.append(dict(id=pid, kind=kind, x=round(float(sx), 1), z=round(float(sz), 1), y=round(float(y), 2),
                        ry=round(float(opt.get('ry', 0.0)), 4), r=float(r), flat=float(r if r > 0 else 0)))
    # the Annecy viewpoint (generic id, fixed spot)
    a = D.ANNECY
    sx, sz, y = settle(F, D, 'p_annecy', 'viewpoint', a['x'], a['z'], 5, dict(search=a.get('search', 80)), out, lakes, rivs, cloud_y)
    out.append(dict(id='p_annecy', kind='viewpoint', x=round(sx, 1), z=round(sz, 1), y=round(y, 2),
                    ry=round(float(np.arctan2(a['look'][0] - sx, a['look'][1] - sz)), 4), r=2.0, flat=0.0))   # no pad: the
    # viewpoint stands on the open slope (a flat landing would hide the valley below from eye height)
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
        queue = list(kinds)            # a kind that finds no spot is replaced by a fallback kind (>= 6 per region)
        qi = 0
        while qi < len(queue):
            kind = queue[qi]
            qi += 1
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
                    # at the foot of a cliff: ground rises > 40 m within 50 m (looser after many tries)
                    loose = attempt > 450
                    rr = 75 if loose else 50
                    rises = [F.h(x + np.cos(a) * rr, z + np.sin(a) * rr) - hh for a in np.linspace(0, 6.28, 16)]
                    if max(rises) < (24 if loose else 40) or F.slope[F.ij(x, z)] > (0.75 if loose else 0.5):
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
                if kind == 'bridge':
                    p['span'] = round(float(rv['W'][k2]) * 1.25 + 4.0, 1)
                out.append(p)
                allp.append(p)
                placed = True
                break
            if not placed:
                log('  generic', kind, 'not placed in region', reg + 1)
                if len(queue) < len(kinds) + 4:
                    queue.append(['ruin', 'camp', 'shrine', 'standing_stones'][len(queue) % 4])
    counts = np.bincount([p['region'] for p in out], minlength=16)
    log('generic POIs', len(out), counts.tolist())
    return out


def nudge_out_of_rivers(F, pois, rivs, log=print):
    """a POI whose pad would sit in a river bed is moved out to the bank (along the normal of the nearest reach)."""
    skip = ('bridge', 'rope_bridge', 'chest_underwater', 'waterfall', 'mist', 'keep', 'gate', 'seat')
    moved = []
    for p in pois:
        if p['kind'] in skip or p['id'] == 'spawn':
            continue
        for _ in range(3):
            best = None
            for rv in rivs:
                P = rv['P']
                d = np.hypot(P[:, 0] - p['x'], P[:, 1] - p['z'])
                k = int(d.argmin())
                need = rv['W'][k] / 2 + max(p['r'], 3.0) + 5.0
                if d[k] < need and (best is None or need - d[k] > best[0]):
                    best = (need - d[k], rv, k)
            if best is None:
                break
            push, rv, k = best
            P = rv['P']
            a, b = P[max(k - 1, 0)], P[min(k + 1, len(P) - 1)]
            tx, tz = b - a
            L = float(np.hypot(tx, tz)) + 1e-9
            nx, nz = -tz / L, tx / L
            side = np.sign((p['x'] - P[k, 0]) * nx + (p['z'] - P[k, 1]) * nz) or 1.0
            p['x'] = round(float(p['x'] + nx * side * (push + 1.0)), 1)
            p['z'] = round(float(p['z'] + nz * side * (push + 1.0)), 1)
            moved.append(p['id'])
    for p in pois:
        if p['id'] in moved and p['flat'] > 0:
            p['y'] = round(F.pad_stats(p['x'], p['z'], max(p['r'], 4))[1], 2)
    if moved:
        log('POIs moved out of river beds:', sorted(set(moved)))


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


def _seg_dist(px, pz, A, B):
    """distances from points (n) to segments A->B (m): (n, m) distance and parameter t."""
    dx, dz = (B - A)[:, 0], (B - A)[:, 1]
    l2 = np.maximum(dx * dx + dz * dz, 1e-9)
    ex = px[:, None] - A[None, :, 0]
    ez = pz[:, None] - A[None, :, 1]
    t = np.clip((ex * dx + ez * dz) / l2, 0, 1)
    qx = ex - t * dx
    qz = ez - t * dz
    return np.sqrt(qx * qx + qz * qz), t


def grade_crossings(roads, rivs, log=print):
    """road/river crossings: rivers narrower than 6 m become shallow fords (road bed 0.35 m under the surface),
    wider ones get a plank bridge (road graded up to a deck ~1 m over the water on both banks). Returns the list of
    crossings (kind, x, z, y, ry, len, w) and marks the road samples that must not fill the river bed (rd['keep'])."""
    out = []
    for rd in roads:
        P = rd['P']
        y = np.asarray(rd['y'], float).copy()
        keep = np.zeros(len(P), bool)
        n = len(P)
        bb = (P[:, 0].min() - 40, P[:, 1].min() - 40, P[:, 0].max() + 40, P[:, 1].max() + 40)
        for rv in rivs:
            RP = rv['P']
            if RP[:, 0].max() < bb[0] or RP[:, 0].min() > bb[2] or RP[:, 1].max() < bb[1] or RP[:, 1].min() > bb[3]:
                continue
            fz = np.zeros(len(RP), bool)
            for f in rv['falls']:
                fz[f['ia']:f['ib'] + 1] = True
            A, B = RP[:-1], RP[1:]
            d = np.full(n, 1e9)
            ks = np.zeros(n, int)
            ts = np.zeros(n)
            for c0 in range(0, n, 400):
                dd, tt = _seg_dist(P[c0:c0 + 400, 0], P[c0:c0 + 400, 1], A, B)
                k = dd.argmin(1)
                d[c0:c0 + 400] = dd[np.arange(len(k)), k]
                ks[c0:c0 + 400] = k
                ts[c0:c0 + 400] = tt[np.arange(len(k)), k]
            W = rv['W'][ks] * (1 - ts) + rv['W'][np.minimum(ks + 1, len(RP) - 1)] * ts
            Sf = rv['s'][ks] * (1 - ts) + rv['s'][np.minimum(ks + 1, len(RP) - 1)] * ts
            inside = d < W / 2 + 0.5
            i = 0
            while i < n:
                if not inside[i]:
                    i += 1
                    continue
                j = i
                while j + 1 < n and inside[j + 1]:
                    j += 1
                c = i + int(np.argmin(d[i:j + 1]))
                i = j + 1
                if fz[ks[c]] or fz[min(ks[c] + 1, len(RP) - 1)]:
                    log('  crossing on a fall skipped', rv['id'], P[c].round(0).tolist())
                    continue
                rs, rw = float(Sf[c]), float(W[c])
                ford = rw < 6.0
                yt = rs - 0.35 if ford else rs + 0.85 + rw * 0.03
                # samples over the water (+ 2.5 m of bank) take the crossing height; 42 m ramps on each side
                core = np.nonzero((d < W / 2 + 2.5) & (np.abs(np.arange(n) - c) < 12))[0]
                a0, a1 = int(core.min()), int(core.max())
                y[a0:a1 + 1] = yt
                keep[a0:a1 + 1] = True
                for (s0, sgn) in ((a0, -1), (a1, 1)):
                    m = 7
                    e = int(np.clip(s0 + sgn * m, 0, n - 1))
                    if e == s0:
                        continue
                    ye = y[e]
                    for q in range(1, abs(e - s0)):
                        t = q / abs(e - s0)
                        y[s0 + sgn * q] = yt + (ye - yt) * t * t * (3 - 2 * t)
                pa, pb = P[max(c - 2, 0)], P[min(c + 2, n - 1)]
                ry = float(np.arctan2(pb[0] - pa[0], pb[1] - pa[1]))
                span = float(np.hypot(*(P[a1] - P[a0]))) + 2.0
                if any(q['river'] == rv['id'] and np.hypot(q['x'] - P[c, 0], q['z'] - P[c, 1]) < 12 for q in out):
                    continue   # two routes sharing this crossing: one deck/ford is enough
                out.append(dict(kind='ford' if ford else 'bridge', river=rv['id'], x=round(float(P[c, 0]), 1),
                                z=round(float(P[c, 1]), 1), y=round(yt, 2), surf=round(rs, 2), ry=round(ry, 4),
                                len=round(max(span, rw + 3.0), 1), w=rd['w'], rw=round(rw, 1)))
        rd['y'] = y
        rd['keep'] = keep
    nb = sum(1 for c in out if c['kind'] == 'bridge')
    log('road/river crossings: %d (%d bridges, %d fords)' % (len(out), nb, len(out) - nb))
    return out


def apply_roads(G, H, roads):
    """cut-and-fill the macro grid gently along the roads (the runtime does the fine version)."""
    for rd in roads:
        y0 = np.asarray(rd['y'], float)
        if 'keep' in rd and rd['keep'].any():
            # bridge decks and fords must not dam the river channel in the macro grid
            y0 = np.where(rd['keep'], np.nan, y0)
        P = resample(rd['P'], 18.0)
        yy = np.interp(np.linspace(0, 1, len(P)), np.linspace(0, 1, len(y0)), np.nan_to_num(y0, nan=-1e4))
        kk = np.interp(np.linspace(0, 1, len(P)), np.linspace(0, 1, len(y0)), np.isnan(y0).astype(float))
        yy = np.where(kk > 0.01, np.nan, yy)
        m = 30
        wj, wi = G.window(P[:, 0].min() - m, P[:, 1].min() - m, P[:, 0].max() + m, P[:, 1].max() + m)
        d, along, _ = polyline_dist(G.X[wj, wi], G.Z[wj, wi], P)
        k = np.clip(np.round(along / 18.0).astype(int), 0, len(P) - 1)
        y = yy[k]
        w = 1 - sstep(rd['w'] / 2 + 2, rd['w'] / 2 + 14, d)
        w = np.where(np.isnan(y), 0.0, w)
        y = np.nan_to_num(y)
        h = H[wj, wi]
        H[wj, wi] = h + (y - h) * w * 0.85


def final_heights(G, H, pois, log=print):
    """last pass: POI heights from the final grid (after rivers, pads and roads). Pads keep their own height."""
    skip = ('bridge', 'rope_bridge', 'chest_underwater')
    n = 0
    for p in pois:
        if p['kind'] in skip or p.get('flat', 0) > 0:
            continue
        y = float(bilinear(H, np.array([p['x']]), np.array([p['z']]), -G.ws, G.cell)[0])
        if abs(y - p['y']) > 0.05:
            n += 1
        p['y'] = round(y, 2)
    log('POI heights refreshed from the final grid: %d changed' % n)
