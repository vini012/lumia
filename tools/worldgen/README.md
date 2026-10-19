# worldgen: o gerador do mundo v5 (somente desenvolvimento)

Gera o mundo de 16 km x 16 km do Lumiar v5 a partir de um desenho feito à mão (`design.py`) e grava os dados que
`js/terrain.js` carrega. É determinístico: a mesma versão do código produz exatamente os mesmos bytes
(`world5.bin` e `world5.json` conferidos por md5 entre execuções, com e sem cache).

## Como rodar

```sh
python3 tools/worldgen/gen.py              # tudo, inclusive m/map5.png  (~2 a 3 min)
python3 tools/worldgen/gen.py --no-map     # só os dados (~1 min com o cache das mesas, ~2 min sem)
python3 tools/worldgen/gen.py --out /tmp/x # grava em outra pasta
```

Requisitos: Python 3 com `numpy` e `Pillow`, e `node` no PATH (o A* das estradas e o flood-fill de
alcançabilidade rodam em `astar.js` / `flood.js`). A pasta de trabalho `tools/worldgen/_build/` (ignorada pelo
git) guarda caches e a prévia de diagnóstico `prev_heights.png`; `WG_SCRATCH=/outra/pasta` muda esse lugar.

## Saídas (em `m/`)

| arquivo | conteúdo |
|---|---|
| `world5.bin` | rasters empacotados, little-endian, ~3,7 MB |
| `world5.b64.json` | `{"b64": "..."}` com os mesmos bytes (para hosts que recusam `.bin`) |
| `world5.json` | metadados: layout do raster, regiões, POIs, rios, cachoeiras, lagos, estradas, disco da Névoa, início, rótulos do mapa, paleta |
| `map5.png` | mapa pintado 2048² (PNG com paleta), visto de cima, norte para cima |

### `world5.bin`

Cabeçalho de 16 bytes: `"LUM5"`, `u32 versão (1)`, `u32 n (1025)`, `u32 n2 (513)`. Depois as seções, cada uma
alinhada a 4 bytes; `world5.json → raster.sections` lista `{name, type, n, offset, bytes}` de cada uma.

| seção | tipo | grade | significado |
|---|---|---|---|
| `height` | u16 | 1025² (15,625 m) | altura = `u16 * 0.02 - 50` metros |
| `region` | u8 | 513² (31,25 m) | região 0..15 (R1..R16) |
| `lake` | u8 | 513² | 0 = sem lago, k = lago `lakes[k-1]` (cobre o lago mais uma margem de 30 m) |
| `forest`, `meadow`, `wet`, `cloud` | u8 | 513² | máscaras 0..255 (densidade de floresta, campo florido, umidade/musgo, cobertura do mar de nuvens) |

Linhas = z (norte primeiro, z = −8000), colunas = x (oeste primeiro, x = −8000); a célula (i, j) fica em
`x = -8000 + j * cell`, `z = -8000 + i * cell`.

### `world5.json`

* `ws` (8000), `cloudY` (90), `oob` (7700, limite de jogo), `raster` (acima).
* `regions[i] = {id, nome, x, z, hidden}`; `labels` = rótulos do mapa (as regiões escondidas ficam de fora).
* `pois[] = {id, kind, region, x, y, z, ry, r, flat}`: todos os ids fixos do contrato (TECH §2) e os genéricos
  `p_<região>_<n>`. `flat` = raio aplainado no terreno; `y` = altura do chão ali.
* `lakes[] = {id, level, x, z, bbox, hot}` (superfície plana em `level`).
* `rivers[] = {id, reaches: [[[x, z, superfície, largura], ...], ...], falls, cloud}`: trechos entre quedas, um
  ponto a cada ~20 m; `cloud` = o rio termina no mar de nuvens.
* `falls[] = {river, x, z, dx, dz, top, bottom, w}`: cachoeiras (posição do topo, direção do fluxo, alturas, largura).
* `roads[] = {w, pts: [[x, z, superfície], ...]}`: linha central simplificada das estradas de terra.
* `mist = {x, z, r}`, `spawn = {x, y, z, ry}`, `palette` / `sand` / `dirt` / `snow` / `sea` (cores do chão).

## Como o mundo é construído (`gen.py`)

1. **Mesas** (`design.T`, `terrainops.apply_tables`): planaltos e terraços com contorno à mão, compostos por
   máximo. Topo = altura + inclinação + ondulação suave; bordas são paredões verticais com estratos e beirada
   nítida (afiados para que a amostragem bilinear da grade de 15,6 m continue íngreme), exceto em zonas `soft`
   onde viram encosta.
2. **Cânions** cheios de nuvem e **rampas** (cortes/aterros com perfil linear: subidas em zigue-zague, pontes naturais).
3. **Lagos** (nível fixo) e **rios** (`hydro.py`): perfil de superfície monotônico ao longo do traçado, quedas onde o
   rio sai de um planalto, leito escavado.
4. **Regiões** (`layout.region_raster`): sementes nos centros do GDD, bordas orgânicas que seguem as mesas.
5. **POIs** (`pois.py`): fixos (posições do `design.POIS`, ajustadas ao chão) e genéricos (≥ 6 por região, em
   lugares alcançáveis a pé), cada um com uma área plana.
6. **Estradas**: A* (`astar.js`) entre vilas, POIs e totens de viagem, com custo por inclinação (≤ ~30°), depois
   niveladas no terreno.
7. **Máscaras** (floresta, campo, umidade, nuvem) e **exportação** (`export.py`).
8. **Conferência** (`check.py`): alcançabilidade a pé a partir do início por região (R9 e o interior da Névoa
   ficam de fora de propósito), POIs inalcançáveis, porcentagem de paredões, cachoeiras.
9. **Mapa** (`mapart.py`): cores da paleta v5, sombreamento suave, paredões, mar de nuvens, oceano, tom de pergaminho.

Para mudar o mundo, edite `design.py` (mesas, rios, rotas, POIs) e rode de novo.
