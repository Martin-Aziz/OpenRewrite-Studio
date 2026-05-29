package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	_ "github.com/lib/pq"
	"github.com/openrewrite/studio/backend/internal/domain"
)

// PostgresRewriteRepository is a PostgreSQL-backed implementation of the store
// interface. All mutating methods use the passed context so callers can impose
// deadlines and cancellation.
type PostgresRewriteRepository struct {
	db *sql.DB
}

// NewPostgresDB opens and validates a PostgreSQL connection pool.
func NewPostgresDB(databaseURL string) (*sql.DB, error) {
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return db, nil
}

// NewPostgresRepository wraps an open *sql.DB.
func NewPostgresRepository(db *sql.DB) *PostgresRewriteRepository {
	return &PostgresRewriteRepository{db: db}
}

// -----------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------

const insertSession = `
INSERT INTO rewrite_sessions
    (id, mode, tone, strength, provider, original_text, rewritten_text, accepted_at, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

// CreateSession persists a new rewrite session together with its evaluation
// and sentence diffs. The evaluation is stored in the evaluations table; the
// sentence diffs go into rewrite_sentences.
func (r *PostgresRewriteRepository) CreateSession(ctx context.Context, session domain.RewriteSession) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	var acceptedAt sql.NullTime
	if session.AcceptedAt != nil {
		acceptedAt = sql.NullTime{Time: *session.AcceptedAt, Valid: true}
	}

	if _, err = tx.ExecContext(ctx, insertSession,
		session.SessionID,
		string(session.Mode),
		string(session.Tone),
		session.Strength,
		session.Provider,
		session.OriginalText,
		session.RewrittenText,
		acceptedAt,
		session.CreatedAt,
	); err != nil {
		return fmt.Errorf("insert rewrite_session: %w", err)
	}

	// Persist evaluation -------------------------------------------------------
	warningsJSON, err := json.Marshal(session.Evaluation.Warnings)
	if err != nil {
		return fmt.Errorf("marshal warnings: %w", err)
	}

	if _, err = tx.ExecContext(ctx, `
INSERT INTO evaluations
    (rewrite_session_id, meaning_score, confidence_score, facts_preserved, citations_preserved, warnings)
VALUES ($1, $2, $3, $4, $5, $6)`,
		session.SessionID,
		session.Evaluation.MeaningScore,
		session.Evaluation.ConfidenceScore,
		session.Evaluation.FactsPreserved,
		session.Evaluation.CitationsPreserved,
		warningsJSON,
	); err != nil {
		return fmt.Errorf("insert evaluation: %w", err)
	}

	// Persist sentence diffs ---------------------------------------------------
	for _, diff := range session.Diffs {
		if _, err = tx.ExecContext(ctx, `
INSERT INTO rewrite_sentences
    (rewrite_session_id, sentence_index, original_text, rewritten_text, change_ratio, status)
VALUES ($1, $2, $3, $4, $5, $6)`,
			session.SessionID,
			diff.Index,
			diff.Original,
			diff.Rewritten,
			diff.ChangeRatio,
			string(diff.Status),
		); err != nil {
			return fmt.Errorf("insert rewrite_sentence index %d: %w", diff.Index, err)
		}
	}

	return tx.Commit()
}

const selectSession = `
SELECT
    s.id, s.mode, s.tone, s.strength, s.provider,
    s.original_text, s.rewritten_text, s.accepted_at, s.created_at,
    COALESCE(e.meaning_score, 0),
    COALESCE(e.confidence_score, 0),
    COALESCE(e.facts_preserved, false),
    COALESCE(e.citations_preserved, false),
    COALESCE(e.warnings, '[]'::jsonb)
FROM rewrite_sessions s
LEFT JOIN evaluations e ON e.rewrite_session_id = s.id
WHERE s.id = $1`

// GetSession fetches a single session by its UUID string, including evaluation
// data and sentence diffs. Returns domain.ErrNotFound when the ID is absent.
func (r *PostgresRewriteRepository) GetSession(ctx context.Context, id string) (*domain.RewriteSession, error) {
	row := r.db.QueryRowContext(ctx, selectSession, id)
	session, err := scanSession(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("get session: %w", err)
	}

	diffs, err := r.loadDiffs(ctx, id)
	if err != nil {
		return nil, err
	}
	session.Diffs = diffs
	return session, nil
}

const listSessions = `
SELECT
    s.id, s.mode, s.tone, s.strength, s.provider,
    s.original_text, s.rewritten_text, s.accepted_at, s.created_at,
    COALESCE(e.meaning_score, 0),
    COALESCE(e.confidence_score, 0),
    COALESCE(e.facts_preserved, false),
    COALESCE(e.citations_preserved, false),
    COALESCE(e.warnings, '[]'::jsonb)
