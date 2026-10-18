"""Deterministic value noise / fBm / geometry helpers on numpy grids (world generator, dev-only)."""
import numpy as np

M32 = 0xffffffff


def hash2(ix, iz, seed):
    ix = ix.astype(np.int64)
    iz = iz.astype(np.int64)
    h = (ix * 374761393 + iz * 668265263 + (seed * 2246822519 & M32)) & M32
    h = ((h ^ (h >> 13)) * 1274126177) & M32
    h = h ^ (h >> 16)
    return h.astype(np.float64) / 4294967296.0


def vnoise(x, z, seed=0):
    ix = np.floor(x)
    iz = np.floor(z)
    fx = x - ix
    fz = z - iz
    u = fx * fx * (3 - 2 * fx)
    v = fz * fz * (3 - 2 * fz)
    ix = ix.astype(np.int64)
    iz = iz.astype(np.int64)
    a = hash2(ix, iz, seed)
    b = hash2(ix + 1, iz, seed)
    c = hash2(ix, iz + 1, seed)
    d = hash2(ix + 1, iz + 1, seed)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v


def fbm(x, z, octaves=4, seed=0, lac=2.03, gain=0.5):
    s = np.zeros_like(x, dtype=np.float64)
    a = 0.5
    f = 1.0
    n = 0.0
    for k in range(octaves):
        s += a * vnoise(x * f + k * 17.3, z * f + k * 9.1, seed + k * 101)
        n += a
        a *= gain
        f *= lac
    return s / n


def ridged(x, z, octaves=4, seed=0):
    s = np.zeros_like(x, dtype=np.float64)
    a = 0.5
    f = 1.0
    n = 0.0
    w = np.ones_like(x, dtype=np.float64)
    for k in range(octaves):
        v = 1 - np.abs(vnoise(x * f + k * 31.7, z * f - k * 12.9, seed + k * 57) * 2 - 1)
        v = v * v * w
        w = np.clip(v * 1.6, 0, 1)
        s += a * v
        n += a
        a *= 0.5
        f *= 2.07
    return s / n


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def seg_dist(px, pz, ax, az, bx, bz):
    """distance from points to segment a-b, and the param t."""
    dx = bx - ax
    dz = bz - az
    l2 = dx * dx + dz * dz
    if l2 < 1e-9:
        return np.hypot(px - ax, pz - az), np.zeros_like(px)
    t = np.clip(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1)
    return np.hypot(px - (ax + dx * t), pz - (az + dz * t)), t


def poly_sdf(px, pz, pts):
    """signed distance to a closed polygon (negative inside)."""
    pts = np.asarray(pts, dtype=np.float64)
    n = len(pts)
    d = np.full(px.shape, 1e12)
    inside = np.zeros(px.shape, dtype=bool)
    for i in range(n):
        ax, az = pts[i]
        bx, bz = pts[(i + 1) % n]
        dd, _ = seg_dist(px, pz, ax, az, bx, bz)
        d = np.minimum(d, dd)
        cond = ((az > pz) != (bz > pz))
        xint = ax + (pz - az) * (bx - ax) / (bz - az + 1e-12)
        inside ^= cond & (px < xint)
    return np.where(inside, -d, d)


def polyline_dist(px, pz, pts):
    """distance to an open polyline, plus arc-length parameter of the closest point."""
    pts = np.asarray(pts, dtype=np.float64)
    d = np.full(px.shape, 1e12)
    along = np.zeros(px.shape)
    acc = 0.0
    for i in range(len(pts) - 1):
        ax, az = pts[i]
        bx, bz = pts[i + 1]
        L = float(np.hypot(bx - ax, bz - az))
        dd, t = seg_dist(px, pz, ax, az, bx, bz)
        m = dd < d
        d = np.where(m, dd, d)
        along = np.where(m, acc + t * L, along)
        acc += L
    return d, along, acc


def chaikin(pts, it=3, closed=False):
    p = np.asarray(pts, dtype=np.float64)
    for _ in range(it):
        if closed:
            q = np.roll(p, -1, axis=0)
            a = 0.75 * p + 0.25 * q
            b = 0.25 * p + 0.75 * q
            p = np.stack([a, b], axis=1).reshape(-1, 2)
        else:
            a = 0.75 * p[:-1] + 0.25 * p[1:]
            b = 0.25 * p[:-1] + 0.75 * p[1:]
            mid = np.stack([a, b], axis=1).reshape(-1, 2)
            p = np.vstack([p[:1], mid, p[-1:]])
    return p


def resample(pts, step):
    p = np.asarray(pts, dtype=np.float64)
    seg = np.hypot(np.diff(p[:, 0]), np.diff(p[:, 1]))
    acc = np.concatenate([[0], np.cumsum(seg)])
    total = acc[-1]
    n = max(2, int(np.ceil(total / step)) + 1)
    s = np.linspace(0, total, n)
    return np.stack([np.interp(s, acc, p[:, 0]), np.interp(s, acc, p[:, 1])], axis=1)


def blur(a, r):
    """separable box blur repeated 3x (~gaussian), radius r cells, edge-clamped."""
    if r <= 0:
        return a.copy()
    out = a.astype(np.float64)
    for _ in range(3):
        for ax in (0, 1):
            pad = [(0, 0), (0, 0)]
            pad[ax] = (r + 1, r)
            p = np.pad(out, pad, mode='edge')
            c = np.cumsum(p, axis=ax)
            if ax == 0:
                out = (c[2 * r + 1:, :] - c[:-2 * r - 1, :]) / (2 * r + 1)
            else:
                out = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
    return out


def dilate_max(a, r):
    out = a.copy()
    for _ in range(r):
        p = np.pad(out, 1, mode='edge')
        out = np.maximum.reduce([p[1:-1, 1:-1], p[:-2, 1:-1], p[2:, 1:-1], p[1:-1, :-2], p[1:-1, 2:]])
    return out


def bilinear(grid, x, z, x0, cell):
    """sample a 2-D grid (rows = z) at world coords."""
    n = grid.shape[0]
    u = np.clip((np.asarray(x) - x0) / cell, 0, n - 1.0001)
    v = np.clip((np.asarray(z) - x0) / cell, 0, n - 1.0001)
    i = np.floor(u).astype(int)
    j = np.floor(v).astype(int)
    fu = u - i
    fv = v - j
    a = grid[j, i]
    b = grid[j, i + 1]
    c = grid[j + 1, i]
    d = grid[j + 1, i + 1]
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv
