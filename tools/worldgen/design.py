"""Hand-authored layout of the 16 km world (dev-only data for gen.py).

Coordinates: x, z in metres, world square [-8000, 8000]^2, north = -z, sea level 0.
Primitives (applied in gen.py in this order):
  TABLES   plateau/terrace tables, max-composited. top = h + gradient + rolling noise + bumps; edges are sheer cliffs
           (k = drop rate, optional ledges) except inside 'soft' zones (x, z, r, tan) where the edge becomes a slope.
  CANYONS  cloud-filled clefts carved (min) to a floor, with protected land bridges.
  RAMPS    cut-and-fill corridors with a linear profile (walkable connections up and down cliffs, natural bridges).
  LAKES    basins with a fixed surface level.
  RIVERS   polylines (source -> mouth); surface heights and waterfalls are computed by gen.py.
  ROUTES   road network (A* routed between waypoints by gen.py).
"""

CLOUD_Y = 90.0

REGIONS = [
    # id, nome, centre, map-label offset
    dict(id='r1', nome='Vale do Amanhecer', x=-1200, z=5600),
    dict(id='r2', nome='Colinas dos Moinhos', x=2600, z=5400),
    dict(id='r3', nome='Costa Turquesa', x=-5600, z=6000),
    dict(id='r4', nome='Lagos Espelhados', x=5800, z=5600),
    dict(id='r5', nome='Penhascos das Cachoeiras', x=-5000, z=1500),
    dict(id='r6', nome='Bosque dos Totens', x=-1400, z=1600),
    dict(id='r7', nome='Cidade Alta', x=2400, z=1400),
    dict(id='r8', nome='Floresta Azul', x=5800, z=1600),
    dict(id='r9', nome='Arquipélago das Nuvens', x=-5200, z=-2600),
    dict(id='r10', nome='Desfiladeiro das Brumas', x=-1200, z=-2200),
    dict(id='r11', nome='Bosque Lunar', x=2200, z=-2600),
    dict(id='r12', nome='Terras de Brasa', x=5800, z=-2400),
    dict(id='r13', nome='Montes do Vento', x=-4800, z=-6200),
    dict(id='r14', nome='Ermo Dourado', x=-600, z=-6000),
    dict(id='r15', nome='Planalto dos Ventos Altos', x=2400, z=-5800),
    dict(id='r16', nome='Terra Velada', x=6000, z=-6000, hidden=True),
]

# region ownership polygons (coarse; gen.py warps the borders). Index = region index.
REGION_SEEDS = [(r['x'], r['z']) for r in REGIONS]

FLOOR = -32.0  # ocean floor / bottom of the cloud canyons

T = []


def table(id, poly, h, **kw):
    d = dict(id=id, poly=poly, h=h)
    big = not (isinstance(poly, tuple) and poly[0] == 'circle')
    if big:
        xs = [q[0] for q in poly]
        zs = [q[1] for q in poly]
        big = max(max(xs) - min(xs), max(zs) - min(zs)) > 1500
    if big and kw.get('edge', 'cliff') == 'cliff':
        d.update(coast=(330, 2300.))
    d.update(kw)
    if 'warp' in d and big:
        d['warp'] = (d['warp'][0] * 1.8, d['warp'][1] * 0.8)
    if big and d.get('edge', 'cliff') == 'cliff':
        d['amp1'] = d.get('amp1', 0) * 1.7
        d['amp2'] = d.get('amp2', 0) * 1.5
    T.append(d)
    return d


import random as _random


def _inside(poly, x, z):
    c = False
    n = len(poly)
    for i in range(n):
        ax, az = poly[i]
        bx, bz = poly[(i + 1) % n]
        if (az > z) != (bz > z) and x < ax + (z - az) * (bx - ax) / (bz - az):
            c = not c
    return c


def autosteps(poly, n, seed, avoid=(), dh=(18, 55), r=(180, 600), neg=0.35, k=(2.5, 8)):
    """n random internal escarpments (raised or sunken sub-tables) inside a polygon."""
    R = _random.Random(seed)
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    out = []
    tries = 0
    while len(out) < n and tries < 400:
        tries += 1
        x = R.uniform(min(xs), max(xs))
        z = R.uniform(min(zs), max(zs))
        rr = R.uniform(*r)
        if not _inside(poly, x, z):
            continue
        if any((x - ax) ** 2 + (z - az) ** 2 < (ar + rr) ** 2 for ax, az, ar in avoid):
            continue
        if any((x - o[0]) ** 2 + (z - o[1]) ** 2 < (o[2] + rr) ** 2 * 0.5 for o in out):
            continue
        h = R.uniform(*dh) * (-0.7 if R.random() < neg else 1)
        out.append((round(x), round(z), round(rr), round(h, 1), round(R.uniform(*k), 2)))
    return out


def tilted(p0, h0, p1, h1):
    """gradient (gx, gz) and reference so that the top is h0 at p0 and h1 at p1."""
    dx = p1[0] - p0[0]
    dz = p1[1] - p0[1]
    L2 = dx * dx + dz * dz
    g = (h1 - h0) / L2
    return dict(h=h0, grad=(g * dx, g * dz), gref=p0)


# ------------------------------------------------------------------ R3 coast (low, beaches, clear sky)
R3P = [(-7400, 3450), (-6500, 3250), (-5600, 3400), (-4000, 3650), (-2700, 3900), (-2350, 5000), (-2500, 6400),
       (-3200, 7250), (-3900, 7450), (-4400, 7300), (-4750, 6950), (-5200, 6750), (-5700, 7000), (-6100, 7450),
       (-6700, 7300), (-7300, 6750), (-7600, 5800), (-7550, 4500)]
table('r3_plain', R3P, h=22, grad=(0.011, -0.002), gref=(-6500, 5500), amp1=10, amp2=3, warp=(260, 1 / 1500.),
      jag=8, edge='slope', tan=0.03, seed=31,
      bumps=[(-6650, 6650, 300, 16), (-4300, 6200, 600, 12), (-3200, 5200, 700, 22), (-5800, 4200, 500, 14)])
table('r3_head', [(-7000, 6400), (-6500, 6350), (-6300, 6750), (-6600, 7100), (-7000, 6950)], h=46, amp1=4, amp2=2,
      warp=(70, 1 / 600.), jag=7, k=7, seed=32)  # lighthouse headland
table('r3_cliffs', [(-7550, 3950), (-6950, 3850), (-6850, 5100), (-7300, 5650), (-7650, 4900)], h=62, amp1=8,
      warp=(150, 1 / 800.), jag=10, k=8, seed=33)
for i, (x, z, r, h) in enumerate([(-7400, 6950, 45, 38), (-7150, 7350, 30, 52), (-6850, 7600, 55, 30),
                                  (-7850, 6150, 40, 44), (-5250, 7550, 35, 28), (-4300, 7800, 60, 36),
                                  (-7950, 5300, 50, 40), (-5550, 7350, 26, 33)]):
    table('r3_stack%d' % i, ('circle', x, z, r), h, amp1=3, amp2=1, warp=(r * .4, 1 / 150.), jag=4, k=9, seed=40 + i)
