export type AudioTags = { title?: string; artist?: string; albumArtist?: string; album?: string; year?: string; genre?: string; trackNumber?: string; trackCount?: string; discNumber?: string; discCount?: string; composer?: string; notes?: string; publisher?: string; copyright?: string; language?: string; isrc?: string; mood?: string; bpm?: string; musicalKey?: string; rating?: string; lyrics?: string; cover?: string }

const synchsafe = (bytes: Uint8Array, at: number) => (bytes[at] << 21) | (bytes[at + 1] << 14) | (bytes[at + 2] << 7) | bytes[at + 3]
const be32 = (bytes: Uint8Array, at: number) => (bytes[at] * 0x1000000) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]

function decodeText(data: Uint8Array) {
  if (!data.length) return ''
  const encoding = data[0]
  const body = data.slice(1)
  try {
    const label = encoding === 1 ? 'utf-16' : encoding === 2 ? 'utf-16be' : encoding === 3 ? 'utf-8' : 'windows-1252'
    return new TextDecoder(label).decode(body).replace(/\0+$/g, '').trim()
  } catch {
    return new TextDecoder().decode(body).replace(/\0+$/g, '').trim()
  }
}

function decodeComment(data: Uint8Array) {
  if (data.length < 5) return ''
  const encoding = data[0]
  let offset = 4 // text encoding, language, then description
  if (encoding === 1 || encoding === 2) {
    while (offset + 1 < data.length && (data[offset] !== 0 || data[offset + 1] !== 0)) offset += 2
    offset += 2
  } else {
    const end = data.indexOf(0, offset)
    offset = end < 0 ? data.length : end + 1
  }
  return decodeText(new Uint8Array([encoding, ...data.subarray(offset)]))
}

