// ═══════════════════════════════════════
//  M-ART — ilustração e ícones da app mobile (administração)
// ═══════════════════════════════════════

// Ícones de traço (24×24, herdam a cor do texto)
const svg = (p, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${p}</svg>`;

export const I = {
  menu:     svg('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  bell:     svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  back:     svg('<path d="m15 18-6-6 6-6"/>'),
  close:    svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  help:     svg('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
  search:   svg('<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.3-4.3"/>'),
  star:     svg('<path d="M12 2.8l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.7l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z"/>'),
  starFill: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.8l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.7l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z"/></svg>',
  grid:     svg('<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>'),
  userCirc: svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3.2"/><path d="M5.8 19c1.6-2.6 3.6-3.7 6.2-3.7s4.6 1.1 6.2 3.7"/>'),
  user:     svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  chev:     svg('<path d="m9 18 6-6-6-6"/>'),
  plus:     svg('<path d="M12 5v14M5 12h14"/>'),
  nav:      svg('<path d="M3 11 22 2l-9 19-2-8z"/>'),
  chat:     svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  gear:     svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  logout:   svg('<circle cx="12" cy="12" r="10"/><path d="M7.5 12h9M13 8.2l3.8 3.8-3.8 3.8"/>'),
  refresh:  svg('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>'),
  chart:    svg('<path d="M18 20V10M12 20V4M6 20v-6"/>'),
  arrowUR:  svg('<path d="M7 17 17 7M8 7h9v9"/>'),
  monitor:  svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  sliders:  svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  building: svg('<path d="M3 21h18M5 21V8l7-4.5L19 8v13"/><path d="M9 21v-5h6v5M9 11h.01M15 11h.01M9 14h.01M15 14h.01"/>'),
  clock:    svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
};

// Ilustração do estado vazio: capacete + percurso até um ponto de obra com estrela
// (equivalente ao comboio + percurso + estrela da app da CP)
export const ART_VAZIO = `<svg class="m-art" viewBox="0 0 420 290" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="212" cy="140" r="88" fill="#f3f5f8" stroke="none"/>
  <path d="M26 232h26M66 232h20" stroke="#2f5fc4" stroke-width="3.5"/>
  <path d="M86 232h224" stroke="#2f5fc4" stroke-width="3.5"/>
  <path d="M322 232h20M356 232h28" stroke="#2f5fc4" stroke-width="3.5"/>
  <g stroke="#3a4150" stroke-width="4.5">
    <path d="M122 214v-34c0-32 24-56 54-56s54 24 54 56v34"/>
    <rect x="104" y="214" width="144" height="15" rx="7.5" fill="#fff"/>
    <path d="M176 124v34M152 132v22M200 132v22"/>
    <path d="M140 196h72" stroke-width="3.5"/>
  </g>
  <g stroke="#3a4150" stroke-width="4.5">
    <path d="M262 168c34-18 62 8 40 28-22 20-8 36 24 34h22"/>
    <circle cx="266" cy="188" r="5" fill="#fff"/>
  </g>
  <g stroke="#3a4150" stroke-width="4.2">
    <path d="M300 118s-31-26-31-50a31 31 0 1 1 62 0c0 24-31 50-31 50z" fill="#fff"/>
  </g>
  <polygon points="300,52 304.6,63.6 317,64.4 307.4,72.4 310.6,84.4 300,77.6 289.4,84.4 292.6,72.4 283,64.4 295.4,63.6" fill="none" stroke="#2f5fc4" stroke-width="3.6"/>
</svg>`;

export const emptyHtml = (titulo, texto) =>
  `<div class="m-empty">${ART_VAZIO}<h3>${titulo}</h3><p>${texto}</p></div>`;