# hilly descent from the spawn terrace to the coast
table('r1_west', [(-3400, 4350), (-2500, 4450), (-2300, 5800), (-2450, 6650), (-3250, 6800), (-3900, 6000),
                  (-4000, 4900)], edge='slope', tan=0.13, amp1=10, amp2=4, warp=(160, 1 / 1000.), jag=6, seed=35,
      **tilted((-2450, 5500), 182, (-3950, 5500), 72))

# ------------------------------------------------------------------ R1 spawn valley (mid terrace) + lower steps east
R1P = [(-2950, 4100), (-1800, 3950), (-1000, 3900), (-450, 3980), (-170, 4280), (-330, 4700), (-400, 5000),
       (-520, 5350), (-470, 5800), (-370, 6200), (-500, 6560), (-1000, 6870), (-1800, 6970), (-2500, 6780),
       (-2950, 6200), (-3100, 5300)]
table('r1_terrace', R1P, h=200, grad=(0.0, 0.003), gref=(-1200, 5000), amp1=18, amp2=7, warp=(140, 1 / 1100.),
      jag=9, k=11, ledge=0.45, seed=1, coast=(260, 2000.),
      calm=[(-1100, 3950, 1300), (-450, 4900, 900), (-450, 6350, 500)],
      soft=[(-3000, 5500, 1300, 0.15)],
      bumps=[(-2050, 5850, 820, 84), (-2500, 5100, 420, 22), (-900, 6300, 420, 18), (-1500, 4500, 380, 10),
             (-1420, 5420, 760, 118)],
      steps=[(-760, 4840, 420, -30, 2.2)])
table('r1_step1', [(-640, 4650), (-300, 4600), (-170, 4880), (-230, 5250), (-520, 5380), (-680, 5100)],
      h=154, amp1=4, amp2=2, warp=(60, 1 / 550.), jag=8, k=10, seed=2)
table('r1_step2', [(-380, 5080), (-60, 5000), (20, 5280), (-180, 5500), (-400, 5420)],
      h=117, amp1=3, amp2=2, warp=(45, 1 / 420.), jag=8, k=10, seed=3)

# ------------------------------------------------------------------ R6 the big plateau north of the spawn
R6P = [(-3800, -550), (-1800, -800), (-300, -700), (650, -350), (900, 600), (700, 1500), (430, 2500), (250, 3300),
       (0, 3850), (-150, 4300), (-480, 4220), (-750, 4060), (-1000, 3990), (-1300, 4000), (-1650, 4060),
       (-1950, 4190), (-2300, 4270), (-2700, 4240), (-3100, 4150), (-3450, 3750), (-3750, 2600), (-3900, 1200)]
table('r6_plateau', R6P, h=466, grad=(0.042, 0.0), gref=(-1300, 2000), amp1=20, amp2=7, warp=(150, 1 / 1300.),
      jag=11, k=13, ledge=0.6, ledges=2, seed=6, calm=[(-1250, 4150, 1300), (300, 2800, 1100), (-2700, 4100, 500)],
      soft=[(-1500, -700, 1100, 0.15)],
      bumps=[(-330, 4020, 750, 46), (-2400, 1100, 600, 14)],
      steps=autosteps(R6P, 7, 6, avoid=[(-1250, 3500, 900), (-1300, 1600, 350), (-2200, 2250, 300), (0, 3900, 500)]))

# the prow: a giant tilted slab rising out of the SE corner of the plateau (seen from the spawn as in the concept
# art: a sheer face under a meadow top that climbs to a high point over the clouds; walkable from its low SW end)
table('r6_prow', [(-960, 4150), (-600, 4225), (-380, 4275), (-150, 4335), (70, 3880), (320, 3280), (510, 2620),
                  (420, 2330), (120, 2420), (-250, 2800), (-700, 3150), (-1000, 3500)],
      edge='cliff', k=14, ledge=0.5, ledges=2, amp1=8, amp2=3, warp=(80, 1 / 900.), jag=8, seed=7,
      soft=[(-1000, 3700, 450, 0.3)],
      **tilted((-960, 3600), 478, (440, 3600), 820))

# ------------------------------------------------------------------ R5 waterfall cliffs (high plateau + lower step)
R5P = [(-7300, -600), (-6200, -1000), (-5000, -850), (-3900, -900), (-3300, -300), (-3200, 1300), (-3150, 2500),
       (-3650, 3050), (-4600, 3150), (-5900, 3100), (-6900, 2750), (-7350, 1500)]
table('r5_plateau', R5P, h=512, grad=(0.0, 0.006), gref=(-5000, 1500), amp1=22, amp2=8, warp=(170, 1 / 1200.),
      jag=14, k=14, ledge=0.65, ledges=2, seed=11,
      steps=autosteps(R5P, 6, 11, avoid=[(-5000, 1500, 700), (-4300, 2300, 400)], dh=(20, 60)))
table('r5_lower', [(-6850, 2650), (-3800, 2750), (-3600, 3650), (-4500, 3950), (-6100, 3900), (-7050, 3400)],
      h=276, amp1=10, amp2=4, warp=(120, 1 / 850.), jag=10, k=11, ledge=0.4, seed=12)

# ------------------------------------------------------------------ R2 windmill hills + the broad valley north of them
R2P = [(850, 4150), (1700, 4300), (2600, 4250), (3500, 4350), (4100, 4700), (4500, 5300), (4550, 6100),
       (4150, 6850), (3200, 7150), (2200, 7150), (1300, 6900), (850, 6400), (720, 5600), (800, 4800)]
table('r2_hills', R2P, h=232, amp1=34, amp2=10, warp=(150, 1 / 1200.), jag=10, k=11, ledge=0.5, seed=21,
      calm=[(850, 6350, 500), (2200, 4300, 1200)],
      soft=[(2300, 4050, 1400, 0.42), (4500, 4800, 800, 0.15)],
      bumps=[(2900, 5150, 520, 42), (1700, 5750, 520, 30), (3700, 6200, 450, 24)],
      ridges=[([(1150, 4900), (1800, 4720), (2400, 4760), (3100, 4950)], 650, 190)])
VP = [(600, 2300), (1300, 2100), (2000, 2650), (2900, 2800), (3500, 2700), (3750, 3250), (3700, 4050),
      (2700, 4400), (1600, 4400), (900, 4150), (620, 3400)]
table('vale_largo', VP, h=196, grad=(0.004, -0.03), gref=(2000, 3500), amp1=14, amp2=6, warp=(120, 1 / 1000.),
      jag=8, k=10, seed=22, soft=[(3900, 3100, 800, 0.13), (2100, 4400, 1100, 0.1)],
      steps=[(1500, 3000, 300, 16, 1.2), (2900, 3500, 260, -10, 1.0)])

# ------------------------------------------------------------------ R7 high town plateau (tilted) + upper table behind
R7P = [(1250, 300), (2300, 150), (3250, 300), (3600, 800), (3700, 1700), (3760, 2300), (3560, 2720), (3150, 2640),
       (2700, 2330), (2150, 2150), (1450, 2000), (1150, 1500), (1100, 900)]
