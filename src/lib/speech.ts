export function splitSpeechText(text: string, maxLength = 2800): string[] {
  const normalized = text.trim().replace(/[\t\f\v ]+/g, ' ');
  if (!normalized) return [];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    let boundary = remaining.lastIndexOf(' ', maxLength);
    const sentenceBoundary = Math.max(remaining.lastIndexOf('. ', maxLength), remaining.lastIndexOf('? ', maxLength), remaining.lastIndexOf('! ', maxLength), remaining.lastIndexOf('\n', maxLength));
    if (sentenceBoundary > maxLength * 0.55) boundary = sentenceBoundary + 1;
    if (boundary < 1) boundary = maxLength;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function availableSpeechLanguages(voices: Pick<SpeechSynthesisVoice, 'lang'>[]): string[] {
  return [...new Set(voices.map(voice => voice.lang).filter(Boolean))].sort((a,b) => a.localeCompare(b));
}
