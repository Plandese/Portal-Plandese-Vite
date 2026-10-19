# Portal Plandese — regras do projeto

## Design: tudo o que é novo usa o design novo do portal

Qualquer ecrã, janela, página ou componente **novo** (ou mexido de forma relevante) deve usar o design novo, nunca o antigo (`btn-login`, `.field` genérico, `--blue-500`, cartões com sombra e cantos de 8px).

- **Cores e tokens** (`:root` em `src/styles/mobile-shell.css`): `--m-brand` (#173f9f), `--m-brand-d`, `--m-ink`, `--m-mute`, `--m-line`, `--m-safe-t/b`, `--m-logo-mask`.
- **Estrutura mobile / encarregados / páginas públicas**: cabeçalho azul `--m-brand` com círculos translúcidos (título 27px/800, subtítulo 14px) + **folha branca** com cantos de 24px em cima (`margin-top:-26px`). Referência: `src/styles/enc-shell.css` e a página pública do QR (`#qr-reg-screen`, classes `q-*`).
- **Campos**: rótulo 12px maiúsculas `#5d6678`; input/select 50px de altura, borda 1.5px `#b9c1ce`, raio 14px, texto 16px; foco com borda `--m-brand` + anel `rgba(23,63,159,.13)`.
- **Botões**: pílula (raio 99px), 52px de altura, 16.5px/600; primário `--m-brand` com texto branco, secundário branco com borda `--m-brand`.
- **Desktop**: seguir `src/styles/desktop-shell.css` (variáveis `--d-*`, cantos 22px, chips e etiquetas em pílula, painéis laterais de altura total com rodapé fixo).
- **Etiquetas de estado**: pílulas coloridas (`eq-est-badge`, `eq-prop-tag`); azul = Plandese, roxo = Aluguer, verde = ok, âmbar = atenção, vermelho = problema.
- Texto sempre em **português de Portugal**.
- Em dúvida, copiar o ecrã equivalente mais recente em vez de inventar estilos.

## Convenções técnicas

- Handlers inline (`onclick=`/`onchange=`) só funcionam se a função estiver em `Object.assign(window, …)` no `src/app.js`.
- `faturas.js`: nunca `export function`; só o bloco `export{}` no fim.
- Tabelas novas no Supabase precisam de RLS e policies (ver `fn_cap(...)`); páginas públicas só via RPC `security definer`.
- Projeto Supabase correto: `zcigwqvqmqatcivkrrsw`.
- Depois de cada tarefa: commit e push.