table('r7_plateau', R7P, h=625, grad=(0.0, -0.035), gref=(2700, 1300), amp1=12, amp2=5, warp=(130, 1 / 1000.),
      jag=12, k=14, ledge=0.55, seed=71, coast=(200, 1600.), calm=[(1300, 2000, 700), (2500, 2250, 900)],
      bumps=[(2700, 1300, 260, 5)])
# the town's south face is a sheer cliff over the broad valley (the Annecy view looks across the valley at it);
# a short concave meadow foot (forest, the valley road) instead of a long convex hill that would hide the town
table('r7_foot', [(1650, 2150), (2550, 2250), (2650, 2500), (2300, 2700), (1900, 2650)],
      edge='slope', tan=0.22, amp1=6, amp2=3, warp=(90, 1 / 700.), jag=5, seed=74,
      **tilted((2150, 2650), 205, (2150, 2200), 268))
table('r7_slope', [(850, 1500), (1500, 1350), (1750, 2100), (1550, 2650), (1000, 2550), (780, 2000)],
      edge='slope', tan=0.3, amp1=6, amp2=2, warp=(70, 1 / 700.), jag=5, seed=73,
      **tilted((1150, 2500), 262, (1520, 1650), 610))
table('r7_upper', [(900, -650), (1700, -650), (2300, -250), (2200, 350), (1650, 700), (950, 600), (700, 0)],
      h=742, coast=(0, 0), amp1=9, amp2=3, warp=(110, 1 / 900.), jag=10, k=13, ledge=0.5, seed=72)

# ------------------------------------------------------------------ Lago Grande basin (clear valley at the foot of R7)
table('lago_basin', [(3500, -500), (4800, -650), (5200, 600), (5150, 2200), (5050, 3600), (4400, 3950),
                      (3700, 3750), (3200, 3400), (3150, 2850), (3600, 2750), (3600, 1200)],
      h=132, amp1=4, amp2=2, warp=(130, 1 / 1000.), jag=6, edge='slope', tan=0.1, seed=81)
table('outflow', [(5000, 3350), (7150, 3280), (7350, 3950), (5300, 4050)], h=124, grad=(-0.002, 0),
      gref=(5000, 3700), amp1=3, amp2=2, warp=(90, 1 / 800.), jag=6, edge='slope', tan=0.12, seed=82)

# ------------------------------------------------------------------ R8 blue forest hills
R8P = [(4900, -1350), (6100, -1450), (7400, -1050), (7500, 800), (7400, 2400), (7150, 3250), (6100, 3400),
       (5300, 3300), (5150, 1800), (5050, 500)]
table('r8_hills', R8P, h=330, amp1=40, amp2=8, warp=(150, 1 / 1200.), jag=10, k=11, ledge=0.5, seed=91,
      soft=[(4900, 1500, 1700, 0.2), (6000, 3600, 1000, 0.16), (5300, -1100, 700, 0.18)],
      steps=autosteps(R8P, 4, 91, dh=(18, 40), k=(0.8, 3)))

# ------------------------------------------------------------------ R4 stepped lake terraces
table('r4_d', [(3950, 3820), (4900, 3720), (5500, 4200), (5420, 4900), (4700, 5100), (4120, 4700)], h=168,
      amp1=4, amp2=2, warp=(100, 1 / 900.), jag=8, k=9, seed=41, soft=[(3900, 4200, 500, 0.12)])
table('r4_c', [(4700, 4480), (5500, 4280), (6100, 4800), (6020, 5600), (5300, 5820), (4820, 5400)], h=212,
      amp1=4, amp2=2, warp=(100, 1 / 900.), jag=8, k=9, seed=42, soft=[(4600, 5300, 400, 0.14)])
table('r4_b', [(5500, 5000), (6400, 4900), (6900, 5500), (6700, 6400), (5900, 6620), (5400, 6000)], h=257,
      amp1=4, amp2=2, warp=(100, 1 / 900.), jag=8, k=9, seed=43, soft=[(5450, 6050, 300, 0.16)])
table('r4_a', [(6300, 5600), (7200, 5500), (7300, 6500), (6800, 7100), (6100, 6900), (6000, 6200)], h=302,
      amp1=5, amp2=2, warp=(100, 1 / 900.), jag=8, k=9, seed=44, soft=[(6050, 6600, 300, 0.16)])

# ------------------------------------------------------------------ R10 canyon plateau (carved by CANYONS)
R10P = [(-3500, -700), (-2200, -1000), (-800, -800), (500, -1100), (1100, -2200), (900, -3600), (450, -4550),
        (-1200, -4750), (-2700, -4650), (-3350, -3500), (-3600, -2000)]
table('r10_plateau', R10P, h=402, amp1=16, amp2=6, warp=(150, 1 / 1000.), jag=12, k=12, ledge=0.5, seed=101,
      soft=[(-1200, -4500, 900, 0.12), (-1500, -600, 900, 0.15)])

# ------------------------------------------------------------------ R11 moon forest plateau
R11P = [(600, -900), (1800, -1150), (3000, -900), (4300, -1300), (4550, -2500), (4350, -4200), (3000, -4550),
        (1300, -4550), (700, -3600), (900, -2200)]
table('r11_plateau', R11P, h=458, amp1=18, amp2=6, warp=(140, 1 / 1000.), jag=10, k=12, ledge=0.5, seed=111,
      soft=[(650, -2400, 700, 0.2)],
      steps=autosteps(R11P, 4, 111, avoid=[(1900, -3300, 400), (2400, -2600, 300)], dh=(14, 34), k=(1, 5)))

# ------------------------------------------------------------------ R12 ember lands: low base + red mesas
table('r12_base', [(4150, -950), (5600, -850), (7300, -800), (7600, -2500), (7400, -4300), (6200, -4800),
                   (4700, -4750), (4100, -2700)], h=238, amp1=20, amp2=7, warp=(150, 1 / 1100.), jag=10, k=10, ledge=0.4,
      seed=121, soft=[(5600, -1100, 900, 0.18)])
for i, (x, z, r, h) in enumerate([(5200, -2000, 320, 382), (6350, -1750, 260, 420), (6050, -3050, 380, 452),
                                  (6950, -3300, 210, 360), (5000, -3500, 230, 338), (5700, -3900, 160, 400)]):
    table('r12_mesa%d' % i, ('circle', x, z, r), h, amp1=4, amp2=2, warp=(r * .45, 1 / 320.), jag=10, k=9,
          ledge=0.85, ledges=2, seed=130 + i)

# ------------------------------------------------------------------ R13 windy peaks (high massif)
R13P = [(-7400, -7200), (-6200, -7600), (-4700, -7450), (-3300, -7500), (-2400, -7000), (-2300, -5900),
        (-2450, -4800), (-3300, -4500), (-4300, -4650), (-5200, -4400), (-6300, -4750), (-7000, -5000), (-7500, -6000)]
table('r13_massif', R13P, h=585, amp1=20, amp2=6, warp=(170, 1 / 1200.), jag=14, k=12, ledge=0.6, seed=131,
      ridges=[([(-6900, -5300), (-6200, -6000), (-5300, -6450), (-4500, -6900), (-3600, -6800)], 720, 255),
              ([(-5300, -6450), (-5050, -5900), (-4700, -5400)], 480, 190),
              ([(-6200, -6000), (-6600, -6700)], 420, 150),
              ([(-4500, -6900), (-4100, -7300)], 380, 120)])

