// ═══════════════════════════════════════
//  APP.JS — Orquestração (entry point modular)
//  Migrado para módulos ES reais
// ═══════════════════════════════════════
import { fmt, fmtPT, calcH, fmtH } from './utils/helpers.js';
import { S, R } from './state.js';
import { carregarDados } from './db.js';

// Auth
import { mostrarDiag, applyDeviceClass, doLogin, doLogout, showDeviceChooser, setDeviceMode, getDeviceMode, tentarSessaoGuardada, validarPassword, trocarPropriaPassword } from './modules/auth.js';

// Navigation
import { showToast, switchFPTab, initAdmin, populateFilterSelects, openModal, closeModal, goTo, refreshPortal, toggleNavGrp, syncNavGroups, flashAlert } from './modules/navigation.js';

// Ponto admin
import { applyFilter, navSemana, renderHistSemana, exportMensal, exportHistSemana, loadWeek, exportSemanaExcel, hpEditCell, hpPickReg, hpTipoChange, hpSaveCell, hpAnularCell, hpDeleteCell, _hpClosePopover, aprovarDiaPonto, retirarAprovacaoPonto } from './modules/ponto.js';

// Obras, Colaboradores, Utilizadores
import { renderObras, editObra, saveObra, toggleObra, novaObra, obrToggleHideInativas } from './modules/obras.js';
import { renderColabs, editColab, saveColab, toggleColab, colabToggleHideInativos } from './modules/colaboradores.js';
import { renderUsers, editUser, saveUser, renderEncModsCheckboxes, onUserRoleChange } from './modules/utilizadores.js';

// Permissões
import { loadPermissions, loadPermissionsFromServer, savePermissions, resetPermissions, readPermMatrixState, renderPermMatrix, onPermChange, switchUtilTab, applyStoredPermissions, applyRolePermissions, canAccessSection } from './modules/permissions.js';

// Notificações
import { initNotifications, emitEvent, renderNotifPanel, notifClick, toggleNotifPanel, closeNotifPanel, markAllRead } from './modules/notifications.js';
import { renderNotifSubs, toggleNotifSub } from './modules/notif-subs.js';
import { renderCalWidget, initCalendario, calMudarMes, calHoje, calSelDia, calNovoEvento, calAbrirEvento, calToggleDiaInteiro, calFecharModal, calGuardar, calApagar, calToggleConcluido, calSetVisib, calFiltrarPessoas, calTogglePessoa } from './modules/calendario.js';
import { initNotifPage, ntfOnInsert, ntfFiltro, renderNotifPage, ntfToggleLida, ntfApagar, ntfAbrir, ntfMarcarTodasLidas, ntfApagarLidas, ntfTogglePref } from './modules/notif-page.js';
import { ensurePushSubscription, requestPushPermission, pushStatus, capturePendingSectionFromURL, applyPendingSection } from './modules/push.js';

// Faturas
import { handleFatFiles, renderFaturas, limparFatFiltros, editarFatura, saveFatura, apagarFatura, exportFaturasXLSX, setupFatDropzone, atualizaKPIs, seedFaturasDemo, carregarTemplatesFaturas, carregarFaturas, openFatSel, fssClose, fssSetActive, fssTextClick, fssSave, _fssFatInputChange, aprovarFatura, rejeitarFatura } from './modules/faturas.js';

// Compras
import { renderCompras, editarCompra, saveCompra, apagarCompra, exportComprasXLSX, abrirMapaPicker, fecharMapaPicker, geocodeSearch, confirmarLocalizacao, limparLocalizacao, cmpRenderArtPicker, cmpAddArtigo, cmpRemoveArtigo, cmpUpdateArtigoQty, cmpAddArtigoRapido, cmpAddForn, cmpRemoveForn, initCompras, atualizaKPIsCompras, populaCmpObras, cmpSetView, abrirListaMateriais, fecharListaMateriais, confirmarListaMateriais, uploadListaExcel, uploadListaExcelFile, cmpLstRender, cmpLstToggle, cmpLstRemoveSel, lstUpdateQty, cmpUpdateArtBtnBadge, abrirFornPicker, cmpFornPickerRender, cmpSelFornPicker, openCompraModal } from './modules/compras.js';

