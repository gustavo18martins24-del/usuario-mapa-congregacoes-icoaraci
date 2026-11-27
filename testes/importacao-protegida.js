// Teste: a importação de planilha só preenche o que está vazio (não move congregações já posicionadas).
// Uso: servir o projeto em http://localhost:8081 e rodar: node testes/importacao-protegida.js caminho/da/planilha.xlsx
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const XLSX = require('xlsx');
const raiz = path.resolve(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:8081/';
const planilha = process.argv[2];
const estrutura = JSON.parse(fs.readFileSync(path.join(raiz, 'data/estrutura.json')));
const linhas = XLSX.utils.sheet_to_json(XLSX.readFile(planilha).Sheets['Importar']);
let n = 0;
const congregacoes = estrutura.areas.flatMap((a) => a.congregacoes.map((nome) => ({ id: `c${++n}`, nome, area: a.nome, sede_area: nome === a.sede, lat: null, lng: null, endereco: null })));
// 43 já posicionadas: inclui de propósito TODAS as que a planilha traz com coordenada, mais outras
const comCoord = new Set(linhas.filter((l) => l.Lat).map((l) => l['Congregação']));
const metade = [...comCoord].filter((_, i) => i % 2 === 0);            // metade das geocodificadas já está no mapa
const outras = congregacoes.filter((c) => !comCoord.has(c.nome)).slice(0, 43 - metade.length).map((c) => c.nome);
const jaNoMapa = new Set([...metade, ...outras]);
congregacoes.forEach((c, i) => {
  if (jaNoMapa.has(c.nome)) { c.lat = -1.30 - i / 10000; c.lng = -48.47 + i / 10000; c.bairro = 'Teste'; }
  if (i % 7 === 0) c.endereco = 'Endereço já cadastrado';
});
const estado = {
  sessao: 'u-admin', usuarios: [{ id: 'u-admin', email: 'admin@teste', senha: 'x' }],
  perfis: [{ id: 'u-admin', email: 'admin@teste', nome: 'Admin', papel: 'admin', area: null }],
  areas: estrutura.areas.map((a, i) => ({ nome: a.nome, setor: a.setor, responsavel: null, ordem: i })), congregacoes,
};
const falhas = []; const confere = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) falhas.push(msg); };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.route('**/vendor/supabase.js', (r) => r.fulfill({ path: path.join(__dirname, 'supabase-simulado.js'), contentType: 'text/javascript' }));
  await ctx.route('**/js/config.js', (r) => r.fulfill({ body: "window.CONFIG={supabaseUrl:'https://x.supabase.co',supabaseAnonKey:'k'};", contentType: 'text/javascript' }));
  await ctx.addInitScript((e) => { if (!localStorage.getItem('supabase-simulado')) localStorage.setItem('supabase-simulado', JSON.stringify(e)); }, estado);
  const p = await ctx.newPage(); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  let dialogos = 0; p.on('dialog', (d) => { dialogos++; d.dismiss(); });
  await p.goto(BASE); await p.waitForSelector('#app:not([hidden])'); await p.waitForTimeout(1500);
  await p.click('[data-aba=cadastro]'); await p.locator('summary', { hasText: 'Importar planilha' }).click();
  await p.setInputFiles('#arquivo', planilha); await p.waitForTimeout(2500);
  console.log((await p.innerText('#resultado-import')).replace(/\n+/g, ' | '));
  const depois = await p.evaluate(() => JSON.parse(localStorage.getItem('supabase-simulado')).congregacoes);
  const antes = new Map(congregacoes.map((c) => [c.nome, c]));
  confere(depois.length === 95 && dialogos === 0, `nenhuma congregação nova criada (total ${depois.length}, avisos ${dialogos})`);
  const mexidas = depois.filter((c) => jaNoMapa.has(c.nome) && (c.lat !== antes.get(c.nome).lat || c.lng !== antes.get(c.nome).lng));
  confere(mexidas.length === 0, `as ${jaNoMapa.size} já posicionadas não se moveram (${mexidas.map((c) => c.nome).join(', ') || 'nenhuma mexida'})`);
  const novasPos = depois.filter((c) => !jaNoMapa.has(c.nome) && c.lat != null);
  const esperadas = [...comCoord].filter((x) => !jaNoMapa.has(x));
  confere(novasPos.length === esperadas.length, `posicionou só as que estavam sem ponto (${novasPos.length} de ${esperadas.length})`);
  const endTrocado = depois.filter((c) => antes.get(c.nome).endereco === 'Endereço já cadastrado' && c.endereco !== 'Endereço já cadastrado');
  confere(endTrocado.length === 0, 'endereços já cadastrados foram mantidos');
  const endPreench = depois.filter((c) => !antes.get(c.nome).endereco && c.endereco).length;
  confere(endPreench > 60, `endereços vazios foram preenchidos (${endPreench})`);
  confere(erros.length === 0, `sem erros de JavaScript ${erros.join(' | ')}`);
  await b.close();
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nIMPORTAÇÃO PROTEGIDA: TODOS OS TESTES PASSARAM');
  process.exit(falhas.length ? 1 : 0);
})();
