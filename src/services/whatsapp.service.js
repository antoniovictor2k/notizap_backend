// src/services/whatsapp.service.js
// Núcleo do sistema: gerencia sessões Baileys com Firestore integrado

import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';
import {
  setWhatsappConnected,
  setWhatsappDisconnected,
  incrementMessagesSent,
  writeLog,
  LogType,
} from './firestore.service.js';

// ─── CONSTANTES ────────────────────────────────────────────────────────────────

const SESSIONS_DIR = path.resolve('sessions');
const MSG_PER_MINUTE_LIMIT = Number(process.env.MSG_PER_MINUTE_LIMIT ?? 20);

// ─── ESTADO GLOBAL DAS SESSÕES ─────────────────────────────────────────────────

const sessions = new Map();

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function sessionDir(userId) {
  return path.join(SESSIONS_DIR, userId);
}

function ensureSessionDir(userId) {
  const dir = sessionDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function randomDelay(min = 2000, max = 5000) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );
}

// ─── CRIAÇÃO / GESTÃO DE SESSÕES ──────────────────────────────────────────────

export async function createSession(userId) {
  if (sessions.has(userId)) {
    const existing = sessions.get(userId);
    if (existing.status === 'open') {
      logger.info({ userId }, 'Sessão já conectada, reutilizando');
      return existing;
    }
    await destroySession(userId);
  }

  const dir = ensureSessionDir(userId);

  const sessionState = {
    socket: null,
    status: 'connecting',
    qrBase64: null,
    pairingCode: null,
    msgCount: 0,
    msgTimer: null,
  };
  sessions.set(userId, sessionState);

  // Log: sessão criada
  writeLog(userId, LogType.SESSION_CREATED, 'Sessão WhatsApp iniciada');

  await _initSocket(userId, dir, sessionState);
  return sessionState;
}

async function _initSocket(userId, dir, sessionState) {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const socket = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: ['NotiZap', 'Chrome', '120.0.0'],
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    logger: logger.child({ module: 'baileys', userId }),
    qrTimeout: 60_000,
  });

  sessionState.socket = socket;

  // ── Event: credenciais ────────────────────────────────────────────────────
  socket.ev.on('creds.update', saveCreds);

  // ── Event: status da conexão ──────────────────────────────────────────────
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR gerado → converte para base64 e loga no Firestore
    if (qr) {
      try {
        sessionState.qrBase64 = await qrcode.toDataURL(qr);
        logger.info({ userId }, 'QR Code gerado');

        writeLog(userId, LogType.WHATSAPP_QR_GENERATED, 'QR Code gerado — aguardando scan');
      } catch (err) {
        logger.error({ err, userId }, 'Erro ao gerar QR base64');
      }
    }

    if (connection === 'open') {
      sessionState.status = 'open';
      sessionState.qrBase64 = null;

      // Obtém número conectado
      const phoneNumber = socket.user?.id
        ? socket.user.id.split(':')[0].split('@')[0]
        : null;

      logger.info({ userId, phoneNumber }, '✅ WhatsApp conectado');

      // ── Atualiza Firestore ──────────────────────────────────────────────
      await setWhatsappConnected(userId, phoneNumber);
      writeLog(
        userId,
        LogType.WHATSAPP_CONNECTED,
        'WhatsApp conectado com sucesso',
        { phoneNumber }
      );
    }

    if (connection === 'close') {
      sessionState.status = 'close';
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;

      logger.warn({ userId, reason, shouldReconnect }, 'Conexão encerrada');

      if (shouldReconnect) {
        // ── Atualiza Firestore: desconectado (mas vai reconectar) ─────────
        await setWhatsappDisconnected(userId);
        writeLog(
          userId,
          LogType.WHATSAPP_RECONNECTING,
          'Conexão perdida — reconectando em 5s',
          { reason },
          'warn'
        );

        logger.info({ userId }, '🔄 Reconectando em 5s...');
        setTimeout(() => _initSocket(userId, dir, sessionState), 5_000);
      } else {
        // ── Logout explícito ──────────────────────────────────────────────
        await setWhatsappDisconnected(userId);
        writeLog(
          userId,
          LogType.WHATSAPP_LOGOUT,
          'Logout detectado — sessão encerrada',
          {},
          'warn'
        );

        logger.info({ userId }, '🚪 Logout — sessão não reconectada');
        await destroySession(userId);
      }
    }
  });

  // ── Event: mensagens recebidas ─────────────────────────────────────────────
  socket.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.key.fromMe) {
        logger.debug({ userId, from: msg.key.remoteJid }, '📨 Mensagem recebida');
      }
    }
  });

  logger.info({ userId, version }, 'Socket Baileys inicializado');
}