// Equipamentos
import { renderEquipamentos, openEqModal, editEquipamento, saveEquipamento, apagarEquipamento, refreshEqMap, showQrCode, printQrCode, showEqHistorico, exportEquipamentosXLSX, openEqManut, addEqManut, toggleEqManut, removeEqManut, submitQrRegistration, initEquipamentos, initQrRegistration } from './modules/equipamentos.js';

// Combustível admin
import { loadCombustivelAdmin, toggleCombView, renderCombObraCards, exportCombustivelXLSX, _initCombustivelAdmin } from './modules/combustivel.js';

// Enc-ponto
import { initEnc, encPassarColaboradores, encVoltarScreen1, carregarEquipaAnterior, adicionarTodosOntem, encAddColab, encRemColab, encSubmeterRegisto, encTimeChange, encTipoChange, encGoMenuPonto, encGoFolhaPontoPlandese, encGoFolhaPonto, encGoHistoricoEnc, encLoadHistorico, encGoFolhaPontoAluguer, encGoEquipamentos, encGoCombustivel, encVoltarHome, encOpenWeatherModal, encCloseWeatherModal, encOpenPrazoModal, encClosePrazoModal } from './modules/enc-ponto.js';

// Enc-equip
import { encScanNovamente, submitEncEquipamento } from './modules/enc-equip.js';

// Enc-combustivel + chat
import { encOpenFuelModal, encCloseFuelModal, depSetMovimento, encGoCombDeposito, encSubmeterCombDeposito, encGoCombViatura, combViaturaManual, combViaturaVoltarScanner, encSubmeterCombViatura, encGoComprasChat, chatOnInput, chatSend, combAbrirPicker, combFecharPicker, combPickerRender, combPickerSetCat, combPickerUsarTexto } from './modules/enc-combustivel.js';

// Enc-aluguer + MOA
import { loadEmpresasMOA, loadColaboradoresMOA, removeColabMOA, moaTrabAbrir, moaTrabEmpresaChange, moaTrabFotoChange, moaTrabFotoRemover, moaTrabGuardar, renderEmpresasMOA, editEmpresaMOA, saveEmpresaMOA, toggleEmpresaMOA, encAlugPassarTrabalhadores, encAlugVoltarA, encAlugAddTrabalhador, encAlugSubmeter, encAlugRemover, applyMOAFilter, navMOASemana, exportMOAExcel, initMOAFilters, moaEditRow, moaSaveRow, moaAnularRow, _moaClosePopover } from './modules/enc-aluguer.js';

// Produção
import { initProducao, renderProdDashboard, coGoList, coOpenDetail, renderPrevFat, editPrevFat, savePrevFat, deletePrevFat, deletePrevFatFromDetail, editPrevFatFromDetail, renderAutos, editAuto, saveAuto, deleteAuto, deleteAutoFromDetail, editAutoFromDetail, clearCustoObra, custoHandleDrop, obraImportCustos, obraCustosHandleDrop, saveObraExtra } from './modules/producao.js';

// Admin/Painel
import { renderPainel, renderFechoMes, exportFechoMes } from './modules/admin.js';

// Fornecedores
import { sbLoadFornecedores, renderFornecedores, openModalFornecedor, saveFornecedor, apagarFornecedor, exportFornecedoresXLSX, fornPag, editarFornecedor } from './modules/fornecedores.js';

// Mapas comparativos
import { sbLoadMapasComp, renderMapasComp, openModalMapa, openModalMapaFromLPU, editarMapaComp, adicionarFornecedorMapa, removerFornecedorMapa, adicionarLinhaMapa, removerLinhaMapa, atualizarValorFornMapa, uploadListaMapaSecos, uploadListaMapaSecosFile, uploadProposta, uploadPropostaFile, mprToggleSel, mprSetLinha, mprUpdateCount, confirmarPropostaReview, saveMapaComp, apagarMapaComp, abrirMapaComparativo, abrirResumoMapa, exportResumoPDF, injectMapaCompBtns } from './modules/mapas-comp.js';

// Dropbox
import { dropboxInit, dropboxLogin, dropboxLogout, dropboxIsConnected } from './modules/dropbox.js';

