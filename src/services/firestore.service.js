// src/services/firestore.service.js
// Camada centralizada para todas as operações no Firestore.
// Mantém o resto do código limpo — nenhum outro arquivo importa getFirestore() diretamente.

import { getFirestore, FieldValue } from '../config/firebase.js';
import logger from '../utils/logger.js';

// ─── COLEÇÕES ──────────────────────────────────────────────────────────────────
//
//  users/{userId}                → documento do usuário (seu schema existente)
//  users/{userId}/logs/{autoId}  → subcoleção de logs de atividade

// ─── USUÁRIO ───────────────────────────────────────────────────────────────────

/**
 * Atualiza campos no documento do usuário em users/{userId}.
 * Usa merge:true para não sobrescrever campos existentes.
 *
 * @param {string} userId  Firebase UID
 * @param {object} data    Campos a atualizar
 */
export async function updateUser(userId, data) {
  try {
    const db = getFirestore();
    await db.collection('users').doc(userId).set(data, { merge: true });
    logger.debug({ userId, data }, 'Firestore: usuário atualizado');
  } catch (err) {
    // Não lança — falha no Firestore nunca deve derrubar o fluxo principal
    logger.error({ err, userId }, 'Firestore: erro ao atualizar usuário');
  }
}

/**
 * Marca whatsappConnected e registra o número conectado.
 *
 * @param {string} userId
 * @param {string|null} phoneNumber  — número normalizado ou null ao desconectar
 */
export async function setWhatsappConnected(userId, phoneNumber = null) {
  await updateUser(userId, {
    whatsappConnected: true,
    whatsappNumber: phoneNumber,
    whatsappConnectedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Marca whatsappConnected = false ao desconectar.
 *
 * @param {string} userId
 */
export async function setWhatsappDisconnected(userId) {
  await updateUser(userId, {
    whatsappConnected: false,
    whatsappDisconnectedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Incrementa messagesSent em +1 e atualiza lastMessageAt.
 *
 * @param {string} userId
 */
export async function incrementMessagesSent(userId) {
  try {
    const db = getFirestore();
    await db.collection('users').doc(userId).update({
      messagesSent: FieldValue.increment(1),
      lastMessageAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.error({ err, userId }, 'Firestore: erro ao incrementar messagesSent');
  }
}

/**
 * Busca o documento do usuário.
 *
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getUser(userId) {
  try {
    const db = getFirestore();
    const snap = await db.collection('users').doc(userId).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  } catch (err) {
    logger.error({ err, userId }, 'Firestore: erro ao buscar usuário');
    return null;
  }
}

// ─── LOGS DE ATIVIDADE ─────────────────────────────────────────────────────────

/**
 * Tipos de log disponíveis para categorização no Firestore.
 */
export const LogType = {
  WHATSAPP_CONNECTED:    'whatsapp_connected',
  WHATSAPP_DISCONNECTED: 'whatsapp_disconnected',
  WHATSAPP_QR_GENERATED: 'whatsapp_qr_generated',
  WHATSAPP_RECONNECTING: 'whatsapp_reconnecting',
  WHATSAPP_LOGOUT:       'whatsapp_logout',
  MESSAGE_SENT:          'message_sent',
  MESSAGE_FAILED:        'message_failed',
  SESSION_CREATED:       'session_created',
  SESSION_DESTROYED:     'session_destroyed',
  AUTH_SUCCESS:          'auth_success',
  AUTH_FAILED:           'auth_failed',
  ERROR:                 'error',
};

/**
 * Grava um log de atividade na subcoleção users/{userId}/logs.
 * Fire-and-forget — nunca bloqueia o fluxo principal.
 *
 * Estrutura do documento:
 * {
 *   type:      string   (LogType)
 *   message:   string
 *   data?:     object   (metadados extras)
 *   level:     'info' | 'warn' | 'error'
 *   createdAt: Timestamp
 * }
 *
 * @param {string} userId
 * @param {string} type       — LogType.*
 * @param {string} message    — descrição legível
 * @param {object} [data={}]  — dados extras (número, motivo, etc.)
 * @param {'info'|'warn'|'error'} [level='info']
 */
export function writeLog(userId, type, message, data = {}, level = 'info') {
  // Fire-and-forget: não await intencional
  _writeLogAsync(userId, type, message, data, level).catch((err) => {
    logger.error({ err, userId, type }, 'Firestore: falha ao gravar log');
  });
}

async function _writeLogAsync(userId, type, message, data, level) {
  const db = getFirestore();

  // Remove valores undefined para não quebrar o Firestore
  const cleanData = JSON.parse(JSON.stringify(data));

  await db.collection('users').doc(userId).collection('logs').add({
    type,
    message,
    data: cleanData,
    level,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Busca os últimos N logs do usuário, ordenados do mais recente.
 *
 * @param {string} userId
 * @param {number} [limit=50]
 * @returns {Promise<object[]>}
 */
export async function getLogs(userId, limit = 50) {
  try {
    const db = getFirestore();
    const snap = await db
      .collection('users')
      .doc(userId)
      .collection('logs')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    logger.error({ err, userId }, 'Firestore: erro ao buscar logs');
    return [];
  }
}