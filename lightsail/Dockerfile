FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV EVENT_DB_PATH=/data/event.db
COPY lightsail/runtime-package.json ./package.json
RUN npm install --omit=dev --ignore-scripts --no-package-lock && npm cache clean --force
COPY public ./public
COPY lightsail/assets.mjs lightsail/server.mjs lightsail/sqlite-d1.mjs ./lightsail/
COPY lightsail/runtime ./lightsail/runtime
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "lightsail/server.mjs"]
