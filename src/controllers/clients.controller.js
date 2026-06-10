// src/controllers/clients.controller.js

import * as clientsService from '../services/clients.service.js';
import logger from '../utils/logger.js';

// GET /clients
export function list(req, res) {
  const clients = clientsService.listClients(req.user.uid);
  return res.json({ data: clients, total: clients.length });
}

// GET /clients/:id
export function get(req, res) {
  const client = clientsService.getClient(req.user.uid, req.params.id);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
  return res.json(client);
}

// POST /clients
export function create(req, res) {
  try {
    const client = clientsService.createClient(req.user.uid, req.body);
    return res.status(201).json(client);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// PATCH /clients/:id
export function update(req, res) {
  const client = clientsService.updateClient(req.user.uid, req.params.id, req.body);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado.' });
  return res.json(client);
}

// DELETE /clients/:id
export function remove(req, res) {
  const deleted = clientsService.deleteClient(req.user.uid, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Cliente não encontrado.' });
  return res.status(204).send();
}
