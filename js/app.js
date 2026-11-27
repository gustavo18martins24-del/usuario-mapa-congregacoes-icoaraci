/* Mapa das Congregações – Distrito Icoaraci (Belém-PA)
 * Leaflet (mapa) + Turf (análise espacial) + SheetJS (planilhas) + Dados (Supabase ou modo local).
 * Distâncias em linha reta: geodésica de Haversine (Turf). Rotas pelas ruas: OSRM sobre o OpenStreetMap.
 */
(() => {
  'use strict';

  // ---------- Estrutura do distrito ----------
  const ESPECIAIS = ['Templo Central', 'Manancial de Bênção'];
  const N_AREAS = 33, TOTAL_ESPERADO = 95;
  // Paleta do site: Cream, Slate Blue, Teal, Terracotta, Mustard, Sage Green, Dusty Rose, Deep Plum (+ carvão).
  const PALETA = { creme: '#F2E9D8', ardosia: '#59718A', teal: '#2F6F6D', terracota: '#E07A47', mostarda: '#D4A72C',
                   salvia: '#8FA68F', rosa: '#C47C8A', ameixa: '#5B3A62', carvao: '#1F2124' };
  // Cores dos setores nas camadas de análise (territórios, Voronoi, raios), tiradas da mesma paleta.
  // Terracotta e Mustard levemente ajustados para os 5 setores passarem no teste de daltonismo.
  const COR_SETOR = { 1: '#5B3A62', 2: '#8FA68F', 3: '#59718A', 4: '#B8552A', 5: '#DDB02E' };
  const COR_SEM_SETOR = '#8a857c';
  const CENTRO = [-1.305, -48.468];
  const PERTO_M = 500, ISOLADA_M = 2000;
  const PAPEIS = { pendente: 'Pendente', leitor: 'Leitor', editor: 'Editor', admin: 'Admin' };

  // ---------- Estado ----------
  let areas = [];            // [{ nome, setor, responsavel, ordem }]
  let congregacoes = [];
  let perfil = null;         // { papel, area, nome, email }
  let bairros = null, uniaoBairros = null, localidades = [];
  let posicionando = null;   // congregação aguardando clique no mapa
  const marcadores = new Map();

  // ---------- Utilidades ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const km = (m) => m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${Math.round(m)} m`;
  const min = (s) => s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const temPos = (c) => Number.isFinite(c.lat) && Number.isFinite(c.lng);
  const posicionadas = () => congregacoes.filter(temPos);
  const ponto = (c) => turf.point([c.lng, c.lat], { id: c.id });
  const distM = (a, b) => turf.distance(ponto(a), ponto(b), { units: 'kilometers' }) * 1000;
  const areaDe = (nome) => areas.find((a) => a.nome === nome);
  const setorDe = (c) => areaDe(c.area)?.setor ?? null;
  const sedeDa = (area) => congregacoes.find((c) => c.area === area && c.sede_area);
  const ehEspecial = (c) => ESPECIAIS.includes(c.area);
  const ordemArea = (nome) => areaDe(nome)?.ordem ?? 999;
  const rotuloArea = (nome) => nome;
  const num = (v, casas = 0) => (v == null || Number.isNaN(v) ? '–' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }));
  const reais = (v) => (v == null ? '–' : `R$ ${num(v)}`);

  const corDe = (c) => COR_SETOR[setorDe(c)] || COR_SEM_SETOR;

  // ---------- Ícones (alfinetes) ----------
  // Congregação: Teal com templo creme · Sede da área e Templo Central: Terracotta com estrela creme e contorno carvão.
  // O Manancial de Bênção segue o padrão das congregações. O número no canto indica o setor.
  const PINO = 'M20 50C20 50 4 31 4 19a16 16 0 0 1 32 0c0 12-16 31-16 31z';
  const ehSedeVisual = (c) => !!c.sede_area && c.area !== 'Manancial de Bênção';
  function svgPino(sede, w) {
    const corpo = sede ? PALETA.terracota : PALETA.teal, tinta = PALETA.creme;
    const glifo = sede
      ? `<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" fill="${tinta}"/>`
      : `<path d="M12 3v3M10.5 4.5h3" stroke="${tinta}" stroke-width="1.6" stroke-linecap="round"/><path d="M5 11.5 12 7l7 4.5V19H5z" fill="${tinta}"/><rect x="10.3" y="13.5" width="3.4" height="5.5" rx="1.7" fill="${corpo}"/>`;
    const contorno = sede ? `<path d="${PINO}" fill="none" stroke="${PALETA.carvao}" stroke-width="5"/>` : '';
    return `<svg class="svg-pino" width="${w}" height="${Math.round(w * 1.3)}" viewBox="0 0 40 52" aria-hidden="true">${contorno}<path d="${PINO}" fill="${corpo}" stroke="${tinta}" stroke-width="2.5"/><g transform="translate(8 7)">${glifo}</g></svg>`;
  }
  const seloSetor = (setor) => (setor ? `<span class="num-setor" title="Setor ${setor}">${setor}</span>` : '');
  const miniPino = (c) => `<span class="mini-pino">${svgPino(ehSedeVisual(c), 20)}${seloSetor(setorDe(c))}</span>`;

  // Padroniza a grafia da área: "1", "01", "AREA 1", "1ª Área", "Área-01" → "Área 1".
  function normalizarArea(bruto) {
    const s = String(bruto ?? '').trim(); if (!s) return '';
    const n = norm(s);
    if (/templo|central/.test(n)) return 'Templo Central';
    if (/manancial/.test(n)) return 'Manancial de Bênção';
    const num = n.match(/\d+/);
    return num ? `Área ${parseInt(num[0], 10)}` : s;
  }

  // ---------- Permissões ----------
  const papel = () => perfil?.papel;
  const ehAdmin = () => papel() === 'admin';
  const podeEditar = (c) => ehAdmin() || (papel() === 'editor' && c && c.area === perfil.area);
  function aplicarPermissoes() {
    $$('[data-papel]').forEach((el) => { el.hidden = !el.dataset.papel.split(' ').includes(papel()); });
    $$('[data-modo]:not([data-modo=entrar]):not([data-modo=cadastrar]):not([data-modo=recuperar])').forEach((el) => {
      if (el.dataset.modo !== Dados.modo) el.hidden = true;
    });
  }

  function avisar(texto, tipo = 'ok') {
    const el = $('#aviso-flutuante');
    el.textContent = texto; el.className = tipo; el.hidden = false;
    clearTimeout(avisar.t); avisar.t = setTimeout(() => { el.hidden = true; }, 3500);
  }

  // ================= LOGIN =================
  let modoLogin = 'entrar';
  function mostrarTela(id) {
    ['#tela-login', '#tela-pendente', '#tela-nova-senha', '#app'].forEach((t) => { $(t).hidden = t !== id; });
  }
  $$('.abas-login button').forEach((b) => b.addEventListener('click', () => {
    modoLogin = b.dataset.modo;
    $$('.abas-login button').forEach((x) => x.classList.toggle('ativa', x === b));
    $$('#form-login [data-so]').forEach((el) => { el.hidden = !el.dataset.so.split(' ').includes(modoLogin); });
    $('#login-senha').required = modoLogin !== 'recuperar';
    $('#login-nome').required = modoLogin === 'cadastrar';
    $('#login-senha').autocomplete = modoLogin === 'cadastrar' ? 'new-password' : 'current-password';
    $('#btn-login').textContent = { entrar: 'Entrar', cadastrar: 'Criar conta', recuperar: 'Enviar link de recuperação' }[modoLogin];
    $('#login-msg').textContent = '';
  }));
  $$('#form-login [data-so]').forEach((el) => { el.hidden = !el.dataset.so.split(' ').includes('entrar'); });
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#login-msg'), btn = $('#btn-login');
    const email = $('#login-email').value.trim(), senha = $('#login-senha').value;
    btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Aguarde…';
    try {
      if (modoLogin === 'entrar') { await Dados.entrar(email, senha); await abrirApp(); }
      else if (modoLogin === 'cadastrar') {
        const r = await Dados.cadastrar($('#login-nome').value.trim(), email, senha);
        if (r.session) await abrirApp();
        else { msg.className = 'msg ok'; msg.textContent = 'Conta criada! Abra o e-mail de confirmação que enviamos e depois entre aqui.'; }
      } else {
        await Dados.recuperarSenha(email);
        msg.className = 'msg ok'; msg.textContent = 'Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.';
      }
    } catch (err) { msg.className = 'msg erro'; msg.textContent = err.message; }
    btn.disabled = false;
  });
  $('#form-nova-senha').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await Dados.novaSenha($('#nova-senha').value); history.replaceState(null, '', location.pathname); await abrirApp(); }
    catch (err) { $('#nova-senha-msg').className = 'msg erro'; $('#nova-senha-msg').textContent = err.message; }
  });
  $$('.btn-sair').forEach((b) => b.addEventListener('click', async () => { await Dados.sair(); location.reload(); }));

  // ================= MAPA =================
  const mapa = L.map('mapa', { zoomControl: true }).setView(CENTRO, 13);
  const ruas = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
  const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imagens © Esri, Maxar, Earthstar Geographics' });
  L.control.layers({ 'Ruas (OpenStreetMap)': ruas, 'Satélite': satelite }, null, { position: 'topright' }).addTo(mapa);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(mapa);

  mapa.createPane('temas').style.zIndex = 350;   // mapas temáticos ficam abaixo dos limites e marcadores
  const camadas = {
    bairros: L.layerGroup().addTo(mapa),
    localidades: L.layerGroup().addTo(mapa),
    territorioSetor: L.layerGroup(),
    territorioArea: L.layerGroup(),
    ligacoes: L.layerGroup(),
    voronoi: L.layerGroup(),
    raios: L.layerGroup(),
    ibge: L.layerGroup(),
    rota: L.layerGroup().addTo(mapa),
    marcadores: L.layerGroup().addTo(mapa),
  };
  const zoomRotulos = () => {
    const z = mapa.getZoom();
    document.body.classList.toggle('sem-rotulos', z < 15);
    document.body.classList.toggle('sem-rotulos-sede', z < 14);
  };
  mapa.on('zoomend', zoomRotulos); zoomRotulos();

  // ---------- Bairros e localidades ----------
  async function carregarGeografia() {
    // Limites oficiais dos bairros (IBGE, Censo 2022) com indicadores agregados dos setores censitários.
    bairros = await (await fetch('data/ibge_bairros.geojson')).json();
    try { uniaoBairros = turf.union(bairros); } catch { uniaoBairros = null; }
    const corDistrito = { DAICO: PALETA.ardosia, DABEN: PALETA.ardosia };
    L.geoJSON(bairros, {
      style: (f) => ({ color: corDistrito[f.properties.distrito_adm] || PALETA.ardosia, weight: 1.6, dashArray: '5 4', fillColor: PALETA.creme, fillOpacity: 0.2 }),
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindTooltip(p.nome, { permanent: true, direction: 'center', className: 'rotulo-bairro' });
        l.on('click', (e) => {
          if (posicionando) return;
          const dentro = posicionadas().filter((c) => turf.booleanPointInPolygon(ponto(c), f));
          L.popup({ maxWidth: 320 }).setLatLng(e.latlng).setContent(`<div class="popup"><h3>${esc(p.nome)}</h3>
            <p class="dica">Distrito ${esc(p.distrito)} (${esc(p.distrito_adm)}) · ${num(p.area_km2, 2)} km²</p>
            <table class="mini-tabela">
              <tr><td>População (2022)</td><td class="n"><b>${num(p.pop)}</b></td></tr>
              <tr><td>Domicílios ocupados</td><td class="n">${num(p.domicilios)}</td></tr>
              <tr><td>Densidade</td><td class="n">${num(p.dens)} hab/km²</td></tr>
              <tr><td>Renda média do responsável</td><td class="n">${reais(p.renda_media)}</td></tr>
              <tr><td>Pop. em favelas e comunidades urbanas</td><td class="n">${num(p.pct_fcu, 1)}%</td></tr>
              <tr><td>Congregações no bairro</td><td class="n"><b>${dentro.length}</b></td></tr>
              ${dentro.length ? `<tr><td>Habitantes por congregação</td><td class="n">${num(p.pop / dentro.length)}</td></tr>` : ''}
            </table>
            ${dentro.length ? `<p>${dentro.map((c) => esc(c.nome)).join(', ')}</p>` : ''}
            ${p.comunidades ? `<p class="dica">Comunidades urbanas (IBGE): ${esc(p.comunidades)}</p>` : ''}</div>`).openOn(mapa);
        });
      },
    }).addTo(camadas.bairros);
    $('#lista-bairros').innerHTML = bairros.features.map((f) => f.properties.nome)
      .sort((a, b) => a.localeCompare(b, 'pt-BR')).map((n) => `<option value="${esc(n)}">`).join('');

    try { localidades = await (await fetch('data/localidades.json')).json(); } catch { localidades = []; }
    localidades.forEach((l) => {
      L.marker([l.lat, l.lng], { icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="rotulo-localidade">◇ ${esc(l.nome)}</div>` }) })
        .bindPopup(`<div class="popup"><h3>${esc(l.nome)}</h3><p>${esc(l.tipo)} · bairro <b>${esc(l.bairro)}</b></p><p class="dica">${esc(l.nota)}</p></div>`)
        .addTo(camadas.localidades);
    });
    $('#lista-localidades').innerHTML = localidades.map((l) => `<option value="${esc(l.nome)}">`).join('');
  }
  function bairroDe(c) {
    if (!bairros || !temPos(c)) return '';
    const f = bairros.features.find((f) => turf.booleanPointInPolygon(ponto(c), f));
    return f ? f.properties.nome : 'Fora dos bairros mapeados';
  }

  // ---------- Marcadores ----------
  function desenharMarcadores() {
    camadas.marcadores.clearLayers(); marcadores.clear();
    const arrastar = $('#modo-edicao').checked;
    const fs = /^\d$/.test(filtroAba) ? filtroAba : '', fa = '', so = filtroAba === 'sedes';
    posicionadas().forEach((c) => {
      const apagada = (fs && String(setorDe(c)) !== fs) || (fa && c.area !== fa) || (so && !c.sede_area);
      const tipo = ehSedeVisual(c) ? 'sede' : 'comum';
      const w = tipo === 'sede' ? 34 : 28, h = Math.round(w * 1.3);
      const icone = L.divIcon({
        className: '', iconSize: [w, h], iconAnchor: [w / 2, h], popupAnchor: [0, -h + 4],
        html: `<div class="marcador ${tipo}${apagada ? ' apagada' : ''}">${svgPino(tipo === 'sede', w)}${seloSetor(setorDe(c))}<div class="rotulo">${esc(c.nome)}</div></div>`,
      });
      const m = L.marker([c.lat, c.lng], {
        icon: icone, draggable: arrastar && podeEditar(c), title: `${c.nome} – ${c.area}`,
        zIndexOffset: tipo === 'comum' ? 0 : 1000, opacity: 1,
      }).bindPopup(() => popupCongregacao(c), { minWidth: 230 });
      m.on('dragend', async () => {
        const ll = m.getLatLng();
        await salvarCongregacao({ ...c, lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) }, { recalcularBairro: true });
      });
      m.addTo(camadas.marcadores); marcadores.set(c.id, m);
    });
  }
  function popupCongregacao(c) {
    const a = areaDe(c.area), sede = sedeDa(c.area);
    const outras = posicionadas().filter((o) => o.id !== c.id).map((o) => ({ o, d: distM(c, o) })).sort((x, y) => x.d - y.d);
    const viz = outras.slice(0, 3).map(({ o, d }) => `<li>${esc(o.nome)} <span class="dica">(${esc(o.area)})</span> – <b>${km(d)}</b></li>`).join('');
    const ateSede = sede && sede.id !== c.id && temPos(sede) ? `<p>Até a sede (${esc(sede.nome)}): <b>${km(distM(c, sede))}</b></p>` : '';
    const infl = ibge ? acesso().filter((x) => x.prox?.c.id === c.id) : [];
    const popInfl = infl.length ? `<p>População na área de influência: <b>${num(infl.reduce((s, x) => s + x.pop, 0))}</b> hab. <span class="dica">(${infl.length} setores censitários, IBGE 2022)</span></p>` : '';
    return `<div class="popup"><h3>${esc(c.nome)}${c.sede_area ? ' <span class="etiqueta sede">Sede</span>' : ''}</h3>
      <p><b>${esc(c.area)}</b>${a?.setor ? ` · Setor ${seloSetor(a.setor)}` : ' · sem setor'}</p>
      ${a?.responsavel ? `<p>Responsável da área: ${esc(a.responsavel)}</p>` : ''}
      <p>Bairro: <b>${esc(c.bairro || bairroDe(c))}</b>${c.localidade ? ` · ${esc(c.localidade)}` : ''}</p>
      ${c.dirigente ? `<p>Dirigente: ${esc(c.dirigente)}</p>` : ''}
      ${c.endereco ? `<p>Endereço: ${esc(c.endereco)}</p>` : ''}
      ${ateSede}
      ${popInfl}
      ${viz ? `<p style="margin-top:6px">Mais próximas (linha reta):</p><ol>${viz}</ol>` : ''}
      <p class="linha" style="margin-top:6px">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}" target="_blank" rel="noopener">Como chegar ↗</a>
        ${podeEditar(c) ? `<a href="#" data-editar="${esc(c.id)}">Editar</a>` : ''}
      </p></div>`;
  }
  mapa.on('popupopen', (e) => {
    const link = e.popup.getElement()?.querySelector('[data-editar]');
    if (link) link.addEventListener('click', (ev) => { ev.preventDefault(); abrirFormulario(congregacoes.find((c) => c.id === link.dataset.editar)); });
  });

  // ---------- Lista agrupada por área ----------
  function itemCongregacao(c, comBotao) {
    const pos = temPos(c);
    return `<li data-id="${esc(c.id)}" class="${pos ? '' : 'sem-posicao'}">
      ${miniPino(c)}
      <div class="info"><div class="nome">${esc(c.nome)}${c.sede_area ? ' <span class="etiqueta sede">Sede</span>' : ''}</div>
      <div class="meta">${pos ? esc(c.bairro || '') + (c.localidade ? ' · ' + esc(c.localidade) : '') : '<i>não posicionada</i>'}</div></div>
      ${comBotao && podeEditar(c) ? `<button data-acao="posicionar">${pos ? 'Mover' : 'Posicionar'}</button>` : ''}
      ${podeEditar(c) ? '<button data-acao="editar" class="icone" title="Editar">✎</button>' : ''}</li>`;
  }
  function grupos(lista, comBotao) {
    const porArea = new Map();
    lista.forEach((c) => { if (!porArea.has(c.area)) porArea.set(c.area, []); porArea.get(c.area).push(c); });
    return [...porArea.entries()].sort((a, b) => ordemArea(a[0]) - ordemArea(b[0])).map(([nome, cs]) => {
      const a = areaDe(nome) || {};
      cs.sort((x, y) => (y.sede_area - x.sede_area) || x.nome.localeCompare(y.nome, 'pt-BR'));
      const semSede = !ESPECIAIS.includes(nome) && !congregacoes.some((c) => c.area === nome && c.sede_area);
      return `<div class="grupo-area"><div class="cab-area">
          <b>${esc(rotuloArea(nome))}</b><span>${a.setor ? `Setor ${seloSetor(a.setor)}` : 'sem setor'}</span>
          ${semSede ? '<span class="etiqueta alerta" title="Defina a sede desta área">sem sede</span>' : ''}</div>
        ${a.responsavel ? `<div class="responsavel">${esc(a.responsavel)}</div>` : ''}
        <ul class="lista">${cs.map((c) => itemCongregacao(c, comBotao)).join('')}</ul></div>`;
    }).join('');
  }
  // ---------- Abas de setor + cartões de área ----------
  let filtroAba = '';                 // '' (todos) | '1'..'5' | 'sedes'
  const areasAbertas = new Set();     // cartões abertos (sobrevive aos redesenhos)
  function filtrar() {
    const q = norm($('#busca').value);
    const fs = /^\d$/.test(filtroAba) ? filtroAba : '', so = filtroAba === 'sedes';
    return congregacoes.filter((c) => (!fs || String(setorDe(c)) === fs) && (!so || c.sede_area) &&
      (!q || norm(`${c.nome} ${c.area} ${c.bairro} ${c.localidade} ${areaDe(c.area)?.responsavel} setor ${setorDe(c)}`).includes(q)));
  }
  function cartoesArea(lista) {
    const busca = !!$('#busca').value.trim(), soSedes = filtroAba === 'sedes';
    const porArea = new Map();
    lista.forEach((c) => { if (!porArea.has(c.area)) porArea.set(c.area, []); porArea.get(c.area).push(c); });
    return [...porArea.entries()].sort((a, b) => ordemArea(a[0]) - ordemArea(b[0])).map(([nome, cs]) => {
      const a = areaDe(nome) || {}, sede = sedeDa(nome), total = congregacoes.filter((c) => c.area === nome).length;
      cs.sort((x, y) => (y.sede_area - x.sede_area) || x.nome.localeCompare(y.nome, 'pt-BR'));
      const aberta = busca || soSedes || areasAbertas.has(nome);
      const semSede = !ESPECIAIS.includes(nome) && !sede;
      const fora = cs.filter((c) => !temPos(c)).length;
      return `<details class="cartao-area" data-area="${esc(nome)}" ${aberta ? 'open' : ''}>
        <summary>${seloSetor(a.setor) || '<span class="num-setor vazio" title="Sem setor">–</span>'}
          <span class="txt"><b>${esc(nome)}</b>
            <span class="meta">${total} cong.${sede ? ` · sede ${esc(sede.nome)}` : ''}${fora ? ` · ${fora} fora do mapa` : ''}</span></span>
          ${semSede ? '<span class="etiqueta alerta">sem sede</span>' : ''}<span class="seta" aria-hidden="true"></span></summary>
        <div class="conteudo">
          ${a.responsavel ? `<div class="responsavel">${esc(a.responsavel)}</div>` : ''}
          <ul class="lista">${cs.map((c) => itemCongregacao(c, !temPos(c))).join('')}</ul>
        </div></details>`;
    }).join('');
  }
  function desenharLista() {
    const itens = filtrar();
    const nAreas = areas.filter((a) => !ESPECIAIS.includes(a.nome)).length;
    const sedes = areas.filter((a) => !ESPECIAIS.includes(a.nome) && sedeDa(a.nome)).length;
    const noMapa = posicionadas().length, pct = congregacoes.length ? (100 * noMapa) / congregacoes.length : 0;
    $('#resumo').innerHTML = `<span><b>${noMapa}</b>/${congregacoes.length} no mapa</span>
      <span class="barra" title="${Math.round(pct)}% posicionadas"><i style="width:${Math.max(pct, 1.5)}%"></i></span>
      <span><b>${sedes}</b>/${nAreas} sedes</span>`;
    $('#lista').innerHTML = itens.length ? cartoesArea(itens) : '<p class="dica">Nenhuma congregação encontrada.</p>';
  }
  $('#lista').addEventListener('toggle', (e) => {
    const d = e.target.closest?.('details[data-area]');
    if (!d || $('#busca').value.trim() || filtroAba === 'sedes') return;
    if (d.open) areasAbertas.add(d.dataset.area); else areasAbertas.delete(d.dataset.area);
  }, true);
  $$('#abas-setor button').forEach((b) => b.addEventListener('click', () => {
    filtroAba = b.dataset.filtro;
    $$('#abas-setor button').forEach((x) => { x.classList.toggle('ativa', x === b); x.setAttribute('aria-selected', String(x === b)); });
    desenharLista(); desenharMarcadores();
    const sel = posicionadas().filter((c) => filtrar().includes(c));
    if (sel.length && /^\d$/.test(filtroAba)) mapa.fitBounds(L.latLngBounds(sel.map((c) => [c.lat, c.lng])).pad(0.3), { maxZoom: 16 });
  }));

  // Legenda dos ícones no canto do mapa
  const legendaMapa = L.control({ position: 'bottomleft' });
  legendaMapa.onAdd = () => {
    const d = L.DomUtil.create('div', 'legenda-mapa');
    d.innerHTML = `<span>${svgPino(false, 15)} Congregação</span><span>${svgPino(true, 17)} Sede / Templo Central</span><span>${seloSetor('1')} nº = setor</span>`;
    L.DomEvent.disableClickPropagation(d);
    return d;
  };
  legendaMapa.addTo(mapa);

  function preencherFiltros() {
    const opts = posicionadas().slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((c) => `<option value="${esc(c.id)}">${esc(c.nome)} (${esc(c.area)})</option>`).join('');
    ['#dist-a', '#dist-b'].forEach((s, i) => { const v = $(s).value; $(s).innerHTML = opts; $(s).value = v || $(s).options[i]?.value || ''; });
    $('#form-congregacao [name=area]').innerHTML = areas.map((a) => `<option>${esc(a.nome)}</option>`).join('');
  }
  function irPara(c) {
    if (!temPos(c)) return;
    mapa.flyTo([c.lat, c.lng], Math.max(mapa.getZoom(), 16));
    setTimeout(() => marcadores.get(c.id)?.openPopup(), 400);
    if (innerWidth <= 760) $('#painel').classList.add('oculto');
  }
  function cliqueLista(e) {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const c = congregacoes.find((x) => x.id === li.dataset.id);
    const acao = e.target.closest('button')?.dataset.acao;
    if (acao === 'editar') abrirFormulario(c);
    else if (acao === 'posicionar') iniciarPosicionamento(c);
    else if (temPos(c)) irPara(c);
    else if (podeEditar(c)) iniciarPosicionamento(c);
  }
  $('#lista').addEventListener('click', cliqueLista);
  $('#pendentes').addEventListener('click', cliqueLista);
  $('#busca').addEventListener('input', () => { desenharLista(); });

  // ---------- Formulário ----------
  let editando = null;
  function abrirFormulario(c) {
    editando = c;
    const f = $('#form-congregacao');
    $('#dlg-titulo').textContent = c?.id ? c.nome : 'Nova congregação';
    ['nome', 'area', 'bairro', 'localidade', 'dirigente', 'endereco', 'observacoes'].forEach((k) => { f[k].value = c?.[k] ?? ''; });
    f.sede_area.checked = !!c?.sede_area;
    f.nome.readOnly = !ehAdmin(); f.area.disabled = !ehAdmin();
    $('#dlg-coords').textContent = c && temPos(c) ? `Posição: ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}` : 'Ainda não posicionada no mapa.';
    $('#dlg-msg').textContent = ''; $('#dlg-historico').innerHTML = '';
    $('#dlg-congregacao').showModal();
  }
  $('#dlg-cancelar').addEventListener('click', () => $('#dlg-congregacao').close());
  $('#form-congregacao').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const dados = { ...editando, nome: f.nome.value.trim(), area: f.area.value, bairro: f.bairro.value.trim(), localidade: f.localidade.value.trim(),
      dirigente: f.dirigente.value.trim(), endereco: f.endereco.value.trim(), observacoes: f.observacoes.value.trim() };
    // Ao virar sede, salva primeiro sem a marca e depois troca a sede da área (desmarca a anterior).
    const virouSede = f.sede_area.checked && !editando?.sede_area;
    dados.sede_area = f.sede_area.checked && !virouSede;
    try {
      const salva = await salvarCongregacao(dados);
      if (virouSede) { await Dados.definirSede(salva.id); await recarregar(); }
      $('#dlg-congregacao').close(); avisar('Congregação salva.');
    } catch (err) { $('#dlg-msg').className = 'msg erro'; $('#dlg-msg').textContent = err.message; }
  });
  $('#dlg-posicionar').addEventListener('click', () => { $('#dlg-congregacao').close(); iniciarPosicionamento(editando); });
  $('#dlg-excluir').addEventListener('click', async () => {
    if (!editando?.id || !confirm(`Excluir a congregação "${editando.nome}"? Esta ação não pode ser desfeita.`)) return;
    try { await Dados.remover(editando.id); congregacoes = congregacoes.filter((c) => c.id !== editando.id); $('#dlg-congregacao').close(); atualizarTudo(); avisar('Congregação excluída.'); }
    catch (err) { $('#dlg-msg').className = 'msg erro'; $('#dlg-msg').textContent = err.message; }
  });
  $('#dlg-historico-btn').addEventListener('click', async () => {
    try {
      const h = await Dados.historico(editando.id);
      $('#dlg-historico').innerHTML = h.length ? '<b>Histórico</b><ul>' + h.map((r) => {
        const mud = r.antes && r.depois ? Object.keys(r.depois).filter((k) => !['atualizado_em', 'atualizado_por'].includes(k) && JSON.stringify(r.antes[k]) !== JSON.stringify(r.depois[k])) : [];
        return `<li>${new Date(r.em).toLocaleString('pt-BR')} – ${esc(r.usuario_email || 'sistema')}: ${esc(r.acao)}${mud.length ? ' (' + mud.map(esc).join(', ') + ')' : ''}</li>`;
      }).join('') + '</ul>' : '<p class="dica">Sem alterações registradas.</p>';
    } catch (err) { $('#dlg-historico').textContent = err.message; }
  });

  async function salvarCongregacao(c, { recalcularBairro } = {}) {
    if (recalcularBairro || (temPos(c) && !c.bairro)) c.bairro = bairroDe(c);
    try {
      const salva = await Dados.salvar(c);
      const i = congregacoes.findIndex((x) => x.id === salva.id);
      if (i >= 0) congregacoes[i] = salva; else congregacoes.push(salva);
      atualizarTudo();
      return salva;
    } catch (err) { avisar(err.message, 'erro'); atualizarTudo(); throw err; }
  }

  // ---------- Posicionar ----------
  function iniciarPosicionamento(c) {
    if (!podeEditar(c)) return;
    posicionando = c;
    $('#instrucao').innerHTML = `Clique no mapa para posicionar: <b>${esc(c.nome)}</b> (${esc(c.area)}) <button id="cancelar-pos">Cancelar</button>`;
    $('#instrucao').hidden = false; mapa.getContainer().style.cursor = 'crosshair';
    mapa.getContainer().classList.add('posicionando');
    $('#cancelar-pos').onclick = pararPosicionamento;
    if (innerWidth <= 760) $('#painel').classList.add('oculto');
  }
  function pararPosicionamento() {
    posicionando = null; $('#instrucao').hidden = true;
    mapa.getContainer().style.cursor = ''; mapa.getContainer().classList.remove('posicionando');
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pararPosicionamento(); });
  mapa.on('click', async (e) => {
    if (!posicionando) return;
    const c = posicionando; pararPosicionamento();
    // Validação geográfica: ponto fora de todos os bairros mapeados costuma ser erro (rio, ilha, outro município).
    if (bairroDe({ lat: e.latlng.lat, lng: e.latlng.lng }) === 'Fora dos bairros mapeados' &&
        !confirm(`O ponto escolhido para "${c.nome}" está fora dos bairros mapeados (pode ser no rio ou em outro município). Confirmar mesmo assim?`)) return;
    try {
      await salvarCongregacao({ ...c, lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }, { recalcularBairro: true });
      const b = bairroDe({ lat: e.latlng.lat, lng: e.latlng.lng });
      avisar(b === 'Fora dos bairros mapeados' ? `${c.nome} posicionada (fora dos bairros mapeados).` : `${c.nome} posicionada no bairro ${b}.`);
      marcadores.get(c.id)?.openPopup();
    } catch { /* aviso já exibido */ }
  });
  function desenharPendentes() {
    const so = $('#so-pendentes').checked;
    const lista = congregacoes.filter((c) => podeEditar(c) && (!so || !temPos(c)));
    const minhas = congregacoes.filter((c) => podeEditar(c));
    const feitas = minhas.filter(temPos).length;
    const pct = minhas.length ? Math.round((feitas / minhas.length) * 100) : 0;
    $('#progresso').innerHTML = `<div class="barra"><i style="width:${pct}%"></i></div>
      <b>${feitas}</b> de ${minhas.length} ${papel() === 'editor' ? `congregações da ${esc(perfil.area)}` : 'congregações'} posicionadas (${pct}%)`;
    $('#pendentes').innerHTML = lista.length ? grupos(lista, true) : '<p class="dica">🎉 Todas as congregações já estão no mapa.</p>';
  }
  $('#so-pendentes').addEventListener('change', desenharPendentes);
  $('#modo-edicao').addEventListener('change', desenharMarcadores);

  // Busca de ruas (Nominatim), limitada à Grande Belém.
  let tBusca;
  $('#busca-endereco').addEventListener('input', (e) => {
    clearTimeout(tBusca);
    const q = e.target.value.trim(); if (q.length < 4) { $('#resultado-endereco').innerHTML = ''; return; }
    tBusca = setTimeout(async () => {
      const p = new URLSearchParams({ q: `${q}, Belém, Pará`, format: 'jsonv2', limit: 6, viewbox: '-48.56,-1.20,-48.36,-1.45', bounded: 1, 'accept-language': 'pt-BR' });
      try {
        const res = await (await fetch(`https://nominatim.openstreetmap.org/search?${p}`)).json();
        $('#resultado-endereco').innerHTML = res.length ? res.map((r) => `<li data-lat="${r.lat}" data-lng="${r.lon}">${esc(r.display_name.split(', Belém')[0])}</li>`).join('') : '<li class="dica">Nada encontrado.</li>';
      } catch { $('#resultado-endereco').innerHTML = '<li class="dica">Busca indisponível no momento.</li>'; }
    }, 600);
  });
  $('#resultado-endereco').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-lat]'); if (li) mapa.flyTo([+li.dataset.lat, +li.dataset.lng], 18);
  });

  // ================= ANÁLISES =================
  async function rotaOSRM(base, perfilRota, a, b) {
    const r = await fetch(`${base}/route/v1/${perfilRota}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(); if (j.code !== 'Ok') throw new Error(j.code);
    return j.routes[0];
  }
  $('#btn-distancia').addEventListener('click', async () => {
    const a = congregacoes.find((c) => c.id === $('#dist-a').value), b = congregacoes.find((c) => c.id === $('#dist-b').value);
    const out = $('#resultado-distancia');
    if (!a || !b || a === b) { out.textContent = 'Escolha duas congregações diferentes.'; return; }
    camadas.rota.clearLayers();
    const reta = distM(a, b);
    L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#475569', dashArray: '6 6', weight: 2 }).addTo(camadas.rota);
    out.innerHTML = `<p>Linha reta: <span class="num">${km(reta)}</span></p><p class="dica">Calculando rotas pelas ruas…</p>`;
    mapa.fitBounds(L.latLngBounds([[a.lat, a.lng], [b.lat, b.lng]]).pad(0.4));
    const [carro, pe] = await Promise.allSettled([
      rotaOSRM('https://router.project-osrm.org', 'driving', a, b),
      rotaOSRM('https://routing.openstreetmap.de/routed-foot', 'foot', a, b),
    ]);
    let html = `<p>Linha reta: <span class="num">${km(reta)}</span></p>`;
    if (carro.status === 'fulfilled') {
      L.geoJSON(carro.value.geometry, { style: { color: '#0b6e4f', weight: 5, opacity: 0.8 } }).addTo(camadas.rota);
      html += `<p>🚗 De carro: <b>${km(carro.value.distance)}</b> · ~${min(carro.value.duration)}</p>`;
    }
    if (pe.status === 'fulfilled') {
      L.geoJSON(pe.value.geometry, { style: { color: '#2563eb', weight: 4, opacity: 0.7, dashArray: '2 6' } }).addTo(camadas.rota);
      html += `<p>🚶 A pé: <b>${km(pe.value.distance)}</b> · ~${min(pe.value.duration)}</p>`;
    }
    if (carro.status === 'rejected' && pe.status === 'rejected') html += '<p class="dica">Não foi possível calcular a rota pelas ruas agora (serviço de rotas indisponível).</p>';
    else if (carro.status === 'fulfilled') html += `<p class="dica">Índice de sinuosidade: ${(carro.value.distance / reta).toFixed(2).replace('.', ',')} (quanto maior, mais as ruas obrigam a contornar).</p>`;
    out.innerHTML = html;
  });
  $('#btn-limpar-rota').addEventListener('click', () => { camadas.rota.clearLayers(); $('#resultado-distancia').innerHTML = ''; });

  // Relatório das sedes: distância até a sede da área e congregações mais próximas da sede de outra área.
  $('#btn-sedes').addEventListener('click', () => {
    const sedes = congregacoes.filter((c) => c.sede_area && temPos(c) && !ehEspecial(c));
    const linhas = areas.filter((a) => !ESPECIAIS.includes(a.nome)).map((a) => {
      const sede = sedeDa(a.nome);
      const membros = congregacoes.filter((c) => c.area === a.nome && !c.sede_area && temPos(c));
      if (!sede || !temPos(sede)) return `<tr><td>${esc(a.nome)}</td><td colspan="3" class="dica">${sede ? 'sede não posicionada' : 'sem sede definida'}</td></tr>`;
      const ds = membros.map((c) => {
        const d = distM(c, sede);
        const outra = sedes.filter((s) => s.area !== a.nome).map((s) => ({ s, d: distM(c, s) })).sort((x, y) => x.d - y.d)[0];
        return { c, d, outra: outra && outra.d < d ? outra : null };
      });
      const media = ds.length ? ds.reduce((s, x) => s + x.d, 0) / ds.length : 0;
      const max = ds.length ? Math.max(...ds.map((x) => x.d)) : 0;
      const alertas = ds.filter((x) => x.outra).map((x) => `<div class="alerta-linha">${esc(x.c.nome)}: ${km(x.d)} da sede, mas ${km(x.outra.d)} da sede da ${esc(x.outra.s.area)} (${esc(x.outra.s.nome)})</div>`).join('');
      return `<tr><td><b>${esc(a.nome)}</b><br><span class="dica">Setor ${a.setor} · sede ${esc(sede.nome)}</span>${alertas}</td>
        <td class="n">${ds.length}</td><td class="n">${ds.length ? km(media) : '–'}</td><td class="n">${ds.length ? km(max) : '–'}</td></tr>`;
    });
    $('#tabela-sedes').innerHTML = `<table><thead><tr><th>Área</th><th class="n">Cong.</th><th class="n">Média</th><th class="n">Máx.</th></tr></thead><tbody>${linhas.join('')}</tbody></table>`;
  });

  $('#btn-vizinhos').addEventListener('click', () => {
    const ps = posicionadas();
    if (ps.length < 2) { $('#tabela-vizinhos').innerHTML = '<p class="dica">Posicione ao menos duas congregações.</p>'; return; }
    const linhas = ps.map((c) => {
      let melhor = null;
      ps.forEach((o) => { if (o !== c) { const d = distM(c, o); if (!melhor || d < melhor.d) melhor = { o, d }; } });
      return { c, ...melhor };
    }).sort((a, b) => a.d - b.d);
    const media = linhas.reduce((s, l) => s + l.d, 0) / linhas.length;
    $('#tabela-vizinhos').innerHTML = `<p class="dica">Distância média até a vizinha mais próxima: <b>${km(media)}</b></p>
      <table><thead><tr><th>Congregação</th><th>Mais próxima</th><th class="n">Dist.</th></tr></thead><tbody>
      ${linhas.map((l) => `<tr class="${l.d < PERTO_M ? 'perto' : l.d > ISOLADA_M ? 'isolada' : ''}" data-id="${esc(l.c.id)}"><td>${esc(l.c.nome)}<br><span class="dica">${esc(l.c.area)}</span></td><td>${esc(l.o.nome)}<br><span class="dica">${esc(l.o.area)}</span></td><td class="n">${km(l.d)}</td></tr>`).join('')}
      </tbody></table>`;
  });
  ['#tabela-vizinhos'].forEach((s) => $(s).addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (tr) irPara(congregacoes.find((x) => x.id === tr.dataset.id));
  }));

  // Território: envoltória convexa das congregações do grupo, com folga de 150 m (1 ou 2 pontos viram círculo/corredor).
  function territorio(lista) {
    const pts = turf.featureCollection(lista.map(ponto));
    let g = lista.length >= 3 ? turf.convex(pts) : lista.length === 2 ? turf.lineString(lista.map((c) => [c.lng, c.lat])) : pts.features[0];
    if (!g) g = turf.lineString(lista.map((c) => [c.lng, c.lat]));   // pontos colineares
    return turf.buffer(g, 0.15, { units: 'kilometers' });
  }
  function desenharTerritorios(camada, chave, cor, rotulo) {
    camada.clearLayers();
    const porGrupo = new Map();
    posicionadas().forEach((c) => { const k = chave(c); if (k == null) return; if (!porGrupo.has(k)) porGrupo.set(k, []); porGrupo.get(k).push(c); });
    porGrupo.forEach((lista, k) => {
      const t = territorio(lista);
      const kmq = (turf.area(t) / 1e6).toFixed(2).replace('.', ',');
      L.geoJSON(t, { style: { color: cor(k, lista), weight: 2, fillColor: cor(k, lista), fillOpacity: 0.15 } })
        .bindTooltip(`<b>${esc(rotulo(k))}</b><br>${lista.length} congregação(ões) · ~${kmq} km²`, { sticky: true })
        .addTo(camada);
    });
  }
  const desenharTerritorioSetor = () => desenharTerritorios(camadas.territorioSetor, (c) => setorDe(c), (s) => COR_SETOR[s], (s) => `Setor ${s}`);
  const desenharTerritorioArea = () => desenharTerritorios(camadas.territorioArea, (c) => (ehEspecial(c) ? null : c.area),
    (a, l) => COR_SETOR[setorDe(l[0])] || COR_SEM_SETOR, (a) => `${a} (Setor ${areaDe(a)?.setor})`);
  function desenharLigacoes() {
    camadas.ligacoes.clearLayers();
    posicionadas().filter((c) => !c.sede_area).forEach((c) => {
      const s = sedeDa(c.area); if (!s || !temPos(s)) return;
      L.polyline([[s.lat, s.lng], [c.lat, c.lng]], { color: corDe(c), weight: 2, opacity: 0.8, dashArray: '4 4' })
        .bindTooltip(`${esc(c.nome)} → sede ${esc(s.nome)}: ${km(distM(c, s))}`, { sticky: true }).addTo(camadas.ligacoes);
    });
  }
  function desenharVoronoi() {
    camadas.voronoi.clearLayers();
    const ps = posicionadas(); if (ps.length < 2) return;
    const pts = turf.featureCollection(ps.map(ponto));
    const caixa = uniaoBairros ? turf.bbox(turf.buffer(uniaoBairros, 1, { units: 'kilometers' })) : turf.bbox(turf.buffer(pts, 2, { units: 'kilometers' }));
    turf.voronoi(pts, { bbox: caixa }).features.forEach((cel, i) => {
      if (!cel) return;
      const c = ps[i];
      let g = cel;
      if (uniaoBairros) { try { g = turf.intersect(turf.featureCollection([cel, uniaoBairros])) || cel; } catch { /* mantém */ } }
      L.geoJSON(g, { style: { color: corDe(c), weight: 1.5, fillColor: corDe(c), fillOpacity: 0.18 } })
        .bindTooltip(`<b>${esc(c.nome)}</b> (${esc(c.area)})<br>Área de influência: ${(turf.area(g) / 1e6).toFixed(2).replace('.', ',')} km²`, { sticky: true })
        .addTo(camadas.voronoi);
    });
  }
  function desenharRaios() {
    camadas.raios.clearLayers();
    const r = +$('#raio').value;
    posicionadas().forEach((c) => L.circle([c.lat, c.lng], { radius: r, color: corDe(c), weight: 1, fillOpacity: 0.08, interactive: false }).addTo(camadas.raios));
  }
  // ================= ESTUDO IBGE (Censo 2022) =================
  // Escalas de um só tom (claro = pouco, escuro = muito). Azul para densidade/distância, laranja para renda.
  const AZUL = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
  const LARANJA = ['#fde3d4', '#f7b08f', '#eb6834', '#b8461b', '#7a2a0c'];
  const COR_FCU = '#6250d6';
  let ibge = null;          // { setores, centros: [{ lat, lng, pop, f }] }
  let cacheAcesso = null;   // congregação mais próxima de cada setor (recalcula quando o mapa muda)
  async function carregarIBGE() {
    if (ibge) return ibge;
    const setores = await (await fetch('data/ibge_setores.geojson')).json();
    ibge = { setores, centros: setores.features.map((f) => {
      const [lng, lat] = turf.pointOnFeature(f).geometry.coordinates;
      return { lat, lng, pop: f.properties.pop, f };
    }) };
    return ibge;
  }
  function acesso() {
    if (cacheAcesso) return cacheAcesso;
    const ps = posicionadas();
    cacheAcesso = ibge.centros.map((s) => {
      let prox = null;
      for (const c of ps) { const d = turf.distance([s.lng, s.lat], [c.lng, c.lat]) * 1000; if (!prox || d < prox.d) prox = { c, d }; }
      return { ...s, prox };
    });
    return cacheAcesso;
  }
  // Quebras por quantis (5 classes), arredondadas para leitura.
  function quebras(valores, n = 5) {
    const v = valores.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
    const arred = (x) => { const m = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(x) || 1)) - 1); return Math.round(x / m) * m; };
    return [...new Set(Array.from({ length: n - 1 }, (_, i) => arred(v[Math.floor(((i + 1) * v.length) / n)])))];
  }
  const classe = (v, qs) => { let i = 0; while (i < qs.length && v > qs[i]) i++; return i; };
  function legendaFaixas(titulo, cores, qs, fmt) {
    const rot = cores.slice(0, qs.length + 1).map((_, i) => i === 0 ? `até ${fmt(qs[0])}` : i === qs.length ? `mais de ${fmt(qs[i - 1])}` : `${fmt(qs[i - 1])} – ${fmt(qs[i])}`);
    return `<b>${titulo}</b>` + rot.map((r, i) => `<div><i style="background:${cores[i]}"></i>${r}</div>`).join('');
  }
  async function desenharTemaIBGE() {
    camadas.ibge.clearLayers();
    const tema = $('#tema-ibge').value, leg = $('#legenda-ibge');
    if (!tema) { leg.innerHTML = ''; mapa.removeLayer(camadas.ibge); return; }
    await carregarIBGE();
    const props = ibge.setores.features.map((f) => f.properties);
    let cor, legenda;
    if (tema === 'densidade') {
      const qs = quebras(props.map((p) => p.dens));
      cor = (p) => AZUL[classe(p.dens, qs)];
      legenda = legendaFaixas('Densidade (hab/km²)', AZUL, qs, (x) => num(x));
    } else if (tema === 'renda') {
      const qs = quebras(props.map((p) => p.renda_media));
      cor = (p) => (p.renda_media == null ? null : LARANJA[classe(p.renda_media, qs)]);
      legenda = legendaFaixas('Renda média do responsável', LARANJA, qs, (x) => reais(x)) + '<div><i class="sem-dado"></i>sem dado (sigilo ou sem moradores)</div>';
    } else if (tema === 'fcu') {
      cor = (p) => (p.fcu ? COR_FCU : null);
      const pop = props.filter((p) => p.fcu).reduce((s, p) => s + p.pop, 0), tot = props.reduce((s, p) => s + p.pop, 0);
      legenda = `<b>Favelas e comunidades urbanas (IBGE)</b><div><i style="background:${COR_FCU}"></i>setor em favela ou comunidade urbana: ${num(pop)} hab. (${num((100 * pop) / tot, 1)}%)</div>`;
    } else {
      if (!posicionadas().length) { leg.innerHTML = '<p class="dica">Posicione congregações no mapa para ver este tema.</p>'; return; }
      const qs = [500, 1000, 1500, 2500];
      const dist = new Map(acesso().map((s) => [s.f, s.prox?.d]));
      cor = (p, f) => AZUL[classe(dist.get(f), qs)];
      legenda = legendaFaixas('Distância até a congregação mais próxima', AZUL, qs, (x) => km(x));
    }
    const dist = posicionadas().length ? new Map(acesso().map((s) => [s.f, s.prox])) : new Map();
    L.geoJSON(ibge.setores, {
      pane: 'temas',
      style: (f) => { const c = cor(f.properties, f); return { color: '#ffffff', weight: 0.6, fillColor: c || '#9ca3af', fillOpacity: c ? 0.7 : (tema === 'fcu' ? 0 : 0.25) }; },
      onEachFeature: (f, l) => {
        const p = f.properties, prox = dist.get(f);
        l.bindTooltip(`<b>Setor ${esc(p.cod)}</b> · ${esc(p.bairro)}<br>${num(p.pop)} hab. · ${num(p.domicilios)} domicílios<br>
          Densidade: ${num(p.dens)} hab/km²<br>Renda média do responsável: ${reais(p.renda_media)}
          ${p.fcu ? `<br>Comunidade urbana: <b>${esc(p.fcu)}</b>` : ''}
          ${prox ? `<br>Mais próxima: ${esc(prox.c.nome)} (${km(prox.d)})` : ''}`, { sticky: true });
      },
    }).addTo(camadas.ibge);
    camadas.ibge.addTo(mapa);
    leg.innerHTML = legenda;
  }
  $('#tema-ibge').addEventListener('change', desenharTemaIBGE);

  $('#btn-estudo').addEventListener('click', async () => {
    const out = $('#estudo-ibge');
    await carregarIBGE();
    const ps = posicionadas();
    if (!ps.length) { out.innerHTML = '<p class="dica">Posicione as congregações no mapa para gerar o estudo.</p>'; return; }
    const R = +$('#raio-acesso').value, ac = acesso();
    const total = ac.reduce((s, x) => s + x.pop, 0);
    const perto = ac.filter((x) => x.prox.d <= R).reduce((s, x) => s + x.pop, 0);
    // Por bairro
    const linhasBairro = bairros.features.map((f) => {
      const p = f.properties, sts = ac.filter((x) => x.f.properties.bairro === p.nome);
      const longe = sts.filter((x) => x.prox.d > R).reduce((s, x) => s + x.pop, 0);
      const n = ps.filter((c) => turf.booleanPointInPolygon(ponto(c), f)).length;
      return { p, n, longe, pctLonge: p.pop ? (100 * longe) / p.pop : 0 };
    }).sort((a, b) => b.longe - a.longe);
    // População na área de influência (setor → congregação mais próxima), somada por área eclesiástica e por setor da igreja
    const porCong = new Map(), porArea = new Map(), porSetor = new Map();
    ac.forEach((x) => {
      const c = x.prox.c;
      porCong.set(c.id, (porCong.get(c.id) || 0) + x.pop);
      porArea.set(c.area, (porArea.get(c.area) || 0) + x.pop);
      const st = setorDe(c) ?? '—'; porSetor.set(st, (porSetor.get(st) || 0) + x.pop);
    });
    const vazios = ac.filter((x) => x.prox.d > R).sort((a, b) => b.pop - a.pop).slice(0, 10);
    ultimoEstudo = { vazios };
    out.innerHTML = `
      <div class="tiles">
        <div class="tile"><span>População da região</span><b>${num(total)}</b></div>
        <div class="tile"><span>Hab. por congregação</span><b>${num(total / ps.length)}</b></div>
        <div class="tile"><span>A até ${km(R)} de uma congregação</span><b>${num((100 * perto) / total, 1)}%</b></div>
        <div class="tile"><span>Mais longe que ${km(R)}</span><b>${num(total - perto)}</b></div>
      </div>
      ${ps.length < congregacoes.length ? `<p class="aviso">Atenção: só ${ps.length} de ${congregacoes.length} congregações estão no mapa. O estudo fica completo quando todas forem posicionadas.</p>` : ''}
      <h4>Onde abrir novos trabalhos: setores mais populosos a mais de ${km(R)}</h4>
      <table><thead><tr><th>Setor censitário</th><th class="n">Hab.</th><th class="n">Dist.</th></tr></thead><tbody>
      ${vazios.map((x, i) => `<tr class="clicavel" data-vazio="${i}"><td>${esc(x.f.properties.bairro)}${x.f.properties.fcu ? `<br><span class="dica">${esc(x.f.properties.fcu)}</span>` : ''}</td><td class="n">${num(x.pop)}</td><td class="n">${km(x.prox.d)}</td></tr>`).join('') || '<tr><td colspan="3">Nenhum: toda a população está perto de uma congregação.</td></tr>'}
      </tbody></table>
      <h4>Por bairro</h4>
      <table><thead><tr><th>Bairro</th><th class="n">Pop.</th><th class="n">Cong.</th><th class="n">Hab./cong.</th><th class="n">Longe</th></tr></thead><tbody>
      ${linhasBairro.map((l) => `<tr><td>${esc(l.p.nome)}<br><span class="dica">renda ${reais(l.p.renda_media)} · ${num(l.p.pct_fcu, 0)}% em comunidades</span></td><td class="n">${num(l.p.pop)}</td><td class="n">${l.n}</td><td class="n">${l.n ? num(l.p.pop / l.n) : '–'}</td><td class="n">${num(l.pctLonge, 0)}%</td></tr>`).join('')}
      </tbody></table>
      <h4>Por setor da igreja: população na área de influência</h4>
      <table><thead><tr><th>Setor</th><th class="n">Cong.</th><th class="n">População</th><th class="n">Hab./cong.</th></tr></thead><tbody>
      ${[...porSetor.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([st, pop]) => { const n = ps.filter((c) => (setorDe(c) ?? '—') === st).length;
        return `<tr><td><span class="bola" style="background:${COR_SETOR[st] || COR_SEM_SETOR}"></span> ${st === '—' ? 'Sem setor' : `Setor ${st}`}</td><td class="n">${n}</td><td class="n">${num(pop)}</td><td class="n">${num(pop / n)}</td></tr>`; }).join('')}
      </tbody></table>
      <h4>Por área: população na área de influência</h4>
      <table><thead><tr><th>Área</th><th class="n">Cong.</th><th class="n">População</th><th class="n">Hab./cong.</th></tr></thead><tbody>
      ${[...porArea.entries()].sort((a, b) => ordemArea(a[0]) - ordemArea(b[0])).map(([a, pop]) => { const n = ps.filter((c) => c.area === a).length;
        return `<tr><td>${esc(a)}</td><td class="n">${n}</td><td class="n">${num(pop)}</td><td class="n">${num(pop / n)}</td></tr>`; }).join('')}
      </tbody></table>`;
    popInfluencia = porCong;
  });
  let ultimoEstudo = null, popInfluencia = null;
  $('#estudo-ibge').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-vazio]'); if (!tr) return;
    const x = ultimoEstudo.vazios[+tr.dataset.vazio];
    camadas.rota.clearLayers();
    L.geoJSON(x.f, { style: { color: '#d7303a', weight: 3, fillOpacity: 0.1 } }).addTo(camadas.rota);
    L.polyline([[x.lat, x.lng], [x.prox.c.lat, x.prox.c.lng]], { color: '#d7303a', dashArray: '6 6', weight: 2 })
      .bindTooltip(`${km(x.prox.d)} até ${esc(x.prox.c.nome)}`, { permanent: true }).addTo(camadas.rota);
    mapa.fitBounds(L.geoJSON(x.f).getBounds().extend([x.prox.c.lat, x.prox.c.lng]).pad(0.3));
  });

  const camadasEstudo = {
    '#cam-bairros': [camadas.bairros], '#cam-localidades': [camadas.localidades],
    '#cam-territorio-setor': [camadas.territorioSetor, desenharTerritorioSetor],
    '#cam-territorio-area': [camadas.territorioArea, desenharTerritorioArea],
    '#cam-ligacoes': [camadas.ligacoes, desenharLigacoes],
    '#cam-voronoi': [camadas.voronoi, desenharVoronoi],
    '#cam-raios': [camadas.raios, desenharRaios],
  };
  Object.entries(camadasEstudo).forEach(([chk, [camada, desenhar]]) => $(chk).addEventListener('change', (e) => {
    if (e.target.checked) { desenhar?.(); camada.addTo(mapa); } else mapa.removeLayer(camada);
  }));
  $('#raio').addEventListener('input', (e) => {
    $('#raio-valor').textContent = `${(e.target.value / 1000).toFixed(e.target.value % 1000 ? 2 : 1).replace('.', ',')} km`;
    if ($('#cam-raios').checked) desenharRaios();
  });

  // ================= IMPORTAR / EXPORTAR =================
  function colunas(linha) {
    const m = {};
    Object.keys(linha).forEach((k) => {
      const n = norm(k);
      if (!m.nome && /^(nome|congrega)/.test(n)) m.nome = k;
      else if (!m.area && /^(area|grupo)/.test(n)) m.area = k;
      else if (!m.sede && /^sede/.test(n)) m.sede = k;
      else if (!m.dirigente && /(dirigente|lider|responsavel)/.test(n)) m.dirigente = k;
      else if (!m.endereco && /(endereco|rua|logradouro)/.test(n)) m.endereco = k;
      else if (!m.localidade && /(localidade|comunidade)/.test(n)) m.localidade = k;
      else if (!m.lat && /^lat/.test(n)) m.lat = k;
      else if (!m.lng && /^(lng|lon)/.test(n)) m.lng = k;
    });
    return m;
  }
  $('#arquivo').addEventListener('click', (e) => { e.target.value = ''; });
  $('#arquivo').addEventListener('change', async (e) => {
    const arq = e.target.files[0]; if (!arq) return;
    const out = $('#resultado-import');
    try {
      const wb = XLSX.read(await arq.arrayBuffer());
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      if (!linhas.length) { out.textContent = 'A planilha está vazia.'; return; }
      const col = colunas(linhas[0]);
      if (!col.nome) { out.innerHTML = `Não encontrei a coluna com o nome da congregação. Colunas lidas: <b>${Object.keys(linhas[0]).map(esc).join(', ')}</b>`; return; }
      let areaAtual = '';
      const lista = [];
      linhas.forEach((l) => {
        const nome = String(l[col.nome]).trim(); if (!nome) return;
        if (col.area && String(l[col.area]).trim()) areaAtual = normalizarArea(l[col.area]);   // área só na 1ª linha do grupo
        const c = { nome, area: ESPECIAIS.find((s) => norm(s) === norm(nome)) || areaAtual };
        if (col.sede) c.sede_area = /^(s|sim|x|1|true|sede)$/i.test(norm(l[col.sede]));
        ['dirigente', 'endereco', 'localidade'].forEach((k) => { if (col[k] && String(l[col[k]]).trim()) c[k] = String(l[col[k]]).trim(); });
        const lat = parseFloat(String(l[col.lat] ?? '').replace(',', '.')), lng = parseFloat(String(l[col.lng] ?? '').replace(',', '.'));
        if (Number.isFinite(lat) && Number.isFinite(lng)) { c.lat = lat; c.lng = lng; c.bairro = bairroDe(c); }
        lista.push(c);
      });
      const rel = relatorioImportacao(lista);
      const invalidas = lista.filter((c) => !areaDe(c.area));
      if (invalidas.length) { out.innerHTML = rel + `<p class="msg erro">Corrija as áreas inválidas antes de importar (${invalidas.length} linha(s)).</p>`; return; }
      // Linhas que não batem com nenhuma congregação existente (mesma área e mesmo nome) viram congregações NOVAS: confirma antes.
      const chave = (c) => `${c.area}|${c.nome}`.toLowerCase();
      const existentes = new Set(congregacoes.map(chave));
      const novas = lista.filter((c) => !existentes.has(chave(c)));
      if (novas.length && !confirm(`${novas.length} linha(s) da planilha não correspondem a nenhuma congregação do mapa e serão INCLUÍDAS como novas:\n\n` +
          novas.slice(0, 15).map((c) => `• ${c.nome} (${c.area})`).join('\n') + (novas.length > 15 ? '\n…' : '') + '\n\nContinuar?')) {
        out.innerHTML = rel + '<p class="msg">Importação cancelada.</p>'; return;
      }
      out.innerHTML = rel + '<p class="dica">Importando…</p>';
      const r = await Dados.importar(lista);
      await recarregar();
      out.innerHTML = rel + `<p class="msg ok">${r.atualizadas} congregação(ões) atualizada(s)${r.incluidas ? `, ${r.incluidas} incluída(s)` : ''}.</p>
        <ul class="relatorio">
          <li>📍 ${r.posicionadas} posicionada(s) agora no mapa</li>
          <li>🔒 ${r.posicoesMantidas} já estavam no mapa e mantiveram a posição</li>
          ${r.enderecosMantidos ? `<li>🔒 ${r.enderecosMantidos} mantiveram o endereço já cadastrado</li>` : ''}
        </ul>`;
    } catch (err) { out.innerHTML = `<p class="msg erro">${esc(err.message)}</p>`; }
  });
  function relatorioImportacao(lista) {
    const g = new Set(lista.map((c) => c.area).filter(Boolean));
    const faltando = []; for (let i = 1; i <= N_AREAS; i++) if (!g.has(`Área ${i}`)) faltando.push(i);
    const invalidas = [...g].filter((a) => !areaDe(a));
    const semArea = lista.filter((c) => !c.area);
    const cont = {}; lista.forEach((c) => { const k = norm(c.nome); cont[k] = (cont[k] || 0) + 1; });
    const repetidas = Object.keys(cont).filter((k) => cont[k] > 1).map((k) => lista.find((c) => norm(c.nome) === k).nome);
    const ok = (v) => (v ? '✅' : '⚠️');
    const itens = [
      `${ok(lista.length === TOTAL_ESPERADO)} <b>${lista.length}</b> de ${TOTAL_ESPERADO} congregações`,
      `${ok(!faltando.length)} <b>${N_AREAS - faltando.length}</b> de ${N_AREAS} áreas${faltando.length ? ` – faltam: ${faltando.join(', ')}` : ''}`,
      ...ESPECIAIS.map((e) => `${ok(g.has(e))} ${e}`),
    ];
    if (invalidas.length) itens.push(`⚠️ Áreas não reconhecidas: ${invalidas.map(esc).join(', ')}`);
    if (semArea.length) itens.push(`⚠️ Sem área: ${semArea.map((c) => esc(c.nome)).join(', ')}`);
    if (repetidas.length) itens.push(`ℹ️ Nomes repetidos (ok se forem de áreas diferentes): ${repetidas.map(esc).join(', ')}`);
    return `<ul class="relatorio">${itens.map((i) => `<li>${i}</li>`).join('')}</ul>`;
  }
  function baixar(nome, conteudo, tipo) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const CAMPOS_EXPORT = ['nome', 'area', 'setor', 'sede_area', 'bairro', 'localidade', 'dirigente', 'endereco', 'lat', 'lng'];
  const paraExportar = () => congregacoes.slice().sort((a, b) => ordemArea(a.area) - ordemArea(b.area) || (b.sede_area - a.sede_area))
    .map((c) => ({ ...c, setor: setorDe(c) }));
  $('#btn-exportar-json').addEventListener('click', () => baixar('congregacoes.json',
    JSON.stringify(paraExportar().map((c) => Object.fromEntries(CAMPOS_EXPORT.map((k) => [k, c[k] ?? null]))), null, 2), 'application/json'));
  $('#btn-exportar-csv').addEventListener('click', () => {
    const csv = [CAMPOS_EXPORT.join(';'), ...paraExportar().map((c) => CAMPOS_EXPORT.map((k) => {
      let v = c[k] ?? ''; if (k === 'sede_area') v = v ? 'Sim' : ''; if (typeof v === 'number') v = String(v).replace('.', ',');
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(';'))].join('\n');
    baixar('congregacoes.csv', '﻿' + csv, 'text/csv');
  });
  $('#btn-apagar').addEventListener('click', () => {
    if (!confirm('Apagar tudo o que foi cadastrado neste navegador e recomeçar?')) return;
    Dados.apagarTudo?.(); location.reload();
  });

  // ================= USUÁRIOS (admin) =================
  async function desenharUsuarios() {
    if (!ehAdmin() || Dados.modo !== 'nuvem') return;
    const el = $('#lista-usuarios');
    try {
      const ps = await Dados.perfis();
      const pend = ps.filter((p) => p.papel === 'pendente').length;
      $('[data-aba=usuarios]').textContent = pend ? `Usuários (${pend})` : 'Usuários';
      const optsArea = areas.map((a) => `<option>${esc(a.nome)}</option>`).join('');
      el.innerHTML = ps.sort((a, b) => (a.papel !== 'pendente') - (b.papel !== 'pendente')).map((p) => `
        <div class="usuario-item${p.papel === 'pendente' ? ' pendente' : ''}" data-id="${esc(p.id)}">
          <div><b>${esc(p.nome || '(sem nome)')}</b><br><span class="dica">${esc(p.email)}</span></div>
          <div class="linha2">
            <select data-campo="papel" ${p.id === perfil.id ? 'disabled title="Você não pode mudar o próprio papel"' : ''}>
              ${Object.entries(PAPEIS).map(([v, t]) => `<option value="${v}" ${p.papel === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <select data-campo="area" ${p.papel === 'editor' ? '' : 'hidden'}><option value="">— área —</option>${optsArea}</select>
          </div></div>`).join('') || '<p class="dica">Nenhum usuário.</p>';
      ps.forEach((p) => { const s = el.querySelector(`[data-id="${CSS.escape(p.id)}"] [data-campo=area]`); if (s) s.value = p.area || ''; });
    } catch (err) { el.innerHTML = `<p class="msg erro">${esc(err.message)}</p>`; }
  }
  $('#lista-usuarios').addEventListener('change', async (e) => {
    const item = e.target.closest('[data-id]'); const campo = e.target.dataset.campo;
    if (!item || !campo) return;
    const valor = e.target.value || null;
    if (campo === 'papel') item.querySelector('[data-campo=area]').hidden = valor !== 'editor';
    if (campo === 'papel' && valor === 'editor' && !item.querySelector('[data-campo=area]').value) { avisar('Escolha a área deste editor.'); return; }
    const campos = campo === 'area' ? { area: valor, papel: 'editor' } : { papel: valor, ...(valor === 'editor' ? { area: item.querySelector('[data-campo=area]').value } : {}) };
    try { await Dados.atualizarPerfil(item.dataset.id, campos); avisar('Usuário atualizado.'); desenharUsuarios(); }
    catch (err) { avisar(err.message, 'erro'); }
  });

  // ================= GERAL =================
  $$('#abas-principais button').forEach((b) => b.addEventListener('click', () => {
    $$('#abas-principais button, .aba').forEach((x) => x.classList.remove('ativa'));
    b.classList.add('ativa'); $(`#aba-${b.dataset.aba}`).classList.add('ativa');
    if (b.dataset.aba === 'usuarios') desenharUsuarios();
  }));
  $('#alternar-painel').addEventListener('click', () => $('#painel').classList.toggle('oculto'));

  function atualizarTudo() {
    cacheAcesso = null;
    if ($('#tema-ibge').value === 'distancia') desenharTemaIBGE();
    preencherFiltros(); desenharMarcadores(); desenharLista(); desenharPendentes();
    Object.entries(camadasEstudo).forEach(([chk, [, desenhar]]) => { if ($(chk).checked) desenhar?.(); });
  }
  async function recarregar() {
    const d = await Dados.carregar();
    areas = d.areas; congregacoes = d.congregacoes;
    atualizarTudo();
  }

  let appAberto = false;
  async function abrirApp() {
    perfil = await Dados.meuPerfil();
    if (!perfil) { mostrarTela('#tela-login'); return; }
    if (perfil.papel === 'pendente') { $('#pendente-email').textContent = perfil.email; mostrarTela('#tela-pendente'); return; }
    mostrarTela('#app');
    if (appAberto) return; appAberto = true;
    $('#usuario-nome').textContent = perfil.nome || perfil.email;
    $('#usuario-papel').textContent = Dados.modo === 'local' ? 'local' : PAPEIS[perfil.papel] + (perfil.papel === 'editor' && perfil.area ? ` · ${perfil.area}` : '');
    $('#aviso-local').hidden = Dados.modo !== 'local';
    if (Dados.modo === 'local') $$('.btn-sair').forEach((b) => { b.hidden = true; });
    aplicarPermissoes();
    mapa.invalidateSize();
    if (!bairros) await carregarGeografia();
    carregarIBGE().catch(() => {});
    await recarregar();
    if (bairros) mapa.fitBounds(L.geoJSON(bairros).getBounds(), { padding: [10, 10] });
    desenharUsuarios();
    // Tempo real: alterações de outras pessoas aparecem sem recarregar.
    Dados.aoMudar(({ eventType, new: nova, old }) => {
      if (eventType === 'DELETE') congregacoes = congregacoes.filter((c) => c.id !== old.id);
      else { const i = congregacoes.findIndex((c) => c.id === nova.id); if (i >= 0) congregacoes[i] = nova; else congregacoes.push(nova); }
      atualizarTudo();
    });
  }

  (async () => {
    Dados.aoAutenticar((evento) => { if (evento === 'PASSWORD_RECOVERY') mostrarTela('#tela-nova-senha'); });
    try {
      const sessao = await Dados.iniciar();
      if (/type=recovery/.test(location.hash)) return;   // aguarda o evento PASSWORD_RECOVERY
      if (sessao) await abrirApp(); else mostrarTela('#tela-login');
    } catch (err) {
      mostrarTela('#tela-login'); $('#login-msg').className = 'msg erro'; $('#login-msg').textContent = err.message;
    }
  })();
})();
