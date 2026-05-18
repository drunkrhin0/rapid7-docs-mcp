"""
Stemmer, stop words, and tokenizer — MUST match src/text.ts exactly.

These functions must produce identical output to the TypeScript originals
because the search index is built by the crawlers (Node.js) and queried by
the FastMCP server (Python). Any divergence breaks search.
"""

STOP_WORDS: frozenset[str] = frozenset([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did", "will",
    "would", "could", "should", "may", "might", "can", "shall", "must",
    "it", "its", "this", "that", "these", "those", "i", "you", "he",
    "she", "we", "they", "my", "your", "his", "her", "our", "their",
    "what", "which", "who", "whom", "how", "when", "where", "why",
    "not", "no", "nor", "if", "then", "than", "so", "just", "also",
    "about", "up", "out", "into", "over", "after", "before", "between",
    "through", "during", "above", "below", "each", "all", "any", "both",
    "few", "more", "most", "other", "some", "such", "only", "own",
    "same", "very", "too", "quite",
])


def stem(word: str) -> str:
    """
    Simple suffix-stripping stemmer for English technical documentation.
    Must produce identical output to stem() in src/text.ts.

    Examples:
        configuration → configur
        scanning → scan
        logged → log
    """
    if len(word) < 4:
        return word

    # -ation (configuration → configur)
    if len(word) > 7 and word.endswith("ation"):
        return word[:-5]

    # -ment (management → manag)
    if len(word) > 6 and word.endswith("ment"):
        return word[:-4]

    # -ness (awareness → aware, effectiveness → effective)
    if len(word) > 6 and word.endswith("ness"):
        return word[:-4]

    # -able/-ible (configurable → configur)
    if len(word) > 6 and (word.endswith("able") or word.endswith("ible")):
        return word[:-4]

    # -ing + doubled-consonant correction
    if len(word) > 5 and word.endswith("ing"):
        base = word[:-3]
        if len(base) > 2 and base[-1] == base[-2]:
            return base[:-1]
        return base

    # -ed + doubled-consonant correction
    if len(word) > 4 and word.endswith("ed"):
        base = word[:-2]
        if len(base) > 2 and base[-1] == base[-2]:
            return base[:-1]
        return base

    # Plurals — ies
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "i"
    # Plurals — sses
    if word.endswith("sses"):
        return word[:-2]
    # Plurals — general -s (exclude -ss, -us)
    if (
        word.endswith("s")
        and not word.endswith("ss")
        and not word.endswith("us")
        and len(word) > 3
    ):
        return word[:-1]

    # -ly (automatically → automatical)
    if len(word) > 4 and word.endswith("ly"):
        return word[:-2]

    # -er + doubled-consonant correction
    if len(word) > 4 and word.endswith("er"):
        base = word[:-2]
        if len(base) > 2 and base[-1] == base[-2]:
            return base[:-1]

    # Trailing -e (configure → configur)
    if len(word) > 4 and word.endswith("e"):
        return word[:-1]

    return word


def tokenize(text: str) -> list[str]:
    """Tokenize text into lowercase alphanumeric tokens >= 2 chars."""
    import re

    clean = re.sub(r"[^a-z0-9]", " ", text.lower())
    return [t for t in clean.split() if len(t) >= 2]
