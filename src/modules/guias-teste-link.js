// ═══════════════════════════════════════
//  GUIAS DE REMESSA (TESTE) — atalho em Definições, só para o administrador
//  A página vive em /guias-teste.html (sistema separado do portal, ver supabase/migrations/20261103_guias_teste_separado.sql)
//  e usa a mesma sessão. O acesso é também decidido no servidor: as tabelas gt_* só deixam o administrador entrar.
// ═══════════════════════════════════════
import { S } from '../state.js';

export function initGuiasTesteLink(){
  ['nav-guias-teste','nav-compras-teste'].forEach(id => {
    const btn = document.getElementById(id);
    if(btn) btn.style.display = S.currentUser?.role === 'admin' ? '' : 'none';
  });
}

export function abrirComprasTeste(){
  window.location.href = '/compras-teste.html';
}

export function abrirGuiasTeste(){
  window.location.href = '/guias-teste.html';
}