# ------------------------------------------------------------------ R14 golden steppe
R14P = [(-2900, -7300), (-1500, -7600), (200, -7400), (1300, -7200), (1400, -6000), (1300, -4700), (500, -4200),
        (-800, -4100), (-2000, -4300), (-2900, -4700), (-3000, -6000)]
table('r14_steppe', R14P, h=420, amp1=22, amp2=6, warp=(150, 1 / 1300.), jag=10, k=11, ledge=0.5, seed=141,
      soft=[(-1300, -4400, 1000, 0.12)],
      steps=autosteps(R14P, 4, 141, avoid=[(-200, -5300, 300)], dh=(10, 26), k=(0.6, 2.5)))

# ------------------------------------------------------------------ R15 high windy plateau
R15P = [(900, -7400), (2600, -7550), (4100, -7300), (4380, -6200), (4350, -5000), (3900, -4350), (2800, -4100),
        (1600, -4250), (900, -4900), (800, -6300)]
table('r15_high', R15P, h=682, amp1=18, amp2=7, warp=(150, 1 / 1200.), jag=12, k=13, ledge=0.55, seed=151,
      bumps=[(2500, -5900, 500, 14)],
      steps=autosteps(R15P, 4, 151, avoid=[(2500, -5900, 400), (3200, -6700, 300)], dh=(12, 30), k=(1, 4)))

# ------------------------------------------------------------------ R16 the highest plateau, ringed by cliffs
table('r16_high', ('circle', 6000, -6000, 1430), 728, coast=(300, 2000.), calm=[(4700, -5950, 400)], amp1=10, amp2=3, warp=(280, 1 / 1400.), jag=14, k=14,
      ledge=0.65, ledges=2, seed=161, bumps=[(6000, -6000, 380, 14)])

# ------------------------------------------------------------------ R9 islets over the cloud sea
ISLETS = [
    # chain from the rim to the highest islet (gaps of 25-40 m, rising)
    ('islet_low', -3650, -2350, 120, 248),
    ('isl_c1', -3900, -2700, 70, 395),
    ('isl_c2', -4080, -2860, 55, 412),
    ('isl_c3', -4260, -3000, 60, 430),
    ('islet_mid', -4560, -2950, 150, 452),
    ('isl_c5', -4840, -3120, 60, 476),
    ('isl_c6', -5040, -3260, 55, 500),
    ('isl_c7', -5250, -3380, 60, 524),
    ('griffin_nest', -5560, -3420, 130, 562),
    # free islets
    ('isl_a', -4300, -1800, 180, 300), ('isl_b', -5100, -2000, 110, 220), ('isl_c', -5900, -2400, 220, 380),
    ('isl_d', -6600, -1800, 140, 260), ('isl_e', -6400, -3300, 160, 330), ('isl_f', -5800, -4000, 90, 410),
    ('isl_g', -4600, -3900, 120, 280), ('isl_h', -6900, -2600, 80, 190), ('isl_i', -3800, -3500, 100, 350),
    ('isl_j', -5400, -1400, 70, 170), ('isl_k', -4900, -2450, 45, 260), ('isl_l', -6100, -1300, 60, 230),
    ('isl_m', -7000, -3900, 120, 300), ('isl_n', -3500, -4000, 60, 240),
]
for i, (nm, x, z, r, h) in enumerate(ISLETS):
    table('isl:' + nm, ('circle', x, z, r), h, amp1=3, amp2=1.5, warp=(r * .38, 1 / (r * 2.2)), jag=6, k=10,
          ledge=0.7, seed=200 + i, islet=nm)

# ------------------------------------------------------------------ canyons (min-carve), widths in metres
CANYONS = [
    # R10 cloud canyon network
    dict(id='c1', pts=[(-3600, -1450), (-2400, -1700), (-1500, -1480), (-800, -1820), (-200, -1700), (300, -1900)],
         w=(210, 150), floor=FLOOR, k=12, seed=301),
    dict(id='c2', pts=[(-2250, -3900), (-1950, -2950), (-1550, -2350), (-1350, -1650)], w=(170, 120), floor=FLOOR,
         k=12, seed=302),
    dict(id='c3', pts=[(-3500, -2950), (-2450, -2600), (-1700, -2750), (-950, -3050), (-300, -2700), (320, -3150)],
         w=(200, 130), floor=FLOOR, k=12, seed=303),
    dict(id='c4', pts=[(-700, -4500), (-820, -3650), (-1000, -3050)], w=(150, 110), floor=FLOOR, k=12, seed=304),
    dict(id='c5', pts=[(-420, -1150), (-260, -2150), (80, -2700)], w=(120, 90), floor=FLOOR, k=12, seed=305),
    # R5 river gorge (floor rises northwards)
    dict(id='gorge', pts=[(-4900, -250), (-5050, 700), (-4850, 1550), (-5100, 2400), (-5250, 3150), (-5480, 3900)],
         w=(420, 560), floor=(195, 46), k=12, ledge=0.5, seed=311),
    # the lake outflow valley (soft walls) towards the east coast
    dict(id='outvalley', pts=[(4600, 3450), (5000, 3650), (5800, 3600), (6600, 3700), (7300, 3650), (7800, 3620)],
         w=(240, 300), floor=(118, 100), k=0.45, seed=331),
    # cleft between R15 and R16 (crossed by the saddle ramp)
    dict(id='cleft16', pts=[(4500, -7600), (4520, -6600), (4480, -5300), (4550, -4300)], w=(220, 260), floor=FLOOR,
         k=13, seed=321),
]
# land bridges: canyon carving is suppressed in these corridors (x0, z0, x1, z1, width)
BRIDGES = [
    (-1180, -1820, -1150, -1420, 46),   # c1 crossing on the R6 -> R14 trail
    (-1820, -2600, -1450, -2780, 40),   # c2/c3 junction crossing
    (-2160, -2480, -2160, -2920, 56),   # c3 crossing between the hermit tower and the rope bridge
    (-1250, -3200, -1350, -2700, 44),   # c3 crossing towards R14
    (-330, -2250, -100, -2350, 38),     # c5 crossing towards R11
    (-560, -3150, -380, -2850, 40),     # c3 east crossing
]

