import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { allowedOrigins } from './config/env';
import { apiLimiter, loginLimiter } from './middleware/rateLimit';
import authRoutes from './routes/auth';
import storeRoutes from './routes/stores';
import taskRoutes from './routes/tasks';
import uploadRoutes from './routes/uploads';
import referenceRoutes from './routes/reference';
import vendorRoutes from './routes/vendors';
import bulkRoutes from './routes/bulk';
import roleRoutes from './routes/roles';
import artworkRoutes from './routes/artworks';
import reportRoutes from './routes/reports';
import imageRoutes from './routes/images';
import { errorHandler } from './middleware/errorHandler';

const app = express();

// Behind a managed load balancer / reverse proxy in production — needed so
// express-rate-limit and req.ip see the real client address, not the proxy.
app.set('trust proxy', 1);

app.use(helmet());

// Lock CORS to the configured web origin(s). With no ALLOWED_ORIGINS set
// (development) we reflect any origin for convenient LAN/device testing.
app.use(
  cors(
    allowedOrigins.length
      ? { origin: allowedOrigins, credentials: true }
      : {}
  )
);

// Cap request bodies — JSON payloads here are small (task steps, photo URLs);
// binary photo data never touches this server (presigned Supabase uploads).
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Throttle credential guessing before the auth router; broad backstop on the rest.
app.use('/api/auth/login', loginLimiter);
app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/bulk', bulkRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/artworks', artworkRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/images', imageRoutes);
app.use('/api', referenceRoutes);

app.use(errorHandler);

export default app;
