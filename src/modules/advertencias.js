// ═══════════════════════════════════════
//  ADVERTÊNCIAS — Registo e PDF
// ═══════════════════════════════════════
import { sb } from '../supabase.js';
import { S } from '../state.js';

const TIPOS = [
  'Falta sem aviso',
  'Falta com aviso fora do prazo',
  'Atraso injustificado',
  'Incumprimento de normas de segurança',
  'Comportamento inadequado',
  'Incumprimento de ordens',
  'Outro',
];

let _colabN = null;
let _advertencias = [];

// ── Supabase ─────────────────────────────
async function sbLoadAdvertencias(colabN) {
  try {
    const { data } = await sb.from('advertencias')
      .select('*')
      .eq('colab_numero', colabN)
      .order('data', { ascending: false });
    return data || [];
  } catch (e) {
    console.warn('Erro ao carregar advertências:', e);
    return [];
  }
}

async function sbSaveAdvertencia(rec) {
  const { data, error } = await sb.from('advertencias').insert({
    colab_numero: rec.colabN,
    data: rec.data,
    tipo: rec.tipo,
    descricao: rec.descricao || null,
  }).select().single();
  if (error) throw error;
  return data;
}

async function sbDeleteAdvertencia(id) {
  await sb.from('advertencias').delete().eq('id', id);
}

// ── Abrir modal ──────────────────────────
export async function openAdvertencias(colabN) {
  _colabN = colabN;
  const colab = S.COLABORADORES.find(c => c.n === colabN);
  if (!colab) return;

  document.getElementById('adv-colab-nome').textContent = `${colab.n} — ${colab.nome}`;
  document.getElementById('adv-data').value = new Date().toISOString().slice(0, 10);
  document.getElementById('adv-tipo').value = TIPOS[0];
  document.getElementById('adv-desc').value = '';

  _advertencias = await sbLoadAdvertencias(colabN);
  _renderLista();
  _showView('lista');

  document.getElementById('modal-advertencias').classList.add('open');
}

export function closeAdvertencias() {
  document.getElementById('modal-advertencias').classList.remove('open');
}

// ── Vistas ───────────────────────────────
function _showView(view) {
  document.getElementById('adv-view-lista').style.display = view === 'lista' ? '' : 'none';
  document.getElementById('adv-view-form').style.display  = view === 'form'  ? '' : 'none';
}

export function advShowForm() { _showView('form'); }
export function advShowLista() { _showView('lista'); }

