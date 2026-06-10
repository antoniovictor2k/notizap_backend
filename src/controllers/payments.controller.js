// src/controllers/payments.controller.js

import {
  createPixPayment,
  handleWebhook,
} from '../services/mercadopago.service.js';
import logger from '../utils/logger.js';

// POST /payments/pix
export async function createPix(req, res) {
  const { amount, description } = req.body;

  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Campo "amount" deve ser um número positivo.' });
  }

  try {
    const result = await createPixPayment({
      userId: req.user.uid,
      email: req.user.email,
      amount: Number(amount),
      description: description ?? 'NotiZap — assinatura',
    });
    return res.json(result);
  } catch (err) {
    logger.warn({ err: err.message }, 'Pagamento PIX falhou');
    return res.status(503).json({ error: err.message });
  }
}

// POST /payments/webhook
// Não requer autenticação Firebase — usa assinatura HMAC do MP
export async function webhook(req, res) {
  try {
    const signature = req.headers['x-signature'] ?? '';
    const result = await handleWebhook(req.body, signature);
    return res.json(result);
  } catch (err) {
    logger.error({ err }, 'Webhook MP inválido');
    return res.status(400).json({ error: 'Webhook inválido.' });
  }
}
