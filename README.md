# Mapa das Congregações – Distrito Icoaraci (Belém-PA)

Mapa interativo das congregações do distrito, com ferramentas de estudo geográfico.

## Estrutura do distrito
**96 congregações** em **33 áreas numeradas**, mais dois grupos à parte: **Templo Central** e **Manancial de Bênção**.
Na importação, a planilha é conferida contra essa estrutura: total, áreas faltando ou fora de 1 a 33, nomes repetidos e linhas sem área.

## Funcionalidades
- **Base:** ruas do OpenStreetMap, imagem de satélite e limites oficiais dos bairros (DAICO, DABEN e Outeiro).
- **Congregações:** marcadores coloridos por área (Templo Central e Manancial de Bênção em destaque), busca e filtro por área.
- **Distância:** em linha reta (Haversine) e pelas ruas, de carro e a pé (OSRM), com índice de sinuosidade.
- **Vizinha mais próxima:** tabela que destaca pares a menos de 500 m e congregações isoladas (mais de 2 km).
- **Áreas de influência:** polígonos de Voronoi recortados pelos limites dos bairros, com área em km².
- **Raio de alcance:** de 250 m a 3 km.
- **Cobertura por bairro:** distância média, numa grade de 250 m, até a congregação mais próxima.
- **Cadastro:** importação de planilha (.xlsx/.csv), com a grafia da área padronizada ("01", "AREA 1", "1ª Área" → "Área 1"; "Sede" → "Templo Central"), posicionamento por clique, ajuste arrastando o marcador, exportação em .json e .csv.

## Rodar localmente
```bash
python3 -m http.server 8080
```
Abra http://localhost:8080.

## Dados
- `data/bairros.geojson`: limites dos bairros, obtidos do OpenStreetMap por `scripts/baixar_bairros.py`.
- `data/congregacoes.json`: dados oficiais. Gere-o pela aba Cadastro (botão "Exportar .json") e coloque-o aqui.
- `data/exemplo.json`: pontos fictícios, usados apenas enquanto não existem dados oficiais.

Mapa base © colaboradores do OpenStreetMap (ODbL).
