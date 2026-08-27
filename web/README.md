# AutoCalendar Web

Frontend para sincronizar o emploi du temps ENSTA FISE 2A com Google Calendar.

## Desenvolvimento local

```bash
cd web
cp .env.example .env.local
# Preencha GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET
npm install
npm run dev
```

Abra http://localhost:3000

## Google OAuth (obrigatório)

1. [Google Cloud Console](https://console.cloud.google.com/) → seu projeto
2. Ative **Google Calendar API**
3. OAuth Consent Screen → External 
4. Credentials → **Create OAuth Client ID** → tipo **Web application**
5. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (dev)
   - `https://SEU-DOMINIO.vercel.app/api/auth/callback/google` (prod)
6. Copie Client ID e Secret para `.env.local`

## Deploy na Vercel

Deploy a partir da pasta `web/` (não da raiz do repo):

```bash
cd web
npx vercel login
npx vercel
```

Quando perguntar **Connect Git repository?** → `no` (se der erro de permissão no GitHub).

Variáveis de ambiente no painel Vercel (Settings → Environment Variables):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_SECRET` — gere com `openssl rand -base64 32`
- `NEXTAUTH_URL` — ex: `https://auto-calendar.vercel.app`

Se conectar o Git depois: no painel Vercel → Settings → General → **Root Directory** = `web`.

## Segurança

- O arquivo `.ods` é processado **no navegador** — nunca enviado ao servidor
- Login OAuth direto com Google — sem armazenar senhas
- Cria calendário **secundário** — nunca toca no calendário principal
- Tooltip na UI explica como deletar o calendário no Google Agenda desktop
