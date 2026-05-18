FROM node:20-alpine
WORKDIR /app

# Create non-root user
RUN addgroup -S app && adduser -S app -G app

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

# Ensure volumes are writable by app user
USER root
RUN mkdir -p /app/docs /app/data && chown -R app:app /app/docs /app/data
USER app

ENTRYPOINT ["/docker-entrypoint.sh"]
