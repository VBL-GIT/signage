import rateLimit from 'express-rate-limit';

// Protects the credential endpoint from brute-force / credential-stuffing.
// Keyed by client IP (trust proxy is enabled in app.ts so this is the real IP
// behind a load balancer). 10 attempts per 15 minutes is generous for humans
// but throttles automated guessing.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Coarse denial-of-service backstop for the rest of the API. Kept high on
// purpose: many RJCorp admins share one corporate NAT IP, so a low cap would
// cause false positives during bulk work. Tune per deployment.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
