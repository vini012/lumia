# Lumiar

Jogo 3D aconchegante e cooperativo no navegador: um mundo de planaltos acima de um mar de nuvens, com vilas, cachoeiras, plantações, criaturas e construção. Feito para jogar a dois, no celular (Android e iPhone, na horizontal) ou no computador.

## Jogar juntos

Os dois entram com o mesmo **código do mundo** na tela inicial. O progresso de cada um (posição, bolsa, fome, energia) e tudo o que muda no mundo (construções, colheitas, baús) fica salvo no Supabase (tabela `lumiar_mundo`) e aparece para os dois na hora. Sem internet, o jogo continua neste aparelho e envia tudo quando a conexão volta.

Códigos de mundo da versão anterior continuam valendo: eles abrem um mundo novo desta versão.

## Controles

- Celular: o círculo à esquerda anda; arrastar a tela olha em volta; os botões à direita pulam, agem, abrem a bolsa, a construção e as magias.
- Computador: WASD ou setas para andar, Shift corre, Espaço pula, E age, B bolsa, C construir, M mapa, J diário, Q magias, Esc fecha.

## Publicar na Vercel

É um site estático, sem etapa de build:

1. Na Vercel, **Add New → Project** e importe o repositório `lumia`.
2. Framework Preset: **Other**. Deixe Build Command e Output Directory vazios.
3. **Deploy**. Cada novo push na branch principal publica sozinho.

As pastas `dev/` e `tools/` não são publicadas (`.vercelignore`).

## Estrutura

- `index.html`, `css/ui.css`: página do jogo, telas de carregamento e de início, interface
- `js/`: motor (three.js r128), céu e nuvens, terreno, vegetação, mundo, criaturas, jogador, construção, salvamento, sobrevivência, plantações e o jogo
- `m/`: dados do mundo e modelos 3D
- `assets/`: texturas e fontes
- `config.js`: endereço do Supabase do modo juntos
- `lib/supabase.js`: cliente oficial do Supabase (supabase-js 2.112.4, licença MIT)
- `dev/`: páginas e testes de desenvolvimento; `tools/`: ferramentas (não publicadas)
