// Obtém o refresh token da Dropbox da empresa (executar UMA vez, com a conta que tem acesso às pastas).
//
//   node scripts/dropbox-refresh-token.mjs <APP_KEY>
//
// 1. Abre o link que o script mostra, entra com a conta Dropbox da empresa e clica "Permitir".
// 2. A Dropbox mostra um código — cola-o aqui.
// 3. O script imprime os comandos para guardar os segredos no Supabase.
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const appKey = process.argv[2];
if(!appKey){ console.error('Uso: node scripts/dropbox-refresh-token.mjs <APP_KEY>'); process.exit(1); }

const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());

const url = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
  client_id: appKey,
  response_type: 'code',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  token_access_type: 'offline',
});
console.log('\n1) Abra este link, autorize e copie o código:\n\n' + url + '\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question('2) Cole o código aqui: ')).trim();
rl.close();

const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ code, grant_type: 'authorization_code', code_verifier: verifier, client_id: appKey }),
});
const d = await r.json();
if(!r.ok || !d.refresh_token){ console.error('Falhou:', d); process.exit(1); }

console.log('\n3) Guarde os segredos no Supabase:\n');
console.log(`supabase secrets set DROPBOX_APP_KEY=${appKey} DROPBOX_REFRESH_TOKEN=${d.refresh_token} --project-ref zcigwqvqmqatcivkrrsw`);
console.log('\nScopes concedidos:', d.scope);
