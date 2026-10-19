#!/usr/bin/env python3
"""Lumiar v5 world generator (dev-only). Usage: python3 tools/worldgen/gen.py [--out m] [--map-size 2048]
Writes m/world5.bin, m/world5.json, m/world5.b64.json, m/map5.png (see README.md). Deterministic."""
import os
import sys
import time
import argparse
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import design as D  # noqa: E402
from wnoise import fbm  # noqa: E402
from terrainops import Grid, apply_tables, apply_canyons, apply_ramps  # noqa: E402
import hydro  # noqa: E402
import layout  # noqa: E402
import pois as PO  # noqa: E402
import export  # noqa: E402
import mapart  # noqa: E402
import preview  # noqa: E402
import check  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SCRATCH = os.environ.get('WG_SCRATCH', os.path.join(HERE, '_build'))
T0 = time.time()


def log(*a):
    print('[worldgen %6.1fs]' % (time.time() - T0), *a, flush=True)


def build_heights(G, owner):
    H = np.full((G.n, G.n), D.FLOOR, dtype=np.float64)
    H += (fbm(G.X / 900., G.Z / 900., 3, 5) - .5) * 10  # gentle undulation of the ocean / canyon floor
    apply_tables(G, H, D.T, D.FLOOR, owner, os.path.join(SCRATCH, 'tcache'))
    log('tables', len(D.T))
    apply_canyons(G, H, D.CANYONS, D.BRIDGES, D.FLOOR)
    log('canyons')
    apply_ramps(G, H, D.RAMPS, log)
    log('ramps')
    edge_falloff(G, H)
    log('world edge')
    return H


def edge_falloff(G, H):
    """everything reaches the ocean before the out-of-bounds line (|x| or |z| = 7700): land near the world edge
    is cut down by a steep, noise-warped sea cliff, so no plateau runs off the map."""
    m = np.maximum(np.abs(G.X), np.abs(G.Z))
    e = 7660.0 - m + (fbm(G.X / 420. + 7, G.Z / 420. - 3, 3, 977) - .5) * 260
    cap = -4.0 + np.maximum(e - 40.0, 0) * 2.6
    np.minimum(H, cap, out=H)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'm'))
    ap.add_argument('--map-size', type=int, default=2048)
    ap.add_argument('--no-map', action='store_true')
    args = ap.parse_args()
    os.makedirs(SCRATCH, exist_ok=True)
    G = Grid(1025, 8000.0)
    owner = np.full((G.n, G.n), -1, np.int16)
    H = build_heights(G, owner)
    lakes = hydro.apply_lakes(G, H, D.LAKES, log)
    rivs = hydro.river_profiles(G, H, D.RIVERS, lakes, D.CLOUD_Y, D.FLOOR, log)
    hydro.carve_rivers(G, H, rivs)
    log('rivers carved')
    R = layout.region_raster(G, owner, D.T, D.REGIONS, 2, log)
    LID = hydro.lake_id_raster(G, lakes, R.shape[0])
    M0 = layout.masks(G, H, R, D, rivs, lakes, LID, [], 2, log)
    F = PO.Field(G, H, R, LID, M0['cloud'], D.MIST)
    fixed = PO.place_fixed(F, D, lakes, rivs, D.CLOUD_Y, log)
    sp0 = [p for p in fixed if p['id'] == 'spawn'][0]
    walk = check.walk_map(G, H, R, M0, D, (sp0['x'], sp0['z']), SCRATCH)
    generic = PO.place_generic(F, D, fixed, lakes, rivs, D.CLOUD_Y, log, walk=walk)
    pois = fixed + generic
    PO.nudge_out_of_rivers(F, pois, rivs, log)
    PO.apply_pads(G, H, pois)
    F = PO.Field(G, H, R, LID, M0['cloud'], D.MIST)
    roads = PO.route_roads(F, D, pois, lakes, rivs, D.CLOUD_Y, SCRATCH, log)
    crossings = PO.grade_crossings(roads, rivs, log)
    PO.apply_roads(G, H, roads)
    PO.apply_pads(G, H, pois)  # pads win over road grading
    log('pads + roads applied')
    PO.final_heights(G, H, pois, log)
    M = layout.masks(G, H, R, D, rivs, lakes, LID, pois, 2, log)
    sp = [p for p in pois if p['id'] == 'spawn'][0]
    spawn = dict(x=sp['x'], y=sp['y'], z=sp['z'], ry=sp['ry'])
    extra = dict(crossings=crossings,
                 slots=[dict(p['slot'], id=p['id']) for p in pois if p.get('slot')],
                 pads=[q for p in pois for q in p.get('pads', [])])
    for p in pois:
        p.pop('slot', None)
        p.pop('pads', None)
    export.write_all(args.out, D, G, H, R, LID, M, lakes, rivs, roads, pois, spawn, log, extra)
    np.save(os.path.join(SCRATCH, 'H.npy'), H.astype(np.float32))
    np.save(os.path.join(SCRATCH, 'R.npy'), R)
    check.report(G, H, R, LID, M, lakes, rivs, pois, D, log, SCRATCH)
    # diagnostics preview
    labels = [(r['x'], r['z'], r['id'], (255, 255, 0)) for r in D.REGIONS]
    lines = [([tuple(q) for q in rv['P'][::3]], (40, 90, 255), 2) for rv in rivs]
    lines += [([tuple(q) for q in rd['P'][::3]], (200, 60, 20), 1) for rd in roads]
    pts = [(p['x'], p['z'], (255, 0, 255) if not p['id'].startswith('p_') else (0, 0, 0), 3) for p in pois]
    preview.render(H, G.cell, os.path.join(SCRATCH, 'prev_heights.png'), cloud=(H < D.CLOUD_Y) * 0.6, lines=lines,
                   labels=labels, points=pts)
    if not args.no_map:
        img = mapart.paint(D, G, H, R, M, lakes, LID, rivs, roads, args.map_size)
        img = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT)  # palette PNG: ~1.9 MB instead of ~6 MB
        img.save(os.path.join(args.out, 'map5.png'), optimize=True)
        log('map5.png %.2f MB' % (os.path.getsize(os.path.join(args.out, 'map5.png')) / 1e6))
    log('done')


if __name__ == '__main__':
    main()
