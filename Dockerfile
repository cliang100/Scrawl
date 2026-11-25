FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o scrawl ./cmd/server

FROM alpine:3.22
RUN apk --no-cache add ca-certificates && adduser -D -H scrawl
WORKDIR /app
COPY --from=builder /app/scrawl .
COPY web ./web
USER scrawl
ENV GIN_MODE=release
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://localhost:${PORT:-8080}/healthz || exit 1
CMD ["./scrawl"]
