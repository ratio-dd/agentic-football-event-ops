FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV EVENT_DB_PATH=/data/event.db
COPY lightsail/runtime-package.json ./package.json
COPY lightsail/runtime-package-lock.json ./package-lock.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY public ./public
COPY config ./config
COPY lightsail/assets.mjs lightsail/server.mjs lightsail/sqlite-d1.mjs lightsail/tenant-directory.mjs ./lightsail/
COPY lightsail/runtime ./lightsail/runtime
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "lightsail/server.mjs"]
