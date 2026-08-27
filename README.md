# AutoCalendar

Sincroniza o emploi du temps ENSTA Bretagne (FISE 2A) com o **Google Calendar**.

Há duas formas de usar:

| | CLI (Python) | Web (Next.js) |
|---|---|---|
| Onde | pasta raiz | pasta `web/` |
| Arquivo ODS | lido do disco | drag-and-drop no navegador |
| Login Google | `credentials.json` (Desktop) | OAuth Web (cada usuário na própria conta) |

A versão web **não usa** o calendário principal: cria um calendário secundário. Se algo der errado, apague esse calendário no [Google Agenda (desktop)](https://calendar.google.com) → Configurações → o calendário → Excluir.

---

## Rodar local — CLI (Python)

1. Python 3 + dependências:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Credenciais OAuth **Desktop**: siga `SETUP_GUIDE.md` e coloque `credentials.json` na raiz.

3. Rode:

```powershell
python main.py --option ROB --dry-run
python main.py --option ROB --sync
```

---

## Rodar local — Web

1. Crie um OAuth Client do tipo **Web application** (não Desktop) no [Google Cloud Console](https://console.cloud.google.com/apis/credentials).

   Redirect URIs:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://SEU-PROJETO.vercel.app/api/auth/callback/google` (depois do deploy)

   Ative a **Google Calendar API**.

2. Variáveis de ambiente:

```powershell
cd web
copy .env.example .env.local
```

Preencha no `.env.local`:

| Variável | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID (tipo Web) |
| `GOOGLE_CLIENT_SECRET` | Client Secret |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `http://localhost:3000` |

3. Suba o servidor:

```powershell
cd web
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

O `.ods` é parseado **no navegador** — não é enviado ao servidor.

---

## Deploy na Vercel

O Next.js está em `web/`. O GitHub aponta para a **raiz** do repo, então o projeto Vercel precisa da pasta certa.

### 1. Conectar o Git

No [dashboard Vercel](https://vercel.com) → Add New → Project → `gustavo-bm/AutoCalendar`.

### 2. Root Directory (obrigatório)

**Settings → General → Root Directory** = `web`  
Salve. Sem isso o build falha (a raiz não é um app Next.js).

Não coloque `rootDirectory` em `vercel.json` — a Vercel rejeita essa propriedade.

### 3. Variáveis de ambiente

**Settings → Environment Variables** (Production + Preview):

| Variável | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | mesmo Client ID Web |
| `GOOGLE_CLIENT_SECRET` | mesmo Secret |
| `NEXTAUTH_SECRET` | um secret aleatório (`openssl rand -base64 32`) |
| `NEXTAUTH_URL` | URL de produção, ex. `https://auto-calendar.vercel.app` |

### 4. Google OAuth (produção)

No Client ID Web, adicione o redirect:

`https://auto-calendar.vercel.app/api/auth/callback/google`

(troque pelo domínio real do projeto)

### 5. Publicar

Depois de alterar Root Directory / env vars, faça **Redeploy** no dashboard, ou:

```powershell
git add -A
git commit -m "Fix Vercel deploy for web app"
git push
```

Cada `git push` em `main` dispara um deploy.

### 6. CLI (opcional, sem Git)

```powershell
cd web
npx vercel login
npx vercel --prod
```

Rode isso **dentro de `web/`**, não na raiz do repositório.
