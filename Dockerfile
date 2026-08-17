# Monorepo build: web/ (Vite/React) is compiled to static assets, then
# copied into the at-voice-app/ Express server's expected ../web/dist
# path (see at-voice-app/app.js's express.static mount), so the runtime
# image only needs the API's own production dependencies.

FROM node:20-alpine AS web-build
WORKDIR /repo/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /repo/at-voice-app
COPY at-voice-app/package*.json ./
RUN npm ci --omit=dev
COPY at-voice-app/ ./
COPY --from=web-build /repo/web/dist /repo/web/dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "app.js"]
