// src/routes/whatsapp.routes.js

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import * as ctrl from '../controllers/whatsapp.controller.js';

const router = Router();

// Todas as rotas de WhatsApp exigem autenticação
router.use(authMiddleware);

router.post('/connect',      ctrl.connect);
router.get('/status',        ctrl.status);
router.post('/pairing-code', ctrl.pairingCode);
router.post('/send',         ctrl.send);

export default router;
