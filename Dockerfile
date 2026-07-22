# deps: install node_modules once, cached
FROM node:24-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# build: prisma generate + next build; also reused by compose as the migrate runner
FROM node:24-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# runner: minimal standalone runtime
FROM node:24-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
# Next's standalone server.js binds to $HOSTNAME, and Docker sets HOSTNAME to
# the container id — so it listens on the container IP only and 127.0.0.1 is
# refused. Caddy still reaches it by service name, so the app looks fine in a
# browser while the healthcheck fails forever and Docker restarts it.
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
