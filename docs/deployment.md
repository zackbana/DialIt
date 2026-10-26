# Local HTTPS and private-server deployment

Use a long-running Node.js 24 host with FFmpeg/FFprobe, a writable persistent local disk and a trusted network. This custom server must not be deployed as independent Next.js serverless handlers. SQLite and Socket.IO are configured for a single server instance; do not run multiple workers/replicas against the same installation without a separate design.

## HTTPS for tablets on a Mac LAN

For a private pilot, one practical approach is **mkcert + Caddy**. These are operator-installed tools; the application does not download or provision certificates at runtime. Examples below use `192.168.1.50` — replace it with your Mac’s actual/reserved LAN IP.

```sh
brew install mkcert caddy
mkcert -install
mkdir -p certs
mkcert -cert-file certs/dialit.pem -key-file certs/dialit-key.pem 192.168.1.50 localhost 127.0.0.1
```

Install **only the public `rootCA.pem`** from `mkcert -CAROOT` as a trusted root on each tablet according to the device/vendor’s procedure. On iPadOS this generally includes installing the profile and explicitly enabling full trust under Certificate Trust Settings; Android has its own user-CA installation policy. Managed devices may prohibit user roots — consult your device administrator. **Never distribute `rootCA-key.pem` or the server private key.** Validate trust with the actual browser; do not train participants to ignore certificate errors.

Copy `deployment/Caddyfile.example` to an ignored local `Caddyfile`, replace its address and absolute certificate paths, and set `.env`:

```dotenv
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=true
COOKIE_SECURE=true
PUBLIC_ORIGIN=https://192.168.1.50:8443
```

Then:

```sh
npm run build
npm start
# In a second terminal:
caddy run --config Caddyfile
```

Open `https://192.168.1.50:8443` on the Mac and all tablets. Port 8443 avoids needing privileged port 443. Allow only the trusted local network through the firewall. Caddy forwards both HTTP/range requests and WebSocket upgrades to the same server. Use the HTTPS origin to create QR/display links and log in; a Secure cookie will deliberately not work on plain HTTP. A changed IP/hostname requires a matching certificate and `PUBLIC_ORIGIN`.

HTTP on a LAN address is generally not a secure context for Wake Lock. HTTPS plus trusted certificates enables eligible secure-context features, but browser/device policies may still deny them; test and retain the manual auto-lock fallback.

## Private server

Use an approved internal DNS name and a certificate trusted by all participating devices (your organisation’s CA or approved private reverse proxy). Keep Node bound to loopback behind that single proxy, configure its exact HTTPS origin and trusted-proxy setting, preserve WebSocket upgrades, and allow long-lived connections. Set the proxy’s body-size/timeouts to support the configured MP4 upload limit. Keep private data outside any public static-file root.

A service manager may run `npm start` from the repository root after a successful `npm ci`, `npm run setup`, account creation and `npm run build`. Retain `db/migrations`, `.next`, `dist`, dependencies, `.env`, database and media. Do not use Next.js standalone/serverless output with this custom-server arrangement. Keep the Node/FFmpeg/runtime versions patched and test before changing a rehearsed build.

No public deployment, external cloud services or production readiness is implied. Account provisioning/password replacement are local administrative tasks rather than a self-service public registration flow. The application applies role/scope checks, rate limits, parameterised queries, validated uploads and secure password handling, but a real production/private-server rollout still needs your organisation’s operational review and the physical-device rehearsal.
