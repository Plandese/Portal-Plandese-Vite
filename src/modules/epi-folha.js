// ═══════════════════════════════════════
//  FOLHA DE DISTRIBUIÇÃO DE EPI — impressão a partir da ficha do colaborador
//  Refeita a partir do modelo em papel («EPI's Modelo.pdf»): cada artigo só tem datas
//  (receção trabalhador / chefia / devolução); por baixo dos artigos há uma caixa com
//  as assinaturas gerais (trabalhador e chefia) e no fim a declaração com a assinatura
//  do trabalhador. Nome, nº interno, função e data vêm preenchidos (data = hoje).
// ═══════════════════════════════════════

const ARTIGOS = [
  ['Capacete', '2, 8, 12'],
  ['Botas c/ biqueira de aço', '4, 7'],
  ['Colete refletor', '20'],
  ['Luvas de proteção', '7, 17'],
  ['', ''],
  ['', ''],
];
const RISCOS_A = ['Quedas ao mesmo nível', 'Queda de objetos', 'Queda por esmagamento', 'Esmagamento das extremidades (mãos/pés)', 'Cortes', 'Entalamentos', 'Corte por objetos pontiagudos ou cortantes', 'Impacto (choque) com objetos', 'Exposição ao ruído', 'Exposição a poeiras', 'Exposição a intensidades luminosas desadequadas'];
const RISCOS_B = ['Pancadas na cabeça', 'Projeção de estilhaços', 'Projeção de partículas', 'Eletrocussão', 'Queimaduras', 'Contacto com substâncias perigosas', 'Exposição a radiações', 'Exposição a atmosferas com oxigénio rarefeito', 'Propensão para acidentes'];

const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const hojePT = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };

