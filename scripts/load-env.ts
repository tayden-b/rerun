import { loadEnvConfig } from '@next/env';

// Load `.env*` files the same way `next dev` does, so CLI scripts and the app see the same settings.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
