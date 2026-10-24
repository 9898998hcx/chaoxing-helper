FROM node:24-bookworm

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --legacy-peer-deps --no-audit --no-fund

RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright

COPY --chown=node:node . .
# Next.js rewrites are compiled during build. This address is internal to Compose.
ARG API_INTERNAL_URL=http://api:3001
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
# Prisma generation reads a syntactically valid placeholder, without connecting to a DB.
RUN DATABASE_URL=postgresql://schema:unused@127.0.0.1:5432/schema npx prisma generate --schema prisma/postgresql/schema.prisma \
    && npm run build --workspace @resume/web \
    && chown -R node:node /app

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    PORT=3001
USER node
EXPOSE 3000 3001
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]
