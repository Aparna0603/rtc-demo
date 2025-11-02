import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import nodePolyfills from 'rollup-plugin-node-polyfills'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 👇 absolute path for "events" to fix duplication
      events: path.resolve(__dirname, 'node_modules/events/'),
      process: 'process/browser',
      util: 'util',
      buffer: 'buffer',
    },
  },
  define: {
    global: 'globalThis', // 👈 Fixes "global is not defined"
  },
  optimizeDeps: {
    include: ['simple-peer', 'socket.io-client', 'events'],
  },
  build: {
    rollupOptions: {
      plugins: [nodePolyfills()],
    },
  },
})
