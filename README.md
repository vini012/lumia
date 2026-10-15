# Lumiar

Jogo 3D cooperativo no navegador: uma ilha de 3 km com criaturas para domar, construção estilo ARK, forja, poções e mapa. Feito para jogar a dois, no celular (Android e iPhone) ou no computador.

## Jogar juntos

Os dois entram com o mesmo **código do mundo** na tela inicial. Construções, criaturas domadas, baús e lugares descobertos ficam salvos no Supabase (tabela `lumiar_mundo`) e aparecem para os dois na hora.

## Publicar na Vercel

É um site estático, sem etapa de build:

1. Na Vercel, **Add New → Project** e importe o repositório `lumia`.
2. Framework Preset: **Other**. Deixe Build Command e Output Directory vazios.
3. **Deploy**. Cada novo push na branch principal publica sozinho.

## Estrutura

- `index.html`: página do jogo e interface
- `js/`: motor (three.js r128), terreno, vegetação, criaturas, jogador, construção, mapa e o jogo
- `m/`: modelos 3D feitos no Blender (criaturas com esqueleto, mago e maga, construções, móveis, ruínas, castelo)
- `assets/`: texturas e árvores
- `config.js`: endereço do Supabase do modo juntos
- `lib/supabase.js`: cliente oficial do Supabase (supabase-js 2.112.4, licença MIT)
