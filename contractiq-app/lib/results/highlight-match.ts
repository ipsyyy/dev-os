export interface HighlightMatch {
  startIndex: number
  endIndex: number
}

const FUZZY_PREFIX_LENGTH = 40

// Collapses whitespace runs to a single space while recording, for each
// character kept, its index in the original string — lets us search a
// normalized string but report highlight ranges in the caller's real text.
function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  const map: number[] = []
  let normalized = ''
  let lastWasSpace = true

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        normalized += ' '
        map.push(i)
      }
      lastWasSpace = true
    } else {
      normalized += ch
      map.push(i)
      lastWasSpace = false
    }
  }
  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1)
    map.pop()
  }

  return { normalized, map }
}

export function findHighlightMatch(pageText: string, sourceSentence: string): HighlightMatch | null {
  const { normalized: normalizedPage, map } = normalizeWithMap(pageText)
  const { normalized: normalizedSentence } = normalizeWithMap(sourceSentence)

  if (!normalizedSentence) return null

  const haystack = normalizedPage.toLowerCase()
  const needle = normalizedSentence.toLowerCase()

  let matchStart = haystack.indexOf(needle)
  let matchLength = needle.length

  if (matchStart === -1) {
    const fuzzyNeedle = needle.slice(0, FUZZY_PREFIX_LENGTH)
    matchStart = haystack.indexOf(fuzzyNeedle)
    matchLength = fuzzyNeedle.length
  }

  if (matchStart === -1 || matchLength === 0) return null

  return {
    startIndex: map[matchStart],
    endIndex: map[matchStart + matchLength - 1] + 1,
  }
}