// Férias
import { renderMapaFerias, feriasNavAno, feriasTogglePrevista, feriasToggleLock, feriasToggleFuncDropdown, feriasToggleFunc, feriasLimparFuncs } from './modules/ferias.js';

// Preços Unitários
import { initPrecosUnit, puGoList, puOpenObra, puOpenImport, puHandleFile, puHandleDrop, puDragOver, puDragLeave, puExportExcel, puLimpar, puEditCell, puToggleNota, puSaveNota, _puRefreshDetail, puToggleSelMode, puToggleArtigoSel, puToggleSelAll, puCriarMapaComp } from './modules/precos-unitarios.js';

// Advertências
import { openAdvertencias, closeAdvertencias, advShowForm, advShowLista, saveAdvertencia, advEliminar, advGerarPDF } from './modules/advertencias.js';

// Análise de dados (vista telemóvel)
import {
  renderAnalise, anlSetPeriodo, anlSetObra, anlResetObras,
  abrirPersonalizarAnalise, fecharPersonalizarAnalise, guardarPersonalizarAnalise, reporPersonalizarAnalise,
  anlCustomToggle, anlCustomMove,
} from './modules/analise.js';

// Pendentes Tavira (obras 49 e 53)
import { initPendentesTavira, ptAdicionar, ptAbrirRelatorio, ptFecharRelatorio, ptEnviarEmail } from './modules/pendentes-tavira.js';

// Lembretes (quadro Trello)
import { renderLembretes, lembretesOpenModal, lembretesCloseModal, lembretesSave, lembretesApagar, lembretesSelectCor, lembretesDragStart, lembretesDragEnd, lembretesDragOver, lembretesDrop } from './modules/lembretes.js';

// ── Registry R — permite que módulos chamem funções de outros módulos sem imports circulares ──
Object.assign(R, {
  carregarDados,
  mostrarDiag,
  initEnc,
  initAdmin,
  applyStoredPermissions, applyRolePermissions, loadPermissionsFromServer, renderPermMatrix,
  initNotifications, emitEvent, ntfOnInsert, renderCalWidget,
  ensurePushSubscription, applyPendingSection,
  renderPainel, renderFaturas, renderCompras, renderObras,
  renderColabs, renderUsers, renderEquipamentos,
  loadCombustivelAdmin, renderProdDashboard,
  renderFechoMes, applyFilter, renderEmpresasMOA,
  loadEmpresasMOA, loadColaboradoresMOA,
  initCompras, initMOAFilters,
  renderEncModsCheckboxes,
  renderAnalise, anlResetObras,
});

// ── Polyfill: expõe helpers globalmente para compatibilidade com HTML inline ──
window.fmt = fmt; window.fmtPT = fmtPT; window.calcH = calcH; window.fmtH = fmtH;
// Expõe S globalmente para os handlers inline dos modais (ex: onchange="S._mcLinhas[i].valor_seco=...")
window.S = S;

// ── Device detection ao carregar ──
applyDeviceClass();
window.addEventListener('resize', applyDeviceClass);

// ── QR Registration via URL param ──
initQrRegistration();

// ── Deep link de notificação push (?open=secção) ──
capturePendingSectionFromURL();

// ── Dropbox OAuth callback (se vier redirect de volta da Dropbox) ──
dropboxInit();

// ── Login com Enter ──
document.getElementById('lp')?.addEventListener('keypress', e => { if (e.key === 'Enter') doLogin(); });

// ── Sessão guardada — mantém o utilizador ligado ao reabrir a página ──
tentarSessaoGuardada();

