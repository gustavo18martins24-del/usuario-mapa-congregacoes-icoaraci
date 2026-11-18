"""Gera a carga inicial do banco a partir de data/estrutura.json.

  supabase/seed.sql                         – setores, áreas e as 96 congregações (sem coordenadas)
  supabase/privado/seed_responsaveis.sql    – nomes dos responsáveis (NÃO vai para o GitHub)

Ambos podem ser executados mais de uma vez: não duplicam nem apagam posições já cadastradas.
"""
import json, pathlib
raiz = pathlib.Path(__file__).resolve().parent.parent
q = lambda s: "'" + str(s).replace("'", "''") + "'"
e = json.loads((raiz / "data/estrutura.json").read_text())

linhas = [f"-- Carga inicial gerada por scripts/gerar_seed.py a partir de: {e['fonte']}", "begin;"]
for i, a in enumerate(e["areas"]):
    setor = a["setor"] if a["setor"] else "null"
    linhas.append(f"insert into public.areas (nome, setor, ordem) values ({q(a['nome'])}, {setor}, {i}) "
                  f"on conflict (nome) do update set setor = excluded.setor, ordem = excluded.ordem;")
for a in e["areas"]:
    for c in a["congregacoes"]:
        linhas.append(f"insert into public.congregacoes (nome, area) select {q(c)}, {q(a['nome'])} "
                      f"where not exists (select 1 from public.congregacoes where lower(nome) = lower({q(c)}) and area = {q(a['nome'])});")
# Sede de cada área = primeira congregação da lista (só marca se a área ainda não tem sede).
for a in e["areas"]:
    linhas.append(f"update public.congregacoes set sede_area = true where lower(nome) = lower({q(a['sede'])}) and area = {q(a['nome'])} "
                  f"and not exists (select 1 from public.congregacoes s where s.area = {q(a['nome'])} and s.sede_area);")
linhas.append("commit;")
(raiz / "supabase/seed.sql").write_text("\n".join(linhas) + "\n")

priv = raiz / "supabase/privado"
resp = json.loads((priv / "responsaveis.json").read_text())
(priv / "seed_responsaveis.sql").write_text(
    "-- Responsáveis por área (dados pessoais: não publicar).\n" +
    "\n".join(f"update public.areas set responsavel = {q(r)} where nome = {q(n)};" for n, r in resp.items()) + "\n")
print("seed.sql e seed_responsaveis.sql gerados")
