/* Camada de dados: a mesma interface para o banco online (Supabase) e para o modo local (navegador).
 *
 *   iniciar()                 → sessão atual ou null
 *   entrar / cadastrar / recuperarSenha / novaSenha / sair
 *   meuPerfil()               → { id, nome, email, papel, area }
 *   carregar()                → { areas, congregacoes }
 *   salvar(c)                 → congregação salva (inclui ou altera)
 *   remover(id), definirSede(id), importar(lista)
 *   historico(id), perfis(), atualizarPerfil(id, campos)
 *   aoMudar(callback)         → avisa quando outra pessoa altera algo (tempo real)
 */
window.Dados = (() => {
  'use strict';
  const CAMPOS = ['nome', 'area', 'sede_area', 'bairro', 'localidade', 'dirigente', 'endereco', 'observacoes', 'lat', 'lng'];
  const so = (c) => Object.fromEntries(CAMPOS.filter((k) => k in c).map((k) => [k, c[k] === '' ? null : c[k]]));
  const erro = (r) => { if (r.error) throw new Error(traduzir(r.error.message)); return r.data; };
  function traduzir(m) {
    const t = {
      'Invalid login credentials': 'E-mail ou senha incorretos.',
      'Email not confirmed': 'Confirme seu e-mail antes de entrar (veja a caixa de entrada).',
      'User already registered': 'Este e-mail já tem cadastro. Use "Entrar" ou "Esqueci a senha".',
      'Password should be at least 6 characters.': 'A senha precisa ter pelo menos 6 caracteres.',
      'new row violates row-level security policy': 'Você não tem permissão para esta alteração.',
    };
    for (const [en, pt] of Object.entries(t)) if (m && m.includes(en.replace(/\.$/, ''))) return pt;
    if (/congregacoes_uma_sede_por_area/.test(m)) return 'Esta área já tem uma sede.';
    if (/violates check constraint .*lat|lng/.test(m)) return 'Coordenadas fora da região de Belém.';
    return m;
  }

  // ---------------- Banco online (Supabase) ----------------
  class Nuvem {
    constructor(url, chave) {
      this.modo = 'nuvem';
      this.sb = window.supabase.createClient(url, chave, { auth: { persistSession: true, detectSessionInUrl: true } });
    }
    async iniciar() { return erro(await this.sb.auth.getSession()).session; }
    aoAutenticar(cb) { this.sb.auth.onAuthStateChange((evento, sessao) => cb(evento, sessao)); }
    async entrar(email, senha) { return erro(await this.sb.auth.signInWithPassword({ email, password: senha })); }
    async cadastrar(nome, email, senha) {
      return erro(await this.sb.auth.signUp({ email, password: senha, options: { data: { nome }, emailRedirectTo: location.href.split('#')[0] } }));
    }
    async recuperarSenha(email) { return erro(await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] })); }
    async novaSenha(senha) { return erro(await this.sb.auth.updateUser({ password: senha })); }
    async sair() { await this.sb.auth.signOut(); }
    async meuPerfil() {
      const { data: { user } } = await this.sb.auth.getUser();
      if (!user) return null;
      return erro(await this.sb.from('perfis').select('*').eq('id', user.id).maybeSingle());
    }
    async carregar() {
      const [areas, congregacoes] = await Promise.all([
        this.sb.from('areas').select('*').order('ordem'),
        this.sb.from('congregacoes').select('*').order('nome'),
      ]);
      return { areas: erro(areas), congregacoes: erro(congregacoes) };
    }
    async salvar(c) {
      const q = c.id ? this.sb.from('congregacoes').update(so(c)).eq('id', c.id) : this.sb.from('congregacoes').insert(so(c));
      const r = erro(await q.select());
      if (!r || !r.length) throw new Error('Você não tem permissão para alterar esta congregação.');
      return r[0];
    }
    async remover(id) { erro(await this.sb.from('congregacoes').delete().eq('id', id)); }
    async definirSede(id) { erro(await this.sb.rpc('definir_sede', { cid: id })); }
    async importar(lista) {
      const existentes = erro(await this.sb.from('congregacoes').select('id,nome,area'));
      const chave = (c) => `${c.area}|${c.nome}`.toLowerCase();
      const mapa = new Map(existentes.map((c) => [chave(c), c.id]));
      const novas = [], alteradas = [];
      lista.forEach((c) => { const id = mapa.get(chave(c)); (id ? alteradas : novas).push({ ...so(c), ...(id ? { id } : {}) }); });
      // Sedes vêm por definirSede depois, para não violar "uma sede por área" no meio da importação.
      const semSede = (c) => { const x = { ...c }; delete x.sede_area; return x; };
      if (novas.length) erro(await this.sb.from('congregacoes').insert(novas.map(semSede)));
      for (const c of alteradas) erro(await this.sb.from('congregacoes').update(semSede(c)).eq('id', c.id));
      const { congregacoes } = await this.carregar();
      for (const c of lista.filter((x) => x.sede_area)) {
        const alvo = congregacoes.find((x) => chave(x) === chave(c));
        if (alvo && !alvo.sede_area) await this.definirSede(alvo.id);
      }
      return { incluidas: novas.length, atualizadas: alteradas.length };
    }
    async historico(id) {
      return erro(await this.sb.from('historico').select('*').eq('congregacao_id', id).order('em', { ascending: false }).limit(30));
    }
    async perfis() { return erro(await this.sb.from('perfis').select('*').order('criado_em')); }
    async atualizarPerfil(id, campos) { erro(await this.sb.from('perfis').update(campos).eq('id', id)); }
    aoMudar(cb) {
      this.sb.channel('mudancas-congregacoes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'congregacoes' }, (p) => cb(p))
        .subscribe();
    }
  }

  // ---------------- Modo local (navegador) ----------------
  const CHAVE = 'mapa-icoaraci-local-v2';
  class Local {
    constructor() { this.modo = 'local'; }
    async iniciar() { return { local: true }; }
    aoAutenticar() {}
    async meuPerfil() { return { id: 'local', nome: 'Modo local', email: '', papel: 'admin', area: null }; }
    async sair() {}
    ler() { try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { return null; } }
    gravar() { try { localStorage.setItem(CHAVE, JSON.stringify(this.dados)); } catch { /* sem armazenamento */ } }
    async carregar() {
      this.dados = this.ler();
      if (!this.dados) {
        // Primeira vez: estrutura oficial (96 congregações, ainda sem posição no mapa).
        const e = await (await fetch('data/estrutura.json')).json();
        let n = 0;
        this.dados = {
          areas: e.areas.map((a, i) => ({ nome: a.nome, setor: a.setor, responsavel: null, ordem: i })),
          congregacoes: e.areas.flatMap((a) => a.congregacoes.map((nome) => ({
            id: `c${++n}`, nome, area: a.nome, sede_area: nome === a.sede, lat: null, lng: null }))),
        };
        this.gravar();
      }
      return structuredClone(this.dados);
    }
    async salvar(c) {
      const lista = this.dados.congregacoes;
      if (c.sede_area && lista.some((x) => x.area === c.area && x.sede_area && x.id !== c.id)) throw new Error('Esta área já tem uma sede.');
      let alvo = c.id && lista.find((x) => x.id === c.id);
      if (!alvo) { alvo = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }; lista.push(alvo); }
      Object.assign(alvo, so(c), { atualizado_em: new Date().toISOString() });
      this.gravar(); return structuredClone(alvo);
    }
    async remover(id) { this.dados.congregacoes = this.dados.congregacoes.filter((c) => c.id !== id); this.gravar(); }
    async definirSede(id) {
      const c = this.dados.congregacoes.find((x) => x.id === id);
      this.dados.congregacoes.forEach((x) => { if (x.area === c.area) x.sede_area = x.id === id; });
      this.gravar();
    }
    async importar(lista) {
      const chave = (c) => `${c.area}|${c.nome}`.toLowerCase();
      let incluidas = 0, atualizadas = 0;
      for (const c of lista) {
        const alvo = this.dados.congregacoes.find((x) => chave(x) === chave(c));
        const { sede_area, ...resto } = c;
        if (alvo) { Object.assign(alvo, so(resto)); atualizadas++; } else { await this.salvar(resto); incluidas++; }
        if (sede_area) await this.definirSede((alvo || this.dados.congregacoes.find((x) => chave(x) === chave(c))).id);
      }
      this.gravar(); return { incluidas, atualizadas };
    }
    async historico() { return []; }
    async perfis() { return []; }
    async atualizarPerfil() {}
    aoMudar() {}
    apagarTudo() { try { localStorage.removeItem(CHAVE); } catch { /* ignora */ } }
  }

  const cfg = window.CONFIG || {};
  return (cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase)
    ? new Nuvem(cfg.supabaseUrl, cfg.supabaseAnonKey)
    : new Local();
})();
