FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o scrawl cmd/server/main.go

FROM alpine:3.22
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/scrawl .
COPY --from=builder /app/web ./web
EXPOSE 8080
CMD ["./scrawl"]