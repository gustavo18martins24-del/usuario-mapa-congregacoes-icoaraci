#!/usr/bin/env bash
# Roda os testes do banco num PostgreSQL local. Uso: PGHOST=... PGPORT=... PGUSER=postgres supabase/testes/rodar.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -q -X -v ON_ERROR_STOP=1"
novo() { $P -c 'drop database if exists teste_mapa' -c 'create database teste_mapa' 2>/dev/null
         $P -d teste_mapa -f supabase/testes/simula_supabase.sql
         $P -d teste_mapa -f supabase/schema.sql 2>/dev/null
         $P -d teste_mapa -f supabase/schema.sql 2>/dev/null; }   # 2x: precisa ser idempotente
novo; $P -d teste_mapa -f supabase/testes/testes_permissoes.sql | grep -E 'PASSARAM'
novo; for i in 1 2; do $P -d teste_mapa -f supabase/seed.sql -f supabase/privado/seed_responsaveis.sql >/dev/null; done
$P -d teste_mapa -f supabase/testes/testes_carga.sql | grep -E 'OK'
