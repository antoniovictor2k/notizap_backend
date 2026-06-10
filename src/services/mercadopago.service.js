// src/services/mercadopago.service.js
// ⚠️  PREPARADO — não ativado em produção ainda.
// Integração com Mercado Pago para cobranças via PIX.

/**
 * ATIVAÇÃO:
 * 1. Defina MP_ACCESS_TOKEN no .env
 * 2. Importe e chame initMercadoPago() no app.js
 * 3. Descomente o código abaixo
 * 4. Mude MP_ENABLED=true no .env
 */

// import { MercadoPagoConfig, Payment } from 'mercadopago';
import logger from '../utils/logger.js';

const MP_ENABLED = process.env.MP_ENABLED === 'true';

// ─── INICIALIZAÇÃO ─────────────────────────────────────────────────────────────

// let mpClient = null;

// export function initMercadoPago() {
//   mpClient = new MercadoPagoConfig({
//     accessToken: process.env.MP_ACCESS_TOKEN,
//     options: { timeout: 5000 },
//   });
//   logger.info('Mercado Pago inicializado');
// }

// ─── PIX ───────────────────────────────────────────────────────────────────────

/**
 * Cria um pagamento PIX.
 *
 * @param {object} params
 * @param {string} params.userId        — UID do usuário pagante
 * @param {string} params.email         — email do pagador
 * @param {number} params.amount        — valor em BRL
 * @param {string} params.description   — descrição da cobrança
 * @returns {Promise<{ id, pixCode, qrBase64, expiresAt }>}
 */
export async function createPixPayment({ userId, email, amount, description }) {
  if (!MP_ENABLED) {
    logger.warn('createPixPayment chamado mas MP_ENABLED=false');
    throw new Error('Pagamentos ainda não habilitados neste ambiente.');
  }

  // ── Código ativo quando MP_ENABLED=true ────────────────────────────────────
  // const payment = new Payment(mpClient);
  //
  // const result = await payment.create({
  //   body: {
  //     transaction_amount: amount,
  //     description,
  //     payment_method_id: 'pix',
  //     payer: { email },
  //     metadata: { userId },
  //     date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30min
  //   },
  //   requestOptions: {
  //     idempotencyKey: `${userId}-${Date.now()}`,
  //   },
  // });
  //
  // const txInfo = result.point_of_interaction?.transaction_data;
  // return {
  //   id: result.id,
  //   pixCode: txInfo?.qr_code,
  //   qrBase64: txInfo?.qr_code_base64,
  //   expiresAt: result.date_of_expiration,
  // };

  // Placeholder enquanto MP está desativado
  throw new Error('Pagamentos ainda não habilitados neste ambiente.');
}

// ─── WEBHOOK ───────────────────────────────────────────────────────────────────

/**
 * Processa o webhook de confirmação do Mercado Pago.
 * Valida a assinatura HMAC antes de processar.
 *
 * @param {object} body      — body da requisição
 * @param {string} signature — header x-signature enviado pelo MP
 */
export async function handleWebhook(body, signature) {
  if (!MP_ENABLED) {
    logger.warn('handleWebhook chamado mas MP_ENABLED=false');
    return { received: true, processed: false };
  }

  // ── Validação de assinatura (ativar junto com MP) ──────────────────────────
  // import crypto from 'crypto';
  //
  // const secret = process.env.MP_WEBHOOK_SECRET;
  // const [, ts] = signature.match(/ts=(\d+)/) ?? [];
  // const [, v1] = signature.match(/v1=([a-f0-9]+)/) ?? [];
  // const manifest = `id:${body.data?.id};request-id:${body.id};ts:${ts};`;
  // const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  //
  // if (expected !== v1) {
  //   throw new Error('Assinatura do webhook inválida');
  // }

  logger.info({ event: body.type, dataId: body.data?.id }, 'Webhook MP recebido');

  // Processar status do pagamento
  // if (body.type === 'payment') {
  //   const paymentId = body.data.id;
  //   // Consultar status, atualizar banco de dados, liberar acesso do usuário...
  // }

  return { received: true, processed: false };
}
