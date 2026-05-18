FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
COPY crawl.ts ./
COPY crawl-extensions.ts ./
COPY crawl-site.ts ./
COPY crawl-external.ts ./
COPY toolkits_complete.json ./
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

VOLUME /app/docs
VOLUME /app/data

ENTRYPOINT ["/docker-entrypoint.sh"]