// ─── ACESSO À SESSÃO ───────────────────────────────────────────────────────────

export function getSession(userId) {
  return sessions.get(userId) ?? null;
}

export function getSessionStatus(userId) {
  const s = sessions.get(userId);
  return s ? s.status : 'not_found';
}

// ─── PAIRING CODE ─────────────────────────────────────────────────────────────

export async function requestPairingCode(userId, phoneNumber) {
  const session = sessions.get(userId);

  if (!session || !session.socket) {
    throw new Error('Sessão não iniciada. Chame /connect primeiro.');
  }
  if (session.status === 'open') {
    throw new Error('WhatsApp já está conectado. Pairing code não é necessário.');
  }

  const normalized = normalizeNumber(phoneNumber);
  const code = await session.socket.requestPairingCode(normalized);
  session.pairingCode = code;

  logger.info({ userId, phoneNumber: normalized }, 'Pairing code gerado');
  writeLog(userId, LogType.WHATSAPP_QR_GENERATED, 'Pairing code gerado', { phoneNumber: normalized });

  return code;
}

// ─── ENVIO DE MENSAGENS (ANTI-BAN + FIRESTORE) ────────────────────────────────

export async function sendMessage(userId, number, message) {
  const session = sessions.get(userId);

  if (!session || session.status !== 'open') {
    throw new Error('WhatsApp não está conectado para este usuário.');
  }

  if (session.msgCount >= MSG_PER_MINUTE_LIMIT) {
    writeLog(
      userId,
      LogType.MESSAGE_FAILED,
      'Rate limit de envio atingido',
      { number, limit: MSG_PER_MINUTE_LIMIT },
      'warn'
    );
    throw new Error(`Limite de ${MSG_PER_MINUTE_LIMIT} mensagens/minuto atingido. Aguarde.`);
  }

  if (!session.msgTimer) {
    session.msgTimer = setTimeout(() => {
      session.msgCount = 0;
      session.msgTimer = null;
    }, 60_000);
  }

  const jid = toJid(number);
  const normalizedNumber = normalizeNumber(number);

  // Delay anti-ban
  await randomDelay(2000, 5000);

  try {
    await session.socket.sendMessage(jid, { text: message });
    session.msgCount++;

    logger.info({ userId, to: jid, msgCount: session.msgCount }, '📤 Mensagem enviada');

    // ── Atualiza Firestore: incrementa messagesSent e loga ────────────────
    await incrementMessagesSent(userId);
    writeLog(
      userId,
      LogType.MESSAGE_SENT,
      `Mensagem enviada para ${normalizedNumber}`,
      { to: normalizedNumber, preview: message.substring(0, 80) }
    );
  } catch (err) {
    writeLog(
      userId,
      LogType.MESSAGE_FAILED,
      `Falha ao enviar para ${normalizedNumber}: ${err.message}`,
      { to: normalizedNumber, error: err.message },
      'error'
    );
    throw err;
  }
}

// ─── DESTRUIÇÃO DE SESSÃO ─────────────────────────────────────────────────────

export async function destroySession(userId) {
  const session = sessions.get(userId);
  if (!session) return;

  try {
    if (session.msgTimer) clearTimeout(session.msgTimer);
    await session.socket?.logout?.();
    session.socket?.end?.();
  } catch {
    // ignora erro no encerramento
  }

  sessions.delete(userId);
  writeLog(userId, LogType.SESSION_DESTROYED, 'Sessão destruída');
  logger.info({ userId }, 'Sessão destruída');
}

// ─── UTILIDADES DE NÚMERO ─────────────────────────────────────────────────────

export function normalizeNumber(number) {
  const digits = String(number).replace(/\D/g, '');
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 13 && digits.startsWith('55')) return digits;
  return digits;
}

export function validateNumber(number) {
  const normalized = normalizeNumber(number);
  return normalized.length >= 12;
}

function toJid(number) {
  const normalized = normalizeNumber(number);
  if (!validateNumber(normalized)) {
    throw new Error(`Número inválido: ${number}`);
  }
  return `${normalized}@s.whatsapp.net`;
}