// ── Expor todas as funções ao window para handlers HTML inline ──
Object.assign(window, {
  // Auth
  doLogin, doLogout,

  // Análise de dados (modo telemóvel)
  renderAnalise, anlSetPeriodo, anlSetObra,
  abrirPersonalizarAnalise, fecharPersonalizarAnalise, guardarPersonalizarAnalise, reporPersonalizarAnalise,
  anlCustomToggle, anlCustomMove,

  // Dropbox
  dropboxLogin, dropboxLogout, dropboxIsConnected,

  // Navegação admin
  goTo, toggleNavGrp, refreshPortal,

  // Modais genéricos
  openModal, closeModal,

  // Histórico / Ponto
  applyFilter, navSemana, exportHistSemana, exportMensal,
  switchFPTab, loadWeek,
  hpEditCell, hpPickReg, hpTipoChange, hpSaveCell, hpAnularCell, hpDeleteCell, _hpClosePopover,
  aprovarDiaPonto, retirarAprovacaoPonto,

  // MOA
  applyMOAFilter, navMOASemana, exportMOAExcel,
  moaEditRow, moaSaveRow, moaAnularRow, _moaClosePopover,

  // Obras
  renderObras, saveObra, editObra, toggleObra, novaObra, obrToggleHideInativas, saveObraExtra,

  // Colaboradores
  renderColabs, saveColab, editColab, toggleColab, colabToggleHideInativos,

  // Advertências
  openAdvertencias, closeAdvertencias, advShowForm, advShowLista, saveAdvertencia, advEliminar, advGerarPDF,

  // Utilizadores
  renderUsers, saveUser, editUser, switchUtilTab, onUserRoleChange,

  // Permissões
  savePermissions, resetPermissions, onPermChange,

  // Faturas
  handleFatFiles, renderFaturas, limparFatFiltros,
  editarFatura, saveFatura, apagarFatura, exportFaturasXLSX, carregarFaturas,
  aprovarFatura, rejeitarFatura,
  // Anotador visual
  openFatSel, fssClose, fssSetActive, fssTextClick, fssSave, _fssFatInputChange,

  // Compras
  renderCompras, editarCompra, saveCompra, apagarCompra,
  exportComprasXLSX, cmpSetView, abrirMapaPicker, fecharMapaPicker,
  geocodeSearch, confirmarLocalizacao, limparLocalizacao,
  cmpRenderArtPicker, cmpAddArtigo, cmpRemoveArtigo, cmpUpdateArtigoQty, cmpAddArtigoRapido,
  cmpAddForn, cmpRemoveForn,
  abrirListaMateriais, fecharListaMateriais, confirmarListaMateriais,
  uploadListaExcel, uploadListaExcelFile,
  cmpLstRender, cmpLstToggle, cmpLstRemoveSel, lstUpdateQty, cmpUpdateArtBtnBadge,
  abrirFornPicker, cmpFornPickerRender, cmpSelFornPicker,
  openCompraModal,

  // Empresas MOA
  saveEmpresaMOA, editEmpresaMOA, toggleEmpresaMOA,
  removeColabMOA, moaTrabAbrir, moaTrabEmpresaChange, moaTrabFotoChange, moaTrabFotoRemover, moaTrabGuardar,

  // Equipamentos
  renderEquipamentos, openEqModal, editEquipamento,
  saveEquipamento, apagarEquipamento, refreshEqMap,
  showQrCode, printQrCode, showEqHistorico, exportEquipamentosXLSX,
  openEqManut, addEqManut, toggleEqManut, removeEqManut,

  // QR Registration
  submitQrRegistration,

  // Combustível
  loadCombustivelAdmin, exportCombustivelXLSX,
  toggleCombView, renderCombObraCards,

  // Encarregado — navegação
  encVoltarHome, encGoMenuPonto, encGoFolhaPontoPlandese,
  encOpenWeatherModal, encCloseWeatherModal,
  encOpenPrazoModal, encClosePrazoModal,
  encGoFolhaPontoAluguer, encGoHistoricoEnc,
  encGoEquipamentos, encGoCombustivel,

  // Encarregado — ponto
  encPassarColaboradores, encVoltarScreen1,
  encAddColab, encRemColab, encSubmeterRegisto,
  encTimeChange, encTipoChange,
  adicionarTodosOntem, encLoadHistorico,

  // Encarregado — equipamentos QR
  encScanNovamente, submitEncEquipamento,

  // Encarregado — combustível
  encOpenFuelModal, encCloseFuelModal,
  encGoCombDeposito, encGoCombViatura,
  depSetMovimento, encSubmeterCombDeposito,
  combViaturaManual, combViaturaVoltarScanner, encSubmeterCombViatura,
  combAbrirPicker, combFecharPicker, combPickerRender, combPickerSetCat, combPickerUsarTexto,

  // Encarregado — aluguer
  encAlugPassarTrabalhadores, encAlugVoltarA,
  encAlugAddTrabalhador, encAlugSubmeter, encAlugRemover,

  // Preços Unitários
  initPrecosUnit, puGoList, puOpenObra,
  puOpenImport, puHandleFile, puHandleDrop, puDragOver, puDragLeave,
  puExportExcel, puLimpar, _puRefreshDetail,
  puEditCell, puToggleNota, puSaveNota,
  puToggleSelMode, puToggleArtigoSel, puToggleSelAll, puCriarMapaComp,

  // Produção / Controlo de Obras
  coGoList, coOpenDetail,
  editAutoFromDetail, deleteAutoFromDetail,
  editPrevFatFromDetail, deletePrevFatFromDetail,
  obraImportCustos, obraCustosHandleDrop, clearCustoObra,
  editPrevFat, deletePrevFat, savePrevFat,
  editAuto, deleteAuto, saveAuto,
  custoHandleDrop,
  exportSemanaExcel,

  // Notificações
  toggleNotifPanel, closeNotifPanel, notifClick, markAllRead,
  calMudarMes, calHoje, calSelDia, calNovoEvento, calAbrirEvento, calToggleDiaInteiro, calFecharModal, calGuardar, calApagar, calToggleConcluido, calSetVisib, calFiltrarPessoas, calTogglePessoa,
  ntfFiltro, renderNotifPage, ntfToggleLida, ntfApagar, ntfAbrir, ntfMarcarTodasLidas, ntfApagarLidas, ntfTogglePref,
  renderNotifSubs, toggleNotifSub,
  requestPushPermission,

  // Folha de Fecho
  renderFechoMes, exportFechoMes,

  // Fornecedores
  sbLoadFornecedores, renderFornecedores,
  openModalFornecedor, saveFornecedor, apagarFornecedor, exportFornecedoresXLSX,
  fornPag, editarFornecedor,

  // Mapas Comparativos
  sbLoadMapasComp, renderMapasComp,
  openModalMapa, openModalMapaFromLPU, editarMapaComp,
  adicionarFornecedorMapa, removerFornecedorMapa,
  adicionarLinhaMapa, removerLinhaMapa, atualizarValorFornMapa,
  uploadListaMapaSecos, uploadListaMapaSecosFile,
  uploadProposta, uploadPropostaFile, mprToggleSel, mprSetLinha, mprUpdateCount, confirmarPropostaReview,
  saveMapaComp, apagarMapaComp, abrirMapaComparativo, abrirResumoMapa, exportResumoPDF,
  criarMapaFromPedido: function() {
    const id = document.getElementById('mcmp-id').value;
    if (!id) return;
    closeModal('modal-compra');
    goTo('mapas-comparativos', document.getElementById('nav-mapas-comp'));
    setTimeout(() => openModalMapa(id), 300);
  },

  // Chat compras
  encGoComprasChat, chatSend, chatOnInput,

  // Férias
  renderMapaFerias, feriasNavAno, feriasTogglePrevista, feriasToggleLock, feriasToggleFuncDropdown, feriasToggleFunc, feriasLimparFuncs,

  // Pendentes Tavira
  ptAdicionar, ptAbrirRelatorio, ptFecharRelatorio, ptEnviarEmail,

  // Lembretes
  renderLembretes, lembretesOpenModal, lembretesCloseModal, lembretesSave, lembretesApagar,
  lembretesSelectCor, lembretesDragStart, lembretesDragEnd, lembretesDragOver, lembretesDrop,
});

