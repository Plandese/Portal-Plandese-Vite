// ═══════════════════════════════════════
//  GUIAS DE REMESSA (TESTE) — atalho em Definições, para quem tem a página na matriz de permissões
//  A página vive em /guias-teste.html (sistema separado do portal, ver supabase/migrations/20261103_guias_teste_separado.sql)
//  e usa a mesma sessão. O acesso é também decidido no servidor: as tabelas gt_* usam fn_pag_on('guias-teste').
// ═══════════════════════════════════════
import { canAccessSection } from './permissions.js';

// quem vê os atalhos decide-se na matriz de permissões (páginas «guias-teste» e «compras-teste»)
export function initGuiasTesteLink(){
  [['nav-guias-teste','guias-teste'],['nav-compras-teste','compras-teste']].forEach(([id, sec]) => {
    const btn = document.getElementById(id);
    if(btn) btn.style.display = canAccessSection(sec) ? '' : 'none';
  });
}

export function abrirComprasTeste(){
  window.location.href = '/compras-teste.html';
}

export function abrirGuiasTeste(){
  window.location.href = '/guias-teste.html';
}
