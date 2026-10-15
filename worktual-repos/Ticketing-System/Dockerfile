# Ticketing API + SPA (Express serves ui-frontend/dist in production)
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY ui-frontend/package.json ui-frontend/
COPY ui-backend/package.json ui-backend/
RUN npm ci
COPY ui-frontend ui-frontend
COPY ui-backend ui-backend
COPY tsconfig.json ./
# Optional Vite public env (baked into SPA at build time)
ARG VITE_COWORKER_MODEL_NAME=
ARG VITE_COWORKER_MODEL_URL=
ENV VITE_COWORKER_MODEL_NAME=$VITE_COWORKER_MODEL_NAME \
    VITE_COWORKER_MODEL_URL=$VITE_COWORKER_MODEL_URL
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY package.json package-lock.json ./
COPY ui-frontend/package.json ui-frontend/
COPY ui-backend/package.json ui-backend/
# --ignore-scripts: vite (prod dep) and tsx/esbuild disagree on binary version during
# postinstall; runtime only needs node dist/server.cjs + Express/pg/etc. (no esbuild).
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# Layout matches bundled server paths:
#   __dirname = /app/dist → REPO_ROOT = /app → ui-frontend + uploads
COPY --from=build /src/ui-backend/dist/server.cjs /app/dist/server.cjs
COPY --from=build /src/ui-backend/dist/server.cjs.map /app/dist/server.cjs.map
COPY --from=build /src/ui-backend/public /app/dist/public
COPY --from=build /src/ui-frontend/dist /app/ui-frontend/dist
RUN mkdir -p /app/uploads
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
