// src/middlewares/auth.middleware.js
// Valida o Bearer token do Firebase e injeta req.user = { uid, email }

import { getFirebaseAuth } from '../config/firebase.js';
import logger from '../utils/logger.js';

/**
 * Middleware de autenticação via Firebase ID Token.
 *
 * Header esperado:
 *   Authorization: Bearer <idToken>
 *
 * Em caso de sucesso, injeta:
 *   req.user = { uid: string, email: string }
 */
export async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Token de autenticação ausente ou malformado.',
        hint: 'Envie o header: Authorization: Bearer <token>',
      });
    }

    const idToken = authHeader.split('Bearer ')[1].trim();

    if (!idToken) {
      return res.status(401).json({ error: 'Token vazio.' });
    }

    // Verifica e decodifica o token junto ao Firebase
    const decoded = await getFirebaseAuth().verifyIdToken(idToken);

    // Injeta os dados do usuário autenticado na requisição
    req.user = {
      uid: decoded.uid,
      email: decoded.email ?? null,
    };

    logger.debug({ uid: req.user.uid }, 'Usuário autenticado');
    next();
  } catch (err) {
    logger.warn({ err: err.message }, 'Falha na autenticação');

    // Diferencia token expirado de inválido para melhor DX
    if (err.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expirado. Faça login novamente.' });
    }

    return res.status(401).json({ error: 'Token inválido.' });
  }
}
