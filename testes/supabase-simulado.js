/* Supabase simulado para testes de interface (substitui vendor/supabase.js nos testes).
 * Reproduz, de forma simplificada, as mesmas regras do supabase/schema.sql. Estado salvo em localStorage. */
(() => {
  const K = 'supabase-simulado';
  const ler = () => JSON.parse(localStorage.getItem(K));
  const gravar = (s) => localStorage.setItem(K, JSON.stringify(s));
  const ok = (data) => ({ data, error: null });
  const falha = (message) => ({ data: null, error: { message } });
  const uid = () => crypto.randomUUID();
  function eu(s) { return s.sessao && s.perfis.find((p) => p.id === s.sessao); }
  const pode = (p, c) => p && (p.papel === 'admin' || (p.papel === 'editor' && c.area === p.area));
  const ver = (p) => p && ['leitor', 'editor', 'admin'].includes(p.papel);

  function executar(tabela, st) {
    const s = ler(), p = eu(s);
    if (!p) return falha('JWT expired');
    let linhas = s[tabela];
    const filtra = (r) => st.filtros.every(([c, v]) => r[c] === v);
    if (tabela === 'perfis') {
      if (st.op === 'select') { const r = linhas.filter((x) => (x.id === p.id || p.papel === 'admin') && filtra(x)); return ok(st.maybe ? r[0] ?? null : r); }
      if (st.op === 'update') { linhas.filter(filtra).forEach((x) => { if (p.papel === 'admin') Object.assign(x, st.dados); else if (x.id === p.id) x.nome = st.dados.nome ?? x.nome; }); gravar(s); return ok(null); }
    }
    if (tabela === 'areas') return ok(ver(p) ? linhas.slice().sort((a, b) => a.ordem - b.ordem) : []);
    if (tabela === 'historico') return ok([]);
    if (tabela === 'congregacoes') {
      if (st.op === 'select') return ok(ver(p) ? linhas.filter(filtra) : []);
      if (st.op === 'insert') {
        for (const r of st.dados) if (!pode(p, r)) return falha('new row violates row-level security policy for table "congregacoes"');
        const novas = st.dados.map((r) => ({ id: uid(), sede_area: false, ...r })); s.congregacoes.push(...novas); gravar(s); return ok(novas);
      }
      if (st.op === 'update') {
        const alvo = linhas.filter((x) => filtra(x) && pode(p, x));
        if (alvo.some(() => !pode(p, { ...st.dados, area: st.dados.area ?? alvo[0].area }))) return falha('new row violates row-level security policy');
        if (st.dados.sede_area && alvo.some((x) => linhas.some((y) => y.area === x.area && y.sede_area && y.id !== x.id)))
          return falha('duplicate key value violates unique constraint "congregacoes_uma_sede_por_area"');
        alvo.forEach((x) => Object.assign(x, st.dados)); gravar(s); return ok(st.retornar ? alvo : null);
      }
      if (st.op === 'delete') { if (p.papel === 'admin') s.congregacoes = linhas.filter((x) => !filtra(x)); gravar(s); return ok(null); }
    }
    return falha('operação não simulada');
  }
  function consulta(tabela) {
    const st = { op: 'select', filtros: [], dados: null, maybe: false, retornar: false };
    const q = {
      select() { if (st.op !== 'select') st.retornar = true; return q; },
      eq(c, v) { st.filtros.push([c, v]); return q; }, order() { return q; }, limit() { return q; },
      maybeSingle() { st.maybe = true; return q; },
      insert(d) { st.op = 'insert'; st.dados = [].concat(d); return q; },
      update(d) { st.op = 'update'; st.dados = d; return q; },
      delete() { st.op = 'delete'; return q; },
      then(a, b) { return Promise.resolve().then(() => executar(tabela, st)).then(a, b); },
    };
    return q;
  }
  window.supabase = {
    createClient() {
      const ouvintes = [];
      return {
        auth: {
          async getSession() { const s = ler(); return ok({ session: s.sessao ? { user: { id: s.sessao } } : null }); },
          async getUser() { const s = ler(); return ok({ user: s.sessao ? { id: s.sessao } : null }); },
          async signInWithPassword({ email, password }) {
            const s = ler(), u = s.usuarios.find((x) => x.email === email && x.senha === password);
            if (!u) return falha('Invalid login credentials');
            s.sessao = u.id; gravar(s); return ok({ session: { user: { id: u.id } } });
          },
          async signUp({ email, password, options }) {
            const s = ler(); if (s.usuarios.some((x) => x.email === email)) return falha('User already registered');
            const id = uid(); s.usuarios.push({ id, email, senha: password });
            s.perfis.push({ id, email, nome: options?.data?.nome || email, papel: 'pendente', area: null, criado_em: new Date().toISOString() });
            s.sessao = id; gravar(s); return ok({ session: { user: { id } }, user: { id } });
          },
          async signOut() { const s = ler(); s.sessao = null; gravar(s); return ok(null); },
          async resetPasswordForEmail() { return ok({}); },
          async updateUser() { return ok({}); },
          onAuthStateChange(cb) { ouvintes.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
        },
        from: consulta,
        async rpc(nome, { cid }) {
          const s = ler(), p = eu(s), c = s.congregacoes.find((x) => x.id === cid);
          if (!c || !pode(p, c)) return falha('Sem permissão para alterar esta congregação');
          s.congregacoes.forEach((x) => { if (x.area === c.area) x.sede_area = x.id === cid; }); gravar(s); return ok(null);
        },
        channel() { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
      };
    },
  };
})();
