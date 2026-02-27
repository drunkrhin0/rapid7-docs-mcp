FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY --from=builder /app/dist/ ./dist/
COPY crawl.ts ./
COPY crawl-extensions.ts ./
COPY crawl-site.ts ./
COPY toolkits_complete.json ./
COPY src/text.ts ./src/text.ts
COPY src/crawl-utils.ts ./src/crawl-utils.ts
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

VOLUME /app/docs
VOLUME /app/data
EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
