import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// WebXR requires a secure context. A Quest headset can't reach a plain http:// dev server over
// LAN (other than localhost, which the headset obviously isn't), so this dev server always runs
// over HTTPS with an auto-generated self-signed cert — Quest Browser will show a one-time
// "connection isn't private" warning to click through, that's expected (see README.md).
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true, // bind 0.0.0.0 so the Quest can reach this machine over the LAN, not just localhost
  },
});
