// src/routes/clients.routes.js

import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import * as ctrl from '../controllers/clients.controller.js';

const router = Router();

router.use(authMiddleware);

router.get('/',       ctrl.list);
router.get('/:id',    ctrl.get);
router.post('/',      ctrl.create);
router.patch('/:id',  ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
