// =======================================
//  UTILS - Funcoes auxiliares puras
// =======================================

export const fmt = (d) => d.toISOString().split('T')[0];

export const fmtPT = (s) => {
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

export const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

// Feriados nacionais de Portugal (fixos + móveis a partir da Páscoa)
const _feriadosCache = {};
function _pascoa(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, mes - 1, dia);
}
export function feriadosPT(y) {
  if (_feriadosCache[y]) return _feriadosCache[y];
  const k = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const p = _pascoa(y), add = (n) => { const x = new Date(p); x.setDate(x.getDate() + n); return x; };
  const m = {};
  [['01-01', 'Ano Novo'], ['04-25', 'Dia da Liberdade'], ['05-01', 'Dia do Trabalhador'],
   ['06-10', 'Dia de Portugal'], ['06-13', 'Santo António (Lisboa)'], ['08-15', 'Assunção de Nossa Senhora'], ['10-05', 'Implantação da República'],
   ['11-01', 'Todos os Santos'], ['12-01', 'Restauração da Independência'],
   ['12-08', 'Imaculada Conceição'], ['12-25', 'Natal']].forEach(([md, n]) => { m[`${y}-${md}`] = n; });
  m[k(add(-2))] = 'Sexta-feira Santa'; m[k(p)] = 'Páscoa'; m[k(add(60))] = 'Corpo de Deus';
  return (_feriadosCache[y] = m);
}
// Nome do feriado nacional (ou '') para uma data (Date local ou 'YYYY-MM-DD')
export function nomeFeriado(d) {
  if (typeof d === 'string') d = new Date(d + 'T12:00:00');
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return feriadosPT(d.getFullYear())[k] || '';
}
export const isFeriado = (d) => !!nomeFeriado(d);
// Dia sem horas normais: fim de semana ou feriado nacional (tudo conta como extra)
export const isNonWorkday = (d) => isWeekend(d) || isFeriado(d);

export function getMonday(d) {
  const c = new Date(d);
  const day = c.getDay(), diff = c.getDate() - day + (day === 0 ? -6 : 1);
  c.setDate(diff);
  return c;
}

export function dayShort(d) {
  return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][d.getDay()];
}

export function dayLong(d) {
  return d.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function calcH(ent, sai, dateObj) {
  if (!ent || !sai) return { n: 0, e: 0, t: 0 };
  const [eh, em] = ent.split(':').map(Number);
  const [sh, sm] = sai.split(':').map(Number);
  let m = (sh * 60 + sm) - (eh * 60 + em);
  if (m <= 0) return { n: 0, e: 0, t: 0 };
  const eM = eh * 60 + em, sM = sh * 60 + sm;
  if (eM < 780 && sM > 720) {
    const ov = Math.min(sM, 780) - Math.max(eM, 720);
    if (ov > 0) m -= ov;
  }
  if (m <= 0) return { n: 0, e: 0, t: 0 };
  const t = m / 60, we = isNonWorkday(dateObj);
  const n = we ? 0 : Math.min(t, 8), e = we ? t : Math.max(0, t - 8);
  const r = v => Math.round(v * 100) / 100;
  return { n: r(n), e: r(e), t: r(t) };
}

export const fmtH = (h) => {
  if (!h || h === 0) return '—';
  const hrs = Math.floor(h), m = Math.round((h - hrs) * 60);
  return hrs + 'h' + (m > 0 ? String(m).padStart(2, '0') : '');
};
