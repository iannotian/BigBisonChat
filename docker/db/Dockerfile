FROM postgres:15-alpine
WORKDIR /
EXPOSE 5432
COPY ./seed/init.sql /docker-entrypoint-initdb.d/
COPY ./seed/*.csv /seed/