/* Mapa das Congregações – Distrito Icoaraci (Belém-PA)
 * Leaflet (mapa) + Turf (análise espacial) + SheetJS (planilhas).
 * Distâncias em linha reta: fórmula de Haversine (Turf). Rotas pelas ruas: OSRM sobre o OpenStreetMap.
 */
(() => {
  'use strict';

  const CHAVE_LS = 'congregacoes-icoaraci-v1';
  const ESPECIAIS = ['Templo Central', 'Manancial de Bênção'];
  const CENTRO = [-1.305, -48.468];
  const PERTO_M = 500, ISOLADA_M = 2000;
  // Estrutura do distrito: 33 áreas numeradas + Templo Central + Manancial de Bênção = 96 congregações.
  const N_AREAS = 33, TOTAL_ESPERADO = 96;

  // ---------- Estado ----------
  let congregacoes = [];
  let usandoExemplo = false;
  let bairros = null, uniaoBairros = null;
  let posicionando = null; // id da congregação sendo posicionada
  const marcadores = new Map();

  // ---------- Utilidades ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const km = (m) => m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${Math.round(m)} m`;
  const min = (s) => s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  const posicionadas = () => congregacoes.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  const ponto = (c) => turf.point([c.lng, c.lat], { id: c.id });
  const distM = (a, b) => turf.distance(ponto(a), ponto(b), { units: 'kilometers' }) * 1000;
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // Cor estável por área: Templo Central e Manancial têm cores próprias, as 33 áreas usam o ângulo áureo no círculo de matizes.
  function corArea(area) {
    if (norm(area) === norm('Templo Central')) return '#b91c1c';
    if (norm(area) === norm('Manancial de Bênção')) return '#7c3aed';
    const n = parseInt(String(area).match(/\d+/)?.[0] ?? '0', 10);
    const h = (n * 137.508) % 360;
    return `hsl(${h.toFixed(0)} 70% 42%)`;
  }
  // Padroniza a grafia da área: "1", "01", "AREA 1", "1ª Área", "Área-01" → "Área 1";
  // variações de "Templo Central" e "Manancial de Bênção" → nome oficial.
  function normalizarArea(bruto) {
    const s = String(bruto ?? '').trim(); if (!s) return '';
    const n = norm(s);
    if (/templo|sede|central/.test(n)) return 'Templo Central';
    if (/manancial/.test(n)) return 'Manancial de Bênção';
    const num = n.match(/\d+/);
    return num ? `Área ${parseInt(num[0], 10)}` : s;
  }
  const ehEspecial = (c) => ESPECIAIS.some((e) => norm(e) === norm(c.area) || norm(e) === norm(c.nome));
  function ordemArea(a) {
    const i = ESPECIAIS.findIndex((e) => norm(e) === norm(a));
    if (i >= 0) return -10 + i;
    return parseInt(String(a).match(/\d+/)?.[0] ?? '999', 10);
  }

  // ---------- Mapa ----------
  const mapa = L.map('mapa', { zoomControl: true, preferCanvas: false }).setView(CENTRO, 13);
  const ruas = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(mapa);
  const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imagens © Esri, Maxar, Earthstar Geographics',
  });
  L.control.layers({ 'Ruas (OpenStreetMap)': ruas, 'Satélite': satelite }, null, { position: 'topright' }).addTo(mapa);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(mapa);

  const camadaBairros = L.layerGroup().addTo(mapa);
  const camadaVoronoi = L.layerGroup();
  const camadaRaios = L.layerGroup();
  const camadaCobertura = L.layerGroup();
  const camadaRota = L.layerGroup().addTo(mapa);
  const camadaMarcadores = L.layerGroup().addTo(mapa);

  mapa.on('zoomend', () => document.body.classList.toggle('sem-rotulos', mapa.getZoom() < 15));
  document.body.classList.toggle('sem-rotulos', mapa.getZoom() < 15);

  // ---------- Bairros ----------
  async function carregarBairros() {
    bairros = await (await fetch('data/bairros.geojson')).json();
    bairros.features.forEach((f) => { f.properties.area_km2 = turf.area(f) / 1e6; });
    try { uniaoBairros = turf.union(bairros); } catch { uniaoBairros = null; }
    const corDistrito = { DAICO: '#0b6e4f', DABEN: '#a16207', DAOUT: '#1d4ed8' };
    L.geoJSON(bairros, {
      style: (f) => ({ color: corDistrito[f.properties.distrito_adm] || '#555', weight: 1.6, dashArray: '5 4', fillOpacity: 0.04 }),
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindTooltip(p.nome, { permanent: true, direction: 'center', className: 'rotulo-bairro' });
        l.on('click', (e) => {
          if (posicionando) return;
          const dentro = posicionadas().filter((c) => turf.booleanPointInPolygon(ponto(c), f));
          L.popup().setLatLng(e.latlng).setContent(`<div class="popup"><h3>${esc(p.nome)}</h3>
            <p>Distrito administrativo: <b>${esc(p.distrito_adm)}</b></p>
            <p>Área: <b>${p.area_km2.toFixed(2).replace('.', ',')} km²</b></p>
            <p>Congregações no bairro: <b>${dentro.length}</b>${dentro.length ? ' – ' + dentro.map((c) => esc(c.nome)).join(', ') : ''}</p></div>`).openOn(mapa);
        });
      },
    }).addTo(camadaBairros);
  }
  function bairroDe(c) {
    if (!bairros) return '';
    const f = bairros.features.find((f) => turf.booleanPointInPolygon(ponto(c), f));
    return f ? f.properties.nome : 'Fora dos bairros mapeados';
  }

  // ---------- Dados das congregações ----------
  async function carregarCongregacoes() {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_LS) || 'null');
      if (Array.isArray(salvo) && salvo.length) { congregacoes = salvo; return; }
    } catch { /* armazenamento indisponível */ }
    try {
      const oficial = await (await fetch('data/congregacoes.json')).json();
      if (Array.isArray(oficial) && oficial.length) { congregacoes = oficial; return; }
    } catch { /* ainda não existe */ }
    congregacoes = await (await fetch('data/exemplo.json')).json();
    usandoExemplo = true;
  }
  function salvar() {
    usandoExemplo = false;
    try { localStorage.setItem(CHAVE_LS, JSON.stringify(congregacoes)); } catch { /* ignora */ }
  }

  // ---------- Marcadores ----------
  function desenharMarcadores() {
    camadaMarcadores.clearLayers(); marcadores.clear();
    const arrastavel = $('#modo-edicao').checked;
    posicionadas().forEach((c) => {
      const esp = ehEspecial(c);
      const icone = L.divIcon({
        className: '', iconSize: esp ? [24, 24] : [16, 16], iconAnchor: esp ? [12, 12] : [8, 8],
        html: `<div class="marcador${esp ? ' especial' : ''}"><div class="ponto" style="background:${corArea(c.area)}"></div><div class="rotulo">${esc(c.nome)}</div></div>`,
      });
      const m = L.marker([c.lat, c.lng], { icon: icone, draggable: arrastavel, zIndexOffset: esp ? 1000 : 0, title: c.nome })
        .bindPopup(() => popupCongregacao(c));
      m.on('dragend', () => {
        const ll = m.getLatLng(); c.lat = +ll.lat.toFixed(6); c.lng = +ll.lng.toFixed(6);
        c.bairro = bairroDe(c); salvar(); atualizarTudo();
      });
      m.addTo(camadaMarcadores); marcadores.set(c.id, m);
    });
  }
  function popupCongregacao(c) {
    const outras = posicionadas().filter((o) => o.id !== c.id).map((o) => ({ o, d: distM(c, o) })).sort((a, b) => a.d - b.d);
    const viz = outras.slice(0, 3).map(({ o, d }) => `<li>${esc(o.nome)} – <b>${km(d)}</b></li>`).join('');
    return `<div class="popup"><h3>${esc(c.nome)}</h3>
      <p><span class="bola" style="display:inline-block;vertical-align:middle;background:${corArea(c.area)}"></span> ${esc(c.area || 'Sem área')}</p>
      <p>Bairro: <b>${esc(c.bairro || bairroDe(c))}</b></p>
      ${c.dirigente ? `<p>Dirigente: ${esc(c.dirigente)}</p>` : ''}
      ${c.endereco ? `<p>Endereço: ${esc(c.endereco)}</p>` : ''}
      ${viz ? `<p style="margin-top:6px">Mais próximas (linha reta):</p><ol style="margin:2px 0 0 18px;padding:0">${viz}</ol>` : ''}
      <p style="margin-top:6px"><a href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}" target="_blank" rel="noopener">Como chegar ↗</a></p></div>`;
  }

  // ---------- Lista e filtros ----------
  function preencherAreas() {
    const areas = [...new Set(congregacoes.map((c) => c.area).filter(Boolean))].sort((a, b) => ordemArea(a) - ordemArea(b));
    const sel = $('#filtro-area'), atual = sel.value;
    sel.innerHTML = '<option value="">Todas as áreas</option>' + areas.map((a) => `<option>${esc(a)}</option>`).join('');
    sel.value = atual;
    const opts = posicionadas().slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
    ['#dist-a', '#dist-b'].forEach((s, i) => { const v = $(s).value; $(s).innerHTML = opts; $(s).value = v || $(s).options[i]?.value || ''; });
  }
  function desenharLista() {
    const q = norm($('#busca').value), area = $('#filtro-area').value;
    const itens = congregacoes.filter((c) => (!area || c.area === area) &&
      (!q || norm(`${c.nome} ${c.area} ${c.bairro}`).includes(q)))
      .sort((a, b) => ordemArea(a.area) - ordemArea(b.area) || a.nome.localeCompare(b.nome, 'pt-BR'));
    const grupos = new Set(congregacoes.map((c) => c.area).filter(Boolean));
    const nAreas = [...grupos].filter((a) => !ESPECIAIS.includes(a)).length;
    const total = usandoExemplo ? congregacoes.length : TOTAL_ESPERADO;
    $('#resumo').textContent = `${itens.length} de ${congregacoes.length} congregações · ${nAreas} áreas` +
      `${ESPECIAIS.filter((e) => grupos.has(e)).length ? ' + ' + ESPECIAIS.filter((e) => grupos.has(e)).join(' e ') : ''}` +
      ` · ${posicionadas().length} de ${total} posicionadas no mapa`;
    $('#lista').innerHTML = itens.map((c) => `<li data-id="${esc(c.id)}">
        <span class="bola" style="background:${corArea(c.area)}"></span>
        <div class="info"><div class="nome">${esc(c.nome)}</div>
        <div class="meta">${esc(c.area || 'Sem área')} · ${Number.isFinite(c.lat) ? esc(c.bairro || '') : '<i>não posicionada</i>'}</div></div></li>`).join('');
  }
  $('#lista').addEventListener('click', (e) => {
    const li = e.target.closest('li'); if (!li) return;
    const c = congregacoes.find((x) => x.id === li.dataset.id);
    if (!c || !Number.isFinite(c.lat)) return;
    mapa.flyTo([c.lat, c.lng], 16); marcadores.get(c.id)?.openPopup();
    if (innerWidth <= 760) $('#painel').classList.add('oculto');
  });
  $('#busca').addEventListener('input', desenharLista);
  $('#filtro-area').addEventListener('change', () => {
    desenharLista();
    const area = $('#filtro-area').value;
    const sel = posicionadas().filter((c) => !area || c.area === area);
    if (sel.length) mapa.fitBounds(L.latLngBounds(sel.map((c) => [c.lat, c.lng])).pad(0.3), { maxZoom: 16 });
  });

  // ---------- Distância ----------
  async function rotaOSRM(base, perfil, a, b) {
    const url = `${base}/route/v1/${perfil}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const r = await fetch(url); if (!r.ok) throw new Error(r.status);
    const j = await r.json(); if (j.code !== 'Ok') throw new Error(j.code);
    return j.routes[0];
  }
  $('#btn-distancia').addEventListener('click', async () => {
    const a = congregacoes.find((c) => c.id === $('#dist-a').value), b = congregacoes.find((c) => c.id === $('#dist-b').value);
    const out = $('#resultado-distancia');
    if (!a || !b || a === b) { out.textContent = 'Escolha duas congregações diferentes.'; return; }
    camadaRota.clearLayers();
    const reta = distM(a, b);
    L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#475569', dashArray: '6 6', weight: 2 }).addTo(camadaRota);
    out.innerHTML = `<p>Linha reta: <span class="num">${km(reta)}</span></p><p class="dica">Calculando rotas pelas ruas…</p>`;
    mapa.fitBounds(L.latLngBounds([[a.lat, a.lng], [b.lat, b.lng]]).pad(0.4));
    const [carro, pe] = await Promise.allSettled([
      rotaOSRM('https://router.project-osrm.org', 'driving', a, b),
      rotaOSRM('https://routing.openstreetmap.de/routed-foot', 'foot', a, b),
    ]);
    let html = `<p>Linha reta: <span class="num">${km(reta)}</span></p>`;
    if (carro.status === 'fulfilled') {
      L.geoJSON(carro.value.geometry, { style: { color: '#0b6e4f', weight: 5, opacity: 0.8 } }).addTo(camadaRota);
      html += `<p>🚗 De carro: <b>${km(carro.value.distance)}</b> · ~${min(carro.value.duration)}</p>`;
    }
    if (pe.status === 'fulfilled') {
      L.geoJSON(pe.value.geometry, { style: { color: '#2563eb', weight: 4, opacity: 0.7, dashArray: '2 6' } }).addTo(camadaRota);
      html += `<p>🚶 A pé: <b>${km(pe.value.distance)}</b> · ~${min(pe.value.duration)}</p>`;
    }
    if (carro.status === 'rejected' && pe.status === 'rejected') html += '<p class="dica">Não foi possível calcular a rota pelas ruas agora (serviço de rotas indisponível).</p>';
    else if (carro.status === 'fulfilled') html += `<p class="dica">Índice de sinuosidade: ${(carro.value.distance / reta).toFixed(2).replace('.', ',')} (quanto maior, mais a malha viária obriga a contornar).</p>`;
    out.innerHTML = html;
  });
  $('#btn-limpar-rota').addEventListener('click', () => { camadaRota.clearLayers(); $('#resultado-distancia').innerHTML = ''; });

  // ---------- Vizinho mais próximo ----------
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
      ${linhas.map((l) => `<tr class="${l.d < PERTO_M ? 'perto' : l.d > ISOLADA_M ? 'isolada' : ''}" data-id="${esc(l.c.id)}"><td>${esc(l.c.nome)}</td><td>${esc(l.o.nome)}</td><td class="n">${km(l.d)}</td></tr>`).join('')}
      </tbody></table>`;
  });
  $('#tabela-vizinhos').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const c = congregacoes.find((x) => x.id === tr.dataset.id); mapa.flyTo([c.lat, c.lng], 16); marcadores.get(c.id)?.openPopup();
  });

  // ---------- Camadas de estudo ----------
  function desenharVoronoi() {
    camadaVoronoi.clearLayers();
    const ps = posicionadas(); if (ps.length < 2) return;
    const pts = turf.featureCollection(ps.map(ponto));
    const caixa = uniaoBairros ? turf.bbox(turf.buffer(uniaoBairros, 1, { units: 'kilometers' })) : turf.bbox(turf.buffer(pts, 2, { units: 'kilometers' }));
    const vor = turf.voronoi(pts, { bbox: caixa });
    vor.features.forEach((cel, i) => {
      if (!cel) return;
      const c = ps[i];
      let g = cel;
      if (uniaoBairros) { try { g = turf.intersect(turf.featureCollection([cel, uniaoBairros])) || cel; } catch { /* mantém célula */ } }
      const area = turf.area(g) / 1e6;
      L.geoJSON(g, { style: { color: corArea(c.area), weight: 1.5, fillColor: corArea(c.area), fillOpacity: 0.18 }, interactive: true })
        .bindTooltip(`<b>${esc(c.nome)}</b><br>Área de influência: ${area.toFixed(2).replace('.', ',')} km²`, { sticky: true })
        .addTo(camadaVoronoi);
    });
  }
  function desenharRaios() {
    camadaRaios.clearLayers();
    const r = +$('#raio').value;
    posicionadas().forEach((c) => L.circle([c.lat, c.lng], { radius: r, color: corArea(c.area), weight: 1, fillOpacity: 0.08, interactive: false }).addTo(camadaRaios));
  }
  function desenharCobertura() {
    camadaCobertura.clearLayers();
    const ps = posicionadas(); if (!bairros || !ps.length) return;
    const faixas = [[500, '#1a9850', 'até 500 m'], [1000, '#91cf60', '500 m – 1 km'], [1500, '#fee08b', '1 – 1,5 km'], [2500, '#fc8d59', '1,5 – 2,5 km'], [Infinity, '#d73027', 'mais de 2,5 km']];
    bairros.features.forEach((f) => {
      // Distância média de pontos amostrados dentro do bairro até a congregação mais próxima.
      const caixa = turf.bbox(f);
      const grade = turf.pointGrid(caixa, 0.25, { units: 'kilometers', mask: f });
      const amostras = grade.features.length ? grade.features : [turf.pointOnFeature(f)];
      const dists = amostras.map((p) => Math.min(...ps.map((c) => turf.distance(p, ponto(c)) * 1000)));
      const media = dists.reduce((s, d) => s + d, 0) / dists.length;
      const pior = Math.max(...dists);
      const n = ps.filter((c) => turf.booleanPointInPolygon(ponto(c), f)).length;
      const cor = faixas.find(([lim]) => media <= lim)[1];
      L.geoJSON(f, { style: { color: '#334155', weight: 1, fillColor: cor, fillOpacity: 0.55 } })
        .bindTooltip(`<b>${esc(f.properties.nome)}</b><br>${n} congregação(ões) no bairro<br>Distância média até a mais próxima: ${km(media)}<br>Ponto mais distante: ${km(pior)}`, { sticky: true })
        .addTo(camadaCobertura);
    });
    $('#legenda-cobertura').innerHTML = '<b>Distância média até uma congregação</b>' + faixas.map(([, c, t]) => `<div><i style="background:${c}"></i>${t}</div>`).join('');
  }
  function alternar(chk, camada, desenhar) {
    $(chk).addEventListener('change', (e) => {
      if (e.target.checked) { desenhar?.(); camada.addTo(mapa); } else mapa.removeLayer(camada);
      if (chk === '#cam-cobertura') $('#legenda-cobertura').hidden = !e.target.checked;
    });
  }
  alternar('#cam-bairros', camadaBairros);
  alternar('#cam-voronoi', camadaVoronoi, desenharVoronoi);
  alternar('#cam-raios', camadaRaios, desenharRaios);
  alternar('#cam-cobertura', camadaCobertura, desenharCobertura);
  $('#raio').addEventListener('input', (e) => {
    $('#raio-valor').textContent = `${(e.target.value / 1000).toFixed(e.target.value % 1000 ? 2 : 1).replace('.', ',')} km`;
    if ($('#cam-raios').checked) desenharRaios();
  });

  // ---------- Cadastro: importar planilha ----------
  function colunas(linha) {
    const m = {};
    Object.keys(linha).forEach((k) => {
      const n = norm(k);
      if (!m.nome && /^(nome|congrega)/.test(n)) m.nome = k;
      else if (!m.area && /^area|^setor/.test(n)) m.area = k;
      else if (!m.dirigente && /(dirigente|pastor|lider|responsavel)/.test(n)) m.dirigente = k;
      else if (!m.endereco && /(endereco|rua|logradouro)/.test(n)) m.endereco = k;
      else if (!m.lat && /^lat/.test(n)) m.lat = k;
      else if (!m.lng && /^(lng|lon)/.test(n)) m.lng = k;
    });
    return m;
  }
  $('#arquivo').addEventListener('change', async (e) => {
    const arq = e.target.files[0]; if (!arq) return;
    const wb = XLSX.read(await arq.arrayBuffer());
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!linhas.length) { $('#resultado-import').textContent = 'A planilha está vazia.'; return; }
    const col = colunas(linhas[0]);
    if (!col.nome) { $('#resultado-import').innerHTML = `Não encontrei a coluna com o nome da congregação. Colunas lidas: <b>${Object.keys(linhas[0]).map(esc).join(', ')}</b>`; return; }
    let areaAtual = '';
    const novas = [];
    linhas.forEach((l, i) => {
      const nome = String(l[col.nome]).trim(); if (!nome) return;
      // Planilhas que trazem a área só na primeira linha de cada grupo herdam a área anterior.
      if (col.area && String(l[col.area]).trim()) areaAtual = normalizarArea(l[col.area]);
      let area = areaAtual;
      const especial = ESPECIAIS.find((s) => norm(s) === norm(nome));
      if (especial) area = especial; // o próprio Templo Central / Manancial formam um grupo à parte
      const existente = congregacoes.find((c) => !c.exemplo && norm(c.nome) === norm(nome));
      const c = existente || { id: `c${Date.now().toString(36)}${i}` };
      Object.assign(c, { nome, area, dirigente: col.dirigente ? String(l[col.dirigente]).trim() : c.dirigente, endereco: col.endereco ? String(l[col.endereco]).trim() : c.endereco });
      const lat = parseFloat(String(l[col.lat] ?? '').replace(',', '.')), lng = parseFloat(String(l[col.lng] ?? '').replace(',', '.'));
      if (Number.isFinite(lat) && Number.isFinite(lng)) { c.lat = lat; c.lng = lng; c.bairro = bairroDe(c); }
      novas.push(c);
    });
    const manter = congregacoes.filter((c) => !c.exemplo && !novas.includes(c));
    congregacoes = [...manter, ...novas];
    salvar(); atualizarTudo();
    $('#resultado-import').innerHTML = relatorioImportacao(novas);
  });

  // Confere a planilha contra a estrutura do distrito (33 áreas + 2 grupos especiais = 96).
  function relatorioImportacao(lista) {
    const grupos = new Set(lista.map((c) => c.area).filter(Boolean));
    const numeradas = [...grupos].filter((a) => /^Área \d+$/.test(a));
    const faltando = [];
    for (let i = 1; i <= N_AREAS; i++) if (!grupos.has(`Área ${i}`)) faltando.push(i);
    const foraDaFaixa = numeradas.filter((a) => +a.split(' ')[1] > N_AREAS || +a.split(' ')[1] < 1);
    const estranhas = [...grupos].filter((a) => !/^Área \d+$/.test(a) && !ESPECIAIS.includes(a));
    const semArea = lista.filter((c) => !c.area);
    const contagem = {}; lista.forEach((c) => { contagem[norm(c.nome)] = (contagem[norm(c.nome)] || 0) + 1; });
    const repetidas = Object.keys(contagem).filter((k) => contagem[k] > 1);
    const ok = (v) => v ? '✅' : '⚠️';
    const avisos = [
      `${ok(lista.length === TOTAL_ESPERADO)} <b>${lista.length}</b> de ${TOTAL_ESPERADO} congregações`,
      `${ok(!faltando.length && !foraDaFaixa.length)} <b>${numeradas.length - foraDaFaixa.length}</b> de ${N_AREAS} áreas numeradas` +
        (faltando.length ? ` – faltam: ${faltando.join(', ')}` : '') +
        (foraDaFaixa.length ? ` – fora de 1 a ${N_AREAS}: ${foraDaFaixa.map(esc).join(', ')}` : ''),
      ...ESPECIAIS.map((e) => `${ok(grupos.has(e))} ${e}`),
    ];
    if (estranhas.length) avisos.push(`⚠️ Áreas não reconhecidas: ${estranhas.map(esc).join(', ')}`);
    if (semArea.length) avisos.push(`⚠️ Sem área: ${semArea.map((c) => esc(c.nome)).join(', ')}`);
    if (repetidas.length) avisos.push(`⚠️ Nomes repetidos: ${repetidas.map((k) => esc(lista.find((c) => norm(c.nome) === k).nome)).join(', ')}`);
    return `<p><span class="num">${lista.length}</span> congregações importadas.</p>
      <ul style="margin:4px 0 0 0;padding-left:0;list-style:none">${avisos.map((a) => `<li>${a}</li>`).join('')}</ul>
      <p class="dica">${lista.filter((c) => !Number.isFinite(c.lat)).length} ainda precisam ser posicionadas no mapa (passo 2).</p>`;
  }
  $('#arquivo').addEventListener('click', () => { $('#arquivo').value = ''; });

  // ---------- Cadastro: posicionar ----------
  function desenharPendentes() {
    const lista = congregacoes.filter((c) => !c.exemplo)
      .sort((a, b) => Number.isFinite(a.lat) - Number.isFinite(b.lat) || ordemArea(a.area) - ordemArea(b.area) || a.nome.localeCompare(b.nome, 'pt-BR'));
    $('#pendentes').innerHTML = lista.length ? lista.map((c) => `<li data-id="${esc(c.id)}">
      <span class="bola" style="background:${corArea(c.area)}"></span>
      <div class="info"><div class="nome">${esc(c.nome)}</div><div class="meta">${esc(c.area || 'Sem área')} · ${Number.isFinite(c.lat) ? '✅ ' + esc(c.bairro || '') : '⏳ não posicionada'}</div></div>
      <button data-acao="posicionar">${Number.isFinite(c.lat) ? 'Reposicionar' : 'Posicionar'}</button></li>`).join('')
      : '<li class="dica">Importe a planilha no passo 1 para listar as congregações aqui.</li>';
  }
  $('#pendentes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-acao]'); if (!b) return;
    posicionando = b.closest('li').dataset.id;
    const c = congregacoes.find((x) => x.id === posicionando);
    $('#instrucao').textContent = `Clique no mapa para posicionar: ${c.nome} (Esc cancela)`;
    $('#instrucao').hidden = false; mapa.getContainer().style.cursor = 'crosshair';
    if (innerWidth <= 760) $('#painel').classList.add('oculto');
  });
  function pararPosicionamento() { posicionando = null; $('#instrucao').hidden = true; mapa.getContainer().style.cursor = ''; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pararPosicionamento(); });
  mapa.on('click', (e) => {
    if (!posicionando) return;
    const c = congregacoes.find((x) => x.id === posicionando);
    c.lat = +e.latlng.lat.toFixed(6); c.lng = +e.latlng.lng.toFixed(6); c.bairro = bairroDe(c);
    pararPosicionamento(); salvar(); atualizarTudo();
    marcadores.get(c.id)?.openPopup();
  });

  // Busca de ruas (Nominatim), limitada à região norte de Belém.
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
    const li = e.target.closest('li[data-lat]'); if (li) mapa.flyTo([+li.dataset.lat, +li.dataset.lng], 17);
  });
  $('#modo-edicao').addEventListener('change', desenharMarcadores);

  // ---------- Exportar ----------
  function baixar(nome, conteudo, tipo) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const reais = () => congregacoes.filter((c) => !c.exemplo);
  $('#btn-exportar-json').addEventListener('click', () => baixar('congregacoes.json', JSON.stringify(reais(), null, 2), 'application/json'));
  $('#btn-exportar-csv').addEventListener('click', () => {
    const cab = ['nome', 'area', 'bairro', 'dirigente', 'endereco', 'lat', 'lng'];
    const csv = [cab.join(';'), ...reais().map((c) => cab.map((k) => `"${String(c[k] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');
    baixar('congregacoes.csv', '﻿' + csv, 'text/csv');
  });
  $('#btn-apagar').addEventListener('click', () => {
    if (!confirm('Apagar as congregações salvas neste navegador?')) return;
    try { localStorage.removeItem(CHAVE_LS); } catch { /* ignora */ }
    location.reload();
  });

  // ---------- Interface ----------
  document.querySelectorAll('.abas button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.abas button, .aba').forEach((x) => x.classList.remove('ativa'));
    b.classList.add('ativa'); $(`#aba-${b.dataset.aba}`).classList.add('ativa');
  }));
  $('#alternar-painel').addEventListener('click', () => $('#painel').classList.toggle('oculto'));

  function atualizarTudo() {
    $('#aviso-exemplo').hidden = !usandoExemplo;
    posicionadas().forEach((c) => { if (!c.bairro) c.bairro = bairroDe(c); });
    desenharMarcadores(); preencherAreas(); desenharLista(); desenharPendentes();
    if ($('#cam-voronoi').checked) desenharVoronoi();
    if ($('#cam-raios').checked) desenharRaios();
    if ($('#cam-cobertura').checked) desenharCobertura();
  }

  (async () => {
    await carregarBairros();
    await carregarCongregacoes();
    atualizarTudo();
    if (bairros) mapa.fitBounds(L.geoJSON(bairros).getBounds(), { padding: [10, 10] });
  })();
})();
