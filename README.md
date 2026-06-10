# 🚀 NotiZap — Backend SaaS WhatsApp

Backend multi-sessão para envio de mensagens WhatsApp via Baileys, com autenticação Firebase e estrutura pronta para cobrança via Mercado Pago.

---

## 📦 Stack

| Camada       | Tecnologia                        |
|--------------|-----------------------------------|
| Runtime      | Node.js 20+ (ESModules)           |
| HTTP         | Express 4                         |
| WhatsApp     | @whiskeysockets/baileys            |
| Auth         | Firebase Admin SDK                |
| Pagamentos   | Mercado Pago (preparado, inativo) |
| Logs         | pino + pino-pretty                |
| Rate Limit   | express-rate-limit                |

---

## 🗂️ Estrutura

```
notizap/
├── src/
│   ├── app.js                      # Entry point
│   ├── config/
│   │   └── firebase.js             # Firebase Admin singleton
│   ├── controllers/
│   │   ├── whatsapp.controller.js
│   │   ├── clients.controller.js
│   │   └── payments.controller.js
│   ├── services/
│   │   ├── whatsapp.service.js     # Baileys multi-sessão + anti-ban
│   │   ├── clients.service.js      # CRUD de clientes
│   │   └── mercadopago.service.js  # PIX (preparado)
│   ├── middlewares/
│   │   └── auth.middleware.js      # Bearer token Firebase
│   ├── routes/
│   │   ├── whatsapp.routes.js
│   │   ├── clients.routes.js
│   │   └── payments.routes.js
│   └── utils/
│       └── logger.js               # pino logger
├── sessions/                       # Credenciais Baileys (gitignore!)
├── .env.example
└── package.json
```

---

## ⚡ Setup rápido

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite `.env` e preencha:

```env
# Porta do servidor
PORT=3000

# Cole o JSON completo da sua Service Account do Firebase
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"meu-projeto",...}

# Limite de mensagens por minuto por sessão
MSG_PER_MINUTE_LIMIT=20
```

### 3. Rodar

```bash
# Produção
npm start

# Desenvolvimento (hot reload nativo Node 20+)
npm run dev
```

---

## 🔐 Autenticação

Todas as rotas (exceto `/health` e `/payments/webhook`) exigem:

```
Authorization: Bearer <Firebase ID Token>
```

O token é obtido no front-end via `firebase.auth().currentUser.getIdToken()`.

---

## 📡 Endpoints

### WhatsApp — `/whatsapp`

| Método | Rota            | Descrição                              |
|--------|-----------------|----------------------------------------|
| POST   | `/connect`      | Inicia sessão, retorna QR em base64    |
| GET    | `/status`       | Status da conexão + QR atual           |
| POST   | `/pairing-code` | Gera código de pareamento              |
| POST   | `/send`         | Envia mensagem de texto                |

**POST /connect** — resposta:
```json
{
  "status": "connecting",
  "qr": "data:image/png;base64,iVBOR...",
  "message": "Escaneie o QR code com seu WhatsApp."
}
```

**POST /send** — body:
```json
{ "number": "5582999999999", "message": "Olá!" }
```

**POST /pairing-code** — body:
```json
{ "phone": "5582999999999" }
```

---

### Clientes — `/clients`

| Método | Rota        | Descrição          |
|--------|-------------|--------------------|
| GET    | `/`         | Lista clientes     |
| GET    | `/:id`      | Busca por ID       |
| POST   | `/`         | Cria cliente       |
| PATCH  | `/:id`      | Atualiza cliente   |
| DELETE | `/:id`      | Remove cliente     |

**POST /clients** — body:
```json
{
  "name": "João Silva",
  "phone": "5582999999999",
  "email": "joao@email.com",
  "notes": "Cliente VIP"
}
```

---

### Pagamentos — `/payments`

| Método | Rota        | Descrição                          |
|--------|-------------|------------------------------------|
| POST   | `/pix`      | Cria cobrança PIX (inativo)        |
| POST   | `/webhook`  | Recebe confirmação do Mercado Pago |

> ⚠️ Pagamentos desativados. Para ativar: defina `MP_ENABLED=true` e `MP_ACCESS_TOKEN` no `.env`, depois descomente o código em `mercadopago.service.js`.

---

## 🛡️ Anti-ban WhatsApp

O sistema implementa as seguintes proteções:

- **Delay entre mensagens**: 2–5 segundos aleatórios antes de cada envio
- **Rate limit por sessão**: máximo de `MSG_PER_MINUTE_LIMIT` msgs/min
- **Rate limit HTTP**: camada extra via `express-rate-limit`
- **Browser fingerprint**: simula Chrome 120 para evitar detecção
- **Reconexão automática**: reabrir sessão ao desconectar (exceto logout)
- **Sem printQRInTerminal**: QR via base64 na API

---

## 🔄 Fluxo de conexão

```
1. Front chama POST /whatsapp/connect
2. API retorna QR base64
3. Usuário escaneia com WhatsApp
4. Status muda para "open"
5. Front pode chamar GET /status para confirmar
6. Pronto para enviar via POST /send
```

---

## 🗄️ Banco de dados

O service de clientes usa **Map em memória** por padrão (dados perdidos ao reiniciar).

Para produção, substitua `src/services/clients.service.js` por uma implementação com:
- **Firestore** (recomendado se já usa Firebase)
- **PostgreSQL** via `pg` ou `drizzle-orm`
- **MongoDB** via `mongoose`

A interface (funções exportadas) permanece idêntica.

---

## 📁 Sessões WhatsApp

As credenciais do Baileys são salvas em `sessions/{userId}/`.

**Importante:** adicione `sessions/` ao `.gitignore` para não versionar tokens de acesso.

```gitignore
sessions/
.env
node_modules/
```

---

## 🚀 Deploy em VPS

```bash
# Instalar PM2 para manter o processo vivo
npm install -g pm2

# Iniciar
pm2 start src/app.js --name notizap

# Auto-start no boot
pm2 startup
pm2 save
```

Recomendado: use **Nginx** como reverse proxy na porta 80/443 apontando para `localhost:3000`.
