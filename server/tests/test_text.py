"""Verify Python stemmer produces identical output to TypeScript stemmer in src/text.ts.

These tests cover every suffix rule. Must pass for search parity.
"""

from server.text import STOP_WORDS, stem, tokenize


class TestStopWords:
    def test_common_stop_words_filtered(self) -> None:
        assert "the" in STOP_WORDS
        assert "and" in STOP_WORDS
        assert "for" in STOP_WORDS
        assert "is" in STOP_WORDS
        assert "was" in STOP_WORDS

    def test_meaningful_words_not_filtered(self) -> None:
        assert "configuration" not in STOP_WORDS
        assert "search" not in STOP_WORDS
        assert "api" not in STOP_WORDS
        assert "docker" not in STOP_WORDS


class TestStem:
    def test_short_words_unchanged(self) -> None:
        assert stem("api") == "api"
        assert stem("log") == "log"

    def test_ation_suffix(self) -> None:
        assert stem("configuration") == "configur"
        assert stem("documentation") == "document"
        assert stem("authentication") == "authentic"

    def test_ment_suffix(self) -> None:
        # -ment strips last 4 chars: management → manage
        assert stem("management") == "manage"
        assert stem("deployment") == "deploy"

    def test_ness_suffix(self) -> None:
        assert stem("awareness") == "aware"
        assert stem("effectiveness") == "effective"

    def test_able_ible_suffix(self) -> None:
        assert stem("configurable") == "configur"
        assert stem("accessible") == "access"

    def test_ing_suffix(self) -> None:
        # -ing with doubled-consonant correction: scanning→scan, running→run
        assert stem("scanning") == "scan"
        assert stem("configuring") == "configur"
        assert stem("logging") == "log"
        assert stem("running") == "run"

    def test_ed_suffix(self) -> None:
        assert stem("scanned") == "scan"
        assert stem("configured") == "configur"
        assert stem("logged") == "log"

    def test_plural_ies(self) -> None:
        assert stem("policies") == "polici"
        assert stem("activities") == "activiti"

    def test_plural_sses(self) -> None:
        # -sses strips last 2 chars (the "es"): classes→class, processes→process
        assert stem("classes") == "class"
        assert stem("processes") == "process"

    def test_plural_general_s(self) -> None:
        assert stem("logs") == "log"
        assert stem("servers") == "server"
        assert stem("engines") == "engine"

    def test_plural_s_excluded(self) -> None:
        # -ss excluded: access stays access
        assert stem("access") == "access"
        # -us excluded: virus stays virus
        assert stem("virus") == "virus"
        # But Kubernetes → kubernete (ends in -es, not -us or -ss)
        assert stem("kubernetes") == "kubernete"

    def test_ly_suffix(self) -> None:
        assert stem("automatically") == "automatical"
        assert stem("quickly") == "quick"

    def test_er_suffix(self) -> None:
        # scanner → scar? No, "scanner". slice(0,-2) = "scann", doubled-n → "scan"
        assert stem("scanner") == "scan"
        # runner → "runn" → doubled-n → "run"
        assert stem("runner") == "run"

    def test_trailing_e(self) -> None:
        assert stem("configure") == "configur"
        assert stem("update") == "updat"
        assert stem("engine") == "engin"

    def test_no_change(self) -> None:
        assert stem("insightvm") == "insightvm"
        assert stem("splunk") == "splunk"


class TestTokenize:
    def test_basic_tokenization(self) -> None:
        tokens = tokenize("Hello World API v2")
        assert tokens == ["hello", "world", "api", "v2"]

    def test_punctuation_stripped(self) -> None:
        tokens = tokenize("log-sources.md?query=test")
        assert tokens == ["log", "sources", "md", "query", "test"]

    def test_short_tokens_filtered(self) -> None:
        tokens = tokenize("a b c d e f g")
        assert tokens == []

    def test_mixed_case(self) -> None:
        tokens = tokenize("InsightIDR Log Sources")
        assert tokens == ["insightidr", "log", "sources"]
