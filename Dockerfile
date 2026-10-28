# Сборка: Mini App и сервер
FROM node:22-bookworm-slim AS build
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
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
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