function htmlFolha({ nome, numero, funcao }){
  const hoje = hojePT();
  const vazio = '<span class="ln"></span>';
  const data = v => `<span class="dt">Data: ${v ? `<b>${v}</b>` : '___/___/______'}</span>`;
  const linhas = ARTIGOS.map(([art, risc]) => `<tr>
      <td class="art">${esc(art)}</td><td class="c">${esc(risc)}</td>
      <td>${data(art ? hoje : '')}</td><td>${data(art ? hoje : '')}</td><td>${data('')}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8"><title>Distribuição de EPI — ${esc(nome)}</title>
<style>
  @page{size:A4;margin:12mm 13mm}
  *{box-sizing:border-box}
  body{margin:0;font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11.5pt;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sup{text-align:center;color:#9aa3b5;letter-spacing:.06em;font-size:12pt;margin:0 0 3mm}
  .fl{border:1.2px solid #222}
  .row{display:flex;border-bottom:1px solid #222}
  .cab{align-items:center;padding:3mm 4mm;position:relative;min-height:20mm}
  .cab .tt{flex:1;text-align:center}
  .cab .tt b{display:block;font-size:14pt}
  .cab .tt span{font-weight:700;font-size:11.5pt}
  .logo{display:flex;align-items:center;gap:2mm;position:absolute;right:5mm;top:50%;transform:translateY(-50%)}
  .logo img{height:12mm}
  .logo span{font-weight:600;letter-spacing:.04em;font-size:12pt;color:#1d2a5c}
  .cp{padding:2mm 3mm;font-weight:700}
  .cp i{font-style:normal;font-weight:400;margin-left:2mm}
  .cp.n{flex:0 0 52mm;border-left:1px solid #222}
  table{width:100%;border-collapse:collapse}
  th,td{border:1px solid #222;padding:2mm 2.5mm;vertical-align:middle}
  table tr>*:first-child{border-left:0} table tr>*:last-child{border-right:0}
  thead th{font-weight:700;text-align:center;font-size:11pt}
  thead small{display:block;font-size:7.5pt;font-weight:600}
  th.sub{font-weight:600;font-size:10pt;padding:1.2mm}
  td.art{font-weight:700;height:11mm}
  td.c{text-align:center;font-weight:700}
  .dt{white-space:nowrap;font-size:10.5pt}
  .dt b{font-weight:600}
  .ass{display:flex;border-bottom:1px solid #222}
  .ass>div{flex:1;padding:2.5mm 3mm 3mm}
  .ass>div+div{border-left:1px solid #222}
  .ass small{display:block;font-weight:700;font-size:10pt;margin-bottom:11mm}
  .ass .ln{display:block;border-top:1px solid #444;margin:0 4mm}
  .tit{text-align:center;font-weight:700;padding:1.5mm;border-bottom:1px dashed #555}
  .riscos{display:flex;font-size:10pt;line-height:1.35;border-bottom:1px solid #222}
  .riscos ol{margin:0;padding:2mm 3mm;list-style:none;flex:1}
  .riscos ol+ol{border-left:1px dashed #555}
  .dec{padding:3mm 6mm 6mm;text-align:center}
  .dec h4{margin:1mm 0 3mm;font-size:12pt}
  .dec p{margin:0 0 7mm;line-height:1.45}
  .dec .fim{display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;font-weight:700;text-align:left}
  .dec .fim .a{flex:1;display:flex;align-items:flex-end;gap:2mm}
  .dec .fim .a .ln{flex:1;border-bottom:1px solid #444;height:0}
</style></head><body>
  <p class="sup">REGISTO DE DISTRIBUIÇÃO DE EPI</p>
  <div class="fl">
    <div class="row cab">
      <div class="tt"><b>DISTRIBUIÇÃO DE EPI</b><span>(Equipamento de Proteção Individual)</span></div>
      <div class="logo"><img src="${location.origin}/plandese_logo.png" alt=""><span>PLANDESE</span></div>
    </div>
    <div class="row"><div class="cp" style="flex:1">Nome do Trabalhador:<i>${esc(nome)}</i></div><div class="cp n">Número Interno:<i>${esc(numero)}</i></div></div>
    <div class="row"><div class="cp" style="flex:1">Função:<i>${esc(funcao || '')}</i></div></div>
    <table>
      <thead>
        <tr><th rowspan="2" style="width:30%">Designação do EPI</th><th rowspan="2" style="width:15%">Riscos (1)</th><th colspan="2">Receção do EPI</th><th rowspan="2" style="width:19%">Devolução<small>(quem recebe a devolução)</small></th></tr>
        <tr><th class="sub">Trabalhador</th><th class="sub">Chefia</th></tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>
    <div class="ass" style="border-top:0">
      <div><small>Assinatura do Trabalhador (receção dos EPI acima)</small>${vazio}</div>
      <div><small>Assinatura da Chefia</small>${vazio}</div>
    </div>
    <div class="tit">RISCOS A ELIMINAR/MINIMIZAR</div>
    <div class="riscos">
      <ol>${RISCOS_A.map((r, i) => `<li>${i + 1} ${r}</li>`).join('')}</ol>
      <ol>${RISCOS_B.map((r, i) => `<li>${i + 12} ${r}</li>`).join('')}<li>21 ________________________________</li></ol>
    </div>
    <div class="dec">
      <h4>DECLARAÇÃO</h4>
      <p>Declaro que recebi os Equipamentos de Proteção Individual acima mencionados, comprometendo-me a utilizá-los corretamente de acordo com as instruções recebidas, a observá-los e a mantê-los em bom estado, bem como a participar todas as avarias ou deficiências de que deles tenha conhecimento.</p>
      <div class="fim"><span>Data: <span style="font-weight:600">${hoje}</span></span><span class="a">Assinatura do Trabalhador: <span class="ln"></span></span></div>
    </div>
  </div>
</body></html>`;
}

// Imprime numa moldura escondida (sem janelas novas, não é bloqueado pelo navegador)
export function imprimirFolhaEPI(dados){
  document.getElementById('epi-print-frame')?.remove();
  const fr = document.createElement('iframe');
  fr.id = 'epi-print-frame';
  fr.setAttribute('aria-hidden', 'true');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(fr);
  const doc = fr.contentDocument;
  doc.open(); doc.write(htmlFolha(dados)); doc.close();
  let feito = false;
  const go = () => { if(feito) return; feito = true; try{ fr.contentWindow.focus(); fr.contentWindow.print(); }catch(e){ console.warn('imprimirFolhaEPI:', e); } };
  const img = doc.querySelector('img');
  if(img && !img.complete){ img.onload = img.onerror = go; setTimeout(() => { if(!img.complete) go(); }, 2500); }
  else setTimeout(go, 50);
}
export { htmlFolha as htmlFolhaEPI };
