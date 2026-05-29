package domain

import (
	"errors"
	"strings"
	"time"
)

type RewriteMode string
type RewriteTone string
type RewriteProvider string
type DiffStatus string

const (
	ModeStandard     RewriteMode = "standard"
	ModeFluency      RewriteMode = "fluency"
	ModeProfessional RewriteMode = "professional"
	ModeSimple       RewriteMode = "simple"
	ModeShorten      RewriteMode = "shorten"
	ModeExpand       RewriteMode = "expand"
	ModeNatural      RewriteMode = "natural"
	ModeHumanize     RewriteMode = "humanize"
	ModeAcademic     RewriteMode = "academic"

	ToneNeutral   RewriteTone = "neutral"
	ToneWarm      RewriteTone = "warm"
	ToneDirect    RewriteTone = "direct"
	ToneFormal    RewriteTone = "formal"
	ToneConfident RewriteTone = "confident"
	ToneFriendly  RewriteTone = "friendly"

	ProviderLocal  RewriteProvider = "local"
	ProviderOpenAI RewriteProvider = "openai-compatible"
	ProviderOllama RewriteProvider = "ollama"
)

type RewriteRequest struct {
	Text        string          `json:"text"`
	Mode        RewriteMode     `json:"mode"`
	Tone        RewriteTone     `json:"tone"`
	Strength    int             `json:"strength"`
	MeaningLock bool            `json:"meaningLock"`
	Provider    RewriteProvider `json:"provider"`
}

type RewriteSession struct {
	SessionID     string            `json:"sessionId"`
	OriginalText  string            `json:"originalText"`
	RewrittenText string            `json:"rewrittenText"`
	Mode          RewriteMode       `json:"mode"`
	Tone          RewriteTone       `json:"tone"`
	Strength      int               `json:"strength"`
	Provider      string            `json:"provider"`
	Diffs         []SentenceDiff    `json:"diffs"`
	Evaluation    RewriteEvaluation `json:"evaluation"`
	CreatedAt     time.Time         `json:"createdAt"`
	AcceptedAt    *time.Time        `json:"acceptedAt,omitempty"`
	LatencyMS     int64             `json:"latencyMs"`
}

type AIRewriteResponse struct {
	RewrittenText string            `json:"rewrittenText"`
	Provider      string            `json:"provider"`
	Diffs         []SentenceDiff    `json:"diffs"`
	Evaluation    RewriteEvaluation `json:"evaluation"`
}

type SentenceDiff struct {
	Index       int        `json:"index"`
	Original    string     `json:"original"`
	Rewritten   string     `json:"rewritten"`
	ChangeRatio float64    `json:"changeRatio"`
	Status      DiffStatus `json:"status"`
}

type RewriteEvaluation struct {
	MeaningScore       float64          `json:"meaningScore"`
	ConfidenceScore    float64          `json:"confidenceScore"`
	HumanizerScore     float64          `json:"humanizerScore"`
	NaturalnessScore   float64          `json:"naturalnessScore"`
	StyleNotes         []string         `json:"styleNotes"`
	FactsPreserved     bool             `json:"factsPreserved"`
	CitationsPreserved bool             `json:"citationsPreserved"`
	Warnings           []RewriteWarning `json:"warnings"`

	ReadabilityScore     float64 `json:"readabilityScore,omitempty"`
	SentenceVarietyScore float64 `json:"sentenceVarietyScore,omitempty"`
	PassiveVoiceReduced  bool    `json:"passiveVoiceReduced,omitempty"`
	AISignaturesRemoved  int     `json:"aiSignaturesRemoved,omitempty"`
	WordCountDelta       int     `json:"wordCountDelta,omitempty"`
	QualityTier          string  `json:"qualityTier,omitempty"`
}

type RewriteWarning struct {
	Code          string  `json:"code"`
	Message       string  `json:"message"`
	SentenceIndex *int    `json:"sentenceIndex,omitempty"`
	Confidence    float64 `json:"confidence"`
}

type Preset struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Mode        RewriteMode `json:"mode"`
	Tone        RewriteTone `json:"tone"`
	Strength    int         `json:"strength"`
	MeaningLock bool        `json:"meaningLock"`
}

type APIKey struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	TokenPreview string    `json:"tokenPreview"`
	CreatedAt    time.Time `json:"createdAt"`
}

type UsageSummary struct {
	RewriteCount        int     `json:"rewriteCount"`
	AcceptedCount       int     `json:"acceptedCount"`
	AverageMeaningScore float64 `json:"averageMeaningScore"`
	AverageLatencyMS    float64 `json:"averageLatencyMs"`
}

var ErrNotFound = errors.New("not found")

func (request RewriteRequest) Validate() error {
	if strings.TrimSpace(request.Text) == "" {
		return errors.New("text is required")
	}
	if len([]rune(request.Text)) > 12000 {
		return errors.New("text must be 12,000 characters or fewer")
	}
	if !validMode(request.Mode) {
		return errors.New("mode is invalid")
	}
	if !validTone(request.Tone) {
		return errors.New("tone is invalid")
	}
	if request.Strength < 0 || request.Strength > 100 {
		return errors.New("strength must be between 0 and 100")
	}
	if !validProvider(request.Provider) {
		return errors.New("provider is invalid")
	}
	return nil
}

func validMode(mode RewriteMode) bool {
	switch mode {
	case ModeStandard, ModeFluency, ModeProfessional, ModeSimple, ModeShorten, ModeExpand, ModeNatural, ModeHumanize, ModeAcademic:
		return true
	default:
		return false
	}
}

func validTone(tone RewriteTone) bool {
	switch tone {
	case ToneNeutral, ToneWarm, ToneDirect, ToneFormal, ToneConfident, ToneFriendly:
		return true
	default:
		return false
	}
}

func validProvider(provider RewriteProvider) bool {
	switch provider {
	case ProviderLocal, ProviderOpenAI, ProviderOllama:
		return true
	default:
		return false
	}
}
