# Сборка: Mini App и сервер
FROM node:22-bookworm-slim AS build
# Зеркало npm, если registry.npmjs.org недоступен с сервера (см. .env.example).
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV npm_config_registry=$NPM_REGISTRY
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci
COPY web web
COPY server server
RUN npm run build

# Рабочий образ: только сервер, его зависимости и собранный фронт
FROM node:22-bookworm-slim
ARG NPM_REGISTRY=https://registry.npmjs.org/
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server --registry=$NPM_REGISTRY && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY server/migrations server/migrations
COPY --from=build /app/web/dist web/dist
WORKDIR /app/server
ENV PORT=3000 DATABASE_PATH=/data/opencart.db STATIC_DIR=/app/web/dist
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
