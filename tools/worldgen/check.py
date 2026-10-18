"""Generator self-checks: walkable connectivity from the spawn, POI reachability, cliff/fall statistics."""
import os
import json
import subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def flood(G, H, blocked, starts, max_grade, scratch):
    hf = os.path.join(scratch, 'fl_h.f32')
    bf = os.path.join(scratch, 'fl_b.u8')
    of = os.path.join(scratch, 'fl_out.u8')
    H.astype('<f4').tofile(hf)
    blocked.astype(np.uint8).tofile(bf)
    job = dict(n=G.n, cell=G.cell, hFile=hf, blockFile=bf, maxGrade=max_grade, starts=[int(s) for s in starts],
               outFile=of)
    jf = os.path.join(scratch, 'fl_job.json')
    json.dump(job, open(jf, 'w'))
    subprocess.run(['node', os.path.join(HERE, 'flood.js'), jf], capture_output=True, text=True, check=True)
    return np.fromfile(of, np.uint8).reshape(G.n, G.n).astype(bool)


def report(G, H, R, LID, M, lakes, rivs, pois, D, log, scratch):
    n = G.n
    step = (n - 1) // (R.shape[0] - 1)
    Rf = np.kron(R, np.ones((step, step), np.uint8))[:n, :n]
    cl = np.kron(M['cloud'], np.ones((step, step)))[:n, :n]
    # falling into the cloud deck = respawn: low ground under the deck is not walkable; deep water is swimmable
    blocked = ((H < D.CLOUD_Y - 2) & (cl > 0.35)) | (H < -6)
    blocked |= (np.abs(G.X) > 7700) | (np.abs(G.Z) > 7700)
    mist = np.hypot(G.X - D.MIST['x'], G.Z - D.MIST['z']) < D.MIST['r']
    sp = [p for p in pois if p['id'] == 'spawn'][0]
    s0 = int(round((sp['z'] + G.ws) / G.cell)) * n + int(round((sp['x'] + G.ws) / G.cell))
    reach = flood(G, H, blocked | mist, [s0], 0.84, scratch)
    reach_m = flood(G, H, blocked, [s0], 0.84, scratch)
    land = ~blocked & (H > 1)
    rows = []
    for r in range(16):
        m = land & (Rf == r)
        tot = int(m.sum())
        rf = float((reach & m).sum()) / max(tot, 1)
        rows.append('%s %.0f%%' % (D.REGIONS[r]['id'], rf * 100))
    log('reachable (no mist) per region:', ', '.join(rows))
    m16 = land & mist
    log('mist interior reachable: blocked-mist %.0f%%, through-mist %.0f%%' % (
        100 * (reach & m16).sum() / max(m16.sum(), 1), 100 * (reach_m & m16).sum() / max(m16.sum(), 1)))
    bad = []
    for p in pois:
        j = int(round((p['z'] + G.ws) / G.cell))
        i = int(round((p['x'] + G.ws) / G.cell))
        ok = reach_m[max(0, min(n - 1, j)), max(0, min(n - 1, i))]
        if not ok and p['kind'] not in ('chest_underwater', 'rope_bridge'):
            bad.append((p['id'], p['region'] + 1))
    log('POIs not reachable on foot (%d):' % len(bad), bad)
    gz, gx = np.gradient(H, G.cell)
    sl = np.hypot(gx, gz)
    log('cliff cells (>70 deg): %.1f%% of land; max height %.0f m; falls %d' % (
        100 * (sl > 2.75).sum() / max((H > 1).sum(), 1), H.max(), sum(len(r['falls']) for r in rivs)))
    np.save(os.path.join(scratch, 'reach.npy'), reach_m)
