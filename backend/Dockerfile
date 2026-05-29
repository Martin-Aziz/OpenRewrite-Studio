FROM golang:1.25-alpine AS builder
WORKDIR /src
COPY backend/go.mod backend/go.sum* ./
RUN go mod download
COPY backend ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM alpine:3.21
RUN adduser -D -H -s /sbin/nologin appuser
WORKDIR /app
COPY --from=builder /out/api /app/api
USER appuser
EXPOSE 8080
CMD ["/app/api"]
