// src/services/whatsapp.service.js
// Núcleo do sistema: gerencia sessões Baileys por usuário com anti-ban e reconexão automática

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

// ─── CONSTANTES ────────────────────────────────────────────────────────────────

const SESSIONS_DIR = path.resolve('sessions');
const MSG_PER_MINUTE_LIMIT = Number(process.env.MSG_PER_MINUTE_LIMIT ?? 20);

// ─── ESTADO GLOBAL DAS SESSÕES ─────────────────────────────────────────────────

/**
 * Map principal: userId → SessionState
 *
 * SessionState = {
 *   socket:      WASocket | null,
 *   status:      'connecting' | 'open' | 'close',
 *   qrBase64:    string | null,      // QR code em base64 para exibir no front
 *   pairingCode: string | null,
 *   msgCount:    number,             // contador de msgs no minuto atual
 *   msgTimer:    NodeJS.Timeout | null,
 * }
 */
const sessions = new Map();

// ─── HELPERS ───────────────────────────────────────────────────────────────────

/** Caminho do diretório de autenticação de uma sessão */
function sessionDir(userId) {
  return path.join(SESSIONS_DIR, userId);
}

/** Garante que o diretório da sessão existe */
function ensureSessionDir(userId) {
  const dir = sessionDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Delay aleatório entre min e max ms — base do anti-ban */
function randomDelay(min = 2000, max = 5000) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );
}

// ─── CRIAÇÃO / GESTÃO DE SESSÕES ──────────────────────────────────────────────

/**
 * Cria (ou reconecta) uma sessão WhatsApp para o userId.
 * Retorna a entrada do Map para que o controller possa ler o QR.
 */
export async function createSession(userId) {
  // Evita sessão duplicada — se já estiver aberta, retorna a existente
  if (sessions.has(userId)) {
    const existing = sessions.get(userId);
    if (existing.status === 'open') {
      logger.info({ userId }, 'Sessão já conectada, reutilizando');
      return existing;
    }
    // Se estiver em estado de erro/fechado, destrói e recria
    await destroySession(userId);
  }

  const dir = ensureSessionDir(userId);

  // Estado inicial da sessão
  const sessionState = {
    socket: null,
    status: 'connecting',
    qrBase64: null,
    pairingCode: null,
    msgCount: 0,
    msgTimer: null,
  };
  sessions.set(userId, sessionState);

  await _initSocket(userId, dir, sessionState);
  return sessionState;
}

/**
 * Instancia o socket Baileys e configura todos os event listeners.
 * Separado para facilitar a reconexão automática.
 */
async function _initSocket(userId, dir, sessionState) {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const socket = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    // ── Anti-ban: simula browser real ──
    browser: ['NotiZap', 'Chrome', '120.0.0'],
    printQRInTerminal: false,      // NÃO usar — depreciado
    syncFullHistory: false,        // reduz consumo e chance de ban
    markOnlineOnConnect: false,    // menos "ruído" comportamental
    logger: logger.child({ module: 'baileys', userId }),
    // Timeout de geração de QR
    qrTimeout: 60_000,
  });

  sessionState.socket = socket;

  // ── Event: atualização de credenciais ──────────────────────────────────────
  socket.ev.on('creds.update', saveCreds);

  // ── Event: status da conexão ───────────────────────────────────────────────
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR Code — converte para base64 (PNG) para retornar via API
    if (qr) {
      try {
        sessionState.qrBase64 = await qrcode.toDataURL(qr);
        logger.info({ userId }, 'QR Code gerado');
      } catch (err) {
        logger.error({ err, userId }, 'Erro ao gerar QR base64');
      }
    }

    if (connection === 'open') {
      sessionState.status = 'open';
      sessionState.qrBase64 = null;   // QR não é mais necessário
      logger.info({ userId }, '✅ WhatsApp conectado');
    }

    if (connection === 'close') {
      sessionState.status = 'close';
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      logger.warn({ userId, reason }, 'Conexão encerrada');

      // Reconexão automática — exceto em caso de logout explícito
      const shouldReconnect = reason !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        logger.info({ userId, reason }, '🔄 Reconectando em 5s...');
        setTimeout(() => _initSocket(userId, dir, sessionState), 5_000);
      } else {
        logger.info({ userId }, '🚪 Logout detectado, sessão não será reconectada');
        await destroySession(userId);
      }
    }
  });

  // ── Event: mensagens recebidas ─────────────────────────────────────────────
  socket.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.key.fromMe) {
        logger.debug(
          { userId, from: msg.key.remoteJid },
          '📨 Mensagem recebida'
        );
        // TODO: emitir via WebSocket/webhook para o front-end
      }
    }
  });

  logger.info({ userId, version }, 'Socket Baileys inicializado');
}

// ─── ACESSO À SESSÃO ───────────────────────────────────────────────────────────

/**
 * Retorna a sessão existente ou null se não existir.
 */
export function getSession(userId) {
  return sessions.get(userId) ?? null;
}

