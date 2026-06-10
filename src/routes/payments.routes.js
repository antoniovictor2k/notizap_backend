// src/routes/payments.routes.js

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import * as ctrl from '../controllers/payments.controller.js';

const router = Router();

// /pix → requer auth (usuário solicita cobrança)
router.post('/pix', authMiddleware, ctrl.createPix);

// /webhook → sem auth Firebase, validado via assinatura HMAC do MP
router.post('/webhook', ctrl.webhook);

export default router;
