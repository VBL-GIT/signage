import { UserRole } from './domain';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
        email: string;
        vendor_id: string | null;
      };
    }
  }
}

export {};
