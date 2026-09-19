FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY enforcer.ts ./
COPY network.ts ./
COPY tsconfig.json ./

CMD ["npx", "tsx", "enforcer.ts"]
