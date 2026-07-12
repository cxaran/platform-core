FROM node:22-alpine AS base

WORKDIR /app

RUN addgroup -S gateway \
  && adduser -S gateway -G gateway

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src

RUN npm run build \
  && npm prune --omit=dev

# Target de desarrollo: conserva las devDependencies (tsx) y arranca con recarga en
# caliente. El código se monta por bind volume en compose.dev.yml; node_modules vive en
# un volumen nombrado para no pisarse con el bind. No se usa en producción.
FROM node:22-alpine AS dev

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src

ENV NODE_ENV=development

EXPOSE 8081

CMD ["npm", "run", "dev"]

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -S gateway \
  && adduser -S gateway -G gateway

COPY --from=base /app/package.json ./
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist

USER gateway

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8081/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
