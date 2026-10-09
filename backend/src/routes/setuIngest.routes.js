import express from 'express';
import { processSetuEvent } from '../controllers/setuIngest.controller.js';

const router = express.Router();

router.post('/', processSetuEvent);

export default router;
