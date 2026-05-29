package config

import (
	"log/slog"
	"os"
	"strings"
)

type Config struct {
	Port         string
	AIServiceURL string
	LogLevel     slog.Level
}

func Load() Config {
	return Config{
		Port:         env("API_PORT", "8080"),
		AIServiceURL: strings.TrimRight(env("AI_SERVICE_URL", "http://localhost:8000"), "/"),
		LogLevel:     parseLogLevel(env("LOG_LEVEL", "info")),
	}
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