# ------------------------------------------------------------------ ramps (cut-and-fill corridors): pts with heights
RAMPS = [
    # lo/hi = ends well inside the lower/upper table (their heights are sampled from the terrain there);
    # via = intermediate points; the ramp is a cut-and-fill corridor with a linear grade between the ends.
    dict(id='rp_r1r6', lo=(-2400, 4800), via=[(-2560, 4250), (-2700, 3800)], hi=(-2900, 3100), w=34),
    dict(id='rp_bridge12', lo=(-800, 6330), via=[(100, 6300)], hi=(1250, 6380), w=44, fill_k=5),
    dict(id='rp_r6r5', lo=(-2800, 1500), hi=(-3800, 1450), w=40),
    dict(id='rp_r6vale', lo=(1300, 2900), via=[(820, 2450), (650, 2050)], hi=(200, 1700), w=34),
    dict(id='rp_r7r11', lo=(2800, -1500), via=[(2850, -200)], hi=(2700, 700), w=36, fill_k=3),
    dict(id='rp_r7up', lo=(1750, 1300), via=[(1850, 600)], hi=(1600, 50), w=30),
    dict(id='rp_r12r11', lo=(5000, -2400), via=[(4400, -2200)], hi=(3600, -2000), w=36),
    dict(id='rp_r14r13', lo=(-2100, -5600), via=[(-2800, -5500), (-3150, -5650)], hi=(-3700, -6050), w=34),
    dict(id='rp_r14r15', lo=(300, -5200), via=[(1050, -5300), (1300, -5650)], hi=(1800, -6100), w=36),
    dict(id='rp_r11r15', lo=(2900, -3300), via=[(3100, -4300)], hi=(3150, -5000), w=36),
    dict(id='rp_saddle', lo=(4000, -5900), via=[(4500, -5930)], hi=(5000, -5960), w=30, fill_k=6),
    dict(id='rp_r5r3', lo=(-4100, 4900), via=[(-4250, 4150)], hi=(-4300, 3500), w=36),
    dict(id='rp_r5up', lo=(-6300, 3150), via=[(-6500, 2550)], hi=(-6450, 1900), w=34),
    dict(id='rp_lago_r4', lo=(4300, 3400), hi=(4380, 4000), w=30),
    dict(id='rp_r4dc', lo=(4400, 4600), hi=(5150, 5100), w=30),
    dict(id='rp_r4cb', lo=(5450, 5250), hi=(5950, 5560), w=30),
    dict(id='rp_r4ba', lo=(5800, 6200), hi=(6600, 6500), w=30),
    dict(id='rp_head', lo=(-6100, 6400), hi=(-6650, 6800), w=24),
    dict(id='rp_r8r12', lo=(5450, -2000), hi=(5600, -900), w=34),
    dict(id='rp_r8lago', lo=(4950, 2050), via=[(5400, 1900)], hi=(6000, 2100), w=34),
    dict(id='rp_mesa', lo=(5500, -2600), via=[(5620, -3050)], hi=(5880, -3260), w=22),
]

# ------------------------------------------------------------------ lakes: centre, radii (ellipse) or polygon, level
LAKES = [
    dict(id='lk_falls', x=-700, z=4440, rx=330, rz=90, rot=-0.05, level=None, depth=5),
    dict(id='lk_grande', poly=[(3800, -300), (4500, -400), (4800, 300), (4750, 1500), (4650, 2600), (4500, 3400),
                               (4100, 3550), (3700, 3380), (3360, 3150), (3420, 2930), (3800, 2850), (3900, 1900),
                               (3750, 700)], level=125.0, depth=14),
    dict(id='lk_d', x=4620, z=4330, rx=360, rz=260, rot=0.4, level=None, depth=7),
    dict(id='lk_c', x=5420, z=5020, rx=330, rz=240, rot=-0.3, level=None, depth=7),
    dict(id='lk_b', x=6180, z=5720, rx=360, rz=260, rot=0.6, level=None, depth=7),
    dict(id='lk_a', x=6720, z=6280, rx=300, rz=240, rot=0.2, level=None, depth=7),
    dict(id='lk_totens', x=-2200, z=2250, rx=160, rz=110, rot=0.3, level=None, depth=4),
    dict(id='lk_lunar', x=1900, z=-3300, rx=120, rz=90, rot=0.1, level=None, depth=3),
    dict(id='lk_tarn', x=3200, z=-6700, rx=170, rz=120, rot=0.5, level=None, depth=5),
    dict(id='lk_steppe', x=-200, z=-5300, rx=130, rz=90, rot=0.0, level=None, depth=3),
    dict(id='spring1', x=5600, z=-2500, rx=26, rz=20, rot=0.0, level=None, depth=1.6, hot=True),
    dict(id='spring2', x=5660, z=-2440, rx=18, rz=15, rot=0.0, level=None, depth=1.4, hot=True),
    dict(id='spring3', x=5540, z=-2420, rx=16, rz=14, rot=0.0, level=None, depth=1.2, hot=True),
]

# ------------------------------------------------------------------ rivers (source -> mouth); 'w' = width in metres
RIVERS = [
    # three streams of the big plateau falling behind the village
    dict(id='rv_fa', pts=[(-1500, 2900), (-1250, 3450), (-1080, 3850), (-980, 4120), (-930, 4420)], w=(6, 13),
         lake='lk_falls'),
    dict(id='rv_fb', pts=[(-560, 3250), (-640, 3600), (-680, 3900), (-690, 4120), (-690, 4430)], w=(8, 17),
         lake='lk_falls'),
    dict(id='rv_fc', pts=[(-200, 3250), (-330, 3600), (-420, 3950), (-460, 4220), (-500, 4410)], w=(6, 13),
         lake='lk_falls'),
    # the village river: from the pool under the falls, past the village, off the east cliff into the clouds
    dict(id='rv_vila', src='lk_falls', pts=[(-640, 4500), (-620, 4650), (-560, 4800), (-470, 4950), (-330, 5080), (-150, 5220),
                            (60, 5330), (250, 5380)], w=(9, 12)),
    # R5 gorge river to the sea through the coast
    dict(id='rv_gorge', pts=[(-4950, -150), (-5050, 700), (-4860, 1550), (-5100, 2400), (-5250, 3150), (-5480, 3900),
                             (-5700, 4700), (-6000, 5500), (-6350, 6300), (-6750, 7200)], w=(10, 22)),
    # R5 side streams falling into the gorge
    dict(id='rv_g1', pts=[(-6200, 300), (-5700, 500), (-5300, 650)], w=(4, 7)),
    dict(id='rv_g2', pts=[(-3900, 900), (-4400, 1250), (-4720, 1400)], w=(4, 7)),
    dict(id='rv_g3', pts=[(-6300, 1900), (-5800, 2150), (-5320, 2350)], w=(4, 7)),
    dict(id='rv_three', pts=[(-3900, 2150), (-4400, 2450), (-4900, 2600)], w=(5, 8)),
    # R7 town stream: over the east cliff into Lago Grande
    dict(id='rv_r7', pts=[(2450, 450), (2850, 880), (3150, 1230), (3450, 1480), (3700, 1640), (3980, 1720)], w=(5, 10),
         lake='lk_grande'),
    # R7 south-face fall: from the town's edge into the broad valley, then across it to Lago Grande
    dict(id='rv_r7s', pts=[(3150, 1750), (2950, 2000), (2780, 2170), (2720, 2450), (2850, 2760), (3150, 2960),
                           (3420, 3040)], w=(4, 9), lake='lk_grande'),
    # R8 streams into Lago Grande
    dict(id='rv_r8a', pts=[(6300, 600), (5700, 900), (5200, 1100), (4700, 1150)], w=(5, 9), lake='lk_grande'),
    dict(id='rv_r8b', pts=[(6500, 2300), (5800, 2500), (5100, 2750), (4600, 2900)], w=(4, 8), lake='lk_grande'),
    # Lago Grande outflow east, off the coast cliff
    dict(id='rv_out', src='lk_grande', pts=[(4500, 3420), (5000, 3650), (5800, 3600), (6600, 3700), (7300, 3650), (7700, 3620)],
         w=(14, 18)),
    # R4 cascade (lake to lake)
    dict(id='rv_r4a', src='lk_a', lake='lk_b', pts=[(6650, 6150), (6400, 5980), (6250, 5850)], w=(6, 8)),
    dict(id='rv_r4b', src='lk_b', lake='lk_c', pts=[(6000, 5500), (5750, 5250), (5550, 5120)], w=(6, 8)),
    dict(id='rv_r4c', src='lk_c', lake='lk_d', pts=[(5250, 4900), (5000, 4650), (4800, 4480)], w=(6, 9)),
    dict(id='rv_r4d', src='lk_d', lake='lk_grande', pts=[(4450, 4200), (4250, 3900), (4350, 3500)], w=(7, 10)),
    # R2 mill stream off the west cliff
    dict(id='rv_mills', pts=[(2950, 5250), (2500, 5230), (2100, 5280), (1700, 5300), (1300, 5320), (950, 5250),
                             (500, 5250)], w=(4, 7)),
    # R11 river falling into the R10 canyons
    dict(id='rv_r11', pts=[(2600, -2000), (2000, -2200), (1400, -2500), (900, -2750), (500, -2950)], w=(5, 9)),
    # R14 steppe stream into the canyon c4
    dict(id='rv_r14', pts=[(-300, -6400), (-500, -5600), (-650, -4900), (-700, -4450)], w=(4, 8)),
    # R13 meltwater off the south cliff into the cloud sea
    dict(id='rv_r13', pts=[(-5100, -6000), (-5000, -5400), (-4900, -4900), (-4850, -4450)], w=(4, 8)),
    # R15 stream off the north edge
    dict(id='rv_r15', pts=[(3200, -6600), (3300, -7100), (3300, -7500)], w=(4, 7)),
    # R1 west stream down towards the coast
    dict(id='rv_r1w', pts=[(-2400, 5500), (-2900, 5650), (-3500, 5800), (-4300, 6000), (-5200, 6500), (-5800, 7100),
                           (-6000, 7600)], w=(4, 10)),
]

