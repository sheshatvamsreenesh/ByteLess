export function documentByteDelta(originalBytes:number, convertedBytes:number) {
  const bytesSaved = originalBytes - convertedBytes;
  return {
    bytesSaved,
    percentageSaved: originalBytes > 0 ? (bytesSaved / originalBytes) * 100 : 0,
    outputLarger: bytesSaved < 0,
  };
}
