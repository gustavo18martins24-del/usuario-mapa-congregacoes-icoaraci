# Mapa das Congregações – Distrito Icoaraci (Belém-PA)

Mapa interativo das **95 congregações** do distrito, com login para pastores e líderes e ferramentas de estudo geográfico.

## Estrutura do distrito
- **5 setores** (cores do Demonstrativo de Áreas 2026: 1 roxo, 2 verde, 3 azul, 4 vermelho, 5 amarelo)
- **33 áreas numeradas**, cada uma com uma **sede**, mais o **Templo Central** e o **Manancial de Bênção** como grupos à parte
- Fonte: *Demonstrativo de Áreas – Ano/2026*, em `data/estrutura.json`

## Funcionalidades
- **Mapa base:** ruas (OpenStreetMap), satélite e **limites oficiais dos 12 bairros** da área de estudo (IBGE, Censo 2022): os 9 bairros de Icoaraci, mais Tapanã, Parque Verde e Pratinha
- **Localidades:** Tapajós (Tapanã) e Eduardo Angelim (Parque Guajará)
- **Estudo demográfico (IBGE, Censo 2022)**, com base em 477 setores censitários e 308.474 habitantes:
  - mapas temáticos de densidade, renda média do responsável, favelas e comunidades urbanas e distância até a congregação mais próxima
  - percentual da população perto de uma congregação (500 m / 1 km / 1,5 km) e habitantes por congregação, por bairro, por área e por setor da igreja
  - lista dos setores mais populosos longe de qualquer congregação, como candidatos a novos trabalhos
  - população na área de influência de cada congregação
- **Congregações:** cores por setor ou por área, sedes com ★, busca e filtros (setor, área, só sedes)
- **Distâncias:** linha reta (geodésica) e pelas ruas, de carro e a pé, com índice de sinuosidade
- **Sedes:** distância média e máxima até a sede da área e alerta de congregações mais perto da sede de outra área
- **Territórios:** de cada setor e de cada área, ligações congregação → sede, áreas de influência (Voronoi), raio de alcance e cobertura por bairro
- **Cadastro:** posicionar por clique (com aviso quando o ponto cai fora dos bairros), arrastar para ajustar, editar dados, importar e exportar planilha
- **Login e permissões:** cada pessoa só altera o que lhe cabe, todas as alterações ficam no histórico e aparecem para todos na hora

| Papel    | O que pode fazer |
|----------|------------------|
| Pendente | Nada: aguarda aprovação |
| Leitor   | Ver mapa, listas e análises |
| Editor   | Além de ver, posicionar e editar as congregações **da sua área** |
| Admin    | Tudo, mais importar planilha, excluir e aprovar usuários |

## Como colocar no ar

### 1. Banco de dados (Supabase, gratuito)
1. Crie uma conta em **supabase.com** e um projeto (*New project*). Escolha a região **South America (São Paulo)**.
2. Em **SQL Editor**, rode nesta ordem:
   1. `supabase/schema.sql`: tabelas, regras de segurança e histórico
   2. `supabase/seed.sql`: setores, áreas e as 96 congregações
   3. `seed_responsaveis.sql`: responsáveis das áreas. Esse arquivo é entregue à parte e **não fica no GitHub**.
3. Em **Authentication → URL Configuration**, coloque o endereço do site em *Site URL*.
4. Em **Project Settings → API**, copie a *Project URL* e a *anon public key* para `js/config.js`.
5. Abra o site, crie sua conta e, no SQL Editor, torne-se administrador:
   ```sql
   update public.perfis set papel = 'admin' where email = 'seu-email@exemplo.com';
   ```
6. A partir daí, aprove os demais usuários na aba **Usuários** do próprio site.

Sem `js/config.js` preenchido, o site funciona em **modo local**: sem login, com os dados salvos só no navegador.

### 2. Site (GitHub Pages)
No repositório: **Settings → Pages → Source: Deploy from a branch → main / (root)**.

## Desenvolvimento
```bash
python3 -m http.server 8080
```

```bash
PGHOST=... PGUSER=postgres supabase/testes/rodar.sh
```

```bash
node testes/interface-online.js
```

O primeiro comando serve o site. O segundo roda os testes das regras do banco num PostgreSQL local. O terceiro roda os testes de interface (login e permissões) com o Supabase simulado.

- `scripts/preparar_ibge.py`: baixa e processa a malha e os agregados do Censo 2022 em `data/ibge_*.geojson`. A lista de bairros da área de estudo fica no início do script.
- `scripts/gerar_seed.py`: gera `supabase/seed.sql` a partir de `data/estrutura.json`

Mapa base © colaboradores do OpenStreetMap (ODbL).
