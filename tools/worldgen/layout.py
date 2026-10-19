"""Region ownership raster and the coarse ecological masks (forest, meadow, wet, cloud)."""
import numpy as np
from wnoise import fbm, sstep, blur, poly_sdf
from terrainops import warp_coords

REGION_OF_PREFIX = [('r1_', 0), ('r2_', 1), ('r3_', 2), ('r4_', 3), ('r5_', 4), ('r6_', 5), ('r7_', 6), ('r8_', 7),
                    ('isl:', 8), ('r10_', 9), ('r11_', 10), ('r12_', 11), ('r13_', 12), ('r14_', 13), ('r15_', 14),
                    ('r16_', 15)]


def table_region(tid):
    for p, r in REGION_OF_PREFIX:
        if tid.startswith(p):
            return r
    return -1


def shift(a, dj, di, fill):
    out = np.full_like(a, fill)
    n0, n1 = a.shape
    out[max(dj, 0):n0 + min(dj, 0), max(di, 0):n1 + min(di, 0)] = a[max(-dj, 0):n0 + min(-dj, 0),
                                                                     max(-di, 0):n1 + min(-di, 0)]
    return out


def mode_filter(R, it=2, nreg=16):
    for _ in range(it):
        cnt = np.zeros((nreg,) + R.shape, np.int16)
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                s = shift(R, dj, di, 255)
                for r in range(nreg):
                    cnt[r] += (s == r)
        best = cnt.argmax(0).astype(np.uint8)
        bc = cnt.max(0)
        R = np.where(bc >= 5, best, R)
    return R


def region_raster(G, owner, tables, regions, step=2, log=print):
    n2 = (G.n - 1) // step + 1
    X = G.X[::step, ::step]
    Z = G.Z[::step, ::step]
    own = owner[::step, ::step]
    tmap = np.array([table_region(t['id']) for t in tables] + [-1], np.int16)
    R = np.where(own >= 0, tmap[np.where(own >= 0, own, len(tables))], -1).astype(np.int16)
    # shared tables (valley, lake basin...): warped Voronoi among the walkable mainland regions
    wx, wz = warp_coords(X, Z, 420, 1 / 2600., 901)
    seeds = [(i, r['x'], r['z']) for i, r in enumerate(regions) if i not in (8, 15)]
    best = np.full(X.shape, 1e18)
    vor = np.zeros(X.shape, np.int16)
    for i, sx, sz in seeds:
        d = (wx - sx) ** 2 + (wz - sz) ** 2
        m = d < best
        vor[m] = i
        best = np.minimum(best, d)
    shared = (own >= 0) & (R < 0)
    R[shared] = vor[shared]
    # the west rim of the canyon plateau is the islets' shore
    r10 = [i for i, t in enumerate(tables) if t['id'] == 'r10_plateau'][0]
    rim = (own == r10) & (wx < -3150)
    R[rim] = 8
    # fill unowned (ocean, canyon floors without a table) from the nearest owned cell
    it = 0
    while (R < 0).any() and it < 600:
        it += 1
        for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            s = shift(R, dj, di, -1)
            m = (R < 0) & (s >= 0)
            R[m] = s[m]
    R = R.astype(np.uint8)
    R = mode_filter(R, 2)
    log('regions: filled in', it, 'iters; counts', np.bincount(R.ravel(), minlength=16).tolist())
    return R


def rasterize_lines(n2, ws, lines, value_fn=None):
    """mark cells touched by polylines (dense points)."""
    out = np.zeros((n2, n2), np.float32)
    cell = 2 * ws / (n2 - 1)
    for P, v in lines:
        ii = np.clip(np.round((P[:, 0] + ws) / cell).astype(int), 0, n2 - 1)
        jj = np.clip(np.round((P[:, 1] + ws) / cell).astype(int), 0, n2 - 1)
        np.maximum.at(out, (jj, ii), v)
    return out


