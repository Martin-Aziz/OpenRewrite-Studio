package repository

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"github.com/openrewrite/studio/backend/internal/domain"
)

type MemoryStore struct {
	mu       sync.RWMutex
	sessions map[string]domain.RewriteSession
	order    []string
	presets  map[string]domain.Preset
	apiKeys  map[string]domain.APIKey
}

func NewMemoryStore() *MemoryStore {
	store := &MemoryStore{
		sessions: make(map[string]domain.RewriteSession),
		presets:  make(map[string]domain.Preset),
		apiKeys:  make(map[string]domain.APIKey),
	}
	store.seedPresets()
	return store
}

func (store *MemoryStore) SaveSession(session domain.RewriteSession) domain.RewriteSession {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.sessions[session.SessionID] = session
	store.order = append([]string{session.SessionID}, store.order...)
	return session
}

func (store *MemoryStore) ListSessions() []domain.RewriteSession {
	store.mu.RLock()
	defer store.mu.RUnlock()
	sessions := make([]domain.RewriteSession, 0, len(store.order))
	for _, id := range store.order {
		sessions = append(sessions, store.sessions[id])
	}
	return sessions
}

func (store *MemoryStore) GetSession(id string) (domain.RewriteSession, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()
	session, ok := store.sessions[id]
	if !ok {
		return domain.RewriteSession{}, domain.ErrNotFound
	}
	return session, nil
}

func (store *MemoryStore) AcceptSession(id string) (domain.RewriteSession, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	session, ok := store.sessions[id]
	if !ok {
		return domain.RewriteSession{}, domain.ErrNotFound
	}
	now := time.Now().UTC()
	session.AcceptedAt = &now
	store.sessions[id] = session
	return session, nil
}

func (store *MemoryStore) ListPresets() []domain.Preset {
	store.mu.RLock()
	defer store.mu.RUnlock()
	presets := make([]domain.Preset, 0, len(store.presets))
	for _, preset := range store.presets {
		presets = append(presets, preset)
	}
	return presets
}

func (store *MemoryStore) SavePreset(preset domain.Preset) domain.Preset {
	store.mu.Lock()
	defer store.mu.Unlock()
	if preset.ID == "" {
		preset.ID = NewID("preset")
	}
	store.presets[preset.ID] = preset
	return preset
}

func (store *MemoryStore) DeletePreset(id string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, ok := store.presets[id]; !ok {
		return domain.ErrNotFound
	}
	delete(store.presets, id)
	return nil
}

func (store *MemoryStore) CreateAPIKey(name string) domain.APIKey {
	store.mu.Lock()
	defer store.mu.Unlock()
	token := NewID("ors")
	key := domain.APIKey{ID: NewID("key"), Name: name, TokenPreview: token[:12] + "...", CreatedAt: time.Now().UTC()}
	store.apiKeys[key.ID] = key
	return key
}

func (store *MemoryStore) DeleteAPIKey(id string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if _, ok := store.apiKeys[id]; !ok {
		return domain.ErrNotFound
	}
	delete(store.apiKeys, id)
	return nil
}

func (store *MemoryStore) UsageSummary() domain.UsageSummary {
	store.mu.RLock()
	defer store.mu.RUnlock()
	var accepted int
	var scoreTotal float64
	var latencyTotal int64
	for _, session := range store.sessions {
		if session.AcceptedAt != nil {
			accepted++
		}
		scoreTotal += session.Evaluation.MeaningScore
		latencyTotal += session.LatencyMS
	}
	count := len(store.sessions)
	if count == 0 {
		return domain.UsageSummary{}
	}
	return domain.UsageSummary{
		RewriteCount:        count,
		AcceptedCount:       accepted,
		AverageMeaningScore: scoreTotal / float64(count),
		AverageLatencyMS:    float64(latencyTotal) / float64(count),
	}
}

func NewID(prefix string) string {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		panic(err)
	}
	return prefix + "_" + hex.EncodeToString(bytes)
}

func (store *MemoryStore) seedPresets() {
	store.SavePreset(domain.Preset{ID: "preset_founder", Name: "Founder LinkedIn", Mode: domain.ModeNatural, Tone: domain.ToneConfident, Strength: 62, MeaningLock: true})
	store.SavePreset(domain.Preset{ID: "preset_academic", Name: "Academic concise", Mode: domain.ModeAcademic, Tone: domain.ToneFormal, Strength: 44, MeaningLock: true})
	store.SavePreset(domain.Preset{ID: "preset_warm_sales", Name: "Warm sales email", Mode: domain.ModeProfessional, Tone: domain.ToneWarm, Strength: 55, MeaningLock: true})
}