/**
 * Retorna o status atual: 'connecting' | 'open' | 'close' | 'not_found'
 */
export function getSessionStatus(userId) {
  const s = sessions.get(userId);
  return s ? s.status : 'not_found';
}

// ─── PAIRING CODE ─────────────────────────────────────────────────────────────

/**
 * Gera um Pairing Code para o número informado.
 * Só funciona após a sessão ser criada (status 'connecting').
 *
 * @param {string} userId
 * @param {string} phoneNumber  — apenas dígitos, ex: "5582999999999"
 * @returns {Promise<string>}   — código de 8 dígitos
 */
export async function requestPairingCode(userId, phoneNumber) {
  const session = sessions.get(userId);

  if (!session || !session.socket) {
    throw new Error('Sessão não iniciada. Chame /connect primeiro.');
  }

  if (session.status === 'open') {
    throw new Error('WhatsApp já está conectado. Pairing code não é necessário.');
  }

  // Normaliza: remove tudo que não for dígito
  const normalized = normalizeNumber(phoneNumber);

  const code = await session.socket.requestPairingCode(normalized);
  session.pairingCode = code;

  logger.info({ userId, phoneNumber: normalized }, 'Pairing code gerado');
  return code;
}

// ─── ENVIO DE MENSAGENS (COM ANTI-BAN) ────────────────────────────────────────

/**
 * Envia uma mensagem de texto com proteções anti-ban:
 * - Delay mínimo de 2s (aleatório até 5s)
 * - Rate limit de MSG_PER_MINUTE_LIMIT mensagens/minuto por sessão
 *
 * @param {string} userId
 * @param {string} number    — número com DDI, ex: "5582999999999"
 * @param {string} message   — texto da mensagem
 */
export async function sendMessage(userId, number, message) {
  const session = sessions.get(userId);

  if (!session || session.status !== 'open') {
    throw new Error('WhatsApp não está conectado para este usuário.');
  }

  // ── Rate limit por minuto ─────────────────────────────────────────────────
  if (session.msgCount >= MSG_PER_MINUTE_LIMIT) {
    throw new Error(
      `Limite de ${MSG_PER_MINUTE_LIMIT} mensagens/minuto atingido. Aguarde.`
    );
  }

  // Reseta o contador após 1 minuto
  if (!session.msgTimer) {
    session.msgTimer = setTimeout(() => {
      session.msgCount = 0;
      session.msgTimer = null;
    }, 60_000);
  }

  // ── Normaliza e valida o número ───────────────────────────────────────────
  const jid = toJid(number);

  // ── Anti-ban: delay antes de enviar ──────────────────────────────────────
  await randomDelay(2000, 5000);

  // ── Envio ─────────────────────────────────────────────────────────────────
  await session.socket.sendMessage(jid, { text: message });

  session.msgCount++;
  logger.info({ userId, to: jid, msgCount: session.msgCount }, '📤 Mensagem enviada');
}

// ─── DESTRUIÇÃO DE SESSÃO ─────────────────────────────────────────────────────

/**
 * Fecha o socket e remove a sessão do Map.
 * Os arquivos de autenticação em disco são preservados para reconexão futura.
 */
export async function destroySession(userId) {
  const session = sessions.get(userId);
  if (!session) return;

  try {
    if (session.msgTimer) clearTimeout(session.msgTimer);
    await session.socket?.logout?.();
    session.socket?.end?.();
  } catch {
    // Ignora erros no encerramento (socket já pode estar morto)
  }

  sessions.delete(userId);
  logger.info({ userId }, 'Sessão destruída');
}

// ─── UTILIDADES DE NÚMERO ─────────────────────────────────────────────────────

/**
 * Normaliza um número de telefone removendo caracteres não-numéricos.
 * Garante que DDI esteja presente (assume Brasil +55 se ausente e tiver 11 dígitos).
 *
 * @param {string} number
 * @returns {string} — apenas dígitos com DDI
 */
export function normalizeNumber(number) {
  const digits = String(number).replace(/\D/g, '');

  // Sem DDI e número brasileiro padrão (11 dígitos com DDD)
  if (digits.length === 11) return `55${digits}`;
  // Já tem DDI 55
  if (digits.length === 13 && digits.startsWith('55')) return digits;
  // Outros formatos internacionais — retorna como está
  return digits;
}

/**
 * Valida se o número parece válido antes de tentar enviar.
 * Regra simples: mínimo 10 dígitos após DDI.
 */
export function validateNumber(number) {
  const normalized = normalizeNumber(number);
  return normalized.length >= 12; // DDI (2) + DDD (2) + número (8+)
}

/**
 * Converte número normalizado para o JID do WhatsApp.
 * Ex: "5582999999999" → "5582999999999@s.whatsapp.net"
 */
function toJid(number) {
  const normalized = normalizeNumber(number);
  if (!validateNumber(normalized)) {
    throw new Error(`Número inválido: ${number}`);
  }
  return `${normalized}@s.whatsapp.net`;
}
