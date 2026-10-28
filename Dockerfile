# Сборка: Mini App, сервер и зависимости рабочего образа.
# better-sqlite3 компилируется при установке, поэтому нужны python3, make и g++.
FROM node:22-bookworm-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci
COPY web web
COPY server server
RUN npm run build
# Оставляем только зависимости сервера, без dev-пакетов
RUN rm -rf node_modules web/node_modules server/node_modules \
 && npm ci --omit=dev --workspace server \
 && mkdir -p server/node_modules

# Рабочий образ: собранный сервер, его зависимости и фронт, без компилятора
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/package.json server/
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