def masks(G, H, R, D, rivs, lakes_out, lake_ids, pads, step=2, log=print):
    """forest density, meadow/flower density, wetness, cloud-sea coverage (all 0..1 at the coarse grid)."""
    X = G.X[::step, ::step]
    Z = G.Z[::step, ::step]
    h = H[::step, ::step]
    n2 = X.shape[0]
    cell = G.cell * step
    gz, gx = np.gradient(blur(h, 1), cell)
    slope = np.hypot(gx, gz)
    fl = D.FLORA
    base_f = np.zeros(X.shape)
    clumpy = np.zeros(X.shape)
    base_m = np.zeros(X.shape)
    base_w = np.zeros(X.shape)
    for i in range(16):
        m = (R == i)
        base_f[m] = fl[i]['forest']
        clumpy[m] = fl[i].get('clump', 1.0)
        base_m[m] = fl[i]['meadow']
        base_w[m] = fl[i].get('wet', 0.0)
    base_f = blur(base_f, 3)
    clumpy = blur(clumpy, 3)
    base_m = blur(base_m, 3)
    base_w = blur(base_w, 3)
    # water proximity
    wl = [(r['P'], 1.0) for r in rivs]
    wr = rasterize_lines(n2, G.ws, wl)
    lakec = (lake_ids > 0).astype(np.float32)
    water = np.maximum(wr, lakec)
    near_w = np.clip(blur(water, 2) * 3.0, 0, 1)
    far_w = np.clip(blur(water, 7) * 4.0, 0, 1)
    # forest: clumps and groves, preferring slopes and valley floors, never on cliffs or in water
    n1 = fbm(X / 900. + 3, Z / 900. - 8, 4, 501)
    n2_ = fbm(X / 240. - 1, Z / 240. + 4, 3, 503)
    clump = sstep(0.40, 0.60, n1 * 0.75 + n2_ * 0.25)
    clump = clump * clumpy + (1 - clumpy) * (0.35 + 0.3 * n2_)
    fs = 1 - sstep(0.55, 1.1, slope)
    fslope = 1 + 0.6 * sstep(0.12, 0.45, slope) * (1 - sstep(0.7, 1.0, slope))
    forest = base_f * (0.15 + 1.45 * clump) * fs * fslope * (1 - near_w * 0.9) * (1 + far_w * 0.25)
    # extra groves (design): forest raised towards amt inside r, still clumpy, off cliffs and water
    for (x, z, r, amt) in getattr(D, 'FOREST_GROVES', []):
        w = 1 - sstep(r * 0.5, r, np.hypot(X - x, Z - z))
        forest = np.maximum(forest, amt * w * (0.3 + 0.95 * clump) * fs * (1 - near_w * 0.6))
    forest = np.where(lake_ids > 0, 0, forest)
    for (x, z, r, keep) in getattr(D, 'FOREST_OPEN', []):
        d = np.hypot(X - x, Z - z)
        forest = forest * (keep + (1 - keep) * sstep(r * 0.6, r * 1.25, d))
    forest = np.where(h < 1.5, 0, forest)
    # meadow / flower fields: open ground away from forests
    n3 = fbm(X / 420. + 9, Z / 420. + 2, 3, 507)
    meadow = base_m * sstep(0.42, 0.62, n3) * (1 - np.clip(forest * 1.4, 0, 1)) * (1 - sstep(0.35, 0.7, slope))
    # wetness: water margins, R4, low flats
    wet = np.clip(near_w * 0.9 + far_w * 0.35 + base_w * (0.5 + 0.5 * fbm(X / 300., Z / 300., 2, 509)), 0, 1)
    wet = wet * (1 - sstep(0.5, 0.9, slope))
    # POI pads: clear trees there
    cellx = lambda v: np.clip(np.round((v + G.ws) / cell).astype(int), 0, n2 - 1)
    for p in pads:
        r = p['r'] + 12
        x, z = p['x'], p['z']
        j0, j1 = cellx(z - r - cell), cellx(z + r + cell) + 1
        i0, i1 = cellx(x - r - cell), cellx(x + r + cell) + 1
        d = np.hypot(X[j0:j1, i0:i1] - x, Z[j0:j1, i0:i1] - z)
        forest[j0:j1, i0:i1] *= sstep(r * 0.8, r + cell, d)
    # cloud sea coverage (1 = cloud deck present over low ground)
    cloud = np.ones(X.shape)
    for kind, poly in D.CLEAR:
        s = poly_sdf(X, Z, poly)
        cloud = np.minimum(cloud, sstep(-300, 250, s))
    holes = fbm(X / 1500. + 4, Z / 1500. - 9, 4, 511)
    cloud = cloud * (1 - 0.8 * sstep(0.60, 0.70, holes))
    for (x, z, r, v) in D.CLOUD_THIN:
        d = np.hypot(X - x, Z - z)
        cloud = cloud * (1 - (1 - v) * (1 - sstep(r * 0.5, r, d)))
    cloud = blur(cloud, 2)
    out = dict(forest=np.clip(forest, 0, 1), meadow=np.clip(meadow, 0, 1), wet=wet, cloud=np.clip(cloud, 0, 1))
    log('masks: forest mean %.3f meadow %.3f wet %.3f cloud %.3f' % tuple(out[k].mean() for k in
                                                                          ('forest', 'meadow', 'wet', 'cloud')))
    return out
