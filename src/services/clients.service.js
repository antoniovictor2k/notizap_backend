// src/services/clients.service.js
// CRUD de clientes por usuário autenticado.
// ⚠️  Armazenamento em memória — substitua por banco de dados (Firestore/PostgreSQL)
//     em produção. A interface permanece a mesma após a troca.

import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';

/**
 * Estrutura de um cliente:
 * {
 *   id:        string (UUID),
 *   userId:    string (Firebase UID do dono),
 *   name:      string,
 *   phone:     string,
 *   email?:    string,
 *   notes?:    string,
 *   createdAt: string (ISO 8601),
 *   updatedAt: string (ISO 8601),
 * }
 */

// Map: userId → Client[]
const store = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUserClients(userId) {
  if (!store.has(userId)) store.set(userId, []);
  return store.get(userId);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function listClients(userId) {
  return getUserClients(userId);
}

export function getClient(userId, clientId) {
  return getUserClients(userId).find((c) => c.id === clientId) ?? null;
}

export function createClient(userId, data) {
  const { name, phone, email, notes } = data;

  if (!name || !phone) {
    throw new Error('Campos "name" e "phone" são obrigatórios.');
  }

  const now = new Date().toISOString();
  const client = {
    id: randomUUID(),
    userId,
    name: name.trim(),
    phone: String(phone).replace(/\D/g, ''),
    email: email?.trim() ?? null,
    notes: notes?.trim() ?? null,
    createdAt: now,
    updatedAt: now,
  };

  getUserClients(userId).push(client);
  logger.info({ userId, clientId: client.id }, 'Cliente criado');
  return client;
}

export function updateClient(userId, clientId, data) {
  const clients = getUserClients(userId);
  const idx = clients.findIndex((c) => c.id === clientId);

  if (idx === -1) return null;

  const { name, phone, email, notes } = data;
  const existing = clients[idx];

  clients[idx] = {
    ...existing,
    name: name?.trim() ?? existing.name,
    phone: phone ? String(phone).replace(/\D/g, '') : existing.phone,
    email: email !== undefined ? email?.trim() ?? null : existing.email,
    notes: notes !== undefined ? notes?.trim() ?? null : existing.notes,
    updatedAt: new Date().toISOString(),
  };

  logger.info({ userId, clientId }, 'Cliente atualizado');
  return clients[idx];
}

export function deleteClient(userId, clientId) {
  const clients = getUserClients(userId);
  const idx = clients.findIndex((c) => c.id === clientId);

  if (idx === -1) return false;

  clients.splice(idx, 1);
  logger.info({ userId, clientId }, 'Cliente removido');
  return true;
}
