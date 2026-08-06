import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // host:true binds to the LAN; allowedHosts:true lets the Cloudflare tunnel
  // hostname (*.trycloudflare.com) through Vite's host check for public testing.
  server: { port: 5173, host: true, allowedHosts: true },
});