# ------------------------------------------------------------------ clear zones (no cloud sea over low ground)
CLEAR = [
    ('poly', [(-8000, 3300), (-2300, 3300), (-2300, 4500), (-2600, 7000), (-3600, 8000), (-8000, 8000)]),  # R3 + bay
    ('poly', [(-5900, -300), (-4200, -300), (-4200, 4000), (-5900, 4000)]),  # R5 gorge
    ('poly', [(3400, -700), (5300, -700), (5400, 3300), (7800, 3200), (7800, 4100), (3500, 4100)]),  # lake + outflow
]

MIST = dict(x=6000.0, z=-6000.0, r=1250.0)

# thin cloud (holes) to open views of the ocean: (x, z, radius, coverage multiplier)
CLOUD_THIN = [(350, 5600, 1500, 0.62), (-300, 3400, 600, 0.6)]

# open ground kept free of forest (x, z, radius, keep factor): the spawn view corridor to the village and the falls
FOREST_OPEN = [(-1110, 5100, 170, 0.0), (-1050, 4980, 170, 0.05), (-950, 4880, 170, 0.12), (-800, 4700, 160, 0.3),
               (-1250, 5000, 150, 0.35), (-1000, 5230, 160, 0.3),
               # east corridor: the terrace edge over the cloud sea stays visible from the spawn
               (-760, 5100, 220, 0.2), (-480, 5060, 240, 0.12), (-240, 5020, 200, 0.2)]

# ------------------------------------------------------------------ flora / ground per region (masks + scatter)
# forest: base density, clump: 1 = groves/clumps, 0 = evenly scattered lone trees; meadow: flower/field share
FLORA = [
    dict(forest=0.30, clump=1.0, meadow=0.75),            # r1 meadows, groves of pines on slopes
    dict(forest=0.14, clump=0.9, meadow=0.9),             # r2 golden hills, windbreaks
    dict(forest=0.12, clump=0.7, meadow=0.35, wet=0.1),   # r3 coast
    dict(forest=0.32, clump=1.0, meadow=0.55, wet=0.6),   # r4 lakes
    dict(forest=0.42, clump=1.0, meadow=0.45, wet=0.25),  # r5 waterfall cliffs
    dict(forest=0.40, clump=0.55, meadow=0.5),            # r6 open woodland of round trees
    dict(forest=0.16, clump=0.9, meadow=0.6),             # r7 town plateau
    dict(forest=0.88, clump=1.0, meadow=0.12, wet=0.3),   # r8 dense blue pine forest
    dict(forest=0.30, clump=1.0, meadow=0.5),             # r9 islets
    dict(forest=0.30, clump=1.0, meadow=0.3),             # r10 canyon rims
    dict(forest=0.70, clump=0.8, meadow=0.35, wet=0.15),  # r11 pale forest
    dict(forest=0.08, clump=0.6, meadow=0.15),            # r12 ember lands
    dict(forest=0.16, clump=1.0, meadow=0.3),             # r13 windy peaks
    dict(forest=0.05, clump=0.0, meadow=0.8),             # r14 steppe with lone trees
    dict(forest=0.10, clump=0.6, meadow=0.7),             # r15 high wind plateau
    dict(forest=0.30, clump=1.0, meadow=0.4),             # r16 hidden plateau
]

