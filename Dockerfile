# Stage Pilot hub — Node + LibreOffice (PPTX->PDF) + poppler (PDF->PNG/text)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/hub/package.json apps/hub/
COPY tools/replay/package.json tools/replay/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/hub apps/hub
COPY tools/replay tools/replay
RUN npm run build

FROM node:22-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice poppler-utils fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HUB_HOST=0.0.0.0 DATA_DIR=/data
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/hub/package.json apps/hub/
COPY tools/replay/package.json tools/replay/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/hub/dist apps/hub/dist
RUN mkdir -p /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/hub/dist/index.js"]
