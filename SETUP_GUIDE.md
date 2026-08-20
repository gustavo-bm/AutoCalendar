# ⚙️ Guia de Configuração: API do Google Calendar

Para que o **AutoCalendar** consiga criar eventos na sua agenda, ele precisa de permissão de acesso à sua conta do Google. Essa permissão é dada através de um arquivo chamado `credentials.json`. 

Siga este passo a passo (leva cerca de 5 minutos) para gerar e baixar as credenciais.

---

### Passo 1: Criar um Projeto no Google Cloud
1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Faça login com a conta do Google que você quer usar para a agenda.
3. No menu superior esquerdo (ao lado da logo do Google Cloud), clique no botão de **Selecionar Projeto** e depois em **Novo Projeto** (New Project).
4. Dê um nome ao projeto (ex: `AutoCalendar-ENSTA`) e clique em **Criar** (Create).
5. Certifique-se de que este novo projeto está selecionado no topo da página.

### Passo 2: Ativar a API do Google Calendar
1. No menu lateral esquerdo (☰), vá em **APIs e Serviços** > **Biblioteca** (Library).
2. Na barra de pesquisa, busque por **Google Calendar API**.
3. Clique no resultado "Google Calendar API" e depois no botão azul **Ativar** (Enable).

### Passo 3: Configurar a Tela de Consentimento (OAuth Consent Screen)
1. No menu lateral esquerdo, vá em **APIs e Serviços** > **Tela de consentimento OAuth** (OAuth consent screen).
2. Escolha o tipo de usuário **Externo** (External) e clique em **Criar**.
3. Preencha apenas os campos obrigatórios:
   - **Nome do App**: `AutoCalendar`
   - **E-mail de suporte**: Selecione seu próprio e-mail.
   - **Dados de contato do desenvolvedor**: Coloque seu e-mail novamente.
4. Clique em **Salvar e Continuar** (Save and Continue).
5. Na tela de **Escopos** (Scopes), apenas clique em **Salvar e Continuar**.
6. Na tela de **Usuários de teste** (Test users), clique em **+ Adicionar usuários** (Add users) e digite o SEU próprio endereço de e-mail (a mesma conta Google que vai usar para o calendário). **Isso é muito importante, pois o app estará em modo de teste**.
7. Clique em **Salvar e Continuar** e depois volte para o painel.

### Passo 4: Criar as Credenciais (O arquivo JSON)
1. No menu lateral, vá em **APIs e Serviços** > **Credenciais** (Credentials).
2. No topo da página, clique em **+ Criar Credenciais** (Create Credentials) e escolha **ID do cliente OAuth** (OAuth client ID).
3. Em **Tipo de Aplicativo** (Application type), escolha **App para computador** (Desktop app).
4. Dê um nome, como "Script Python AutoCalendar".
5. Clique em **Criar** (Create).
6. Uma janela vai aparecer mostrando seu Client ID e Secret. Ignore o texto e **clique no botão de Download (JSON)** no final dessa janela.
7. Renomeie o arquivo baixado para **`credentials.json`**.
8. Mova o arquivo `credentials.json` para dentro da pasta principal do projeto **AutoCalendar** (na mesma pasta onde está o arquivo `main.py`).

---

### Passo 5: Primeira Execução
Ao rodar o script pela primeira vez SEM a flag `--dry-run`:
```bash
python main.py --option ROB
```

1. O script vai abrir uma aba no seu navegador automaticamente.
2. O Google vai pedir para você fazer login e dar permissão ao "AutoCalendar".
3. *Aviso importante:* Como seu app não é verificado pelo Google, aparecerá uma tela de aviso "Google hasn't verified this app" (O Google não verificou este app).
4. Clique em **Advanced** (Avançado) ou **Continuar** na tela de aviso e escolha a opção "Go to AutoCalendar (unsafe)" (Acessar AutoCalendar).
5. Clique em **Continue** para conceder permissão de gerenciar seus calendários.
6. A página vai mostrar que a autenticação foi feita com sucesso. Pode fechar a aba!

O script vai salvar um arquivo chamado `token.json` na pasta do projeto. Nas próximas vezes que você rodar o AutoCalendar, ele não pedirá login novamente (usará o token guardado).

🎉 **Pronto! A sincronização já pode ocorrer.**