# ------------------------------------------------------------------ fixed points of interest
# (id, kind, x, z, pad radius, options). The generator settles each one on the nearest suitable spot inside
# `search` metres (default 90), records its height and flattens a pad of radius `flat` (default = r).
POIS = [
    # R1
    # at the lip of the meadow step, so the village below is not hidden by the brow of the hill
    ('spawn', 'spawn', -1097, 5092, 5, dict(ry=2.6, search=0)),  # ry: facing (sin ry, cos ry), towards the village
    ('cottage', 'cottage', -1940, 5330, 10, {}),
    # the village sits on the lower terrace just below the spawn lip: the round-tower house ~150 m away, slightly
    # left of the three falls, the other houses spread to the right (the concept-art framing)
    ('vila_ventura', 'village', -955, 4895, 26, dict(search=25)),
    ('tower_house', 'house', -1042, 4969, 11, dict(search=6)),
    ('bakery', 'house', -1010, 4835, 10, dict(search=25)),
    ('well_vila', 'well', -1000, 4935, 4, dict(search=12)),
    ('village_house_a', 'house', -880, 4850, 9, dict(search=30)),
    ('village_house_b', 'house', -930, 4995, 9, dict(search=30)),
    ('hermit_tower_vale', 'tower', -2650, 6250, 9, {}),
    ('totem_sorriso', 'totem', -1106, 5077, 2, dict(search=0)),
    ('totem_jardim', 'totem', -1150, 6150, 3, {}),
    ('tt_r1', 'travel_totem', -1380, 5330, 5, {}),
    # R2
    ('windmill_broken', 'windmill', 2900, 5150, 10, {}),
    ('windmills', 'windmill_group', 1700, 5750, 40, {}),
    ('stream_mills', 'watermill', 2150, 5280, 10, dict(search=140, near_river=True)),
    ('haystack_hills', 'haystacks', 3350, 5850, 16, {}),
    ('hill_top', 'viewpoint', 3700, 6200, 8, {}),
    ('tt_r2', 'travel_totem', 2350, 4800, 5, {}),
    # R3
    ('lighthouse', 'lighthouse', -6720, 6780, 12, dict(search=160)),
    ('bay_chest', 'chest_underwater', -5620, 7260, 0, dict(search=200, underwater=True)),
    ('beach_bottle', 'item', -4450, 7120, 2, dict(search=200, shore=True)),
    ('fisher_hut', 'hut', -4950, 6650, 9, dict(search=160)),
    ('tt_r3', 'travel_totem', -4500, 5600, 5, {}),
    # R4
    ('turtle_shrine', 'shrine', 6420, 5930, 12, dict(search=160, shore=True)),
    ('lake_bench', 'bench', 5230, 5260, 3, dict(search=160, shore=True)),
    ('lake_house', 'house', 4930, 4500, 10, dict(search=160)),
    ('tt_r4', 'travel_totem', 5050, 4880, 5, dict(search=160)),
    # R5
    ('falls_three', 'waterfall', -4700, 2560, 8, dict(search=150, foot_of='rv_three')),
    ('tt_r5', 'travel_totem', -3950, 1650, 5, {}),
    # R6
    ('totem_choro', 'totem', -1300, 1600, 4, {}),
    ('totems_ring', 'totem_ring', -2500, 1900, 16, {}),
    ('totems_path', 'totem_row', -1250, 3200, 10, {}),
    ('tt_r6', 'travel_totem', -2450, 3300, 5, {}),
    # R7
    ('high_plaza', 'plaza', 2700, 1300, 22, {}),
    ('royal_forge', 'forge', 2350, 1000, 12, {}),
    ('high_school', 'house', 2980, 1580, 12, {}),
    ('high_tower', 'tower', 3200, 900, 9, {}),
    ('tt_r7', 'travel_totem', 2000, 1900, 5, {}),
    # R8
    ('hunter_cabin', 'cabin', 6300, 1200, 9, {}),
    ('mushroom_ring', 'mushroom_ring', 6700, 2000, 10, {}),
    ('tt_r8', 'travel_totem', 5700, 1800, 5, {}),
    # R9 (islets)
    ('islet_low', 'islet', -3650, -2350, 10, dict(search=60, islet=True)),
    ('islet_mid', 'islet', -4560, -2950, 10, dict(search=60, islet=True)),
    ('griffin_nest', 'nest', -5560, -3420, 14, dict(search=60, islet=True)),
    ('griffin_queen', 'creature', -5520, -3380, 4, dict(search=80, islet=True)),
    ('feather_1', 'item', -5900, -2400, 2, dict(search=120, islet=True)),
    ('feather_2', 'item', -6400, -3300, 2, dict(search=120, islet=True)),
    ('feather_3', 'item', -4300, -1800, 2, dict(search=120, islet=True)),
    ('tt_r9', 'travel_totem', -3420, -2200, 5, dict(search=200)),
    # R10
    ('hermit_tower_canyon', 'tower', -2400, -2150, 9, dict(search=160)),
    ('rope_bridge', 'rope_bridge', -2100, -3425, 0, dict(span='c2', at=(-2100, -3425))),
    ('tt_r10', 'travel_totem', -1050, -1150, 5, dict(search=160)),
    # R11
    ('lunar_garden', 'garden', 2400, -2600, 24, {}),
    ('lunar_grove', 'grove', 3300, -3500, 16, {}),
    ('lunar_glade', 'glade', 1640, -3480, 14, {}),
    ('deer_meadow', 'meadow', 3500, -2000, 20, {}),
    ('tt_r11', 'travel_totem', 2200, -1700, 5, {}),
    # R12
    ('hot_spring', 'hot_spring', 5600, -2470, 0, dict(search=0)),
    ('dragon_nest', 'nest', 6080, -3080, 16, dict(search=150)),
    ('tt_r12', 'travel_totem', 5150, -2050, 5, dict(search=160)),
    # R13
    ('summit_camp', 'camp', -5000, -6150, 10, dict(search=220)),
    ('summit_view', 'viewpoint', -5300, -6450, 5, dict(search=240, highest=True)),
    ('yak_trail', 'trail', -3300, -5850, 6, dict(search=120)),
    ('tt_r13', 'travel_totem', -3750, -6050, 5, dict(search=160)),
    # R14
    ('steppe_post', 'post', -600, -5800, 12, {}),
    ('steppe_stones', 'standing_stones', -1500, -6600, 14, {}),
    ('tt_r14', 'travel_totem', -1000, -4650, 5, dict(search=160)),
    # R15
    ('totem_ancestral', 'totem', 2500, -5900, 8, {}),
    ('windy_stones', 'standing_stones', 1800, -6800, 14, {}),
    ('tt_r15', 'travel_totem', 2000, -5000, 5, {}),
    # R16
    ('mist_center', 'mist', 6000, -6000, 0, dict(search=0, exact=True)),
    ('castle', 'keep', 6080, -6000, 230, dict(search=0, exact=True, ry=-1.5708)),
    ('castle_gate', 'gate', 5880, -6000, 0, dict(search=0, exact=True, ry=-1.5708)),
    ('throne', 'seat', 6200, -6000, 0, dict(search=0, exact=True, ry=-1.5708)),
    ('mist_sign', 'sign', 4640, -5945, 3, dict(search=40)),
]

# generic minor POI kinds per region (ids p_<region>_<n>), placed by the generator
GENERIC = [
    ['picnic', 'flowerfield', 'beehive', 'well', 'cart', 'house_ruin', 'viewpoint', 'shrine'],
    ['viewpoint', 'flowerfield', 'beehive', 'cart', 'house_ruin', 'picnic', 'well', 'camp'],
    ['pier', 'camp', 'cave', 'ruin', 'viewpoint', 'picnic', 'flowerfield'],
    ['pier', 'picnic', 'shrine', 'flowerfield', 'camp', 'bridge', 'beehive'],
    ['viewpoint', 'cave', 'camp', 'shrine', 'bridge', 'ruin', 'standing_stones'],
    ['standing_stones', 'standing_stones', 'shrine', 'ruin', 'camp', 'flowerfield', 'beehive'],
    ['house_ruin', 'well', 'ruin', 'viewpoint', 'cart', 'shrine', 'flowerfield'],
    ['camp', 'cave', 'beehive', 'ruin', 'shrine', 'flowerfield', 'standing_stones'],
    ['ruin', 'shrine', 'viewpoint', 'camp', 'flowerfield', 'standing_stones'],
    ['viewpoint', 'standing_stones', 'cave', 'camp', 'ruin', 'shrine'],
    ['flowerfield', 'shrine', 'ruin', 'standing_stones', 'camp', 'picnic', 'well'],
    ['cave', 'ruin', 'camp', 'viewpoint', 'shrine', 'standing_stones'],
    ['camp', 'cave', 'viewpoint', 'shrine', 'ruin', 'standing_stones'],
    ['standing_stones', 'camp', 'cart', 'ruin', 'well', 'flowerfield', 'viewpoint'],
    ['standing_stones', 'viewpoint', 'shrine', 'camp', 'ruin', 'flowerfield'],
    ['ruin', 'ruin', 'shrine', 'standing_stones', 'well', 'ruin'],
]
# the Annecy view: a fixed viewpoint on the hillside path of R2 looking north over the broad valley to R7
ANNECY = dict(x=2330, z=4620, look=(2650, 1500))

