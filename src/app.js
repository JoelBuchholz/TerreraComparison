import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/apiRoutes.js';
import errorHandler from './middleware/errorMiddleware.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/', apiRoutes);

app.use(errorHandler);

export default app;