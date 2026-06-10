// src/app.js
// Ponto de entrada do servidor NotiZap

import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';

import logger from './utils/logger.js';
import { getFirebaseAdmin } from './config/firebase.js';

import whatsappRoutes  from './routes/whatsapp.routes.js';
import clientsRoutes   from './routes/clients.routes.js';
import paymentsRoutes  from './routes/payments.routes.js';

// ─── INICIALIZAÇÃO ANTECIPADA ──────────────────────────────────────────────────

// Inicializa Firebase ao subir o servidor (falha rápido se a config estiver errada)
try {
  getFirebaseAdmin();
} catch (err) {
  logger.error({ err }, '❌ Falha ao inicializar Firebase. Verifique FIREBASE_SERVICE_ACCOUNT.');
  process.exit(1);
}

// ─── EXPRESS ───────────────────────────────────────────────────────────────────

const app = express();

// ── Parsers ──────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate Limit global ────────────────────────────────────────────────────────
// Proteção genérica: 30 req/min por IP (ajustável via .env)
const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em breve.' },
  skip: (req) => req.path === '/health', // healthcheck não é limitado
});
app.use(globalLimiter);

// ── Rate limit específico para /whatsapp/send ────────────────────────────────
// Camada extra no nível HTTP (a camada por sessão fica no service)
const sendLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.MSG_PER_MINUTE_LIMIT ?? 20),
  keyGenerator: (req) => req.user?.uid ?? req.ip, // por usuário autenticado
  message: { error: 'Limite de envio por minuto atingido.' },
});
app.use('/whatsapp/send', sendLimiter);

// ── Logging de requisições ────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, 'Requisição recebida');
  next();
});

// ─── ROTAS ─────────────────────────────────────────────────────────────────────

app.use('/whatsapp',  whatsappRoutes);
app.use('/clients',   clientsRoutes);
app.use('/payments',  paymentsRoutes);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// ─── TRATAMENTO DE ERRO GLOBAL ─────────────────────────────────────────────────
// Captura qualquer erro não tratado nos controllers/services
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error({ err }, 'Erro não tratado');
  const status = err.status ?? err.statusCode ?? 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor.'
      : err.message,
  });
});

// ─── START ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
  logger.info(`🚀 NotiZap rodando na porta ${PORT} [${process.env.NODE_ENV ?? 'development'}]`);
});

export default app;
