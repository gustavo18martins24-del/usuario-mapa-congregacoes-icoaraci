-- Testa a carga inicial (seed.sql + responsáveis), executada como no SQL Editor.
\set ON_ERROR_STOP on
do $$ begin
  assert (select count(*) from areas) = 35, 'esperava 35 grupos';
  assert (select count(*) from areas where nome like 'Área %') = 33, 'esperava 33 áreas';
  assert (select count(*) from congregacoes) = 96, 'esperava 96 congregações';
  assert (select count(*) from congregacoes where area like 'Área %') = 94, 'esperava 94 nas áreas numeradas';
  assert (select count(distinct setor) from areas) = 5, 'esperava 5 setores';
  assert (select count(*) from congregacoes where sede_area) = 35, 'uma sede por grupo (35)';
  assert (select nome from congregacoes where area = 'Área 3' and sede_area) = 'Monte de Israel', 'sede da Área 3 = 1ª da lista';
  assert (select nome from congregacoes where area = 'Área 33' and sede_area) = 'Rio Jordão', 'sede da Área 33';
  assert (select count(*) from areas where responsavel is not null) = 35, 'todos os responsáveis';
  assert (select string_agg(nome, ',' order by nome) from congregacoes where area = 'Área 32') = 'Manancial,Rocha Eterna,Torre Forte', 'Área 32';
end $$;
\echo CARGA INICIAL OK