// ── Render lista ─────────────────────────
function _renderLista() {
  const cont = document.getElementById('adv-lista');
  if (!_advertencias.length) {
    cont.innerHTML = '<div style="text-align:center;color:var(--gray-400);padding:32px 0;font-size:14px">Nenhuma advertência registada</div>';
    return;
  }
  cont.innerHTML = _advertencias.map(a => {
    const dtFmt = a.data ? new Date(a.data + 'T00:00:00').toLocaleDateString('pt-PT') : '—';
    return `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid var(--gray-100)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px;color:var(--gray-800)">${a.tipo}</div>
        <div style="font-size:12px;color:var(--gray-400);margin-top:2px">${dtFmt}</div>
        ${a.descricao ? `<div style="font-size:12px;color:var(--gray-600);margin-top:4px">${a.descricao}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-secondary btn-sm" onclick="advGerarPDF('${a.id}')">PDF</button>
        <button class="btn btn-sm" style="background:var(--red-bg,#FEE2E2);color:#B91C1C;border:1px solid #FECACA" onclick="advEliminar('${a.id}')">Apagar</button>
      </div>
    </div>`;
  }).join('');
}

// ── Guardar advertência ──────────────────
export async function saveAdvertencia() {
  const data  = document.getElementById('adv-data').value;
  const tipo  = document.getElementById('adv-tipo').value;
  const desc  = document.getElementById('adv-desc').value.trim();
  if (!data || !tipo) { alert('Preencha a data e o tipo.'); return; }
  try {
    const saved = await sbSaveAdvertencia({ colabN: _colabN, data, tipo, descricao: desc });
    _advertencias.unshift(saved);
    _renderLista();
    _showView('lista');
    const colab = S.COLABORADORES.find(c => c.n === _colabN);
    await _gerarCartaAdvertencia(saved, colab);
  } catch (e) {
    alert('Erro ao guardar: ' + e.message);
  }
}

// ── Eliminar ─────────────────────────────
export async function advEliminar(id) {
  if (!confirm('Eliminar esta advertência?')) return;
  await sbDeleteAdvertencia(id);
  _advertencias = _advertencias.filter(a => a.id !== id);
  _renderLista();
}

// ── Gerar PDF ────────────────────────────
export async function advGerarPDF(id) {
  const adv = _advertencias.find(a => a.id === id);
  const colab = S.COLABORADORES.find(c => c.n === _colabN);
  if (!adv || !colab) return;
  await _gerarCartaAdvertencia(adv, colab);
}

async function _gerarCartaAdvertencia(adv, colab) {
  if (!window.jspdf) { alert('Biblioteca PDF não carregada.'); return; }
  const { jsPDF } = window.jspdf;

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();   // 210
  const H = pdf.internal.pageSize.getHeight();  // 297

  const margin = 25;
  const innerW = W - margin * 2;

  // ── Cor principal ──
  const BLUE  = [13, 71, 161];
  const GRAY7 = [55, 65, 81];
  const GRAY4 = [156, 163, 175];
  const BLACK = [17, 24, 39];

  // ── Linha de topo colorida ──
  pdf.setFillColor(...BLUE);
  pdf.rect(0, 0, W, 6, 'F');

  // ── Logo ──
  let logoY = 16;
  try {
    const logoImg = await _loadImageAsDataURL('/plandese_logo.png');
    const logoH = 16;
    const logoW = logoH; // quadrado
    pdf.addImage(logoImg, 'PNG', margin, logoY, logoW, logoH);
  } catch (_) {}

  // ── Nome e info empresa (à direita) ──
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...BLUE);
  pdf.text('PLANDESE, SA', W - margin, logoY + 4, { align: 'right' });
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...GRAY4);
  pdf.text('NIF: 504 XXX XXX  ·  geral@plandese.pt', W - margin, logoY + 9, { align: 'right' });
  pdf.text('R. das Flores, n.º 1, 2400-000 Leiria', W - margin, logoY + 14, { align: 'right' });

  // ── Linha separadora ──
  const sepY = logoY + 22;
  pdf.setDrawColor(...BLUE);
  pdf.setLineWidth(0.4);
  pdf.line(margin, sepY, W - margin, sepY);

  // ── Data e local ──
  const dataAdv = new Date(adv.data + 'T00:00:00');
  const dtStr = dataAdv.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' });
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...GRAY7);
  pdf.text(`Leiria, ${dtStr}`, W - margin, sepY + 8, { align: 'right' });

  // ── Destinatário ──
  let y = sepY + 20;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...BLACK);
  pdf.text('Exmo. Sr.', margin, y);
  y += 5.5;
  pdf.setFont('helvetica', 'normal');
  pdf.text(colab.nome, margin, y);
  y += 5;
  pdf.text(`Colaborador n.º ${colab.n}  ·  ${colab.func}`, margin, y);

  // ── Título da carta ──
  y += 16;
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...BLUE);
  pdf.text('CARTA DE ADVERTÊNCIA', W / 2, y, { align: 'center' });
  y += 4;
  pdf.setDrawColor(...BLUE);
  pdf.setLineWidth(0.6);
  const titW = pdf.getTextWidth('CARTA DE ADVERTÊNCIA');
  pdf.line(W / 2 - titW / 2, y, W / 2 + titW / 2, y);

  // ── Assunto ──
  y += 10;
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...GRAY7);
  pdf.text('Assunto: ', margin, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...BLACK);
  pdf.text(adv.tipo, margin + pdf.getTextWidth('Assunto: '), y);

  // ── Corpo ──
  y += 10;
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...BLACK);

  const intro = `Por meio da presente, a Plandese, SA, vem notificar V. Exa. de que, em ${dtStr}, ` +
    `foi verificada a seguinte ocorrência: ${adv.tipo}.`;

  const linhasIntro = pdf.splitTextToSize(intro, innerW);
  pdf.text(linhasIntro, margin, y);
  y += linhasIntro.length * 5.5 + 4;

  if (adv.descricao) {
    const descLabel = 'Descrição/Observações:';
    pdf.setFont('helvetica', 'bold');
    pdf.text(descLabel, margin, y);
    y += 5.5;
    pdf.setFont('helvetica', 'normal');
    const linhasDesc = pdf.splitTextToSize(adv.descricao, innerW);
    pdf.text(linhasDesc, margin, y);
    y += linhasDesc.length * 5.5 + 4;
  }

  const corpo2 = 'A presente advertência fica registada no seu processo individual, devendo V. Exa. tomar conhecimento ' +
    'e tomar as diligências necessárias para que situações desta natureza não se repitam. ' +
    'O incumprimento reiterado poderá implicar sanções disciplinares mais gravosas, nos termos do Código do Trabalho em vigor.';
  const linhasCorp2 = pdf.splitTextToSize(corpo2, innerW);
  pdf.text(linhasCorp2, margin, y);
  y += linhasCorp2.length * 5.5 + 4;

  const fecho = 'Sem outro assunto, apresentamos os melhores cumprimentos.';
  pdf.text(fecho, margin, y);

  // ── Assinaturas ──
  y += 22;
  const col1 = margin;
  const col2 = W / 2 + 5;

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...GRAY7);

  // Empresa
  pdf.line(col1, y, col1 + 70, y);
  y += 5;
  pdf.text('A Administração / Recursos Humanos', col1, y);
  y += 4;
  pdf.text('Plandese, SA', col1, y);

  // Colaborador
  y -= 9;
  pdf.line(col2, y, col2 + 70, y);
  y += 5;
  pdf.text('O Colaborador', col2, y);
  y += 4;
  pdf.text(colab.nome, col2, y);
  y += 4;
  pdf.text(`(Nº ${colab.n})`, col2, y);

  // ── Rodapé ──
  const footY = H - 14;
  pdf.setFillColor(...BLUE);
  pdf.rect(0, footY, W, 14, 'F');
  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(255, 255, 255);
  pdf.text('Plandese, SA  ·  Documento de uso interno  ·  Confidencial', W / 2, footY + 5.5, { align: 'center' });
  pdf.text(`Gerado em ${new Date().toLocaleDateString('pt-PT')} pelo Portal Plandese`, W / 2, footY + 10, { align: 'center' });

  // ── Número do documento ──
  pdf.setFontSize(7);
  pdf.setTextColor(...GRAY4);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Ref: ADV-${colab.n}-${adv.id.slice(0,8).toUpperCase()}`, margin, footY - 2);

  const filename = `Advertencia_${colab.nome.replace(/ /g,'_')}_${adv.data}.pdf`;
  pdf.save(filename);
}

function _loadImageAsDataURL(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ── Preencher select de tipos ─────────────
export function populateAdvTipos() {
  const sel = document.getElementById('adv-tipo');
  if (!sel || sel.options.length > 1) return;
  sel.innerHTML = TIPOS.map(t => `<option>${t}</option>`).join('');
}
