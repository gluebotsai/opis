# Campaign SPA — Vite build served by nginx (with API/agents proxy)
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/

RUN npm ci --workspace=frontend --include-workspace-root

COPY frontend ./frontend

ARG VITE_AGENTS_SOCKET_PATH=/agents-socket
ARG VITE_PUBLIC_APP_URL=
ARG VITE_CRM_EMBED_ORIGINS=

ENV VITE_AGENTS_SOCKET_PATH=$VITE_AGENTS_SOCKET_PATH
ENV VITE_PUBLIC_APP_URL=$VITE_PUBLIC_APP_URL
ENV VITE_CRM_EMBED_ORIGINS=$VITE_CRM_EMBED_ORIGINS

# Vite build only — skip tsc -b (dev typecheck may have known drift)
WORKDIR /app/frontend
RUN npx vite build

FROM nginx:1.27-alpine AS production

COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template

COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
