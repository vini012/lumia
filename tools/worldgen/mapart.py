"""Painted top-down world map (m/map5.png): palette ground, forests, soft hillshade, cliffs, water, cloud sea,
roads, parchment tint. The hidden plateau is covered by an ordinary-looking cloud bank."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from wnoise import fbm, sstep, blur


def hexrgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float64)


def up(a, size, mode=Image.BICUBIC):
    im = Image.fromarray(a.astype(np.float32), mode='F')
    return np.asarray(im.resize((size, size), mode), dtype=np.float64)


def paint(D, G, H, R, M, lakes, LID, rivs, roads, size=2048):
    ws = G.ws
    px = 2 * ws / size
    a = -ws + (np.arange(size) + 0.5) * px
    X, Z = np.meshgrid(a, a)
    h = up(H, size)
    reg = np.asarray(Image.fromarray(R).resize((size, size), Image.NEAREST))
    forest = np.clip(up(M['forest'], size), 0, 1)
    meadow = np.clip(up(M['meadow'], size), 0, 1)
    cloud = np.clip(up(M['cloud'], size), 0, 1)
    pal = D.PALETTE
    cols = {k: np.stack([hexrgb(p[k]) for p in pal]) for k in ('grass', 'alt', 'forest', 'rock')}
    G3 = np.stack([blur(cols['grass'][reg][..., c], 3) for c in range(3)], -1)
    A3 = np.stack([blur(cols['alt'][reg][..., c], 3) for c in range(3)], -1)
    F3 = np.stack([blur(cols['forest'][reg][..., c], 3) for c in range(3)], -1)
    K3 = np.stack([blur(cols['rock'][reg][..., c], 3) for c in range(3)], -1)
    n1 = fbm(X / 500., Z / 500., 4, 701)
    col = G3 + (A3 - G3) * sstep(0.45, 0.6, n1)[..., None]
    col = col * (1 + 0.12 * meadow[..., None])
    # forests: dark floor with a speckle of canopies
    sp = fbm(X / 22., Z / 22., 2, 703)
    fcan = np.clip(forest * 1.25 + (sp - 0.5) * 0.6, 0, 1)
    fcan = sstep(0.25, 0.6, fcan)
    col = col * (1 - fcan[..., None] * 0.85) + F3 * (fcan[..., None] * 0.85) * (0.85 + 0.3 * sp[..., None])
    # altitude: high ground slightly lighter and cooler
    col = col * (1 + np.clip((h - 300) / 2500, -0.05, 0.12))[..., None]
    # slopes and cliffs
    gz, gx = np.gradient(h, px)
    sl = np.hypot(gx, gz)
    rockw = sstep(0.75, 1.6, sl)
    strata = 0.9 + 0.12 * np.sin(h / 7.0 * np.pi) + 0.05 * (fbm(X / 40., Z / 40., 2, 705) - .5)
    col = col * (1 - rockw[..., None]) + (K3 * strata[..., None]) * rockw[..., None]
    # snow caps on the highest peaks
    snow = sstep(860, 930, h + (fbm(X / 120., Z / 120., 2, 707) - .5) * 60) * (1 - sstep(1.2, 2.2, sl))
    col = col * (1 - snow[..., None]) + hexrgb(D.SNOW) * snow[..., None]
    # beaches
    sand = sstep(7, 2, h) * (h > 0)
    col = col * (1 - sand[..., None]) + hexrgb(D.SAND) * sand[..., None]
    # hillshade (light from the north-west), blue-tinted shadows
    az = np.radians(315)
    alt = np.radians(42)
    slope = np.arctan(sl * 1.6)
    aspect = np.arctan2(-gx, gz)
    shd = np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)
    shd = 0.55 + 0.6 * shd
    col = col * shd[..., None] + np.array([-10, -2, 18]) * np.clip(1.0 - shd, 0, 1)[..., None] * 1.6
    # ocean
    s0, s1 = hexrgb(D.SEA[0]), hexrgb(D.SEA[1])
    dep = np.clip(-h / 30.0, 0, 1)
    sea = s0 * (1 - dep[..., None]) + s1 * dep[..., None]
    wv = (fbm(X / 60., Z / 60., 2, 709) - .5) * 14
    ocean = (h < 0)
    col = np.where(ocean[..., None], sea + wv[..., None], col)
    foam = sstep(-1.5, 0, h) * (h < 0.4)
    col = col * (1 - foam[..., None] * 0.5) + 255 * foam[..., None] * 0.5
    # lakes
    lid = np.asarray(Image.fromarray(LID).resize((size, size), Image.NEAREST)).astype(int)
    for i, lk in enumerate(lakes):
        m = (lid == i + 1) & (h < lk['level'])
        c = s0 * 0.85 + np.array([10, 25, 20]) if not lk['hot'] else np.array([150, 215, 220])
        col[m] = c
    img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8))
    dr = ImageDraw.Draw(img)
    P = lambda x, z: ((x + ws) / px, (z + ws) / px)
    for rd in roads:
        pts = [P(x, z) for x, z in rd['P'][::2]]
        dr.line(pts, fill=(222, 202, 128), width=3 if rd['w'] < 4 else 4, joint='curve')
    for rv in rivs:
        Pp = rv['P']
        W = rv['W']
        for k in range(0, len(Pp) - 2, 2):
            w = max(2, int(round(W[k] / px * 1.6 + 1)))
            dr.line([P(*Pp[k]), P(*Pp[k + 2])], fill=(92, 172, 210), width=w)
    col = np.asarray(img).astype(np.float64)
    # cloud sea over low ground (soft, white-blue), thinning where the deck is open
    cn = fbm(X / 420. + 2, Z / 420. - 5, 5, 711)
    deck = sstep(D.CLOUD_Y + 15, D.CLOUD_Y - 45, h) * cloud
    puff = np.clip(deck * (0.65 + 0.7 * cn), 0, 1)
    ccol = np.array([238, 243, 250]) * (0.9 + 0.1 * cn[..., None]) - np.array([22, 14, 0]) * (1 - cn[..., None])
    col = col * (1 - puff[..., None]) + ccol * puff[..., None]
    # the hidden plateau: a plain cumulus bank, slightly irregular, like any other cloud
    mx, mz, mr = D.MIST['x'], D.MIST['z'], D.MIST['r']
    d = np.hypot(X - mx, Z - mz)
    ang = np.arctan2(Z - mz, X - mx)
    edge = mr + 330 + (fbm(np.cos(ang) * 2.2 + 5, np.sin(ang) * 2.2 + 5, 4, 713) - .5) * 520
    bank = sstep(edge + 120, edge - 220, d + (cn - .5) * 160)
    bcol = np.array([242, 245, 250]) * (0.92 + 0.1 * cn[..., None]) - np.array([30, 22, 6]) * \
        sstep(0.5, 0.0, cn)[..., None] * 0.6
    col = col * (1 - bank[..., None]) + bcol * bank[..., None]
    # parchment tint, paper grain, soft vignette
    parch = hexrgb('#efe3c8')
    col = col * 0.88 + parch * 0.12
    grain = (fbm(X / 6., Z / 6., 2, 715) - .5) * 10
    col = col + grain[..., None]
    v = np.hypot(X, Z) / (ws * 1.42)
    col = col * (1 - 0.18 * sstep(0.6, 1.0, v))[..., None]
    out = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8))
    return out
