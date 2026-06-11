// src/controllers/whatsapp.controller.js
// Camada HTTP: valida input, chama o service, formata resposta

import * as whatsappService from "../services/whatsapp.service.js";
import logger from "../utils/logger.js";
// Adicione o import no topo do arquivo (usando ES Modules)
import qrcode from "qrcode-terminal";
import terminalImage from 'terminal-image';
// Se usar CommonJS, seria: const qrcode = require('qrcode-terminal');

// ─── CONNECT ──────────────────────────────────────────────────────────────────

/**
 * POST /whatsapp/connect
 * Inicia a sessão e retorna o QR code em base64.
 * Se já estiver conectado, retorna o status atual.
 */

export async function connect(req, res) {
  const { uid: userId } = req.user;

  try {
    const session = await whatsappService.createSession(userId);

    if (session.status === 'open') {
      return res.json({ status: 'open', message: 'WhatsApp já conectado.', qr: null });
    }

    const qr = await waitForQR(session, 8000);

    if (session.qrCode) {
      // 1. EXIBE NO TERMINAL (Usando o texto puro)
      qrcode.generate(session.qrCode, { small: true }, function (qrcode) {
        console.log('\n📱 Escaneie o QR Code abaixo no terminal:\n');
        console.log(qrcode);
      });

     
    }

    return res.json({
      status: session.status,
      qrBase64: qr ?? null,
      qrCode: session.qrCode ?? null,
      message: qr ? 'Escaneie o QR code com seu WhatsApp.' : 'Gerando...',
    });
  } catch (err) {
    logger.error({ err, userId }, 'Erro ao conectar sessão');
    return res.status(500).json({ error: err.message });
  }
}

// ─── STATUS ───────────────────────────────────────────────────────────────────

/**
 * GET /whatsapp/status
 * Retorna o status da conexão e, se disponível, o QR atual.
 */
export function status(req, res) {
  const { uid: userId } = req.user;

  const sessionStatus = whatsappService.getSessionStatus(userId);
  const session = whatsappService.getSession(userId);

  return res.json({
    status: sessionStatus,
    qrBase64: session?.qrBase64 ?? null,
    qrCode: session?.qrCode ?? null,
    pairingCode: session?.pairingCode ?? null,
  });
}

// ─── PAIRING CODE ─────────────────────────────────────────────────────────────

/**
 * POST /whatsapp/pairing-code
 * Body: { "phone": "5582999999999" }
 *
 * Gera um código de pareamento de 8 dígitos para vincular sem QR.
 */
export async function pairingCode(req, res) {
  const { uid: userId } = req.user;
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      error: 'Campo "phone" é obrigatório.',
      example: { phone: "5582999999999" },
    });
  }

  if (!whatsappService.validateNumber(phone)) {
    return res.status(400).json({ error: "Número de telefone inválido." });
  }

  try {
    const code = await whatsappService.requestPairingCode(userId, phone);
    return res.json({ pairingCode: code });
  } catch (err) {
    logger.warn({ err: err.message, userId }, "Erro ao gerar pairing code");
    return res.status(400).json({ error: err.message });
  }
}

// ─── SEND ─────────────────────────────────────────────────────────────────────

/**
 * POST /whatsapp/send
 * Body: { "number": "5582999999999", "message": "Olá!" }
 *
 * Envia uma mensagem de texto com delay anti-ban embutido.
 */
export async function send(req, res) {
  const { uid: userId } = req.user;
  const { number, message } = req.body;

  // ── Validação de input ────────────────────────────────────────────────────
  if (!number || !message) {
    return res.status(400).json({
      error: 'Campos "number" e "message" são obrigatórios.',
      example: { number: "5582999999999", message: "Olá!" },
    });
  }

  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "Mensagem não pode ser vazia." });
  }

  if (!whatsappService.validateNumber(number)) {
    return res.status(400).json({ error: "Número de telefone inválido." });
  }

  try {
    await whatsappService.sendMessage(userId, number, message.trim());

    return res.json({
      success: true,
      to: whatsappService.normalizeNumber(number),
      message: "Mensagem enviada com sucesso.",
    });
  } catch (err) {
    logger.error({ err, userId, number }, "Erro ao enviar mensagem");

    // Rate limit — HTTP 429
    if (err.message.includes("Limite de")) {
      return res.status(429).json({ error: err.message });
    }

    return res.status(500).json({ error: err.message });
  }
}

// ─── HELPER ───────────────────────────────────────────────────────────────────

/**
 * Polling simples para aguardar o QR ser populado na sessão.
 * Retorna o QR base64 assim que disponível, ou null se expirar.
 *
 * @param {object} session
 * @param {number} timeoutMs
 * @returns {Promise<string|null>}
 */
function waitForQR(session, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const start = Date.now();

    const check = () => {
      if (session.qrBase64) return resolve(session.qrBase64);
      if (session.qrCode) return resolve(session.qrCode);
      if (session.status === "open") return resolve(null);
      if (Date.now() - start >= timeoutMs) return resolve(null);
      setTimeout(check, 300);
    };

    check();
  });
}
