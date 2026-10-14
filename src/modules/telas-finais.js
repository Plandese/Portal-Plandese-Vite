// ═══════════════════════════════════════
//  TELAS FINAIS — atalho na sidebar (Produção)
//  A app vive em /telas-finais/ (public/telas-finais/index.html) e usa a mesma
//  sessão Supabase. O acesso é decidido no servidor por fn_tf_acesso()
//  (lista 'telas_finais_acesso' em app_config, editável pelo admin).
// ═══════════════════════════════════════
import { sb } from '../supabase.js';

export async function initTelasFinaisLink(){
  const btn = document.getElementById('nav-telas-finais');
  if(!btn) return;
  btn.style.display = 'none';
  try {
    const { data } = await sb.rpc('fn_tf_acesso');
    if(data === true) btn.style.display = '';
  } catch(e) { /* sem acesso ou sem rede: o atalho fica escondido */ }
}

export function abrirTelasFinais(){
  window.location.href = '/telas-finais/';
}
