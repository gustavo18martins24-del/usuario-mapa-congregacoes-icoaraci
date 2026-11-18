"""Baixa os limites dos bairros do norte de Belém (DAICO, DABEN e vizinhos) via Nominatim/OSM."""
import json, time, urllib.error, urllib.parse, urllib.request, sys

BAIRROS = {
    "DAICO": ["Águas Negras", "Agulha", "Campina de Icoaraci", "Cruzeiro", "Maracacuera",
              "Paracuri", "Parque Guajará", "Ponta Grossa", "Tenoné"],
    "DABEN": ["Benguí", "Cabanagem", "Coqueiro", "Mangueirão", "Parque Verde",
              "Pratinha", "São Clemente", "Tapanã", "Una"],
    "DAOUT": ["Água Boa", "Brasília", "Itaiteua", "São João do Outeiro"],
}
UA = {"User-Agent": "mapa-congregacoes-prototipo/0.1"}

def _get(q):
    req = urllib.request.Request(f"https://nominatim.openstreetmap.org/search?{q}", headers=UA)
    for tentativa in range(6):
        try:
            return json.load(urllib.request.urlopen(req, timeout=30))
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            time.sleep(15 * (tentativa + 1))
    raise RuntimeError("Nominatim continua limitando as requisições")

def buscar(nome):
    # Só aceita limites administrativos (evita, p.ex., o estádio no lugar do bairro Mangueirão)
    for consulta in (f"{nome}, Belém, Pará, Brasil", f"bairro {nome}, Belém"):
        q = urllib.parse.urlencode({"q": consulta, "format": "jsonv2",
                                    "polygon_geojson": 1, "limit": 10})
        res = _get(q); time.sleep(1.5)
        for r in res:
            if (r.get("category") == "boundary"
                    and r.get("geojson", {}).get("type") in ("Polygon", "MultiPolygon")):
                return r
    return None

feats, faltando = [], []
for distrito, nomes in BAIRROS.items():
    for nome in nomes:
        r = buscar(nome)
        if not r:
            faltando.append(nome); print("SEM POLÍGONO:", nome); continue
        print("ok", nome, "->", r["display_name"][:70], r["osm_type"], r["osm_id"])
        feats.append({"type": "Feature", "geometry": r["geojson"],
                      "properties": {"nome": nome, "distrito_adm": distrito,
                                     "osm": f'{r["osm_type"]}/{r["osm_id"]}'}})
json.dump({"type": "FeatureCollection", "features": feats},
          open(sys.argv[1], "w"), ensure_ascii=False)
print("faltando:", faltando)