function decodePicture(data: Uint8Array, version: number) {
  if (!data.length) return undefined
  const encoding = data[0]
  let offset = 1
  let mime = 'image/jpeg'
  if (version === 2) {
    mime = `image/${String.fromCharCode(...data.slice(offset, offset + 3)).toLowerCase()}`
    offset += 3
  } else {
    const end = data.indexOf(0, offset)
    if (end < 0) return undefined
    mime = new TextDecoder().decode(data.slice(offset, end)) || mime
    offset = end + 1
  }
  offset += 1 // picture type
  if (encoding === 1 || encoding === 2) {
    while (offset + 1 < data.length && (data[offset] !== 0 || data[offset + 1] !== 0)) offset += 2
    offset += 2
  } else {
    const end = data.indexOf(0, offset)
    offset = end < 0 ? data.length : end + 1
  }
  const image = data.slice(offset)
  if (!image.length) return undefined
  let binary = ''
  for (let i = 0; i < image.length; i += 0x8000) binary += String.fromCharCode(...image.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(binary)}`
}

export async function readMp3Tags(file: Blob): Promise<AudioTags> {
  const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 12 * 1024 * 1024)).arrayBuffer())
  if (bytes.length < 10 || String.fromCharCode(...bytes.slice(0, 3)) !== 'ID3') {
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 128)).arrayBuffer())
    if (tail.length < 128 || String.fromCharCode(...tail.slice(0, 3)) !== 'TAG') return {}
    const field = (start: number, length: number) => new TextDecoder('windows-1252').decode(tail.slice(start, start + length)).replace(/\0/g, '').trim()
    return { title: field(3, 30), artist: field(33, 30), album: field(63, 30), year: field(93, 4), genre: '' }
  }
  const version = bytes[3]
  if (version < 2 || version > 4) return {}
  let offset = 10 + synchsafe(bytes, 6)
  let cursor = 10
  if (bytes[5] & 0x40) {
    const extendedSize = version === 4 ? synchsafe(bytes, cursor) : be32(bytes, cursor)
    cursor += extendedSize + (version === 3 ? 4 : 0)
  }
  const tags: AudioTags = {}
  while (cursor + (version === 2 ? 6 : 10) <= Math.min(offset, bytes.length)) {
    const frameId = String.fromCharCode(...bytes.slice(cursor, cursor + (version === 2 ? 3 : 4)))
    if (!frameId.trim() || frameId[0] === '\0') break
    const size = version === 2 ? (bytes[cursor + 3] << 16) | (bytes[cursor + 4] << 8) | bytes[cursor + 5]
      : version === 4 ? synchsafe(bytes, cursor + 4) : be32(bytes, cursor + 4)
    const bodyStart = cursor + (version === 2 ? 6 : 10)
    const bodyEnd = Math.min(bodyStart + size, offset, bytes.length)
    const body = bytes.subarray(bodyStart, bodyEnd)
    if ((frameId === 'COMM' || frameId === 'COM') && !tags.notes) tags.notes = decodeComment(body)
    if (frameId === 'USLT' || frameId === 'ULT') tags.lyrics = decodeComment(body)
    if (frameId === 'TXXX' && body.length > 1) {
      const encoding = body[0]
      let separator = encoding === 1 || encoding === 2 ? -1 : body.indexOf(0, 1)
      if (separator < 0 && (encoding === 1 || encoding === 2)) {
        for (let i = 1; i + 1 < body.length; i += 2) if (body[i] === 0 && body[i + 1] === 0) { separator = i; break }
      }
      if (separator > 0) {
        const description = decodeText(new Uint8Array([encoding, ...body.subarray(1, separator)])).toLowerCase()
        const valueStart = separator + (encoding === 1 || encoding === 2 ? 2 : 1)
        const value = decodeText(new Uint8Array([encoding, ...body.subarray(valueStart)]))
        if (description === 'mood') tags.mood = value
        if (description === 'rating') tags.rating = value
      }
    }
    const key = ({ TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TPE2: 'albumArtist', TP2: 'albumArtist', TALB: 'album', TAL: 'album', TDRC: 'year', TYER: 'year', TYE: 'year', TCON: 'genre', TCO: 'genre', TRCK: 'trackNumber', TRK: 'trackNumber', TPOS: 'discNumber', TPA: 'discNumber', TCOM: 'composer', TCM: 'composer', TPUB: 'publisher', TCOP: 'copyright', TLAN: 'language', TSRC: 'isrc', TBPM: 'bpm', TKEY: 'musicalKey' } as Record<string, keyof AudioTags>)[frameId]
    if (key && !tags[key]) tags[key] = decodeText(body)
    if ((frameId === 'APIC' || frameId === 'PIC') && !tags.cover) tags.cover = decodePicture(body, version === 2 ? 2 : 3)
    if (bodyEnd <= cursor) break
    cursor = bodyStart + size
  }
  for (const key of ['trackNumber', 'discNumber'] as const) {
    const value = tags[key]
    if (!value) continue
    const [position, total] = value.split('/', 2)
    tags[key] = position.trim()
    if (total?.trim()) tags[key === 'trackNumber' ? 'trackCount' : 'discCount'] = total.trim()
  }
  return tags
}

const encodeSynchsafe = (size: number) => new Uint8Array([(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f])
const concatBytes = (...parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output
}

export async function writeMp3Tags(file: Blob, tags: AudioTags) {
  const original = new Uint8Array(await file.arrayBuffer())
  let audioStart = 0
  if (original.length > 10 && String.fromCharCode(...original.subarray(0, 3)) === 'ID3') audioStart = 10 + synchsafe(original, 6)
  const encoder = new TextEncoder()
  const frames: Uint8Array[] = []
  const combinePosition = (position?: string, total?: string) => {
    if (!position?.trim()) return ''
    const [number, embeddedTotal] = position.trim().split('/', 2)
    return [number, total?.trim() || embeddedTotal?.trim()].filter(Boolean).join('/')
  }
  const trackPosition = combinePosition(tags.trackNumber, tags.trackCount)
  const discPosition = combinePosition(tags.discNumber, tags.discCount)
  for (const [id, value] of [['TIT2', tags.title], ['TPE1', tags.artist], ['TPE2', tags.albumArtist], ['TALB', tags.album], ['TDRC', tags.year], ['TCON', tags.genre], ['TRCK', trackPosition || tags.trackNumber], ['TPOS', discPosition || tags.discNumber], ['TCOM', tags.composer], ['TPUB', tags.publisher], ['TCOP', tags.copyright], ['TLAN', tags.language], ['TSRC', tags.isrc], ['TBPM', tags.bpm], ['TKEY', tags.musicalKey], ['TXXX', tags.mood ? `Mood:${tags.mood}` : undefined], ['TXXX', tags.rating ? `Rating:${tags.rating}` : undefined]] as const) {
    if (!value?.trim()) continue
    const body = id === 'TXXX' ? concatBytes(new Uint8Array([3]), encoder.encode(value.startsWith('Mood:') ? 'MOOD' : 'RATING'), new Uint8Array([0]), encoder.encode(value.slice(value.indexOf(':') + 1))) : concatBytes(new Uint8Array([3]), encoder.encode(value.trim()))
    frames.push(concatBytes(encoder.encode(id), encodeSynchsafe(body.length), new Uint8Array([0, 0]), body))
  }
  if (tags.notes?.trim()) {
    const body = concatBytes(new Uint8Array([3]), encoder.encode('eng'), new Uint8Array([0]), encoder.encode(tags.notes.trim()))
    frames.push(concatBytes(encoder.encode('COMM'), encodeSynchsafe(body.length), new Uint8Array([0, 0]), body))
  }
  if (tags.lyrics?.trim()) {
    const body = concatBytes(new Uint8Array([3]), encoder.encode('eng'), new Uint8Array([0]), encoder.encode(tags.lyrics.trim()))
    frames.push(concatBytes(encoder.encode('USLT'), encodeSynchsafe(body.length), new Uint8Array([0, 0]), body))
  }
  if (tags.cover?.startsWith('data:image/')) {
    const response = await fetch(tags.cover)
    const cover = new Uint8Array(await response.arrayBuffer())
    const mime = tags.cover.slice(5, tags.cover.indexOf(';'))
    const body = concatBytes(new Uint8Array([3]), encoder.encode(mime), new Uint8Array([0, 3, 0]), cover)
    frames.push(concatBytes(encoder.encode('APIC'), encodeSynchsafe(body.length), new Uint8Array([0, 0]), body))
  }
  const payload = concatBytes(...frames)
  const header = concatBytes(encoder.encode('ID3'), new Uint8Array([4, 0, 0]), encodeSynchsafe(payload.length))
  return new Blob([concatBytes(header, payload, original.subarray(audioStart))], { type: file.type || 'audio/mpeg' })
}
