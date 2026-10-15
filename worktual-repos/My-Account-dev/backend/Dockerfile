FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY database ./database
COPY assets ./assets
COPY data ./data
RUN mkdir -p /app/logs /app/server/data/pdfs \
  && chown -R node:node /app/logs /app/server
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
