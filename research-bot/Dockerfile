FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir /app/data && chown node:node /app/data
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production
ENV RESEARCH_DATABASE_PATH=/app/data/messages.sqlite
VOLUME /app/data
CMD ["node", "index.js"]