// ── Settings panel ──────────────────────────────────────────────────────────
(function () {
  let open = false;

  window.toggleSettingsPanel = function () {
    const panel = document.getElementById('settings-panel');
    const wrap  = document.getElementById('settings-wrap');
    if (!panel || !wrap) return;
    open = !open;
    // Em telemóvel o painel abre em folha inferior, aberto pelo botão "Mais".
    // A app-bar tem backdrop-filter, o que a torna bloco de contenção dos
    // descendentes position:fixed (e ainda tem overflow:hidden) — o painel tem
    // de sair de lá para se posicionar face à janela.
    const destino = document.body.classList.contains('device-mobile') ? document.body : wrap;
    if (panel.parentElement !== destino) destino.appendChild(panel);
    panel.classList.toggle('open', open);
  };

  document.addEventListener('click', function (e) {
    if (!open) return;
    // #settings-panel testado à parte: em telemóvel já não vive dentro do wrap
    if (!e.target.closest('#settings-wrap') && !e.target.closest('#settings-panel') && !e.target.closest('#bnav-mais')) {
      open = false;
      document.getElementById('settings-panel')?.classList.remove('open');
    }
  });
})();

// ── Modo escuro retirado: limpa a preferência antiga guardada no browser ──
try { localStorage.removeItem('plandese-dark-mode'); } catch (e) {}

