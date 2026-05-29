package config

import (
	"errors"
	"log/slog"
	"os"
	"strings"
)

const defaultJWTSecret = "change-me-to-strong-secret"

type Config struct {
	Port         string
	AIServiceURL string
	LogLevel     slog.Level
	DatabaseURL  string
	RedisURL     string
	FrontendURL  string
	JWTSecret    string
	Environment  string
}

func Load() (Config, error) {
	cfg := Config{
		Port:         env("API_PORT", "8080"),
		AIServiceURL: strings.TrimRight(env("AI_SERVICE_URL", "http://localhost:8000"), "/"),
		LogLevel:     parseLogLevel(env("LOG_LEVEL", "info")),
		DatabaseURL:  env("DATABASE_URL", ""),
		RedisURL:     env("REDIS_URL", ""),
		FrontendURL:  env("FRONTEND_URL", "http://localhost:3000"),
		JWTSecret:    env("JWT_SECRET", defaultJWTSecret),
		Environment:  env("APP_ENV", "development"),
	}

	if cfg.Environment == "production" && cfg.JWTSecret == defaultJWTSecret {
		return Config{}, errors.New("JWT_SECRET must be changed from the default value in production")
	}

	return cfg, nil
}

func env(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func parseLogLevel(value string) slog.Level {
	switch strings.ToLower(value) {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
