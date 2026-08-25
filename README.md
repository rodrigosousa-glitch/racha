# ⚽ Sistema de Rachas da Firma

Sistema web para organizar jogos de futebol amador do trabalho.

## O que é

Um link único. Abriu, logou, participou. Sem instalar nada.

## Como hospedar

### 1. Criar conta no Supabase (grátis)

1. Acesse [https://supabase.com](https://supabase.com)
2. Clique em "Start your project" e crie uma conta (pode usar GitHub)
3. Crie um novo projeto (nome: `rachas-firma`)
4. Aguarde a criação (1-2 minutos)

### 2. Configurar o banco de dados

1. No painel do Supabase, vá em **SQL Editor**
2. Clique em **New query**
3. Cole TODO o conteúdo do arquivo `schema.sql`
4. Clique em **Run**

Isso cria todas as tabelas, funções, triggers, políticas de segurança e views.

### 3. Habilitar autenticação por email

1. Vá em **Authentication > Providers**
2. Certifique-se de que **Email** está habilitado
3. Desabilite **Confirm email** (para não precisar confirmar por email)
4. Salve

### 4. Configurar Storage (comprovantes)

1. Vá em **Storage**
2. O bucket `receipts` já foi criado pelo SQL
3. Clique no bucket `receipts` > **Policies**
4. Verifique se as políticas estão lá (já criadas pelo SQL)

### 5. Pegar as credenciais

1. Vá em **Project Settings > API**
2. Copie:
   - **URL** (ex: `https://abcdefgh12345678.supabase.co`)
   - **anon public** (ex: `eyJhbGciOiJIUzI1NiIs...`)

### 6. Configurar o frontend

Abra o arquivo `app.js` e substitua as duas linhas no topo:

```javascript
const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_KEY = 'SUA-ANON-KEY';
```

Pelo URL e anon key que você copiou do Supabase.

### 7. Hospedar os arquivos

Você precisa de um lugar que hospede arquivos estáticos (HTML, CSS, JS). Opções gratuitas:

#### Opção A: Netlify (recomendado)
1. Acesse [https://netlify.com](https://netlify.com)
2. Arraste os 3 arquivos (`index.html`, `styles.css`, `app.js`) para a área de deploy
3. Pronto! O link é gerado automaticamente

#### Opção B: Vercel
1. Acesse [https://vercel.com](https://vercel.com)
2. Importe os arquivos
3. Deploy automático

#### Opção C: Surge.sh
```bash
npm install -g surge
surge
# Escolha a pasta com os arquivos
# Escolha um domínio: rachas-firma.surge.sh
```

**NÃO use GitHub Pages** — funciona, mas o Supabase é o backend, então qualquer hospedagem estática serve. Netlify e Vercel são mais práticos.

### 8. Testar

1. Abra o link no celular
2. Crie uma conta (usuário + senha)
3. Crie um racha
4. Compartilhe o link com os colegas

## Funcionalidades

- ✅ Um único link para todos
- ✅ Apenas um racha ativo por vez
- ✅ Login simples (usuário + senha)
- ✅ Criar racha (data, hora, local, valor, meta)
- ✅ Pagamento antes ou depois
- ✅ Comprovante por Pix (upload de foto/PDF)
- ✅ Barra de meta em tempo real
- ✅ Furão automático ao encerrar inscrições
- ✅ Encerrar e reabrir inscrições
- ✅ Finalizar racha (presença + gols)
- ✅ Rankings: gols, presença, furões
- ✅ Transferir organização
- ✅ Perfil do jogador

## Estrutura de arquivos

```
├── index.html      # Estrutura da página
├── styles.css      # Estilos (mobile-first, dark theme)
├── app.js          # Lógica completa do app
└── schema.sql      # Banco de dados Supabase
```

## Segurança

- RLS (Row Level Security) ativado em todas as tabelas
- Comprovantes privados — só o organizador vê
- Apenas o organizador edita o racha
- Senhas gerenciadas pelo Supabase Auth (criptografadas)

## Suporte

Se precisar de ajuda, me chame com o erro que aparece no console do navegador (F12 > Console).
