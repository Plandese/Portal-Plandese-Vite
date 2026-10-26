// ===================================================
//  MAIN.JS - Ponto de entrada Vite
//  Importa estilos e toda a logica da app
// ===================================================
import './styles/global.css';
import './styles/mobile-shell.css';
import './styles/enc-shell.css';
import './styles/desktop-shell.css';
import './styles/agente.css';
import './styles/painel-atencao.css';
import './styles/ponto-esc.css';

// Separador aberto com uma versão antiga do portal: depois de um deploy, os ficheiros com hash antigo já não
// existem e os módulos carregados a pedido (pdf, carimbo…) falham. Recarrega a página uma vez para apanhar a versão nova.
function _recarregarVersaoNova(){
  try{
    const k = 'plandese_reload_chunk';
    if(Date.now() - Number(sessionStorage.getItem(k) || 0) < 60000) return false;   // evita ciclos
    sessionStorage.setItem(k, String(Date.now()));
  } catch(e){}
  location.reload();
  return true;
}
window.addEventListener('vite:preloadError', e => { e.preventDefault(); _recarregarVersaoNova(); });
window.addEventListener('unhandledrejection', e => {
  if(/dynamically imported module|Importing a module script failed/i.test(String(e.reason?.message || e.reason))) _recarregarVersaoNova();
});
window.plandeseVersaoAntiga = _recarregarVersaoNova;

// Leaflet — exposto como global para compatibilidade com app.js (usa L.map, L.tileLayer, etc.)
import L from 'leaflet';
window.L = L;

// XLSX (SheetJS) — exposto como global para export/import Excel em todos os módulos
import * as XLSX from 'xlsx';
window.XLSX = XLSX;

// ExcelJS — exposto como global para exports Excel com formatação (folha de ponto, folha de fecho)
import ExcelJS from 'exceljs';
window.ExcelJS = ExcelJS;

// Html5Qrcode — exposto como global para compatibilidade com app.js (usa Html5Qrcode para QR scanner)
import { Html5Qrcode } from 'html5-qrcode';
window.Html5Qrcode = Html5Qrcode;

// QRCode — gerador de QR codes (usado em showQrCode dos equipamentos)
import QRCodeLib from 'qrcode';
window.QRCodeLib = QRCodeLib;

// Importa a logica completa da aplicacao (migrada de portal_antigo.html)
// app.js ja importa: supabase.js, config.js, utils/helpers.js
import './app.js';
