FROM node:22-alpine

WORKDIR /app

# Install server deps
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy frontend source + build config
COPY arc ./arc

# Build-time network selection (TASK 10A-REVISION). Required, no default —
# every build must explicitly choose exactly "arc-testnet" or "arc-mainnet".
# Vite's actual process.env always takes priority over a matching key in
# arc/.env.production (the checked-in file), so promoting this ARG to a real
# ENV var here safely overrides that file's default at build time without
# editing or duplicating it — the same Dockerfile/source tree builds either
# network. Missing/unsupported values fail the BUILD itself (this RUN step),
# not just app startup — `vite build` alone never fails on a bad
# VITE_NETWORK (it's a pure bundler, see helpers.js's own comment on this),
# so without this explicit check a bad value would silently produce a
# broken bundle that only fails once a user's browser loads it. Each Fly
# app supplies its own value automatically via fly.toml's [build.args] —
# see fly.toml (Arc Testnet) for the working example; a future Arc Mainnet
# fly.toml supplies VITE_NETWORK = "arc-mainnet" the same way.
ARG VITE_NETWORK
ENV VITE_NETWORK=${VITE_NETWORK}
RUN if [ "$VITE_NETWORK" != "arc-testnet" ] && [ "$VITE_NETWORK" != "arc-mainnet" ]; then \
      echo "ERROR: VITE_NETWORK build arg must be exactly 'arc-testnet' or 'arc-mainnet' — got: '$VITE_NETWORK'" >&2; \
      exit 1; \
    fi

# Build frontend with Vite (JSX → optimized JS+CSS bundle)
WORKDIR /app/arc
RUN npm install --no-audit --no-fund && npx vite build && mv dist/index.vite.html dist/index.html && \
    cp -r assets dist/assets 2>/dev/null; \
    cp -r styles dist/styles 2>/dev/null; \
    cp -r images dist/images 2>/dev/null; \
    true
WORKDIR /app

# Copy server + admin backend + auth + public assets
COPY server-arc.js ./
COPY admin_routes.js ./
COPY network-config.js ./
COPY static-serve.js ./
COPY domain-config.js ./
COPY keeper-heartbeat.js ./
COPY config ./config
COPY auth.js ./
COPY cid-auth.js ./
COPY contract-form-lock.js ./
COPY text-filter.js ./
COPY reserved-names.js ./
COPY telegram-notify.js ./
COPY public ./public

EXPOSE 3001

CMD ["node", "server-arc.js"]
