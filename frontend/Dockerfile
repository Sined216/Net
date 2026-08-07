# --- сборка ---------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Отдельным слоем, чтобы установка зависимостей не повторялась при каждой
# правке исходников.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Пустой базовый адрес: фронтенд и API за одним nginx, запросы идут на
# /api того же origin.
ENV VITE_API_BASE_URL=/api
RUN npm run build

# --- раздача --------------------------------------------------------------
FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
