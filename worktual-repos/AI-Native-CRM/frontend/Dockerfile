# Vite SPA → nginx (same-origin /api and /socket-io proxied to Fastify).
FROM node:20-bookworm-slim AS build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./

ARG VITE_GOOGLE_CLOUD_PROJECT_NUMBER=
ENV VITE_GOOGLE_CLOUD_PROJECT_NUMBER=$VITE_GOOGLE_CLOUD_PROJECT_NUMBER

RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 5173 4001
