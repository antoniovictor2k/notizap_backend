// src/controllers/logs.controller.js
// Expõe os logs de atividade do usuário armazenados no Firestore

import { getLogs } from '../services/firestore.service.js';

/**
 * GET /logs?limit=50
 * Retorna os últimos N logs do usuário autenticado.
 */
export async function list(req, res) {
  const limit = Math.min(Number(req.query.limit ?? 50), 200); // máx 200

  const logs = await getLogs(req.user.uid, limit);

  // Serializa Timestamps do Firestore para ISO string
  const serialized = logs.map((log) => ({
    ...log,
    createdAt: log.createdAt?.toDate?.()?.toISOString() ?? null,
  }));

  return res.json({ data: serialized, total: serialized.length });
}