// ── Profile modal ─────────────────────────────────────────────────────────────
window.openProfileModal = function () {
  const u = S.currentUser;
  if (!u) return;
  document.getElementById('perfil-av-badge').textContent = u.initials || '';
  document.getElementById('perfil-nome-display').textContent = u.nome || '';
  document.getElementById('perfil-role-display').textContent = u.role || '';
  document.getElementById('perfil-nome-input').value = u.nome || '';
  document.getElementById('perfil-senha').value = '';
  document.getElementById('perfil-senha2').value = '';
  document.getElementById('modal-perfil').classList.add('open');
};

window.closePerfil = function () {
  document.getElementById('modal-perfil').classList.remove('open');
};

window.savePerfil = async function () {
  const nome = document.getElementById('perfil-nome-input').value.trim();
  const pass = document.getElementById('perfil-senha').value;
  const pass2 = document.getElementById('perfil-senha2').value;
  if (!nome) { showToast('Introduza um nome'); return; }
  if (pass) { const v = validarPassword(pass, pass2); if (v) { showToast(v); return; } }
  const u = S.currentUser;
  if (!u) return;
  u.nome = nome;
  const initials = nome.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  u.initials = initials;
  document.getElementById('u-nm').textContent = nome;
  document.getElementById('u-av').textContent = initials;
  if (pass) {
    const erro = await trocarPropriaPassword(pass);
    if (erro) { showToast(erro); return; }
  }
  closePerfil();
  showToast('Perfil actualizado');
};

// ── Hooks goTo: inicializa cada secção quando navegada ──
(function () {
  const _orig = window.goTo;
  window.goTo = function (id, btn) {
    // Barreira central de segurança: qualquer entrada (sidebar, painel, notificações,
    // atalhos, chamadas programáticas) passa por aqui e é recusada sem permissão.
    if (!canAccessSection(id)) {
      showToast('🔒 Sem permissão para aceder a esta secção');
      return;
    }
    _orig(id, btn);
    if (id === 'analise')      { renderAnalise(); }
    if (id === 'painel')       { renderPainel(); }
    if (id === 'faturas')      { seedFaturasDemo(); setupFatDropzone(); carregarTemplatesFaturas(); renderFaturas(); atualizaKPIs(); }
    if (id === 'compras')      { populaCmpObras(); renderCompras(); injectMapaCompBtns(); }
    if (id === 'equipamentos') { initEquipamentos(); }
    if (id === 'combustivel')  { _initCombustivelAdmin(); }
    if (id === 'fecho-mes')    { renderFechoMes(); }
    if (id === 'producao')          { renderProdDashboard(); }
    if (id === 'precos-unitarios')  { initPrecosUnit(); }
    if (id === 'fornecedores') { sbLoadFornecedores().then(() => renderFornecedores()); }
    if (id === 'mapas-comparativos') { sbLoadMapasComp().then(() => renderMapasComp()); }
    if (id === 'mapa-ferias')        { renderMapaFerias(); }
    if (id === 'pendentes-tavira')   { initPendentesTavira(); }
    if (id === 'notificacoes')       { initNotifPage(); }
    if (id === 'calendario')         { initCalendario(); }
  };
})();

// ── Modo de visualização (telemóvel / computador) ───────────────────
// Reabre o ecrã de escolha e leva o utilizador à vista adequada ao modo.
window.escolherModoDispositivo = async function () {
  const anterior = getDeviceMode();
  const modo = await showDeviceChooser();
  if (modo === anterior) return;
  const secAtiva = document.querySelector('.section.active');
  const idAtiva = secAtiva ? secAtiva.id.replace(/^sec-/, '') : '';
  if (modo === 'mobile' && idAtiva === 'painel') window.goTo('analise', document.getElementById('bnav-analise'));
  else if (modo === 'desktop' && idAtiva === 'analise') window.goTo('painel', document.getElementById('nav-painel'));
};

