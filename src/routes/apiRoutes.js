import { Router } from 'express';
import { authenticateAdmin, verifyBearerToken } from '../middleware/authMiddleware.js';
import { TokenController } from '../controllers/tokenController.js';
import { OrderController } from '../controllers/orderController.js';
import { TokenService } from '../services/tokenService.js';

const router = Router();
const tokenService = new TokenService();
const tokenController = new TokenController(tokenService);
const orderController = new OrderController(tokenService);

router.get('/token/:tokenName', authenticateAdmin, tokenController.handleTokenRotation);

router.post(
  '/getFilteredOrders',
  verifyBearerToken(tokenService),
  orderController.getFilteredOrders
);

router.post(
  '/updateFilteredOrders',
  verifyBearerToken(tokenService),
  orderController.updateFilteredOrders
);

router.get(
  '/jobs/:jobId',
  verifyBearerToken(tokenService),
  orderController.getJobStatus
);

tokenService.startTokenRotation();

export default router;