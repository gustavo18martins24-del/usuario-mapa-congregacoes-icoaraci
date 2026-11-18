-- Testes das regras de permissão. Cada bloco falha (exceção) se a regra não se comportar como esperado.
\set ON_ERROR_STOP on
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
insert into areas (nome, setor) values ('Templo Central', 1), ('Área 5', 2), ('Área 6', 2);


insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a', 'admin@ex.com',  '{"nome":"Pr. Admin"}'),
 ('00000000-0000-0000-0000-00000000000e', 'editor@ex.com', '{"nome":"Líder Área 5"}'),
 ('00000000-0000-0000-0000-00000000000f', 'leitor@ex.com', '{}'),
 ('00000000-0000-0000-0000-000000000000', 'novo@ex.com',   '{}');

-- 1) Cadastro cria perfil pendente; o SQL Editor (postgres) consegue promover o primeiro admin.
do $$ begin
  assert (select count(*) from perfis where papel = 'pendente') = 4, 'perfis não criados como pendentes';
  assert (select nome from perfis where email = 'admin@ex.com') = 'Pr. Admin', 'nome não veio do cadastro';
end $$;
update perfis set papel = 'admin' where email = 'admin@ex.com';
update perfis set papel = 'editor', area = 'Área 5' where email = 'editor@ex.com';
update perfis set papel = 'leitor' where email = 'leitor@ex.com';
do $$ begin assert (select papel from perfis where email = 'admin@ex.com') = 'admin', 'bootstrap do admin falhou'; end $$;

-- 2) Admin cadastra congregações (inclusive sedes).
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into congregacoes (id, nome, area, sede_area, lat, lng) values
 ('11111111-0000-0000-0000-000000000001', 'Templo Central', 'Templo Central', true, -1.2990, -48.4800),
 ('11111111-0000-0000-0000-000000000051', 'Sede Área 5',    'Área 5', true,  -1.3300, -48.4600),
 ('11111111-0000-0000-0000-000000000052', 'Betel',          'Área 5', false, -1.3350, -48.4550),
 ('11111111-0000-0000-0000-000000000061', 'Sede Área 6',    'Área 6', true,  -1.3200, -48.4500);
do $$ begin
  assert (select count(*) from congregacoes) = 4, 'admin não conseguiu incluir';
  assert (select atualizado_por from congregacoes limit 1) = '00000000-0000-0000-0000-00000000000a', 'carimbo de autor falhou';
end $$;

-- 3) Regras de dados: área inválida, coordenada fora de Belém, duas sedes na mesma área.
do $$ begin
  begin insert into congregacoes (nome, area) values ('X', 'Área 34'); raise exception 'aceitou Área 34';
  exception when foreign_key_violation then null; end;
  begin insert into congregacoes (nome, area, lat, lng) values ('X', 'Área 1', -48.46, -1.30); raise exception 'aceitou lat/lng invertidas';
  exception when check_violation then null; end;
  begin insert into congregacoes (nome, area, sede_area) values ('X', 'Área 5', true); raise exception 'aceitou 2 sedes';
  exception when unique_violation then null; end;
end $$;

-- 4) definir_sede troca a sede da área.
select definir_sede('11111111-0000-0000-0000-000000000052');
do $$ begin
  assert (select nome from congregacoes where area = 'Área 5' and sede_area) = 'Betel', 'definir_sede falhou';
  assert (select count(*) from congregacoes where area = 'Área 5' and sede_area) = 1, 'ficaram 2 sedes';
end $$;

-- 5) Editor da Área 5: edita a própria área, não mexe em outra, não muda para outra área, não exclui, não se promove.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
update congregacoes set lat = -1.3310 where nome = 'Sede Área 5';
update congregacoes set lat = -1.3000 where nome = 'Sede Área 6';
delete from congregacoes where nome = 'Betel';
update areas set setor = 5 where nome = 'Área 5';
update perfis set papel = 'admin', area = 'Área 6', nome = 'Líder Área 5 (editado)' where id = auth.uid();
do $$ begin
  begin update congregacoes set area = 'Área 6' where nome = 'Betel'; raise exception 'editor moveu congregação para outra área';
  exception when insufficient_privilege then null; end;
  begin insert into congregacoes (nome, area) values ('Nova', 'Área 6'); raise exception 'editor incluiu em outra área';
  exception when insufficient_privilege then null; end;
end $$;
insert into congregacoes (nome, area) values ('Nova da Área 5', 'Área 5');
reset role;
do $$ begin
  assert (select lat from congregacoes where nome = 'Sede Área 5') = -1.3310, 'editor não editou a própria área';
  assert (select lat from congregacoes where nome = 'Sede Área 6') = -1.3200, 'editor editou outra área';
  assert exists (select 1 from congregacoes where nome = 'Betel'), 'editor excluiu';
  assert (select papel || '|' || area || '|' || nome from perfis where email = 'editor@ex.com') = 'editor|Área 5|Líder Área 5 (editado)',
         'editor mudou o próprio papel/área (ou não conseguiu mudar o nome)';
  assert exists (select 1 from congregacoes where nome = 'Nova da Área 5'), 'editor não incluiu na própria área';
  assert (select setor from areas where nome = 'Área 5') = 2, 'editor alterou a tabela de áreas';
end $$;

-- 6) Leitor vê, mas não altera; pendente e anônimo não veem nada.
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false);
do $$ begin assert (select count(*) from congregacoes) = 5, 'leitor não vê'; end $$;
do $$ begin assert (select count(*) from areas) = 3, 'leitor não vê as áreas'; end $$;
update areas set responsavel = 'hack';
update congregacoes set nome = 'hack';
do $$ begin assert (select count(*) from historico) = 0, 'leitor vê o histórico'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', false);
do $$ begin assert (select count(*) from congregacoes) = 0, 'pendente vê congregações'; end $$;
do $$ begin assert (select count(*) from areas) = 0, 'pendente vê áreas'; end $$;
do $$ begin assert (select count(*) from perfis) = 1, 'pendente vê perfis de outros'; end $$;
reset role; set role anon;
do $$ begin
  begin perform count(*) from congregacoes; raise exception 'anônimo leu congregações';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin assert not exists (select 1 from congregacoes where nome = 'hack'), 'leitor alterou'; end $$;
do $$ begin assert not exists (select 1 from areas where responsavel = 'hack'), 'leitor alterou área'; end $$;

-- 7) Histórico registra quem fez o quê.
do $$ begin
  assert (select count(*) from historico where acao = 'inclusão') = 5, 'histórico de inclusões';
  assert exists (select 1 from historico where usuario_email = 'editor@ex.com' and acao = 'alteração'), 'histórico do editor';
end $$;

-- 8) Admin aprova usuário e vê todos os perfis.
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update perfis set papel = 'leitor' where email = 'novo@ex.com';
do $$ begin assert (select count(*) from perfis) = 4, 'admin não vê todos os perfis'; end $$;
reset role;
do $$ begin assert (select papel from perfis where email = 'novo@ex.com') = 'leitor', 'admin não aprovou'; end $$;
\echo TODOS OS TESTES DE PERMISSÃO PASSARAM
