"""Prepara os dados do Censo 2022 (IBGE) para o mapa.

Fontes (baixadas para uma pasta de cache, fora do repositório):
  - Malha de setores censitários com atributos básicos – PA_setores_CD2022.gpkg
  - Malha de bairros com atributos básicos            – PA_bairros_CD2022.gpkg
  - Rendimento do responsável por setor               – Agregados_por_setores_renda_responsavel_BR_*.csv

Gera:
  data/ibge_setores.geojson – setores censitários dos distritos de estudo
  data/ibge_bairros.geojson – bairros oficiais (limites IBGE/Prefeitura) com indicadores agregados

Uso: python3 scripts/preparar_ibge.py [pasta_cache]
"""
import csv, io, json, pathlib, sys, urllib.request, zipfile
import geopandas as gpd
import pandas as pd

RAIZ = pathlib.Path(__file__).resolve().parent.parent
CACHE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else RAIZ.parent / "ibge-bruto")
CACHE.mkdir(parents=True, exist_ok=True)

FTP = "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022"
MALHA = f"{FTP}/Agregados_por_Setores_Censitarios/malha_com_atributos"
ARQUIVOS = {
    "PA_setores_CD2022.gpkg": f"{MALHA}/setores/gpkg/UF/PA/PA_setores_CD2022.gpkg",
    "PA_bairros_CD2022.gpkg": f"{MALHA}/bairros/gpkg/UF/PA/PA_bairros_CD2022.gpkg",
    "Agregados_por_setores_renda_responsavel_BR_20260508_csv.zip":
        f"{FTP}/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/Agregados_por_setores_renda_responsavel_BR_20260508_csv.zip",
}
MUNICIPIO = "Belém"
DISTRITOS = {"Icoaraci": "DAICO", "Bengui": "DABEN"}
# Área de estudo do Distrito Icoaraci (igreja): os 9 bairros do distrito administrativo de Icoaraci
# e 3 bairros do Bengui. Ficaram fora, a pedido do distrito: Brasília, São João do Outeiro, Água Boa,
# Itaiteua, Coqueiro, Una, Cabanagem, Benguí, Mangueirão e São Clemente.
BAIRROS = {
    "Águas Negras", "Agulha", "Campina de Icoaraci", "Cruzeiro", "Maracacuera",
    "Paracuri", "Parque Guajará", "Ponta Grossa", "Tenoné",
    "Tapanã", "Parque Verde", "Pratinha",
}
UTM = 31982            # SIRGAS 2000 / UTM 22S – metros, para simplificar e medir áreas
TOLERANCIA_M = 4       # simplificação das linhas (imperceptível na escala do mapa)


def baixar():
    for nome, url in ARQUIVOS.items():
        destino = CACHE / nome
        if not destino.exists():
            print("baixando", nome)
            urllib.request.urlretrieve(url, destino)


def numero(v):
    """Converte valores do IBGE ('1.67', 'X' = sigilo, '' = ausente) em float ou None."""
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def renda_por_setor(codigos):
    with zipfile.ZipFile(CACHE / "Agregados_por_setores_renda_responsavel_BR_20260508_csv.zip") as z:
        nome = next(n for n in z.namelist() if n.endswith(".csv"))
        with z.open(nome) as f:
            leitor = csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";")
            return {r["CD_SETOR"]: {"responsaveis": numero(r["V06001"]), "renda_media": numero(r["V06004"]),
                                    "renda_mediana": numero(r["V06006"])}
                    for r in leitor if r["CD_SETOR"] in codigos}


def exportar(gdf, arquivo):
    g = gdf.to_crs(UTM)
    g["geometry"] = g.geometry.simplify(TOLERANCIA_M, preserve_topology=True)
    g = g.to_crs(4326)
    dados = json.loads(g.to_json(drop_id=True))
    for f in dados["features"]:          # 5 casas decimais ≈ 1 m
        f["geometry"] = json.loads(json.dumps(f["geometry"]), parse_float=lambda x: round(float(x), 5))
    (RAIZ / "data" / arquivo).write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")))
    print(arquivo, len(dados["features"]), "feições", round((RAIZ / "data" / arquivo).stat().st_size / 1024), "KB")


