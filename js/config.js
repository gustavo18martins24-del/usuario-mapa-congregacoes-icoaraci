// Configuração do banco de dados online (Supabase).
// Copie do painel do Supabase (Project Settings → API Keys / Data API):
//   supabaseUrl     → "Project URL"   (ex.: https://abcdefghijklmnop.supabase.co)
//   supabaseAnonKey → "Publishable key" (sb_publishable_...) ou, no painel antigo, a "anon public" key
// Essas duas informações são públicas por natureza: quem protege os dados são as regras do banco
// (supabase/schema.sql). NUNCA coloque aqui a "secret key" / "service_role".
// Deixe vazio para usar o MODO LOCAL (dados salvos só neste navegador, sem login).
window.CONFIG = {
  supabaseUrl: 'https://hdnxyfconblcrhxaaawx.supabase.co',
  supabaseAnonKey: 'sb_publishable_e7BXnpaAqmy_-keVgTyu5w_iLTHrHmh',
};
