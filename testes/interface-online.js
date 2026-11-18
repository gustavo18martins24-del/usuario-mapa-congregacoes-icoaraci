// Teste de interface do modo online (login, papéis e permissões) com o Supabase simulado.
// Uso: servir a pasta do projeto em http://localhost:8080 e rodar: node testes/interface-online.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const raiz = path.resolve(__dirname, '..');
const BASE = 'http://localhost:8080/';
const estrutura = JSON.parse(fs.readFileSync(path.join(raiz, 'data/estrutura.json')));
let n = 0;
const estadoInicial = {
  sessao: null,
  usuarios: [{ id: 'u-admin', email: 'admin@teste', senha: 'segredo1' }, { id: 'u-novo', email: 'lider@teste', senha: 'segredo2' }],
  perfis: [{ id: 'u-admin', email: 'admin@teste', nome: 'Pr. Administrador', papel: 'admin', area: null, criado_em: '2026-01-01' },
           { id: 'u-novo', email: 'lider@teste', nome: 'Líder da Área 5', papel: 'pendente', area: null, criado_em: '2026-01-02' }],
  areas: estrutura.areas.map((a, i) => ({ nome: a.nome, setor: a.setor, responsavel: `Responsável ${a.nome}`, ordem: i })),
  congregacoes: estrutura.areas.flatMap((a) => a.congregacoes.map((nome) => ({ id: `c${++n}`, nome, area: a.nome, sede_area: nome === a.nome, lat: null, lng: null }))),
};
const falhas = [];
const confere = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) falhas.push(msg); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1300, height: 820 } });
  await ctx.route('**/vendor/supabase.js', (r) => r.fulfill({ path: path.join(__dirname, 'supabase-simulado.js'), contentType: 'text/javascript' }));
  await ctx.route('**/js/config.js', (r) => r.fulfill({ body: "window.CONFIG={supabaseUrl:'https://simulado.supabase.co',supabaseAnonKey:'anon'};", contentType: 'text/javascript' }));
  await ctx.addInitScript((e) => { if (!localStorage.getItem('supabase-simulado')) localStorage.setItem('supabase-simulado', JSON.stringify(e)); }, estadoInicial);
  const p = await ctx.newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  p.on('dialog', (d) => d.accept());
  const entrar = async (email, senha) => {
    await p.goto(BASE); await p.waitForSelector('#tela-login:not([hidden])');
    await p.fill('#login-email', email); await p.fill('#login-senha', senha); await p.click('#btn-login');
  };
  const sair = async () => { await p.locator('.btn-sair:visible').first().click(); await p.waitForTimeout(500); };

  await p.goto(BASE); await p.waitForTimeout(800);
  confere(await p.isVisible('#tela-login') && !(await p.isVisible('#app')), 'sem login: só a tela de login aparece');

  await entrar('admin@teste', 'errada'); await p.waitForTimeout(400);
  confere((await p.textContent('#login-msg')).includes('incorretos'), 'senha errada: mensagem em português');

  await entrar('lider@teste', 'segredo2'); await p.waitForTimeout(800);
  confere(await p.isVisible('#tela-pendente'), 'usuário pendente vê "Aguardando aprovação"');
  await sair();

  // Admin aprova o líder como editor da Área 5
  await entrar('admin@teste', 'segredo1'); await p.waitForSelector('#app:not([hidden])'); await p.waitForTimeout(1500);
  confere((await p.textContent('#usuario-papel')).includes('Admin'), 'admin logado');
  confere(await p.isVisible('[data-aba=usuarios]') && (await p.textContent('[data-aba=usuarios]')).includes('(1)'), 'aba Usuários mostra 1 pendente');
  await p.click('[data-aba=usuarios]'); await p.waitForTimeout(400);
  const item = p.locator('.usuario-item', { hasText: 'lider@teste' });
  await item.locator('[data-campo=papel]').selectOption('editor');
  await item.locator('[data-campo=area]').selectOption('Área 5'); await p.waitForTimeout(500);
  const est = await p.evaluate(() => JSON.parse(localStorage.getItem('supabase-simulado')).perfis.find((x) => x.email === 'lider@teste'));
  confere(est.papel === 'editor' && est.area === 'Área 5', 'admin aprovou o líder como editor da Área 5');

  // Admin posiciona Templo Central e define sede da Área 4
  await p.click('[data-aba=cadastro]');
  await p.locator('#pendentes li', { hasText: 'Templo Central' }).locator('[data-acao=posicionar]').click();
  await p.mouse.click(860, 330); await p.waitForTimeout(500);
  await p.locator('#pendentes li', { hasText: 'Maranata' }).locator('[data-acao=editar]').click();
  await p.check('#form-congregacao [name=sede_area]'); await p.click('#dlg-salvar'); await p.waitForTimeout(500);
  const s1 = await p.evaluate(() => JSON.parse(localStorage.getItem('supabase-simulado')).congregacoes);
  confere(s1.find((c) => c.nome === 'Templo Central').lat != null, 'admin posicionou o Templo Central');
  confere(s1.find((c) => c.nome === 'Maranata').sede_area, 'admin definiu Maranata como sede da Área 4');
  await sair();

  // Editor da Área 5: só edita a própria área
  await entrar('lider@teste', 'segredo2'); await p.waitForSelector('#app:not([hidden])'); await p.waitForTimeout(1500);
  confere((await p.textContent('#usuario-papel')).includes('Editor · Área 5'), 'editor logado com a área no cabeçalho');
  confere(!(await p.isVisible('[data-aba=usuarios]')), 'editor não vê a aba Usuários');
  await p.click('[data-aba=cadastro]');
  const nomesCadastro = await p.locator('#pendentes li .nome').allTextContents();
  confere(nomesCadastro.length === 2 && nomesCadastro.every((t) => /Monte Gerizim|Ágape/.test(t)), `Cadastro do editor lista só a Área 5 (${nomesCadastro.join(', ')})`);
  confere((await p.textContent('#progresso')).includes('da Área 5'), 'progresso mostra a área do editor');
  confere(!(await p.isVisible('#arquivo')), 'editor não vê a importação de planilha');
  await p.locator('#pendentes li', { hasText: 'Monte Gerizim' }).locator('[data-acao=posicionar]').click();
  await p.mouse.click(900, 470); await p.waitForTimeout(500);
  await p.click('[data-aba=congregacoes]');
  confere(await p.locator('#lista li', { hasText: 'Maranata' }).locator('[data-acao=editar]').count() === 0, 'editor não tem botão de editar em outra área');
  confere(await p.locator('#lista li', { hasText: 'Ágape' }).locator('[data-acao=editar]').count() === 1, 'editor tem botão de editar na própria área');
  const s2 = await p.evaluate(() => JSON.parse(localStorage.getItem('supabase-simulado')).congregacoes.find((c) => c.nome === 'Monte Gerizim'));
  confere(s2.lat != null && s2.bairro, `editor posicionou Monte Gerizim (bairro: ${s2.bairro})`);
  await p.screenshot({ path: path.join(process.argv[2] || '.', '10-editor.png') });
  await sair();

  // Leitor: só visualiza
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('supabase-simulado')); s.perfis.find((x) => x.email === 'lider@teste').papel = 'leitor'; localStorage.setItem('supabase-simulado', JSON.stringify(s)); });
  await entrar('lider@teste', 'segredo2'); await p.waitForSelector('#app:not([hidden])'); await p.waitForTimeout(1200);
  confere(!(await p.isVisible('[data-aba=cadastro]')) && await p.locator('#lista [data-acao=editar]').count() === 0, 'leitor não vê Cadastro nem botões de edição');
  confere((await p.textContent('#lista')).includes('Responsável Área 5'), 'leitor vê o responsável de cada área');
  await sair();

  // Criar conta nova
  await p.goto(BASE); await p.click('[data-modo=cadastrar]');
  await p.fill('#login-nome', 'Ev. Novo'); await p.fill('#login-email', 'novo@teste'); await p.fill('#login-senha', 'abcdef'); await p.click('#btn-login');
  await p.waitForTimeout(800);
  confere(await p.isVisible('#tela-pendente'), 'conta criada fica aguardando aprovação');

  confere(erros.length === 0, `sem erros de JavaScript ${erros.join(' | ')}`);
  await b.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTODOS OS TESTES DE INTERFACE PASSARAM');
  process.exit(falhas.length ? 1 : 0);
})();
