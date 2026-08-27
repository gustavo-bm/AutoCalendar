# AutoCalendar

Sincroniza o emploi du temps ENSTA Bretagne (FISE 2A) com o **Google Calendar**.

Há duas formas de usar o mesmo repositório:

| | CLI (Python) | Web (Next.js) |
|---|---|---|
| Como | `python main.py` | `npm run dev` |
| Arquivo ODS | lido do disco | drag-and-drop no navegador |
| Login Google | `credentials.json` (Desktop) | OAuth Web (cada usuário na própria conta) |

A versão web **não usa** o calendário principal: cria um calendário secundário. Se algo der errado, apague esse calendário no [Google Agenda (desktop)](https://calendar.google.com) → Configurações → o calendário → Excluir.

Push em `main` publica o site na Vercel.

---

## Rodar local — CLI (Python)

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Credenciais OAuth **Desktop**: siga `SETUP_GUIDE.md` e coloque `credentials.json` na raiz.

```powershell
python main.py --option ROB --dry-run
python main.py --option ROB --sync
```

---

## Rodar local — Web

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie um OAuth Client do tipo **Web application** (não Desktop). Ative a **Google Calendar API**.

   Redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://auto-calendar.vercel.app/api/auth/callback/google` (produção; use o domínio real)

2. Variáveis:

```powershell
copy .env.example .env.local
```

| Variável | Local | Produção (Vercel) |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Client ID Web | igual |
| `GOOGLE_CLIENT_SECRET` | Client Secret | igual |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` | outro secret (ou o mesmo) |
| `NEXTAUTH_URL` | `http://localhost:3000` | `https://auto-calendar.vercel.app` |

3. Servidor:

```powershell
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

O `.ods` é parseado **no navegador** — não é enviado ao servidor.

A lógica da planilha no site está em TypeScript (`src/lib/`). Se mudar o parser Python, atualize também `src/lib/ods-parser.ts` (e filtro/sync) para o deploy web refletir a mudança.

---

## Deploy na Vercel

O Next.js está na **raiz** do repo. Conecte `gustavo-bm/AutoCalendar` e deixe o Root Directory **vazio** (`.`).

**Settings → Environment Variables** (Production + Preview):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL` = URL pública, ex. `https://auto-calendar.vercel.app`

Depois de configurar as env vars uma vez:

```powershell
git add -A
git commit -m "Sua mensagem"
git push
```

Cada push em `main` dispara o deploy.