def main():
    baixar()
    ba = gpd.read_file(CACHE / "PA_bairros_CD2022.gpkg")
    ba = ba[(ba.NM_MUN == MUNICIPIO) & ba.NM_BAIRRO.isin(BAIRROS)].copy()
    assert set(ba.NM_BAIRRO) == BAIRROS, f"bairros não encontrados no IBGE: {BAIRROS - set(ba.NM_BAIRRO)}"
    st = gpd.read_file(CACHE / "PA_setores_CD2022.gpkg")
    st = st[(st.NM_MUN == MUNICIPIO) & st.NM_BAIRRO.isin(set(ba.NM_BAIRRO))].copy()
    renda = renda_por_setor(set(st.CD_SETOR))

    st["pop"] = st.v0001.map(numero).fillna(0).astype(int)
    st["domicilios"] = st.v0007.map(numero).fillna(0).astype(int)
    st["moradores_dom"] = st.v0005.map(numero)
    st["area_km2"] = st.to_crs(UTM).area / 1e6
    st["dens"] = (st["pop"] / st.area_km2).round(0)
    for k in ("responsaveis", "renda_media", "renda_mediana"):
        st[k] = st.CD_SETOR.map(lambda c: renda.get(c, {}).get(k))
    st["fcu"] = st.NM_FCU.where(st.NM_FCU.notna() & (st.NM_FCU != ""), None)   # Favela/Comunidade Urbana
    setores = st[["CD_SETOR", "NM_BAIRRO", "NM_DIST", "SITUACAO", "pop", "domicilios", "moradores_dom", "area_km2",
                  "dens", "renda_media", "renda_mediana", "fcu", "geometry"]].rename(
        columns={"CD_SETOR": "cod", "NM_BAIRRO": "bairro", "NM_DIST": "distrito", "SITUACAO": "situacao"})
    setores["area_km2"] = setores.area_km2.round(4)
    exportar(setores, "ibge_setores.geojson")

    # Bairros: limites oficiais + indicadores somados/ponderados a partir dos setores.
    st["renda_x_resp"] = st.renda_media * st.responsaveis
    ag = st.groupby("NM_BAIRRO").agg(
        pop=("pop", "sum"), domicilios=("domicilios", "sum"), setores=("CD_SETOR", "count"),
        pop_fcu=("pop", lambda s: int(s[st.loc[s.index, "fcu"].notna()].sum())),
        renda_x_resp=("renda_x_resp", "sum"), resp=("responsaveis", lambda s: s[st.loc[s.index, "renda_media"].notna()].sum()),
        comunidades=("fcu", lambda s: sorted(set(s.dropna()))))
    ba = ba.merge(ag, left_on="NM_BAIRRO", right_index=True, how="left")
    ba["area_km2"] = (ba.to_crs(UTM).area / 1e6).round(3)
    ba["dens"] = (ba["pop"] / ba.area_km2).round(0)
    ba["renda_media"] = (ba.renda_x_resp / ba.resp).round(2)
    ba["pct_fcu"] = (100 * ba.pop_fcu / ba["pop"]).round(1)
    ba["distrito_adm"] = ba.NM_DIST.map(DISTRITOS)
    ba["comunidades"] = ba.comunidades.map(lambda l: "; ".join(l) if isinstance(l, list) else "")
    # Conferência: a soma dos setores deve bater com o total oficial do bairro (v0001).
    dif = (ba["pop"] - ba.v0001.map(numero)).abs().max()
    assert dif == 0, f"população dos setores não fecha com a do bairro (diferença {dif})"
    bairros = ba[["NM_BAIRRO", "distrito_adm", "NM_DIST", "pop", "domicilios", "area_km2", "dens", "renda_media",
                  "pop_fcu", "pct_fcu", "comunidades", "setores", "geometry"]].rename(
        columns={"NM_BAIRRO": "nome", "NM_DIST": "distrito"})
    exportar(bairros, "ibge_bairros.geojson")
    print("população total:", int(bairros["pop"].sum()), "| setores:", int(st["pop"].sum()))
    print(bairros.drop(columns="geometry").sort_values(["distrito", "nome"]).to_string(index=False))


if __name__ == "__main__":
    main()
