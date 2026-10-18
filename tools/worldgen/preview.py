"""Quick diagnostic preview of the height field (hillshade + hypsometric colours + overlays)."""
import numpy as np
from PIL import Image, ImageDraw


def hillshade(H, cell, az=315, alt=40, zf=1.0):
    gy, gx = np.gradient(H * zf, cell)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a = np.radians(az)
    e = np.radians(alt)
    sh = np.sin(e) * np.cos(slope) + np.cos(e) * np.sin(slope) * np.cos(a - aspect)
    return np.clip(sh, 0, 1)


STOPS = [(-40, (30, 70, 120)), (0, (60, 140, 190)), (1, (220, 210, 150)), (40, (140, 170, 90)),
         (90, (120, 150, 80)), (150, (150, 180, 80)), (250, (170, 185, 90)), (400, (150, 150, 100)),
         (550, (170, 150, 120)), (700, (200, 190, 180)), (900, (240, 240, 245))]


def hyps(H):
    xs = [s[0] for s in STOPS]
    out = np.zeros(H.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(H, xs, [s[1][c] for s in STOPS])
    return out


def render(H, cell, path, cloud=None, water=None, lines=(), points=(), labels=(), size=1025, cloud_y=90):
    sh = hillshade(H, cell)
    col = hyps(H) * (0.35 + 0.8 * sh[..., None])
    gy, gx = np.gradient(H, cell)
    steep = np.clip((np.hypot(gx, gy) - 1.2) / 2.0, 0, 1)
    col = col * (1 - steep[..., None] * 0.45)
    if water is not None:
        col = np.where(water[..., None], col * 0.3 + np.array([40, 120, 200]) * 0.7, col)
    if cloud is not None:
        c = np.clip(cloud, 0, 1)[..., None] * 0.75
        col = col * (1 - c) + np.array([235, 240, 248]) * c
    img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8))
    if img.size[0] != size:
        img = img.resize((size, size), Image.BILINEAR)
    dr = ImageDraw.Draw(img)
    n = H.shape[0]
    sc = size / (n - 1)
    ws = (n - 1) * cell / 2
    P = lambda x, z: ((x + ws) / cell * sc, (z + ws) / cell * sc)
    for pts, color, w in lines:
        dr.line([P(x, z) for x, z in pts], fill=color, width=w)
    for x, z, color, r in points:
        px, pz = P(x, z)
        dr.ellipse([px - r, pz - r, px + r, pz + r], fill=color)
    for x, z, txt, color in labels:
        px, pz = P(x, z)
        dr.text((px + 4, pz - 6), txt, fill=color)
    img.save(path)
    return img