// ── Badge de compras ao iniciar ──
setTimeout(() => { try { atualizaKPIsCompras(); } catch (e) {} }, 500);

// ── Datetime widget ──
(function () {
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const MESES_ABR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  let calVisible = null;
  let calYear, calMonth;

  function pad(n) { return String(n).padStart(2, '0'); }

  function updateClocks() {
    const now = new Date();
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dateStr = `${DIAS[now.getDay()]}, ${now.getDate()} ${MESES_ABR[now.getMonth()]} ${now.getFullYear()}`;
    ['enc', 'adm'].forEach(function (s) {
      const c = document.getElementById('dw-clock-' + s);
      const d = document.getElementById('dw-date-' + s);
      if (c) c.textContent = timeStr;
      if (d) d.textContent = dateStr;
    });
  }

  function renderCal(suffix) {
    const cal = document.getElementById('dw-cal-' + suffix);
    if (!cal) return;
    const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const today = new Date();
    const y = calYear, m = calMonth;
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    let html = `<div class="dw-cal-hdr">
      <button class="dw-cal-nav" onclick="dwNavCal('${suffix}',-1)">&#8592;</button>
      <span class="dw-cal-title">${MESES[m]} ${y}</span>
      <button class="dw-cal-nav" onclick="dwNavCal('${suffix}',1)">&#8594;</button>
    </div>
    <div class="dw-cal-grid">
      <div class="dw-cal-dow">Dom</div><div class="dw-cal-dow">Seg</div><div class="dw-cal-dow">Ter</div>
      <div class="dw-cal-dow">Qua</div><div class="dw-cal-dow">Qui</div><div class="dw-cal-dow">Sex</div><div class="dw-cal-dow">Sáb</div>`;
    for (var i = 0; i < firstDow; i++) html += '<div class="dw-cal-empty"></div>';
    for (var d = 1; d <= daysInMonth; d++) {
      const isToday = d === today.getDate() && m === today.getMonth() && y === today.getFullYear();
      html += `<button class="dw-cal-day${isToday ? ' today' : ''}">${d}</button>`;
    }
    html += '</div>';
    cal.innerHTML = html;
  }

  window.dwToggleCal = function (suffix) {
    const cal = document.getElementById('dw-cal-' + suffix);
    const dateEl = document.getElementById('dw-date-' + suffix);
    if (!cal || !dateEl) return;
    if (calVisible === suffix) {
      cal.style.display = 'none'; calVisible = null;
    } else {
      if (calVisible) { const other = document.getElementById('dw-cal-' + calVisible); if (other) other.style.display = 'none'; }
      const now = new Date(); calYear = now.getFullYear(); calMonth = now.getMonth();
      renderCal(suffix);
      // Centra o calendário por baixo da data. O backdrop-filter da .dw-wrap faz dela o
      // containing block do position:fixed, por isso desconta-se a origem real medida.
      const anchor = cal.closest('.dw-wrap') || dateEl;
      const rect = anchor.getBoundingClientRect();
      cal.style.right = 'auto';
      cal.style.left = '0px'; cal.style.top = '0px';
      cal.style.display = 'block';
      const origin = cal.getBoundingClientRect();
      const w = cal.offsetWidth;
      const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 8);
      cal.style.left = (left - origin.left) + 'px';
      cal.style.top = (rect.bottom + 8 - origin.top) + 'px';
      calVisible = suffix;
    }
  };

  window.dwNavCal = function (suffix, dir) {
    calMonth += dir;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    if (calMonth < 0)  { calMonth = 11; calYear--; }
    renderCal(suffix);
  };

  document.addEventListener('click', function (e) {
    if (calVisible && !e.target.closest('.dw-wrap')) {
      const cal = document.getElementById('dw-cal-' + calVisible);
      if (cal) cal.style.display = 'none';
      calVisible = null;
    }
  });

  updateClocks();
  setInterval(updateClocks, 1000);
})();
