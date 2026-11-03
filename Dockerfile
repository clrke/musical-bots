# Musical Bots: serves the production static build (web/dist/ via nginx).
#
# The curated episodes replay fully inside the container (no keys); live
# director runs ("Make it" on a new prompt) need the Vercel deployment, which
# runs the director in a sandbox (see docs/HOSTING.md).
#
#   docker build -t musical-bots .
#   docker run --rm -p 8080:80 musical-bots
#   open http://localhost:8080
FROM node:22-slim AS build
WORKDIR /app
COPY web/package.json web/package-lock.json* web/
RUN npm ci --prefix web --no-audit --no-fund
COPY . .
RUN npm --prefix web run build

FROM nginx:alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