# ------------------------------------------------------------------ roads (A* routed between consecutive stops)
# stops are POI ids or (x, z) tuples; w = width in metres
ROUTES = [
    dict(w=3.4, stops=['spawn', 'tt_r1', 'vila_ventura']),
    dict(w=4.4, stops=['vila_ventura', 'bakery']), dict(w=4.4, stops=['vila_ventura', 'tower_house']),
    dict(w=4.4, stops=['vila_ventura', 'village_house_a']), dict(w=4.4, stops=['vila_ventura', 'village_house_b']),
    dict(w=3.0, stops=['spawn', 'cottage']), dict(w=2.6, stops=['tt_r1', 'totem_jardim']),
    dict(w=3.2, stops=['tt_r1', 'hermit_tower_vale', 'tt_r3', 'fisher_hut', (-6100, 6400), (-6650, 6800), 'lighthouse']),
    dict(w=3.0, stops=['tt_r3', 'beach_bottle']),
    dict(w=3.4, stops=['tt_r1', (-500, 6330), (900, 6380), 'tt_r2', 'windmills']),
    dict(w=3.2, stops=['tt_r2', 'stream_mills']),
    dict(w=3.2, stops=['tt_r2', 'windmill_broken', 'haystack_hills', 'hill_top']),
    dict(w=3.2, stops=['vila_ventura', (-2400, 4800), (-2900, 3100), 'tt_r6', 'totems_path', 'totem_choro',
                       'totems_ring']),
    dict(w=3.0, stops=['tt_r6', (-2800, 1500), (-3800, 1450), 'tt_r5']),
    dict(w=2.8, stops=['tt_r3', (-5600, 4300), 'falls_three']),
    dict(w=3.0, stops=['tt_r5', (-6450, 1900), (-6300, 3150), (-4300, 3500), (-4100, 4900), 'tt_r3']),
    dict(w=3.2, stops=['totem_choro', (200, 1700), (1300, 2900), 'tt_r7', 'high_plaza', 'royal_forge']),
    dict(w=3.0, stops=['high_plaza', 'high_school']), dict(w=3.0, stops=['high_plaza', 'high_tower']),
    dict(w=3.2, stops=['tt_r2', 'p_annecy', (1800, 3400), 'tt_r7']),
    dict(w=3.0, stops=['high_plaza', (2700, 700), (2800, -1500), 'tt_r11', 'lunar_garden', 'lunar_glade']),
    dict(w=3.0, stops=['lunar_garden', 'lunar_grove']), dict(w=3.0, stops=['tt_r11', 'deer_meadow']),
    dict(w=3.0, stops=['deer_meadow', (3600, -2000), (5000, -2400), 'tt_r12', 'hot_spring']),
    dict(w=3.0, stops=['hot_spring', (5500, -2600), (5880, -3260), 'dragon_nest']),
    dict(w=3.0, stops=['tt_r12', (5450, -2000), (5600, -900), 'tt_r8', 'hunter_cabin', 'mushroom_ring']),
    dict(w=3.0, stops=['tt_r8', (6000, 2100), (4950, 2050), (4300, 3400), (4380, 4000), 'lake_house', 'tt_r4']),
    dict(w=3.0, stops=['tt_r4', 'lake_bench', (5450, 5250), (5950, 5560), 'turtle_shrine']),
    dict(w=3.0, stops=['totem_choro', 'tt_r10', 'hermit_tower_canyon', 'tt_r9']),
    dict(w=3.0, stops=['hermit_tower_canyon', 'rope_bridge:b']), dict(w=3.0, stops=['tt_r10', 'rope_bridge:a']),
    dict(w=3.0, stops=['tt_r10', 'tt_r14', 'steppe_post', 'steppe_stones']),
    dict(w=2.8, stops=['tt_r14', (-2100, -5600), 'yak_trail', (-3700, -6050), 'tt_r13', 'summit_camp', 'summit_view']),
    dict(w=3.0, stops=['steppe_post', (300, -5200), (1800, -6100), 'tt_r15', 'totem_ancestral', 'windy_stones']),
    dict(w=3.0, stops=['lunar_grove', (2900, -3300), (3150, -5000), 'tt_r15']),
    dict(w=2.6, stops=['totem_ancestral', (4000, -5900), 'mist_sign']),
]

# ------------------------------------------------------------------ ground palette per region (sRGB hex)
# grass = sunlit ground, alt = second tone (patches), forest = forest floor, rock = cliff/strata tone
PALETTE = [
    dict(grass='#b4bb48', alt='#9db94a', forest='#59784a', rock='#95928b'),   # r1
    dict(grass='#c9bd52', alt='#d8cf55', forest='#7b7f26', rock='#a59f92'),   # r2
    dict(grass='#a9b950', alt='#bcc361', forest='#59784a', rock='#a59f92'),   # r3
    dict(grass='#93b846', alt='#a1c126', forest='#4f7446', rock='#95928b'),   # r4
    dict(grass='#8fae4a', alt='#9db94a', forest='#4a6b3a', rock='#87827b'),   # r5
    dict(grass='#a5b54c', alt='#bcc361', forest='#6b7a3a', rock='#95928b'),   # r6
    dict(grass='#b9b552', alt='#c7c051', forest='#7b7f26', rock='#a59f92'),   # r7
    dict(grass='#6f9656', alt='#7fa35c', forest='#3f6446', rock='#87827b'),   # r8
    dict(grass='#a9b950', alt='#bcc361', forest='#59784a', rock='#95928b'),   # r9
    dict(grass='#b3ab66', alt='#a9a66a', forest='#6f7a4a', rock='#b8a487'),   # r10
    dict(grass='#9db592', alt='#b6c6a6', forest='#6f8a7a', rock='#9a9aa0'),   # r11
    dict(grass='#bf9a5c', alt='#b8804e', forest='#8a6a40', rock='#b0674a'),   # r12
    dict(grass='#93a06c', alt='#a4a87c', forest='#5f6f4a', rock='#8d8a86'),   # r13
    dict(grass='#d6c26a', alt='#c9b15a', forest='#9a9132', rock='#b39f80'),   # r14
    dict(grass='#a9b86a', alt='#bcc37a', forest='#6f7f4a', rock='#9a968e'),   # r15
    dict(grass='#9fae6a', alt='#b2bb78', forest='#5f7a4a', rock='#95928b'),   # r16
]
SAND = '#e6d9a6'
DIRT = '#d9c27a'
SNOW = '#f2f4f7'
SEA = ('#63b2d4', '#2a7fc4')