FROM rewrite_sessions s
LEFT JOIN evaluations e ON e.rewrite_session_id = s.id
ORDER BY s.created_at DESC`

// ListSessions returns all sessions ordered newest-first.
func (r *PostgresRewriteRepository) ListSessions(ctx context.Context) ([]*domain.RewriteSession, error) {
	rows, err := r.db.QueryContext(ctx, listSessions)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	var sessions []*domain.RewriteSession
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error: %w", err)
	}

	// Load diffs for each session (N+1 acceptable for typical session list sizes;
	// replace with a single JOIN + de-aggregation when volumes demand it).
	for _, session := range sessions {
		diffs, err := r.loadDiffs(ctx, session.SessionID)
		if err != nil {
			return nil, err
		}
		session.Diffs = diffs
	}
	return sessions, nil
}

// AcceptSession stamps accepted_at = NOW() on the given session and returns
// the updated record. Returns domain.ErrNotFound when the ID is absent.
func (r *PostgresRewriteRepository) AcceptSession(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx,
		`UPDATE rewrite_sessions SET accepted_at = NOW() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("accept session: %w", err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// -----------------------------------------------------------------------
// Presets
// -----------------------------------------------------------------------

// CreatePreset inserts a new preset row. If preset.ID is empty a UUID is
// generated by the database.
func (r *PostgresRewriteRepository) CreatePreset(ctx context.Context, preset domain.Preset) error {
	var err error
	if preset.ID == "" {
		_, err = r.db.ExecContext(ctx, `
INSERT INTO presets (name, mode, tone, strength, meaning_lock)
VALUES ($1, $2, $3, $4, $5)`,
			preset.Name,
			string(preset.Mode),
			string(preset.Tone),
			preset.Strength,
			preset.MeaningLock,
		)
	} else {
		_, err = r.db.ExecContext(ctx, `
INSERT INTO presets (id, name, mode, tone, strength, meaning_lock)
VALUES ($1, $2, $3, $4, $5, $6)`,
			preset.ID,
			preset.Name,
			string(preset.Mode),
			string(preset.Tone),
			preset.Strength,
			preset.MeaningLock,
		)
	}
	if err != nil {
		return fmt.Errorf("create preset: %w", err)
	}
	return nil
}

// ListPresets returns every preset row ordered by name.
func (r *PostgresRewriteRepository) ListPresets(ctx context.Context) ([]*domain.Preset, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, name, mode, tone, strength, meaning_lock
FROM presets
ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list presets: %w", err)
	}
	defer rows.Close()

	var presets []*domain.Preset
	for rows.Next() {
		var p domain.Preset
		if err := rows.Scan(&p.ID, &p.Name, &p.Mode, &p.Tone, &p.Strength, &p.MeaningLock); err != nil {
			return nil, fmt.Errorf("scan preset: %w", err)
		}
		presets = append(presets, &p)
	}
	return presets, rows.Err()
}

// UpdatePreset replaces a preset's mutable fields. Returns domain.ErrNotFound
// when the ID does not exist.
func (r *PostgresRewriteRepository) UpdatePreset(ctx context.Context, id string, preset domain.Preset) error {
	result, err := r.db.ExecContext(ctx, `
UPDATE presets
SET name = $1, mode = $2, tone = $3, strength = $4, meaning_lock = $5, updated_at = NOW()
WHERE id = $6`,
		preset.Name,
		string(preset.Mode),
		string(preset.Tone),
		preset.Strength,
		preset.MeaningLock,
		id,
	)
	if err != nil {
		return fmt.Errorf("update preset: %w", err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// DeletePreset removes a preset by ID. Returns domain.ErrNotFound when absent.
func (r *PostgresRewriteRepository) DeletePreset(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM presets WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete preset: %w", err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected: %w", err)
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

// scanner is satisfied by both *sql.Row and *sql.Rows so scanSession can be
// reused for single-row and multi-row queries.
type scanner interface {
	Scan(dest ...any) error
}

func scanSession(s scanner) (*domain.RewriteSession, error) {
	var session domain.RewriteSession
	var acceptedAt sql.NullTime
	var warningsJSON []byte

	if err := s.Scan(
		&session.SessionID,
		&session.Mode,
		&session.Tone,
		&session.Strength,
		&session.Provider,
		&session.OriginalText,
		&session.RewrittenText,
		&acceptedAt,
		&session.CreatedAt,
		&session.Evaluation.MeaningScore,
		&session.Evaluation.ConfidenceScore,
		&session.Evaluation.FactsPreserved,
		&session.Evaluation.CitationsPreserved,
		&warningsJSON,
	); err != nil {
		return nil, err
	}

	if acceptedAt.Valid {
		t := acceptedAt.Time
		session.AcceptedAt = &t
	}

	if len(warningsJSON) > 0 {
		if err := json.Unmarshal(warningsJSON, &session.Evaluation.Warnings); err != nil {
			return nil, fmt.Errorf("unmarshal warnings: %w", err)
		}
	}
	if session.Evaluation.Warnings == nil {
		session.Evaluation.Warnings = []domain.RewriteWarning{}
	}

	return &session, nil
}

func (r *PostgresRewriteRepository) loadDiffs(ctx context.Context, sessionID string) ([]domain.SentenceDiff, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT sentence_index, original_text, rewritten_text, change_ratio, status
FROM rewrite_sentences
WHERE rewrite_session_id = $1
ORDER BY sentence_index`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("load diffs: %w", err)
	}
	defer rows.Close()

	var diffs []domain.SentenceDiff
	for rows.Next() {
		var d domain.SentenceDiff
		if err := rows.Scan(&d.Index, &d.Original, &d.Rewritten, &d.ChangeRatio, &d.Status); err != nil {
			return nil, fmt.Errorf("scan diff: %w", err)
		}
		diffs = append(diffs, d)
	}
	if diffs == nil {
		diffs = []domain.SentenceDiff{}
	}
	return diffs, rows.Err()
}
