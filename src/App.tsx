import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AudioLines,
  Clock3, Disc3, Heart, Home, ListMusic, MoreHorizontal, Music2,
  Pause, Play, Plus, Repeat, Search, Shuffle, SkipBack, SkipForward,
  Upload, Volume2, VolumeX, X, HardDrive, Download, FileUp, LoaderCircle,
  ListPlus, UserRound, Trash2, Columns3, Pencil, Mic, ChevronDown, ChevronUp, AlertTriangle
} from 'lucide-react'
import './index.css'
import { readMp3Tags, writeMp3Tags, type AudioTags } from './music'

type Track = {
  id: string
  title: string
  artist: string
  albumArtist?: string
  album: string
  year?: string
  genre?: string
  trackNumber?: string
  trackCount?: string
  discNumber?: string
  discCount?: string
  composer?: string
  notes?: string
  publisher?: string
  copyright?: string
  language?: string
  isrc?: string
  mood?: string
  bpm?: string
  musicalKey?: string
  rating?: string
  lyrics?: string
  duration: number
  cover: string
  audioUrl?: string
  file?: Blob
  fileName?: string
  source?: 'nas' | 'local' | 'demo' | 'playlist'
  remoteId?: string
  added?: boolean
  addedAt?: number
}

type EditableField = 'title' | 'artist' | 'album' | 'year' | 'genre' | 'trackNumber' | 'discNumber' | 'composer'

function EditableCell({ value, field, suggestions, onCommit, className = '' }: { value?: string; field: EditableField; suggestions: string[]; onCommit: (value: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const cancelEditing = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!editing) setDraft(value || '') }, [value, editing])
  useEffect(() => { if (editing) { inputRef.current?.focus(); setShowSuggestions(true) } }, [editing])
  const matches = suggestions.filter(item => !draft.trim() || item.toLocaleLowerCase().includes(draft.trim().toLocaleLowerCase())).slice(0, 8)
  if (editing) return <span className="track-cell-edit-wrap"><input ref={inputRef} className="track-cell-editor" value={draft} aria-label={`Edit ${field}`} aria-autocomplete="list" aria-expanded={showSuggestions && matches.length > 0} onChange={event => { setDraft(event.target.value); setShowSuggestions(true) }} onFocus={() => setShowSuggestions(true)} onBlur={() => { if (cancelEditing.current) { cancelEditing.current = false; return } const next = draft.trim(); if (next !== (value || '')) onCommit(next); setEditing(false); setShowSuggestions(false) }} onKeyDown={event => { if (event.key === 'Enter') inputRef.current?.blur(); if (event.key === 'Escape') { cancelEditing.current = true; setDraft(value || ''); setShowSuggestions(false); setEditing(false) } }} onClick={event => event.stopPropagation()}/>{showSuggestions && matches.length > 0 && <span className="track-cell-suggestions" role="listbox">{matches.map(item => <button type="button" role="option" key={item} onMouseDown={event => event.preventDefault()} onClick={() => { onCommit(item); setDraft(item); setShowSuggestions(false); setEditing(false) }}>{item}</button>)}</span>}</span>
  return <button type="button" className={`track-cell-value ${className}`} title="Double-click to edit" onDoubleClick={event => { event.stopPropagation(); setDraft(value || ''); setEditing(true) }}>{value || '—'}</button>
}

type MetadataMatch = Partial<Pick<Track, 'title' | 'artist' | 'albumArtist' | 'album' | 'year' | 'genre' | 'composer' | 'trackNumber' | 'trackCount' | 'discNumber' | 'discCount' | 'notes'>>

let lastMusicBrainzRequestAt = 0
async function musicBrainzFetch(url: string) {
  const wait = 1100 - (Date.now() - lastMusicBrainzRequestAt)
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  lastMusicBrainzRequestAt = Date.now()
  return fetch(url)
}

async function findMetadataMatch(track: Track): Promise<MetadataMatch | null> {
  const title = track.title.trim()
  if (!title) return null
  const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`
  const query = [`recording:${quote(title)}`, track.artist.trim() && !/^unknown artist$/i.test(track.artist.trim()) ? `artist:${quote(track.artist.trim())}` : ''].filter(Boolean).join(' AND ')
  const params = new URLSearchParams({ query, fmt: 'json', limit: '3' })
  const response = await musicBrainzFetch(`https://musicbrainz.org/ws/2/recording/?${params}`)
  if (!response.ok) throw new Error(`Metadata lookup returned ${response.status}`)
  const data = await response.json() as { recordings?: Array<{ id: string; title?: string; score?: number }> }
  const match = data.recordings?.find(recording => (recording.score ?? 0) >= 85)
  if (!match) return null
  const detailParams = new URLSearchParams({ fmt: 'json', inc: 'artist-credits+releases+tags+genres+artist-rels+work-rels' })
  const detailResponse = await musicBrainzFetch(`https://musicbrainz.org/ws/2/recording/${encodeURIComponent(match.id)}?${detailParams}`)
  if (!detailResponse.ok) throw new Error(`Recording details returned ${detailResponse.status}`)
  const detail = await detailResponse.json() as {
    title?: string
    'artist-credit'?: Array<{ name?: string; artist?: { name?: string } }>
    'first-release-date'?: string
    releases?: Array<{ id?: string; title?: string; date?: string }>
    tags?: Array<{ name?: string; count?: number }>
    genres?: Array<{ name?: string; count?: number }>
    relations?: Array<{ type?: string; artist?: { name?: string } }>
  }
  const albumHint = !isMissingMetadata(track.album) ? track.album.trim().toLocaleLowerCase() : ''
  const releases = [...(detail.releases || [])].sort((a, b) => {
    const aMatch = albumHint && a.title?.toLocaleLowerCase() === albumHint ? 1 : 0
    const bMatch = albumHint && b.title?.toLocaleLowerCase() === albumHint ? 1 : 0
    return bMatch - aMatch || (a.date || '9999').localeCompare(b.date || '9999')
  })
  const release = releases.find(item => item.title)
  let trackNumber: string | undefined
  let trackCount: string | undefined
  let discNumber: string | undefined
  let discCount: string | undefined
  let albumArtist: string | undefined
  if (release?.id) {
    const releaseParams = new URLSearchParams({ fmt: 'json', inc: 'artist-credits+media+recordings' })
    const releaseResponse = await musicBrainzFetch(`https://musicbrainz.org/ws/2/release/${encodeURIComponent(release.id)}?${releaseParams}`)
    if (releaseResponse.ok) {
      const releaseDetail = await releaseResponse.json() as { 'artist-credit'?: Array<{ name?: string; artist?: { name?: string } }>; media?: Array<{ position?: number; 'track-count'?: number; tracks?: Array<{ id?: string; number?: string; recording?: { id?: string } }> }> }
      albumArtist = releaseDetail['artist-credit']?.map(credit => credit.name || credit.artist?.name).filter(Boolean).join(', ')
      discCount = releaseDetail.media?.length ? String(releaseDetail.media.length) : undefined
      for (const medium of releaseDetail.media || []) {
        const recordingTrack = medium.tracks?.find(item => item.recording?.id === match.id)
        if (recordingTrack) {
          trackNumber = recordingTrack.number?.split('/')[0]
          trackCount = String(medium['track-count'] || medium.tracks?.length || '') || undefined
          discNumber = medium.position ? String(medium.position) : undefined
          break
        }
      }
    }
  }
  const artist = detail['artist-credit']?.map(credit => credit.name || credit.artist?.name).filter(Boolean).join(', ')
  const tags = [...(detail.genres || []), ...(detail.tags || [])].sort((a, b) => (b.count || 0) - (a.count || 0))
  const genre = tags[0]?.name
  const composer = detail.relations?.find(relation => /composer/i.test(relation.type || ''))?.artist?.name
  return { title: detail.title || match.title, artist, albumArtist, album: release?.title, year: release?.date || detail['first-release-date'], genre, composer, trackNumber, trackCount, discNumber, discCount }
}

const isMissingMetadata = (value?: string) => !value?.trim() || ['unknown artist', 'unknown album', 'nas library', 'unknown title'].includes(value.trim().toLowerCase())
const splitTagPosition = (value?: string) => {
  const [position = '', total = ''] = (value || '').split('/', 2)
  return { position: position.trim(), total: total.trim() }
}

type SortField = 'title' | 'artist' | 'album'
type SortDirection = 'asc' | 'desc'
type MetaColumn = 'year' | 'genre' | 'trackNumber' | 'discNumber' | 'composer'
type HomeCategory = 'Most replayed' | 'Old favorites' | 'Recently played' | 'Random' | 'Most skipped'
const homeCategories: HomeCategory[] = ['Most replayed', 'Old favorites', 'Recently played', 'Random', 'Most skipped']
type PlayHistoryEvent = { trackId: string; playedAt: number }
type SeasonalMemoryPlaylist = { id: string; name: string; trackIds: string[]; endYear: number; endMonth: number }
type MonthlyMemorySelection = { monthKey: string; seasonId: string; previousSeasonId?: string }

function getSeasonForDate(date: Date) {
  const month = date.getMonth()
  const year = date.getFullYear()
  if (month === 11) return { id: `winter-${year}`, name: `Winter ${year}`, endYear: year + 1, endMonth: 2 }
  if (month <= 1) return { id: `winter-${year - 1}`, name: `Winter ${year - 1}`, endYear: year, endMonth: 2 }
  if (month <= 4) return { id: `spring-${year}`, name: `Spring ${year}`, endYear: year, endMonth: 5 }
  if (month <= 7) return { id: `summer-${year}`, name: `Summer ${year}`, endYear: year, endMonth: 8 }
  return { id: `fall-${year}`, name: `Fall ${year}`, endYear: year, endMonth: 11 }
}

function buildSeasonalMemoryPlaylists(history: PlayHistoryEvent[], tracks: Track[]): SeasonalMemoryPlaylist[] {
  const groups = new Map<string, SeasonalMemoryPlaylist & { counts: Map<string, number> }>()
  const knownTrackIds = new Set(tracks.map(track => track.id))
  for (const event of history) {
    if (!knownTrackIds.has(event.trackId)) continue
    const season = getSeasonForDate(new Date(event.playedAt))
    const group = groups.get(season.id) || { ...season, trackIds: [], counts: new Map<string, number>() }
    group.counts.set(event.trackId, (group.counts.get(event.trackId) || 0) + 1)
    groups.set(season.id, group)
  }
  return [...groups.values()].map(group => ({
    id: group.id,
    name: group.name,
    endYear: group.endYear,
    endMonth: group.endMonth,
    trackIds: [...group.counts.entries()].sort((a, b) => b[1] - a[1] || (tracks.find(track => track.id === a[0])?.title || '').localeCompare(tracks.find(track => track.id === b[0])?.title || '')).slice(0, 20).map(([trackId]) => trackId),
  }))
}
const metaColumnLabels: Record<MetaColumn, string> = { year: 'Release year', genre: 'Genre', trackNumber: 'Track number', discNumber: 'Disc number', composer: 'Composer' }
type MoodKey = 'calm' | 'focus' | 'uplifting' | 'energetic' | 'nostalgic'
const moodOptions: Array<{ id: MoodKey; name: string; description: string; terms: string[] }> = [
  { id: 'calm', name: 'Calm', description: 'Easygoing, softer sounds', terms: ['ambient', 'chill', 'calm', 'acoustic', 'folk', 'classical', 'piano', 'new age', 'downtempo', 'soundtrack', 'soft', 'meditation', 'relax'] },
  { id: 'focus', name: 'Focus', description: 'Steady music for concentration', terms: ['instrumental', 'ambient', 'classical', 'jazz', 'minimal', 'downtempo', 'soundtrack', 'focus', 'study', 'lo-fi', 'lofi', 'post-rock'] },
  { id: 'uplifting', name: 'Uplifting', description: 'Bright, positive songs', terms: ['uplifting', 'upbeat', 'pop', 'dance', 'disco', 'funk', 'soul', 'indie pop', 'positive', 'summer'] },
  { id: 'energetic', name: 'High energy', description: 'Driving rhythms and big sounds', terms: ['energetic', 'high energy', 'dance', 'electronic', 'edm', 'house', 'techno', 'rock', 'metal', 'punk', 'drum and bass', 'synthwave'] },
  { id: 'nostalgic', name: 'Nostalgic', description: 'Favorites and older-era sounds', terms: ['nostalgic', 'retro', 'oldies', 'classic', '80s', '90s', '2000s', 'synthpop'] },
]

function moodScore(track: Track, mood: MoodKey, favorites: string[]) {
  const profile = moodOptions.find(option => option.id === mood)!
  const genre = (track.genre || '').toLocaleLowerCase()
  const details = `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase()
  const matchedTerms = profile.terms.filter(term => genre.includes(term) || details.includes(term))
  let score = matchedTerms.reduce((total, term) => total + (genre.includes(term) ? 3 : 1), 0)
  if (favorites.includes(track.id)) score += 0.75
  if (mood === 'nostalgic' && Number(track.year) > 0 && Number(track.year) <= 2010) score += 1
  return { score, matched: matchedTerms.length > 0 || (mood === 'nostalgic' && Number(track.year) > 0 && Number(track.year) <= 2010) }
}

function buildMoodMix(tracks: Track[], mood: MoodKey, favorites: string[], limit = 12) {
  const ranked = tracks.map(track => ({ track, ...moodScore(track, mood, favorites) }))
    .sort((a, b) => b.score - a.score || a.track.title.localeCompare(b.track.title))
  const matched = ranked.filter(item => item.matched)
  const remaining = ranked.filter(item => !item.matched).sort(() => Math.random() - 0.5)
  return { tracks: [...matched, ...remaining].slice(0, limit).map(item => item.track), matchCount: matched.length }
}

type ArtworkResult = { id: string; title: string; artist: string; cover: string }
type ArtistImage = { url: string; pageTitle?: string; custom?: boolean }

function openTrackStore() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('musync-library', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('tracks', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function saveLocalTrack(track: Track) {
  const db = await openTrackStore()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('tracks', 'readwrite')
    transaction.objectStore('tracks').put(track)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
}

async function loadLocalTracks() {
  const db = await openTrackStore()
  const tracks = await new Promise<Track[]>((resolve, reject) => {
    const request = db.transaction('tracks', 'readonly').objectStore('tracks').getAll()
    request.onsuccess = () => resolve(request.result as Track[])
    request.onerror = () => reject(request.error)
  })
  db.close()
  return tracks
}

async function deleteLocalTrack(id: string) {
  const db = await openTrackStore()
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction('tracks', 'readwrite').objectStore('tracks').delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  db.close()
}

const blobAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

const estimateMp3Duration = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, 256 * 1024)).arrayBuffer())
  let offset = 0
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) offset = 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9])
  const mpeg1Layer3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
  const mpeg2Layer3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  for (let i = offset; i + 4 < bytes.length; i++) {
    const header = (bytes[i] * 0x1000000) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]
    if ((header & 0xffe00000) !== 0xffe00000) continue
    const version = (header >>> 19) & 3
    const layer = (header >>> 17) & 3
    const bitrateIndex = (header >>> 12) & 15
    const sampleIndex = (header >>> 10) & 3
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) continue
    const kbps = (version === 3 ? mpeg1Layer3 : mpeg2Layer3)[bitrateIndex]
    return (blob.size * 8) / (kbps * 1000)
  }
  return 0
}

const getAudioDuration = (blob: Blob) => new Promise<number>(resolve => {
  const audio = new Audio()
  const url = URL.createObjectURL(blob)
  let done = false
  const finish = (duration: number) => {
    if (done) return
    done = true
    URL.revokeObjectURL(url)
    if (Number.isFinite(duration) && duration > 0) resolve(duration)
    else void estimateMp3Duration(blob).then(resolve).catch(() => resolve(0))
  }
  audio.onloadedmetadata = () => finish(audio.duration)
  audio.onerror = () => finish(0)
  audio.src = url
})

const covers = [
  'https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=640&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=640&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=640&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=640&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=640&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=640&auto=format&fit=crop&q=85',
]

const initialTracks: Track[] = [
  { id: '1', title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We’re Dreaming', duration: 243, cover: covers[0], audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: '2', title: 'Intro', artist: 'The xx', album: 'xx', duration: 128, cover: covers[1], audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: '3', title: 'A Moment Apart', artist: 'ODESZA', album: 'A Moment Apart', duration: 228, cover: covers[2], audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: '4', title: 'Awake', artist: 'Tycho', album: 'Awake', duration: 275, cover: covers[3], audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { id: '5', title: 'Sunset Lover', artist: 'Petit Biscuit', album: 'Presence', duration: 210, cover: covers[4], audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
  { id: '6', title: 'Innerbloom', artist: 'RÜFÜS DU SOL', album: 'Bloom', duration: 578, cover: covers[5], audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3' },
  { id: '7', title: 'Weightless', artist: 'Marconi Union', album: 'Weightless', duration: 510, cover: covers[0], audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3' },
  { id: '8', title: 'Open Eye Signal', artist: 'Jon Hopkins', album: 'Immunity', duration: 460, cover: covers[2], audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3' },
]

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${mins}:${secs}`
}

const readStored = (key: string, fallback: any) => {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

type LibraryManifest = { tracks: Array<{ id?: string; title: string; artist?: string; albumArtist?: string; album?: string; year?: string; releaseDate?: string; genre?: string; trackNumber?: string; trackCount?: string; discNumber?: string; discCount?: string; composer?: string; notes?: string; publisher?: string; copyright?: string; language?: string; isrc?: string; mood?: string; bpm?: string; musicalKey?: string; rating?: string; lyrics?: string; addedAt?: number; duration?: number; cover?: string; url: string }> }

function App() {
  const [tracks, setTracks] = useState<Track[]>(() => {
    const seededAt = Date.now()
    const saved = readStored('musync-nas-tracks', []) as Track[]
    return [...saved.map((track, index) => ({ ...track, addedAt: track.addedAt || seededAt - index })), ...initialTracks.map((track, index) => ({ ...track, addedAt: seededAt - (initialTracks.length - index) * 1000 }))]
  })
  const [favorites, setFavorites] = useState<string[]>(() => readStored('musync-favorites', ['1', '3']))
  const [playlists, setPlaylists] = useState<{ id: string; name: string; trackIds: string[] }[]>(() => readStored('musync-playlists', [
    { id: 'p1', name: 'Late night drive', trackIds: ['1', '3', '6'] },
    { id: 'p2', name: 'Focus mode', trackIds: ['2', '4', '7'] },
  ]))
  const [activeNav, setActiveNav] = useState('Home')
  const [songsView, setSongsView] = useState<'alphabetical' | 'lastAdded'>('alphabetical')
  const [activePlaylist, setActivePlaylist] = useState<string | null>(null)
  const [libraryContext, setLibraryContext] = useState<{ kind: 'album' | 'artist'; value: string } | null>(null)
  const [search, setSearch] = useState('')
  const [currentId, setCurrentId] = useState('1')
  const [homeCategory, setHomeCategory] = useState<HomeCategory>('Most replayed')
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(() => readStored('musync-play-counts', {}))
  const [skipCounts, setSkipCounts] = useState<Record<string, number>>(() => readStored('musync-skip-counts', {}))
  const [recentPlayIds, setRecentPlayIds] = useState<string[]>(() => readStored('musync-recent-plays', []))
  const [playHistory, setPlayHistory] = useState<PlayHistoryEvent[]>(() => readStored('musync-play-history', []))
  const [seasonalMemoryPlaylists, setSeasonalMemoryPlaylists] = useState<SeasonalMemoryPlaylist[]>(() => readStored('musync-seasonal-memory-playlists', []))
  const [monthlyMemorySelection, setMonthlyMemorySelection] = useState<MonthlyMemorySelection>(() => readStored('musync-old-favorites-monthly-selection', { monthKey: '', seasonId: '' }))
  const [currentMonthKey, setCurrentMonthKey] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${now.getMonth() + 1}` })
  const [isPlaying, setIsPlaying] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.75)
  const lastAudibleVolume = useRef(0.75)
  const [showQueue, setShowQueue] = useState(false)
  const [showPlayerMenu, setShowPlayerMenu] = useState(false)
  const [showPlayerPlaylistMenu, setShowPlayerPlaylistMenu] = useState(false)
  const [queue, setQueue] = useState<string[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [deleteRequestIds, setDeleteRequestIds] = useState<string[]>([])
  const [deletingTracks, setDeletingTracks] = useState(false)
  const [undoMessage, setUndoMessage] = useState('')
  const undoActionRef = useRef<null | (() => void)>(null)
  const undoExpireRef = useRef<null | (() => void)>(null)
  const undoTimerRef = useRef<number | null>(null)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [newPlaylistTrackIds, setNewPlaylistTrackIds] = useState<string[]>([])
  const moodMixes = useMemo(() => Object.fromEntries(moodOptions.map(mood => [mood.id, buildMoodMix(tracks, mood.id, favorites)])) as Record<MoodKey, ReturnType<typeof buildMoodMix>>, [tracks, favorites])
  const [sortField, setSortField] = useState<SortField>('title')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [customColumns, setCustomColumns] = useState<MetaColumn[]>(() => {
    try { return (JSON.parse(localStorage.getItem('musync-custom-columns') || '[]') as MetaColumn[]).filter(column => column in metaColumnLabels).slice(0, 4) }
    catch { return [] }
  })
  useEffect(() => { localStorage.setItem('musync-custom-columns', JSON.stringify(customColumns)) }, [customColumns])
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([])
  const [menuTrack, setMenuTrack] = useState<string | null>(null)
  const [metadataScanning, setMetadataScanning] = useState(false)
  const [metadataScanStatus, setMetadataScanStatus] = useState('')
  const [metadataEditStatus, setMetadataEditStatus] = useState('')
  const [metadataEditSearching, setMetadataEditSearching] = useState(false)
  const [metadataSuggestions, setMetadataSuggestions] = useState<MetadataMatch>({})
  const [acceptedMetadataFields, setAcceptedMetadataFields] = useState<(keyof MetadataMatch)[]>([])
  const [playlistTarget, setPlaylistTarget] = useState<string | null>(null)
  const [showNas, setShowNas] = useState(false)
  const [manifestUrl, setManifestUrl] = useState(() => localStorage.getItem('musync-manifest-url') ?? '')
  const [nasApiBaseUrl, setNasApiBaseUrl] = useState(() => localStorage.getItem('musync-nas-api') ?? '')
  const [nasApiToken, setNasApiToken] = useState('')
  const [nasStatus, setNasStatus] = useState('Not connected')
  const [connecting, setConnecting] = useState(false)
  const [editingTrack, setEditingTrack] = useState<Track | null>(null)
  const [editDraft, setEditDraft] = useState({ title: '', artist: '', albumArtist: '', album: '', year: '', genre: '', trackNumber: '', trackCount: '', discNumber: '', discCount: '', composer: '', notes: '', publisher: '', copyright: '', language: '', isrc: '', mood: '', bpm: '', musicalKey: '', rating: '', lyrics: '', cover: '' })
  const [songEditTab, setSongEditTab] = useState<'Basic' | 'Details' | 'Classification' | 'Lyrics'>('Basic')
  const [artQuery, setArtQuery] = useState('')
  const [artResults, setArtResults] = useState<ArtworkResult[]>([])
  const [artPreview, setArtPreview] = useState('')
  const [selectedArtResultId, setSelectedArtResultId] = useState('')
  const [artSearchSubmitted, setArtSearchSubmitted] = useState(false)
  const [artSearching, setArtSearching] = useState(false)
  const [artError, setArtError] = useState('')
  const [artistImages, setArtistImages] = useState<Record<string, ArtistImage>>(() => readStored('musync-artist-images', {}))
  const [editingArtist, setEditingArtist] = useState<string | null>(null)
  const [editingAlbum, setEditingAlbum] = useState<string | null>(null)
  const [artistImageDraft, setArtistImageDraft] = useState('')
  const [artistImageQuery, setArtistImageQuery] = useState('')
  const [artistImageResults, setArtistImageResults] = useState<ArtworkResult[]>([])
  const [artistImageSearching, setArtistImageSearching] = useState(false)
  const [artistImageError, setArtistImageError] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const playlistInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const artistImageInputRef = useRef<HTMLInputElement>(null)
  const countedPlayTrackRef = useRef<string | null>(null)

  const currentTrack = tracks.find(track => track.id === currentId) ?? tracks[0]
  const generatedSeasonalMemoryPlaylists = useMemo(() => buildSeasonalMemoryPlaylists(playHistory, tracks), [playHistory, tracks])
  const eligibleSeasonalMemoryPlaylists = useMemo(() => {
    const [year, month] = currentMonthKey.split('-').map(Number)
    const currentMonthIndex = year * 12 + month - 1
    return seasonalMemoryPlaylists.filter(playlist => currentMonthIndex - (playlist.endYear * 12 + playlist.endMonth - 1) >= 2)
  }, [seasonalMemoryPlaylists, currentMonthKey])

  useEffect(() => localStorage.setItem('musync-favorites', JSON.stringify(favorites)), [favorites])
  useEffect(() => localStorage.setItem('musync-playlists', JSON.stringify(playlists)), [playlists])
  useEffect(() => localStorage.setItem('musync-artist-images', JSON.stringify(artistImages)), [artistImages])
  useEffect(() => localStorage.setItem('musync-play-counts', JSON.stringify(playCounts)), [playCounts])
  useEffect(() => localStorage.setItem('musync-skip-counts', JSON.stringify(skipCounts)), [skipCounts])
  useEffect(() => localStorage.setItem('musync-recent-plays', JSON.stringify(recentPlayIds)), [recentPlayIds])
  useEffect(() => localStorage.setItem('musync-play-history', JSON.stringify(playHistory)), [playHistory])
  useEffect(() => localStorage.setItem('musync-seasonal-memory-playlists', JSON.stringify(seasonalMemoryPlaylists)), [seasonalMemoryPlaylists])
  useEffect(() => localStorage.setItem('musync-old-favorites-monthly-selection', JSON.stringify(monthlyMemorySelection)), [monthlyMemorySelection])

  useEffect(() => {
    const [year, month] = currentMonthKey.split('-').map(Number)
    const currentMonthIndex = year * 12 + month - 1
    const knownTrackIds = new Set(tracks.map(track => track.id))
    setSeasonalMemoryPlaylists(previous => {
      const merged = new Map(previous.map(playlist => [playlist.id, playlist]))
      for (const generated of generatedSeasonalMemoryPlaylists) {
        const seasonIsOld = currentMonthIndex - (generated.endYear * 12 + generated.endMonth - 1) >= 2
        if (!seasonIsOld || !merged.has(generated.id)) merged.set(generated.id, generated)
      }
      return [...merged.values()].map(playlist => ({ ...playlist, trackIds: playlist.trackIds.filter(id => knownTrackIds.has(id)) })).filter(playlist => playlist.trackIds.length > 0)
    })
  }, [generatedSeasonalMemoryPlaylists, currentMonthKey, tracks])

  useEffect(() => {
    const refreshMonth = () => { const now = new Date(); setCurrentMonthKey(`${now.getFullYear()}-${now.getMonth() + 1}`) }
    const timer = window.setInterval(refreshMonth, 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const selectionIsValid = monthlyMemorySelection.monthKey === currentMonthKey && monthlyMemorySelection.seasonId && eligibleSeasonalMemoryPlaylists.some(playlist => playlist.id === monthlyMemorySelection.seasonId)
    if (selectionIsValid) return
    if (monthlyMemorySelection.monthKey === currentMonthKey && !monthlyMemorySelection.seasonId && !eligibleSeasonalMemoryPlaylists.length) return
    const previousSeasonId = monthlyMemorySelection.monthKey === currentMonthKey ? monthlyMemorySelection.previousSeasonId : monthlyMemorySelection.seasonId || monthlyMemorySelection.previousSeasonId
    if (!eligibleSeasonalMemoryPlaylists.length) {
      setMonthlyMemorySelection({ monthKey: currentMonthKey, seasonId: '', previousSeasonId })
      return
    }
    const alternatives = eligibleSeasonalMemoryPlaylists.filter(playlist => playlist.id !== previousSeasonId)
    const choices = alternatives.length ? alternatives : eligibleSeasonalMemoryPlaylists
    const selected = choices[Math.floor(Math.random() * choices.length)]
    setMonthlyMemorySelection({ monthKey: currentMonthKey, seasonId: selected.id, previousSeasonId })
  }, [currentMonthKey, eligibleSeasonalMemoryPlaylists, monthlyMemorySelection])

  useEffect(() => {
    loadLocalTracks().then(async saved => {
      const restored = await Promise.all(saved.map(async (track, index) => {
        let updated = { ...track, addedAt: track.addedAt || Date.now() - index }
        if (track.file && track.fileName?.toLowerCase().endsWith('.mp3') && (!track.albumArtist || !track.trackCount || !track.discCount || !track.year || /^\d{4}$/.test(track.year))) {
          const tags = await readMp3Tags(track.file).catch(() => ({} as AudioTags))
          updated = {
            ...updated,
            albumArtist: updated.albumArtist || tags.albumArtist,
            trackCount: updated.trackCount || tags.trackCount,
            discCount: updated.discCount || tags.discCount,
            year: tags.year && tags.year.length > (updated.year || '').length ? tags.year : updated.year,
          }
        }
        if (updated.file && !updated.duration) updated = { ...updated, duration: await getAudioDuration(updated.file) }
        return updated
      }))
      await Promise.all(restored.filter((track, index) => track.addedAt !== saved[index].addedAt || track.duration !== saved[index].duration || track.albumArtist !== saved[index].albumArtist || track.trackCount !== saved[index].trackCount || track.discCount !== saved[index].discCount || track.year !== saved[index].year).map(track => saveLocalTrack(track).catch(() => undefined)))
      if (restored.length) setTracks(current => [...restored, ...current.filter(track => !restored.some(item => item.id === track.id))])
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !currentTrack) return
    const objectUrl = currentTrack.file ? URL.createObjectURL(currentTrack.file) : ''
    if (objectUrl) audio.src = objectUrl
    else audio.src = currentTrack.audioUrl ?? ''
    audio.volume = volume
    setProgress(0)
    if (isPlaying) audio.play().catch(() => setIsPlaying(false))
    return () => {
      audio.pause()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [currentId, currentTrack?.file])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  const filteredTracks = useMemo(() => {
    let list = tracks
    if (activeNav === 'Favorites') list = list.filter(track => favorites.includes(track.id))
    if (activeNav === 'Songs') list = list
    if (activeNav === 'NAS Library') list = list.filter(track => track.source === 'nas')
    if (libraryContext) list = list.filter(track => libraryContext.kind === 'album' ? track.album === libraryContext.value : track.artist === libraryContext.value)
    if (activeNav === 'Playlist' && activePlaylist) {
      const playlist = playlists.find(item => item.id === activePlaylist)
      list = playlist ? playlist.trackIds.map(id => tracks.find(track => track.id === id)).filter((track): track is Track => Boolean(track)) : []
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(track => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(q))
    }
    return list
  }, [tracks, activeNav, favorites, activePlaylist, playlists, search, libraryContext, songsView])

  const homeCategoryTracks = useMemo(() => {
    if (homeCategory === 'Old favorites') {
      const selectedSeason = seasonalMemoryPlaylists.find(playlist => playlist.id === monthlyMemorySelection.seasonId)
      return selectedSeason ? selectedSeason.trackIds.map(id => tracks.find(track => track.id === id)).filter((track): track is Track => Boolean(track)) : []
    }
    if (homeCategory === 'Recently played') return recentPlayIds.map(id => tracks.find(track => track.id === id)).filter((track): track is Track => Boolean(track))
    if (homeCategory === 'Most skipped') return tracks.filter(track => (skipCounts[track.id] || 0) > 0).sort((a, b) => (skipCounts[b.id] || 0) - (skipCounts[a.id] || 0) || a.title.localeCompare(b.title))
    if (homeCategory === 'Random') return [...tracks].sort(() => Math.random() - 0.5)
    return tracks.filter(track => (playCounts[track.id] || 0) > 0).sort((a, b) => (playCounts[b.id] || 0) - (playCounts[a.id] || 0) || a.title.localeCompare(b.title))
  }, [tracks, homeCategory, recentPlayIds, skipCounts, playCounts, seasonalMemoryPlaylists, monthlyMemorySelection.seasonId])
  const activeMemorySeason = seasonalMemoryPlaylists.find(playlist => playlist.id === monthlyMemorySelection.seasonId)

  const playTrack = (track: Track) => {
    if (currentId === track.id) {
      togglePlayback()
    } else {
      setCurrentId(track.id)
      setIsPlaying(true)
      setTimeout(() => audioRef.current?.play().catch(() => setIsPlaying(false)), 80)
    }
  }

  const shuffleTracks = (pool: Track[]) => {
    if (!pool.length) return
    setShuffle(true)
    const choices = pool.filter(track => track.id !== currentId)
    const selected = (choices.length ? choices : pool)[Math.floor(Math.random() * (choices.length || pool.length))]
    if (selected.id === currentId) {
      if (audioRef.current) { audioRef.current.currentTime = 0; void audioRef.current.play().catch(() => setIsPlaying(false)) }
      setIsPlaying(true)
    } else {
      setCurrentId(selected.id)
      setIsPlaying(true)
      setTimeout(() => audioRef.current?.play().catch(() => setIsPlaying(false)), 80)
    }
  }

  const togglePlayback = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
    }
  }

  const playNext = (manual = false) => {
    if (!tracks.length) return
    if (manual && isPlaying && currentTrack) setSkipCounts(current => ({ ...current, [currentTrack.id]: (current[currentTrack.id] || 0) + 1 }))
    const queuedTrack = tracks.find(track => track.id === queue[0])
    if (queuedTrack) {
      setQueue(current => current.slice(1))
      setCurrentId(queuedTrack.id)
      setIsPlaying(true)
      return
    }
    const pool = activeNav === 'Playlist' ? filteredTracks : tracks
    if (!pool.length) return
    const index = pool.findIndex(track => track.id === currentId)
    const next = shuffle ? pool[Math.floor(Math.random() * pool.length)] : pool[(index + 1 + pool.length) % pool.length]
    setCurrentId(next.id)
    setIsPlaying(true)
  }

  const playNextFromMenu = (trackId: string) => {
    setQueue(current => [trackId, ...current.filter(id => id !== trackId)])
    setMenuTrack(null)
  }

  const enqueueTrack = (trackId: string) => {
    setQueue(current => current.includes(trackId) ? current : [...current, trackId])
    setMenuTrack(null)
  }

  const enqueueTracks = (trackIds: string[]) => {
    setQueue(current => [...current, ...trackIds.filter(id => !current.includes(id))])
    setSelectedTrackIds([])
  }

  const toggleTrackSelection = (trackId: string) => {
    setSelectedTrackIds(current => current.includes(trackId) ? current.filter(id => id !== trackId) : [...current, trackId])
  }

  const selectTracks = (trackIds: string[], selected: boolean) => {
    setSelectedTrackIds(current => selected
      ? [...new Set([...current, ...trackIds])]
      : current.filter(id => !trackIds.includes(id)))
  }

  const saveTracksToPlaylist = (playlistId: string, trackIds: string[]) => {
    setPlaylists(current => current.map(playlist => playlist.id === playlistId
      ? { ...playlist, trackIds: [...new Set([...playlist.trackIds, ...trackIds])] }
      : playlist))
    setSelectedTrackIds([])
  }

  const reorderPlaylistTracks = (playlistId: string, sourceId: string, targetId: string, placeAfter = false) => {
    setPlaylists(current => current.map(playlist => {
      if (playlist.id !== playlistId) return playlist
      const sourceIndex = playlist.trackIds.indexOf(sourceId)
      const targetIndex = playlist.trackIds.indexOf(targetId)
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return playlist
      const trackIds = [...playlist.trackIds]
      trackIds.splice(sourceIndex, 1)
      const insertionIndex = targetIndex + (placeAfter ? 1 : 0) - (sourceIndex < targetIndex + (placeAfter ? 1 : 0) ? 1 : 0)
      trackIds.splice(insertionIndex, 0, sourceId)
      return { ...playlist, trackIds }
    }))
  }

  const mergeMissingMetadata = async (track: Track, match: MetadataMatch) => {
    const updated: Track = { ...track }
    let changed = false
    for (const key of ['title', 'artist', 'albumArtist', 'album', 'year', 'genre', 'trackNumber', 'trackCount', 'discNumber', 'discCount', 'composer', 'notes'] as const) {
      const found = match[key]
      if (found?.trim() && isMissingMetadata(updated[key])) {
        updated[key] = found.trim()
        changed = true
      }
    }
    if (!changed) return false
    if (updated.file && updated.fileName?.toLowerCase().endsWith('.mp3')) {
      try { updated.file = await writeMp3Tags(updated.file, updated) } catch { /* Keep the discovered details in the library. */ }
    }
    if (updated.file) await saveLocalTrack(updated).catch(() => undefined)
    setTracks(current => current.map(item => item.id === updated.id ? updated : item))
    const cachedNasTracks = readStored('musync-nas-tracks', []) as Track[]
    if (cachedNasTracks.some(item => item.id === updated.id)) {
      localStorage.setItem('musync-nas-tracks', JSON.stringify(cachedNasTracks.map(item => item.id === updated.id ? { ...updated, file: undefined } : item)))
    }
    return true
  }

  const scanMissingMetadata = async (trackIds: string[]) => {
    const selected = tracks.filter(track => trackIds.includes(track.id))
    if (!selected.length || metadataScanning) return
    setMetadataScanning(true)
    setMetadataScanStatus(`Scanning ${selected.length} song${selected.length === 1 ? '' : 's'}…`)
    let updatedCount = 0
    let matchedCount = 0
    let failedCount = 0
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const track = selected[index]
        setMetadataScanStatus(`Checking ${index + 1} of ${selected.length}: ${track.title}`)
        try {
          const match = await findMetadataMatch(track)
          if (match) { matchedCount += 1; if (await mergeMissingMetadata(track, match)) updatedCount += 1 }
        } catch { failedCount += 1 }
      }
      const unmatchedCount = selected.length - matchedCount - failedCount
      setMetadataScanStatus(`${updatedCount} updated · ${matchedCount} matched${unmatchedCount ? ` · ${unmatchedCount} no confident match` : ''}${failedCount ? ` · ${failedCount} lookup${failedCount === 1 ? '' : 's'} failed` : ''}`)
    } finally { setMetadataScanning(false) }
  }

  const playQueuedTrack = (track: Track) => {
    setQueue(current => current.filter(id => id !== track.id))
    setCurrentId(track.id)
    setIsPlaying(true)
  }

  const goToAlbum = (track: Track) => {
    setLibraryContext({ kind: 'album', value: track.album })
    setActiveNav('Albums'); setActivePlaylist(null); setSearch(''); setMenuTrack(null); setPlaylistTarget(null)
  }

  const goToArtist = (track: Track) => {
    setLibraryContext({ kind: 'artist', value: track.artist })
    setArtistImageQuery(track.artist)
    setArtistImageResults([])
    setArtistImageError('')
    setActiveNav('Artists'); setActivePlaylist(null); setSearch(''); setMenuTrack(null); setPlaylistTarget(null)
  }

  const beginEditArtist = (artist: string) => {
    setEditingArtist(artist)
    setArtistImageQuery(artist)
    setArtistImageDraft(artistImages[artist]?.url || '')
    setArtistImageResults([])
    setArtistImageError('')
  }

  const beginEditAlbum = (track: Track) => {
    setEditingAlbum(track.album)
    const trackPosition = splitTagPosition(track.trackNumber)
    const discPosition = splitTagPosition(track.discNumber)
    setEditDraft({ title: track.title, artist: track.artist, albumArtist: track.albumArtist || '', album: track.album, year: track.year || '', genre: track.genre || '', trackNumber: trackPosition.position, trackCount: track.trackCount || trackPosition.total, discNumber: discPosition.position, discCount: track.discCount || discPosition.total, composer: track.composer || '', notes: track.notes || '', publisher: track.publisher || '', copyright: track.copyright || '', language: track.language || '', isrc: track.isrc || '', mood: track.mood || '', bpm: track.bpm || '', musicalKey: track.musicalKey || '', rating: track.rating || '', lyrics: track.lyrics || '', cover: track.cover })
    setSongEditTab('Basic')
    setArtQuery(`${track.artist} ${track.album}`.trim())
    setArtResults([])
    setArtPreview('')
    setSelectedArtResultId('')
    setArtSearchSubmitted(false)
    setArtError('')
  }

  const saveAlbumArtwork = async () => {
    if (!editingAlbum) return
    const matching = tracks.filter(track => track.album === editingAlbum)
    const updated = await Promise.all(matching.map(async track => {
      let file = track.file
      if (file && track.fileName?.toLowerCase().endsWith('.mp3')) {
        try { file = await writeMp3Tags(file, { title: track.title, artist: track.artist, albumArtist: track.albumArtist, album: track.album, year: track.year, genre: track.genre, trackNumber: track.trackNumber, trackCount: track.trackCount, discNumber: track.discNumber, discCount: track.discCount, composer: track.composer, notes: track.notes, cover: editDraft.cover }) }
        catch { /* Keep the selected artwork in the library if a file cannot be rewritten. */ }
      }
      return { ...track, cover: editDraft.cover, file }
    }))
    const byId = new Map(updated.map(track => [track.id, track]))
    setTracks(current => current.map(track => byId.get(track.id) || track))
    await Promise.all(updated.filter(track => track.file).map(track => saveLocalTrack(track).catch(() => undefined)))
    try {
      const cached = readStored('musync-nas-tracks', []) as Track[]
      localStorage.setItem('musync-nas-tracks', JSON.stringify(cached.map(track => byId.get(track.id) || track)))
    } catch { /* The in-memory library is still updated. */ }
    setEditingAlbum(null)
  }

  const saveArtistImage = () => {
    if (!editingArtist) return
    setArtistImages(current => {
      const next = { ...current }
      if (artistImageDraft) next[editingArtist] = { url: artistImageDraft, custom: true }
      else delete next[editingArtist]
      return next
    })
    setEditingArtist(null)
  }

  const playPrevious = () => {
    if (!tracks.length) return
    if (progress > 3 && audioRef.current) {
      audioRef.current.currentTime = 0
      return
    }
    const index = tracks.findIndex(track => track.id === currentId)
    const previous = tracks[(index - 1 + tracks.length) % tracks.length]
    setCurrentId(previous.id)
    setIsPlaying(true)
  }

  const recordTrackStarted = () => {
    if (!currentTrack || countedPlayTrackRef.current === currentTrack.id) return
    countedPlayTrackRef.current = currentTrack.id
    setPlayCounts(current => ({ ...current, [currentTrack.id]: (current[currentTrack.id] || 0) + 1 }))
    setRecentPlayIds(current => [currentTrack.id, ...current.filter(id => id !== currentTrack.id)].slice(0, 50))
    setPlayHistory(current => [...current, { trackId: currentTrack.id, playedAt: Date.now() }].slice(-10000))
  }

  const toggleFavorite = (id: string) => {
    setFavorites(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  const createPlaylist = () => {
    const name = newPlaylistName.trim()
    if (!name) return
    const id = `p${Date.now()}`
    setPlaylists(current => [...current, { id, name, trackIds: newPlaylistTrackIds }])
    setNewPlaylistName('')
    setNewPlaylistTrackIds([])
    setShowCreate(false)
  }

  const createPlaylistForTracks = (trackIds: string[]) => {
    setNewPlaylistTrackIds(trackIds)
    setNewPlaylistName('')
    setPlaylistTarget(null)
    setShowCreate(true)
  }

  const createMoodPlaylist = (moodId: MoodKey) => {
    const mix = moodMixes[moodId]
    if (!mix.tracks.length) return
    const mood = moodOptions.find(option => option.id === moodId)!
    const id = `mood-${Date.now()}`
    setPlaylists(current => [...current, { id, name: `${mood.name} mix`, trackIds: mix.tracks.map(track => track.id) }])
    setActiveNav('Playlist')
    setActivePlaylist(id)
    setLibraryContext(null)
    setSearch('')
  }

  const cancelCreatePlaylist = () => {
    setNewPlaylistTrackIds([])
    setNewPlaylistName('')
    setShowCreate(false)
  }

  const addToPlaylist = (playlistId: string, trackId: string) => {
    saveTracksToPlaylist(playlistId, [trackId])
    setPlaylistTarget(null)
    setMenuTrack(null)
  }

  const uploadTrackToNas = async (track: Track) => {
    const baseUrl = nasApiBaseUrl.trim().replace(/\/$/, '')
    if (!baseUrl || !track.file || track.source === 'nas') return
    const form = new FormData()
    form.append('file', track.file, track.fileName || `${track.title}.mp3`)
    form.append('title', track.title)
    form.append('artist', track.artist)
    form.append('album', track.album)
    form.append('duration', String(track.duration))
    if (track.albumArtist) form.append('albumArtist', track.albumArtist)
    if (track.year) { form.append('year', track.year); form.append('releaseDate', track.year) }
    if (track.genre) form.append('genre', track.genre)
    if (track.trackNumber) form.append('trackNumber', track.trackNumber)
    if (track.trackCount) form.append('trackCount', track.trackCount)
    if (track.discNumber) form.append('discNumber', track.discNumber)
    if (track.discCount) form.append('discCount', track.discCount)
    if (track.composer) form.append('composer', track.composer)
    if (track.notes) form.append('notes', track.notes)
    for (const key of ['publisher', 'copyright', 'language', 'isrc', 'mood', 'bpm', 'musicalKey', 'rating', 'lyrics'] as const) if (track[key]) form.append(key, track[key]!)
    if (track.cover.startsWith('data:image/')) form.append('cover', track.cover)
    const response = await fetch(`${baseUrl}/tracks`, {
      method: 'POST',
      headers: nasApiToken ? { Authorization: `Bearer ${nasApiToken}` } : undefined,
      body: form,
    })
    if (!response.ok) throw new Error(`Upload failed (${response.status})`)
    const result = await response.json() as { id?: string | number; url?: string }
    if (result.id === undefined || !result.url) throw new Error('Upload API must return { id, url }.')
    const updated: Track = { ...track, source: 'nas', remoteId: String(result.id), audioUrl: result.url }
    await saveLocalTrack(updated).catch(() => undefined)
    setTracks(current => current.map(item => item.id === track.id ? updated : item))
    const cached = { ...updated, file: undefined }
    const existing = readStored('musync-nas-tracks', []) as Track[]
    localStorage.setItem('musync-nas-tracks', JSON.stringify([...existing.filter(item => item.id !== cached.id), cached]))
  }

  const uploadTracksToNas = async (trackIds: string[]) => {
    if (!nasApiBaseUrl.trim()) {
      setNasStatus('Set the custom NAS API URL before uploading.')
      setShowNas(true)
      return
    }
    const local = tracks.filter(track => trackIds.includes(track.id) && track.source !== 'nas' && track.file)
    let uploaded = 0
    let failed = 0
    for (const track of local) {
      try { await uploadTrackToNas(track); uploaded += 1 }
      catch (error) { failed += 1; setNasStatus(error instanceof Error ? error.message : 'NAS upload failed') }
    }
    setNasStatus(failed ? `${uploaded} uploaded; ${failed} failed. Check the NAS API connection.` : `${uploaded} song${uploaded === 1 ? '' : 's'} uploaded to Synology`)
    setSelectedTrackIds([])
  }

  const connectNas = async () => {
    const baseUrl = nasApiBaseUrl.trim().replace(/\/$/, '')
    const sourceUrl = baseUrl ? `${baseUrl}/library.json` : manifestUrl.trim()
    if (!sourceUrl) return
    setConnecting(true)
    setNasStatus('Connecting…')
    try {
      const response = await fetch(sourceUrl, { headers: nasApiToken ? { Authorization: `Bearer ${nasApiToken}` } : undefined })
      if (!response.ok) throw new Error(`Server returned ${response.status}`)
      const manifest = await response.json() as LibraryManifest
      if (!Array.isArray(manifest.tracks)) throw new Error('Manifest needs a tracks array')
      const synced: Track[] = manifest.tracks.filter(item => item.title && item.url).map((item, index) => ({
        id: `nas-${item.id || index}-${item.url}`, remoteId: item.id || item.url, title: item.title, artist: item.artist || 'Unknown artist', album: item.album || 'NAS Library',
        albumArtist: item.albumArtist, year: item.releaseDate || item.year, genre: item.genre, trackNumber: item.trackNumber, trackCount: item.trackCount, discNumber: item.discNumber, discCount: item.discCount, composer: item.composer, notes: item.notes, publisher: item.publisher, copyright: item.copyright, language: item.language, isrc: item.isrc, mood: item.mood, bpm: item.bpm, musicalKey: item.musicalKey, rating: item.rating, lyrics: item.lyrics,
        duration: item.duration || 0, cover: item.cover || covers[index % covers.length], audioUrl: item.url, source: 'nas', addedAt: item.addedAt || tracks.find(track => track.remoteId === String(item.id || item.url))?.addedAt || Date.now() + (manifest.tracks.length - index),
      }))
      if (!synced.length) throw new Error('No playable tracks found')
      localStorage.setItem('musync-nas-tracks', JSON.stringify(synced))
      setTracks(current => [...synced, ...current.filter(track => !track.id.startsWith('nas-') && track.source !== 'nas')])
      if (baseUrl) localStorage.setItem('musync-nas-api', baseUrl)
      else localStorage.setItem('musync-manifest-url', manifestUrl.trim())
      setNasStatus(`${synced.length} tracks connected`)
      setActiveNav('NAS Library')
      setShowNas(false)
    } catch (error) {
      setNasStatus(error instanceof Error ? error.message : 'Could not connect')
    } finally {
      setConnecting(false)
    }
  }

  const exportPlaylist = (playlistId: string) => {
    const playlist = playlists.find(item => item.id === playlistId)
    if (!playlist) return
    const content = JSON.stringify({ name: playlist.name, tracks: tracks.filter(track => playlist.trackIds.includes(track.id)).map(({ title, artist, album, duration, cover, audioUrl }) => ({ title, artist, album, duration, cover, url: audioUrl })) }, null, 2)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    link.download = `${playlist.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const importPlaylist = async (file: File | undefined) => {
    if (!file) return
    try {
      const data = JSON.parse(await file.text()) as { name?: string; tracks?: Array<{ title: string; artist?: string; album?: string; duration?: number; cover?: string; url?: string }> }
      if (!Array.isArray(data.tracks)) throw new Error('This file does not contain a tracks list.')
      const imported: Track[] = data.tracks.filter(track => track.title && track.url).map((track, index) => ({
        id: `pl-${Date.now()}-${index}`, title: track.title, artist: track.artist || 'Unknown artist', album: track.album || 'Imported playlist',
        duration: track.duration || 0, cover: track.cover || covers[index % covers.length], audioUrl: track.url, source: 'playlist',
      }))
      const id = `p${Date.now()}`
      if (!imported.length) throw new Error('No playable tracks found. Playlist entries need a url field.')
      setTracks(current => [...imported, ...current])
      setPlaylists(current => [...current, { id, name: data.name || file.name.replace(/\.json$/i, ''), trackIds: imported.map(track => track.id) }])
      setActiveNav('Playlist'); setActivePlaylist(id)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not import playlist.')
    }
  }

  const importFiles = async (files: FileList | null) => {
    if (!files) return
    const imported = await Promise.all(Array.from(files).filter(file => file.type.startsWith('audio/')).map(async (file, index) => {
      const tags: AudioTags = file.name.toLowerCase().endsWith('.mp3') ? await readMp3Tags(file).catch(() => ({})) : {}
      const title = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ')
      return {
        id: `local-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        title: tags.title || title,
        artist: tags.artist || 'Unknown artist',
        album: tags.album || 'Unknown album',
        albumArtist: tags.albumArtist,
        year: tags.year,
        genre: tags.genre,
        trackNumber: tags.trackNumber,
        trackCount: tags.trackCount,
        discNumber: tags.discNumber,
        discCount: tags.discCount,
        composer: tags.composer,
        notes: tags.notes,
        publisher: tags.publisher, copyright: tags.copyright, language: tags.language, isrc: tags.isrc,
        mood: tags.mood, bpm: tags.bpm, musicalKey: tags.musicalKey, rating: tags.rating, lyrics: tags.lyrics,
        duration: await getAudioDuration(file),
        cover: tags.cover || covers[index % covers.length],
        file,
        fileName: file.name,
        source: 'local' as const,
        added: true,
        addedAt: Date.now() + files.length - index,
      }
    }))
    await Promise.all(imported.map(track => saveLocalTrack(track).catch(() => undefined)))
    setTracks(current => [...imported, ...current])
    setActiveNav('Songs')
    setSongsView('lastAdded')
    setSearch('')
    if (nasApiBaseUrl.trim()) {
      setNasStatus(`Uploading ${imported.length} song${imported.length === 1 ? '' : 's'} to Synology…`)
      void Promise.all(imported.map(track => uploadTrackToNas(track).catch(error => setNasStatus(error instanceof Error ? error.message : 'NAS upload failed')))).then(() => setNasStatus('Upload complete'))
    }
  }

  const beginEditTrack = (id: string) => {
    const track = tracks.find(item => item.id === id)
    if (!track) return
    setEditingTrack(track)
    const trackPosition = splitTagPosition(track.trackNumber)
    const discPosition = splitTagPosition(track.discNumber)
    setEditDraft({ title: track.title, artist: track.artist, albumArtist: track.albumArtist || '', album: track.album, year: track.year || '', genre: track.genre || '', trackNumber: trackPosition.position, trackCount: track.trackCount || trackPosition.total, discNumber: discPosition.position, discCount: track.discCount || discPosition.total, composer: track.composer || '', notes: track.notes || '', publisher: track.publisher || '', copyright: track.copyright || '', language: track.language || '', isrc: track.isrc || '', mood: track.mood || '', bpm: track.bpm || '', musicalKey: track.musicalKey || '', rating: track.rating || '', lyrics: track.lyrics || '', cover: track.cover })
    setSongEditTab('Basic')
    setArtQuery([track.artist, track.album].filter(Boolean).join(' '))
    setArtResults([])
    setArtPreview('')
    setSelectedArtResultId('')
    setArtSearchSubmitted(false)
    setArtError('')
    setMetadataEditStatus('')
    setMetadataSuggestions({})
    setAcceptedMetadataFields([])
    setMenuTrack(null)
  }

  const findMissingMetadataForEdit = async () => {
    if (!editingTrack) return
    setMetadataEditSearching(true)
    setMetadataEditStatus('Looking up a matching recording…')
    try {
      const match = await findMetadataMatch({ ...editingTrack, ...editDraft })
      if (!match) { setMetadataEditStatus('No confident match found. Try checking the title and artist.'); return }
      const suggestions = Object.fromEntries(Object.entries(match).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => [key, value!.trim()])) as MetadataMatch
      const count = Object.keys(suggestions).length
      setMetadataSuggestions(suggestions)
      setMetadataEditStatus(count ? `Found ${count} metadata field${count === 1 ? '' : 's'} to review.` : 'No metadata fields were returned for this match.')
    } catch (error) {
      setMetadataEditStatus(error instanceof Error ? error.message : 'Metadata lookup failed.')
    } finally { setMetadataEditSearching(false) }
  }

  const acceptMetadataSuggestion = (key: keyof MetadataMatch) => {
    const value = metadataSuggestions[key]
    if (value) setEditDraft(current => ({ ...current, [key]: value }))
    if (value) setAcceptedMetadataFields(current => current.includes(key) ? current : [...current, key])
    setMetadataSuggestions(current => { const next = { ...current }; delete next[key]; return next })
  }

  const acceptAllMetadataSuggestions = () => {
    setEditDraft(current => ({ ...current, ...metadataSuggestions }))
    setAcceptedMetadataFields(current => [...new Set([...current, ...Object.keys(metadataSuggestions) as (keyof MetadataMatch)[]])])
    setMetadataSuggestions({})
    setMetadataEditStatus('Accepted metadata suggestions. Save changes to apply them to the song.')
  }

  const revertMetadataSuggestions = () => {
    setMetadataSuggestions({})
    setMetadataEditStatus('Kept the current metadata. No suggestions were applied.')
  }

  const renderFoundMetadataField = (key: keyof MetadataMatch, label: string) => {
    const value = metadataSuggestions[key]
    return <button type="button" className={`metadata-found-row ${key === 'composer' || key === 'notes' ? 'metadata-found-wide' : ''} ${key === 'notes' ? 'metadata-found-notes' : ''}`} key={key} onClick={() => acceptMetadataSuggestion(key)} disabled={!value} aria-label={value ? `Accept found ${label}: ${value}` : `No found ${label}`}><strong>{label}</strong><span className={value ? 'metadata-found-value' : 'metadata-found-empty'} title={value || ''}>{value || '—'}</span></button>
  }

  const searchArtwork = async () => {
    const query = artQuery.trim() || `${editDraft.artist} ${editDraft.album}`.trim()
    if (!query) return
    setArtSearchSubmitted(true)
    setArtSearching(true)
    setArtError('')
    setArtResults([])
    setArtPreview('')
    setSelectedArtResultId('')
    try {
      const params = new URLSearchParams({ query, fmt: 'json', limit: '8' })
      const response = await musicBrainzFetch(`https://musicbrainz.org/ws/2/release-group/?${params}`)
      if (!response.ok) throw new Error(`Artwork search returned ${response.status}`)
      const data = await response.json() as { 'release-groups'?: Array<{ id: string; title: string; 'artist-credit'?: Array<{ name?: string; artist?: { name?: string } }> }> }
      const results = (data['release-groups'] || []).map(item => ({
        id: item.id, title: item.title,
        artist: item['artist-credit']?.map(credit => credit.name || credit.artist?.name).filter(Boolean).join(', ') || 'Unknown artist',
        cover: `https://coverartarchive.org/release-group/${item.id}/front-250`,
      }))
      setArtResults(results)
      if (!results.length) setArtError('No artwork results found. Try a different artist or album search.')
    } catch (error) {
      setArtError(error instanceof Error ? error.message : 'Artwork search failed.')
    } finally {
      setArtSearching(false)
    }
  }

  const searchArtistImages = async (artist: string) => {
    const query = artistImageQuery.trim() || artist
    if (!query) return
    setArtistImageSearching(true)
    setArtistImageError('')
    try {
      const params = new URLSearchParams({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '8', prop: 'imageinfo', iiprop: 'url', iiurlwidth: '360' })
      const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`)
      if (!response.ok) throw new Error(`Image search returned ${response.status}`)
      const data = await response.json() as { query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ thumburl?: string; url?: string }> }> } }
      const results = Object.values(data.query?.pages || {}).flatMap((page, index) => {
        const url = page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url
        return url ? [{ id: `${page.title || query}-${index}`, title: (page.title || query).replace(/^File:/, '').replaceAll('_', ' '), artist, cover: url }] : []
      })
      setArtistImageResults(results)
      if (!results.length) setArtistImageError('No images found. Try another search.')
    } catch (error) {
      setArtistImageError(error instanceof Error ? error.message : 'Image search failed.')
    } finally {
      setArtistImageSearching(false)
    }
  }

  const selectArtistImage = async (result: ArtworkResult) => {
    let url = result.cover
    try {
      const response = await fetch(result.cover)
      if (response.ok) url = await blobAsDataUrl(await response.blob())
    } catch { /* The remote image can still be used directly if it cannot be embedded. */ }
    setArtistImageDraft(url)
    setArtistImageResults([])
  }

  const uploadArtistImage = async (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return
    try {
      const url = await blobAsDataUrl(file)
      setArtistImageDraft(url)
      setArtistImageResults([])
      setArtistImageError('')
    } catch { setArtistImageError('Could not read that image. Try another file.') }
  }

  const selectArtwork = async (url: string, resultId = '') => {
    setSelectedArtResultId(resultId)
    setArtError('')
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error('Could not download the cover image.')
      const cover = await blobAsDataUrl(await response.blob())
      if (editingAlbum) setEditDraft(current => ({ ...current, cover }))
      else { setArtPreview(cover); setEditDraft(current => ({ ...current, cover })) }
    } catch {
      if (editingAlbum) setEditDraft(current => ({ ...current, cover: url }))
      else { setArtPreview(url); setEditDraft(current => ({ ...current, cover: url })) }
      setArtError('Preview selected. If it cannot be embedded, upload a cover image from your device.')
    }
  }

  const revertTrackArtwork = () => {
    if (!editingTrack) return
    setEditDraft(current => ({ ...current, cover: editingTrack.cover }))
    setArtPreview('')
    setSelectedArtResultId('')
    setArtError('')
  }

  const saveTrackEdits = async () => {
    if (!editingTrack) return
    const updated: Track = { ...editingTrack, ...editDraft, year: editDraft.year.trim() || undefined }
    if (updated.file && updated.fileName?.toLowerCase().endsWith('.mp3')) {
      try {
        updated.file = await writeMp3Tags(updated.file, editDraft)
      } catch {
        setArtError('Metadata was updated in the library, but tags could not be written into the MP3 file.')
      }
    }
    await saveLocalTrack(updated).catch(() => undefined)
    setTracks(current => current.map(track => track.id === updated.id ? updated : track))
    setEditingTrack(null)
  }

  const updateTrackCell = async (trackId: string, field: EditableField, value: string) => {
    const track = tracks.find(item => item.id === trackId)
    if (!track || track[field] === value) return
    let updated: Track = { ...track, [field]: value || undefined }
    if (updated.file && updated.fileName?.toLowerCase().endsWith('.mp3')) {
      try { updated.file = await writeMp3Tags(updated.file, updated) } catch { /* Keep the edited value in the library if tag writing is unavailable. */ }
    }
    setTracks(current => current.map(item => item.id === trackId ? updated : item))
    if (updated.file) await saveLocalTrack(updated).catch(() => undefined)
    const cachedNasTracks = readStored('musync-nas-tracks', []) as Track[]
    if (cachedNasTracks.some(item => item.id === trackId)) localStorage.setItem('musync-nas-tracks', JSON.stringify(cachedNasTracks.map(item => item.id === trackId ? { ...updated, file: undefined } : item)))
  }

  const downloadTrack = (track: Track) => {
    const saveBlob = (blob: Blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = track.fileName || `${track.title}.mp3`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
    if (track.file) saveBlob(track.file)
    else if (track.audioUrl) void fetch(track.audioUrl).then(response => {
      if (!response.ok) throw new Error('Download failed')
      return response.blob()
    }).then(saveBlob).catch(() => window.open(track.audioUrl, '_blank', 'noopener,noreferrer'))
  }

  const removeTracks = async (ids: string[]) => {
    if (!ids.length) return
    const requested = tracks.filter(track => ids.includes(track.id))
    const removed = new Set(requested.map(track => track.id))
    if (!removed.size) return
    const previousTracks = tracks
    const previousFavorites = favorites
    const previousPlaylists = playlists
    const previousQueue = queue
    const previousSelection = selectedTrackIds
    const previousCurrentId = currentId
    const previousPlaying = isPlaying
    setQueue(current => current.filter(id => !removed.has(id)))
    setSelectedTrackIds(current => current.filter(id => !removed.has(id)))
    setTracks(current => current.filter(track => !removed.has(track.id)))
    setFavorites(current => current.filter(id => !removed.has(id)))
    setPlaylists(current => current.map(playlist => ({ ...playlist, trackIds: playlist.trackIds.filter(id => !removed.has(id)) })))
    if (removed.has(currentId)) {
      setIsPlaying(false)
      const next = tracks.find(track => !removed.has(track.id))
      if (next) setCurrentId(next.id)
    }
    const expire = async () => {
      for (const track of requested) {
        if (track.source === 'nas') {
          if (!nasApiBaseUrl.trim()) { setNasStatus('Connect a custom NAS API to delete Synology files.'); continue }
          try {
            const response = await fetch(`${nasApiBaseUrl.trim().replace(/\/$/, '')}/tracks/${encodeURIComponent(track.remoteId || track.id)}`, { method: 'DELETE', headers: nasApiToken ? { Authorization: `Bearer ${nasApiToken}` } : undefined })
            if (!response.ok) throw new Error(`NAS delete failed (${response.status})`)
          } catch (error) { setNasStatus(error instanceof Error ? error.message : 'NAS delete failed') }
        }
        await deleteLocalTrack(track.id).catch(() => undefined)
      }
      const cached = (readStored('musync-nas-tracks', []) as Track[]).filter(track => !removed.has(track.id))
      localStorage.setItem('musync-nas-tracks', JSON.stringify(cached))
    }
    offerUndo(`Deleted ${requested.length} song${requested.length === 1 ? '' : 's'}`, () => {
      setTracks(previousTracks)
      setFavorites(previousFavorites)
      setPlaylists(previousPlaylists)
      setQueue(previousQueue)
      setSelectedTrackIds(previousSelection)
      setCurrentId(previousCurrentId)
      setIsPlaying(previousPlaying)
      for (const track of requested) if (track.file) void saveLocalTrack(track).catch(() => undefined)
      const cached = readStored('musync-nas-tracks', []) as Track[]
      localStorage.setItem('musync-nas-tracks', JSON.stringify([...cached.filter(track => !removed.has(track.id)), ...requested.filter(track => track.source === 'nas').map(track => ({ ...track, file: undefined }))]))
    }, expire)
    setMenuTrack(null)
  }

  const offerUndo = (message: string, undo: () => void, expire?: () => void) => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    undoExpireRef.current?.()
    undoActionRef.current = undo
    undoExpireRef.current = expire || null
    setUndoMessage(message)
    undoTimerRef.current = window.setTimeout(() => {
      undoExpireRef.current?.()
      undoTimerRef.current = null
      undoActionRef.current = null
      undoExpireRef.current = null
      setUndoMessage('')
    }, 8000)
  }
  const undoLastAction = () => {
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    undoTimerRef.current = null
    undoExpireRef.current = null
    const undo = undoActionRef.current
    undoActionRef.current = null
    setUndoMessage('')
    undo?.()
  }

  const requestRemoveTracks = (ids: string[]) => {
    const requestedIds = [...new Set(ids)].filter(id => tracks.some(track => track.id === id))
    if (!requestedIds.length) return
    setMenuTrack(null)
    setDeleteRequestIds(requestedIds)
  }

  const cancelRemoveTracks = () => {
    if (!deletingTracks) setDeleteRequestIds([])
  }

  const confirmRemoveTracks = async () => {
    if (!deleteRequestIds.length || deletingTracks) return
    setDeletingTracks(true)
    try {
      await removeTracks(deleteRequestIds)
      setDeleteRequestIds([])
    } finally {
      setDeletingTracks(false)
    }
  }

  const removeTrack = (id: string) => requestRemoveTracks([id])

  const sortBy = (field: SortField) => {
    if (sortField === field) setSortDirection(direction => direction === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDirection('asc') }
  }

  const navItems = [
    { label: 'Home', icon: Home },
    { label: 'Songs', icon: Music2 },
    { label: 'Albums', icon: Disc3 },
    { label: 'Artists', icon: Mic },
    { label: 'Favorites', icon: Heart },
    { label: 'NAS Library', icon: HardDrive },
  ]

  const uniqueAlbums = Array.from(new Map(tracks.map(track => [track.album, track])).values())
  const uniqueArtists = Array.from(new Set(tracks.map(track => track.artist)))

  useEffect(() => {
    const targets = libraryContext?.kind === 'artist' ? [libraryContext.value] : activeNav === 'Artists' ? uniqueArtists : []
    const missing = targets.filter(artist => !artistImages[artist])
    if (!missing.length) return
    const controller = new AbortController()
    for (const artist of missing) {
      const params = new URLSearchParams({ action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: artist, gsrnamespace: '0', gsrlimit: '1', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '500', pilicense: 'free' })
      void fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal: controller.signal }).then(response => response.json()).then(data => {
        const page = Object.values(data.query?.pages || {})[0] as { title?: string; thumbnail?: { source?: string } } | undefined
        if (page?.thumbnail?.source) setArtistImages(current => current[artist] ? current : ({ ...current, [artist]: { url: page.thumbnail!.source!, pageTitle: page.title || artist } }))
      }).catch(() => undefined)
    }
    return () => controller.abort()
  }, [activeNav, libraryContext, tracks])
  const title = libraryContext?.value ?? (activeNav === 'Playlist'
    ? playlists.find(item => item.id === activePlaylist)?.name ?? 'Playlist'
    : activeNav)

  return (
    <div className="app-shell">
      <audio
        ref={audioRef}
        onPlay={recordTrackStarted}
        onTimeUpdate={event => setProgress(event.currentTarget.currentTime)}
        onLoadedMetadata={event => setDuration(event.currentTarget.duration || 0)}
        onEnded={() => repeat && audioRef.current ? (countedPlayTrackRef.current = null, audioRef.current.currentTime = 0, audioRef.current.play()) : playNext()}
      />
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><AudioLines size={21} strokeWidth={2.5} /></div><span>musync</span><span className="brand-period">.</span></div>
        <div className="sidebar-label">MENU</div>
        <nav className="main-nav">
          {navItems.map(item => {
            const Icon = item.icon
            return <button key={item.label} className={`nav-item ${activeNav === item.label ? 'active' : ''}`} onClick={() => { setActiveNav(item.label); if (item.label === 'Songs') setSongsView('alphabetical'); setActivePlaylist(null); setLibraryContext(null); setPlaylistTarget(null); setMenuTrack(null); setSearch('') }}>
              <Icon size={18} /><span>{item.label}</span>
              {item.label === 'Favorites' && <span className="nav-count">{favorites.length}</span>}
            </button>
          })}
        </nav>
        <div className="sidebar-divider" />
        <div className="sidebar-heading"><span className="sidebar-label">YOUR PLAYLISTS</span><div className="sidebar-playlist-actions"><button className="icon-button tiny" onClick={() => playlistInputRef.current?.click()} aria-label="Import playlist"><FileUp size={15} /></button><button className="icon-button tiny" onClick={() => setShowCreate(true)} aria-label="Create playlist"><Plus size={16} /></button></div></div>
        <input ref={playlistInputRef} type="file" accept="application/json,.json" hidden onChange={event => { void importPlaylist(event.target.files?.[0]); event.target.value = '' }} />
        <div className="playlist-nav">
          {playlists.map(playlist => <div className="playlist-item" key={playlist.id}><button className={`nav-item playlist-link ${activeNav === 'Playlist' && activePlaylist === playlist.id ? 'active' : ''}`} onClick={() => { setActiveNav('Playlist'); setActivePlaylist(playlist.id); setLibraryContext(null); setPlaylistTarget(null); setMenuTrack(null); setSearch('') }}><ListMusic size={17} /><span>{playlist.name}</span></button><button className="playlist-export icon-button tiny" onClick={() => exportPlaylist(playlist.id)} aria-label={`Export ${playlist.name}`} title="Export playlist"><Download size={13}/></button></div>)}
          {playlists.length === 0 && <p className="empty-side">No playlists yet</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="storage-card"><div className="storage-icon"><Disc3 size={17}/></div><div><strong>Your music, your space.</strong><span>{nasApiBaseUrl ? nasStatus : 'Local library'}</span></div></div>
          <button className="profile-button"><div className="avatar">M</div><div className="profile-text"><strong>My collection</strong><span>Local library</span></div><MoreHorizontal size={18}/></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><strong>{title.toUpperCase()}</strong></div>
          <div className="topbar-actions">
            <div className="search-box"><Search size={17}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search your music..." /><kbd>⌘ K</kbd>{search && <button className="clear-search" onClick={() => setSearch('')}><X size={14}/></button>}</div>
            <button className="secondary-button nas-button" onClick={() => setShowNas(true)}><HardDrive size={15}/><span>Connect NAS</span></button>
            <button className="import-button" onClick={() => fileInputRef.current?.click()}><Upload size={16}/><span>Import music</span></button>
            <input ref={fileInputRef} type="file" accept="audio/*" multiple hidden onChange={event => { void importFiles(event.target.files); event.target.value = '' }} />
          </div>
        </header>

        <div className="content-scroll">
          {activeNav === 'Home' && !search ? <>
            <section className="welcome-section">
              <div className="welcome-copy"><div className="eyebrow"><span className="eyebrow-dot"/> YOUR PERSONAL MUSIC SPACE</div><h1>Music for<br/><em>every moment.</em></h1><p>Your collection, all in one place. Pick a mood and press play.</p><div className="welcome-actions"><button className="primary-button" onClick={() => tracks[0] && playTrack(tracks[0])}><Play size={16} fill="currentColor"/> Play something</button></div></div>
              <div className="hero-art"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-disc"><div className="disc-center"><AudioLines size={35}/></div></div><div className="hero-tag"><span className="live-dot"/> YOUR SOUNDTRACK</div></div>
            </section>
            <section className="section-block mood-section">
              <div className="section-heading"><div><span className="section-kicker">MADE FROM YOUR LIBRARY</span><h2>Pick a mood</h2></div></div>
              <div className="mood-card-viewport"><div className="mood-card-grid">{moodOptions.map(mood => { const mix = moodMixes[mood.id]; return <button key={mood.id} className={`mood-card mood-card-${mood.id}`} onClick={() => createMoodPlaylist(mood.id)} disabled={!mix.tracks.length} aria-label={`Create ${mood.name} mix`}><span className="mood-card-glow"/><span className="mood-card-icon"><Music2 size={17}/></span><strong>{mood.name}</strong><small>{mood.description}</small><span className="mood-card-footer"><span>{mix.tracks.length} songs{mix.matchCount ? ` · ${mix.matchCount} tag matches` : ''}</span><span className="mood-card-create"><Plus size={14}/> Create mix</span></span></button> })}</div></div>
            </section>
            <section className="section-block">
              <div className="section-heading"><div><span className="section-kicker">{homeCategory === 'Old favorites' && activeMemorySeason ? `${activeMemorySeason.name.toUpperCase()} MEMORY` : 'YOUR LISTENING'}</span><h2>{homeCategory}</h2></div><div className="home-category-actions"><label className="sr-only" htmlFor="home-category">Choose home category</label><span className="home-category-select-wrap"><select id="home-category" className="home-category-select" value={homeCategory} onChange={event => setHomeCategory(event.target.value as HomeCategory)}>{homeCategories.map(category => <option key={category} value={category}>{category}</option>)}</select></span><button className="text-button" onClick={() => setActiveNav('Songs')}>View all <span>→</span></button></div></div>
              {homeCategoryTracks.length ? <div className="album-grid">{homeCategoryTracks.slice(0, 4).map(track => <button className="album-card" key={track.id} onClick={() => playTrack(track)}><div className="cover-wrap"><img src={track.cover} alt=""/><span className="cover-play"><Play size={19} fill="currentColor"/></span></div><strong>{track.title}</strong><span>{track.artist} · {track.album}</span></button>)}</div> : <div className="home-category-empty">{homeCategory === 'Most replayed' ? 'Songs will show here as you listen.' : homeCategory === 'Recently played' ? 'Your recently played songs will show here.' : homeCategory === 'Most skipped' ? 'Songs you skip while playing will show here.' : homeCategory === 'Old favorites' ? 'Each month, a hidden playlist of a past season’s top 20 songs is chosen at random. Seasons must be at least two months old.' : 'Add songs to your library for a random selection.'}</div>}
            </section>
            <section className="section-block track-section">
              <div className="section-heading"><div><span className="section-kicker">A LITTLE MORE MUSIC</span><h2>All songs</h2></div><button className="text-button" onClick={() => setActiveNav('Songs')}>See library <span>→</span></button></div>
              <TrackTable tracks={tracks.slice(0, 5)} favorites={favorites} currentId={currentId} isPlaying={isPlaying} onPlay={playTrack} onFavorite={toggleFavorite} onMenu={setMenuTrack} menuTrack={menuTrack} onRemove={removeTrack} onEdit={beginEditTrack} onDownload={downloadTrack} onPlayNext={playNextFromMenu} onEnqueue={enqueueTrack} onGoToAlbum={goToAlbum} onGoToArtist={goToArtist} onAddToPlaylist={id => { setPlaylistTarget(id); setMenuTrack(null) }} sortField={sortField} sortDirection={sortDirection} customColumns={customColumns} onCustomColumnsChange={setCustomColumns} onSort={sortBy} onUpdateMetadata={updateTrackCell} metadataScanning={metadataScanning} metadataScanStatus={metadataScanStatus} onScanMissingMetadata={scanMissingMetadata} selectedIds={selectedTrackIds} onSelectTrack={toggleTrackSelection} onSelectAll={selectTracks} onQueueSelected={enqueueTracks} onDeleteSelected={requestRemoveTracks} onSaveSelected={saveTracksToPlaylist} onCreatePlaylist={ids => createPlaylistForTracks([ids])} onCreatePlaylistSelected={createPlaylistForTracks} onUploadSelected={uploadTracksToNas} playlists={playlists} playlistTarget={playlistTarget} addToPlaylist={addToPlaylist}/>
            </section>
          </> : <>
            {activeNav !== 'Now Playing' && <section className="page-heading">
              <div><span className="section-kicker">{libraryContext ? `BROWSE ${libraryContext.kind.toUpperCase()}` : activeNav === 'Favorites' ? 'THE ONES YOU LOVE' : activeNav === 'Playlist' ? 'YOUR COLLECTION' : 'EXPLORE YOUR COLLECTION'}</span><h1>{search ? 'Search results' : title}</h1><p>{search ? `Matches for “${search}”` : `${filteredTracks.length} ${filteredTracks.length === 1 ? 'track' : 'tracks'} in your collection${activeNav === 'Playlist' ? ' · Drag songs to reorder' : ''}`}</p></div>
              <div className="heading-actions">{activeNav === 'Songs' && !libraryContext && <div className="songs-view-toggle" role="group" aria-label="Song sort order"><button className={songsView === 'alphabetical' ? 'active' : ''} aria-pressed={songsView === 'alphabetical'} onClick={() => { setSongsView('alphabetical'); setSortField('title'); setSortDirection('asc') }}>Alphabetical</button><button className={songsView === 'lastAdded' ? 'active' : ''} aria-pressed={songsView === 'lastAdded'} onClick={() => setSongsView('lastAdded')}>Last added</button></div>}<button className="secondary-button shuffle-all" onClick={() => { if (filteredTracks.length) { setShuffle(true); playTrack(filteredTracks[Math.floor(Math.random() * filteredTracks.length)]) } }}><Shuffle size={14}/> Shuffle</button><button className="primary-button compact" onClick={() => filteredTracks[0] && playTrack(filteredTracks[0])}><Play size={15} fill="currentColor"/> Play all</button></div>
            </section>}
            {activeNav === 'Now Playing' && currentTrack ? <section className="now-playing-page"><div className="now-playing-art-wrap"><img className="now-playing-art" src={currentTrack.cover} alt={`${currentTrack.album} album artwork`}/></div><div className="now-playing-details"><span className="section-kicker">NOW PLAYING</span><h1>{currentTrack.title}</h1><button className="now-playing-link" onClick={() => goToArtist(currentTrack)}>{currentTrack.artist}</button><button className="now-playing-link album-link" onClick={() => goToAlbum(currentTrack)}>{currentTrack.album}</button><div className="now-playing-controls"><button className="player-control" onClick={playPrevious} aria-label="Previous track"><SkipBack size={22} fill="currentColor"/></button><button className="play-button" onClick={togglePlayback} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Pause size={23} fill="currentColor"/> : <Play size={23} fill="currentColor"/>}</button><button className="player-control" onClick={() => playNext(true)} aria-label="Next track"><SkipForward size={22} fill="currentColor"/></button><button className={`player-control now-playing-favorite ${favorites.includes(currentTrack.id) ? 'selected' : ''}`} onClick={() => toggleFavorite(currentTrack.id)} aria-label="Favorite track"><Heart size={19} fill={favorites.includes(currentTrack.id) ? 'currentColor' : 'none'}/></button></div><div className="now-playing-progress"><span>{formatTime(progress)}</span><input className="range progress-range" type="range" min="0" max={duration || 100} value={Math.min(progress, duration || 100)} onChange={event => { const value = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = value; setProgress(value) }} style={{'--range-progress': `${duration ? progress / duration * 100 : 0}%`} as CSSProperties}/><span>{formatTime(duration || currentTrack.duration || 0)}</span></div></div></section>
            : libraryContext?.kind === 'album' && filteredTracks[0] ? <><section className="detail-banner album-detail"><div className="detail-album-art-wrap"><img className="detail-artwork" src={filteredTracks[0].cover} alt={`${libraryContext.value} album cover`}/><button className="detail-image-edit" onClick={() => beginEditAlbum(filteredTracks[0])}><Pencil size={14}/> Edit artwork</button></div><div className="detail-copy"><span className="section-kicker">ALBUM</span><h2>{libraryContext.value}</h2><button className="detail-link" onClick={() => goToArtist(filteredTracks[0])}>{filteredTracks[0].artist}</button><p>{filteredTracks.length} {filteredTracks.length === 1 ? 'song' : 'songs'}{filteredTracks[0].year ? ` · ${filteredTracks[0].year}` : ''}</p></div><div className="detail-play-actions"><button className="secondary-button compact" onClick={() => shuffleTracks(filteredTracks)}><Shuffle size={14}/> Shuffle</button><button className="primary-button compact" onClick={() => playTrack(filteredTracks[0])}><Play size={15} fill="currentColor"/> Play album</button></div></section><TrackTable tracks={filteredTracks} favorites={favorites} currentId={currentId} isPlaying={isPlaying} onPlay={playTrack} onFavorite={toggleFavorite} onMenu={setMenuTrack} menuTrack={menuTrack} onRemove={removeTrack} onEdit={beginEditTrack} onDownload={downloadTrack} onPlayNext={playNextFromMenu} onEnqueue={enqueueTrack} onGoToAlbum={goToAlbum} onGoToArtist={goToArtist} onAddToPlaylist={id => { setPlaylistTarget(id); setMenuTrack(null) }} sortField={sortField} sortDirection={sortDirection} customColumns={customColumns} onCustomColumnsChange={setCustomColumns} onSort={sortBy} onUpdateMetadata={updateTrackCell} metadataScanning={metadataScanning} metadataScanStatus={metadataScanStatus} onScanMissingMetadata={scanMissingMetadata} selectedIds={selectedTrackIds} onSelectTrack={toggleTrackSelection} onSelectAll={selectTracks} onQueueSelected={enqueueTracks} onDeleteSelected={requestRemoveTracks} onSaveSelected={saveTracksToPlaylist} onCreatePlaylist={ids => createPlaylistForTracks([ids])} onCreatePlaylistSelected={createPlaylistForTracks} onUploadSelected={uploadTracksToNas} playlists={playlists} playlistTarget={playlistTarget} addToPlaylist={addToPlaylist}/></>
            : libraryContext?.kind === 'artist' ? <><section className="detail-banner artist-detail"><div className="detail-artist-photo">{artistImages[libraryContext.value] ? <img src={artistImages[libraryContext.value].url} alt={libraryContext.value}/> : <span>{libraryContext.value.slice(0, 1).toUpperCase()}</span>}<button className="detail-image-edit" onClick={() => beginEditArtist(libraryContext.value)}><Pencil size={14}/> Edit image</button></div><div className="detail-copy"><span className="section-kicker">ARTIST</span><h2>{libraryContext.value}</h2><p>{filteredTracks.length} {filteredTracks.length === 1 ? 'song' : 'songs'} in your collection</p>{artistImages[libraryContext.value]?.pageTitle && !artistImages[libraryContext.value]?.custom && <a className="artist-source" href={`https://en.wikipedia.org/wiki/${encodeURIComponent(artistImages[libraryContext.value].pageTitle!.replaceAll(' ', '_'))}`} target="_blank" rel="noreferrer">Image source: Wikipedia</a>}</div><div className="detail-play-actions"><button className="secondary-button compact" onClick={() => shuffleTracks(filteredTracks)}><Shuffle size={14}/> Shuffle</button><button className="primary-button compact" onClick={() => filteredTracks[0] && playTrack(filteredTracks[0])}><Play size={15} fill="currentColor"/> Play artist</button></div></section><TrackTable tracks={filteredTracks} favorites={favorites} currentId={currentId} isPlaying={isPlaying} onPlay={playTrack} onFavorite={toggleFavorite} onMenu={setMenuTrack} menuTrack={menuTrack} onRemove={removeTrack} onEdit={beginEditTrack} onDownload={downloadTrack} onPlayNext={playNextFromMenu} onEnqueue={enqueueTrack} onGoToAlbum={goToAlbum} onGoToArtist={goToArtist} onAddToPlaylist={id => { setPlaylistTarget(id); setMenuTrack(null) }} sortField={sortField} sortDirection={sortDirection} sortByAdded={activeNav === 'Songs' && songsView === 'lastAdded'} customColumns={customColumns} onCustomColumnsChange={setCustomColumns} onSort={sortBy} onUpdateMetadata={updateTrackCell} metadataScanning={metadataScanning} metadataScanStatus={metadataScanStatus} onScanMissingMetadata={scanMissingMetadata} selectedIds={selectedTrackIds} onSelectTrack={toggleTrackSelection} onSelectAll={selectTracks} onQueueSelected={enqueueTracks} onDeleteSelected={requestRemoveTracks} onSaveSelected={saveTracksToPlaylist} onCreatePlaylist={ids => createPlaylistForTracks([ids])} onCreatePlaylistSelected={createPlaylistForTracks} onUploadSelected={uploadTracksToNas} playlists={playlists} playlistTarget={playlistTarget} addToPlaylist={addToPlaylist}/></>
            : activeNav === 'Albums' && !search ? <div className="album-grid full-grid">{uniqueAlbums.map(track => <article className="album-card-shell" key={track.album}><button className="album-card" onClick={() => goToAlbum(track)}><div className="cover-wrap"><img src={track.cover} alt=""/><span className="cover-play"><Play size={19} fill="currentColor"/></span></div><strong>{track.album}</strong><span>{track.artist}</span></button></article>)}</div>
            : activeNav === 'Artists' && !search ? <div className="artist-grid">{uniqueArtists.map(artist => <article className="artist-card" key={artist}><button className="artist-card-open" onClick={() => goToArtist(tracks.find(track => track.artist === artist)!)}><div className="artist-avatar">{artistImages[artist] ? <img src={artistImages[artist].url} alt={artist}/> : <span>{artist.slice(0, 1).toUpperCase()}</span>}</div><strong>{artist}</strong><span>{tracks.filter(track => track.artist === artist).length} tracks</span>{artistImages[artist] && <small className="artist-card-credit">{artistImages[artist].custom ? 'Custom image' : 'Wikipedia image'}</small>}</button></article>)}</div>
            : <TrackTable tracks={filteredTracks} favorites={favorites} currentId={currentId} isPlaying={isPlaying} onPlay={playTrack} onFavorite={toggleFavorite} onMenu={setMenuTrack} menuTrack={menuTrack} onRemove={removeTrack} onEdit={beginEditTrack} onDownload={downloadTrack} onPlayNext={playNextFromMenu} onEnqueue={enqueueTrack} onGoToAlbum={goToAlbum} onGoToArtist={goToArtist} onAddToPlaylist={id => { setPlaylistTarget(id); setMenuTrack(null) }} sortField={sortField} sortDirection={sortDirection} sortByAdded={activeNav === 'Songs' && songsView === 'lastAdded'} customColumns={customColumns} onCustomColumnsChange={setCustomColumns} onSort={sortBy} onUpdateMetadata={updateTrackCell} metadataScanning={metadataScanning} metadataScanStatus={metadataScanStatus} onScanMissingMetadata={scanMissingMetadata} selectedIds={selectedTrackIds} onSelectTrack={toggleTrackSelection} onSelectAll={selectTracks} onQueueSelected={enqueueTracks} onDeleteSelected={requestRemoveTracks} onSaveSelected={saveTracksToPlaylist} onCreatePlaylist={ids => createPlaylistForTracks([ids])} onCreatePlaylistSelected={createPlaylistForTracks} onUploadSelected={uploadTracksToNas} playlists={playlists} playlistTarget={playlistTarget} addToPlaylist={addToPlaylist} preserveOrder={activeNav === 'Playlist' && Boolean(activePlaylist)} onReorder={(sourceId, targetId, placeAfter) => { if (activePlaylist) reorderPlaylistTracks(activePlaylist, sourceId, targetId, placeAfter) }}/>}
            {filteredTracks.length === 0 && <div className="empty-state"><div className="empty-icon"><Music2 size={25}/></div><h3>Nothing here just yet</h3><p>Try another search or import some music to get started.</p><button className="secondary-button" onClick={() => fileInputRef.current?.click()}><Upload size={15}/> Import music</button></div>}
          </>}
        </div>
      </main>

      {showQueue && <div className="queue-panel"><div className="queue-header"><div><span className="section-kicker">UP NEXT</span><h3>Playback queue</h3></div><button className="icon-button" onClick={() => setShowQueue(false)}><X size={18}/></button></div>{currentTrack && <div className="queue-current"><img src={currentTrack.cover} alt=""/><div><strong>{currentTrack.title}</strong><span>{currentTrack.artist}</span></div><span className="playing-bars"><i/><i/><i/></span></div>}{queue.map(id => tracks.find(track => track.id === id)).filter((track): track is Track => Boolean(track)).map(track => <button className="queue-row" key={track.id} onClick={() => playQueuedTrack(track)}><img src={track.cover} alt=""/><span><strong>{track.title}</strong><small>{track.artist}</small></span><Play size={15}/></button>)}{queue.length === 0 && <p className="queue-empty">Your queue is empty. Add a song from its menu.</p>}</div>}

      <footer className="player-bar">
        <div className="now-playing">
          {currentTrack && <><button className="now-cover-button" onClick={() => { setActiveNav('Now Playing'); setActivePlaylist(null); setLibraryContext(null); setSearch('') }} aria-label="Open Now Playing"><img className="now-cover" src={currentTrack.cover} alt=""/></button><div className="now-meta"><strong>{currentTrack.title}</strong><span>{currentTrack.artist}</span></div><button className={`player-heart ${favorites.includes(currentTrack.id) ? 'liked' : ''}`} onClick={() => toggleFavorite(currentTrack.id)} aria-label="Favorite"><Heart size={17} fill={favorites.includes(currentTrack.id) ? 'currentColor' : 'none'}/></button></>}
        </div>
        <div className="player-center">
          <div className="transport-controls"><button className={`player-control ${shuffle ? 'selected' : ''}`} onClick={() => setShuffle(!shuffle)} aria-label="Shuffle"><Shuffle size={17}/></button><button className="player-control" onClick={playPrevious} aria-label="Previous"><SkipBack size={19} fill="currentColor"/></button><button className="play-button" onClick={togglePlayback} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button><button className="player-control" onClick={() => playNext(true)} aria-label="Next"><SkipForward size={19} fill="currentColor"/></button><button className={`player-control ${repeat ? 'selected' : ''}`} onClick={() => setRepeat(!repeat)} aria-label="Repeat"><Repeat size={17}/></button></div>
          <div className="progress-row"><span>{formatTime(progress)}</span><input className="range progress-range" type="range" min="0" max={duration || 100} value={Math.min(progress, duration || 100)} onChange={event => { const value = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = value; setProgress(value) }} style={{'--range-progress': `${duration ? progress / duration * 100 : 0}%`} as CSSProperties}/><span>{formatTime(duration || currentTrack?.duration || 0)}</span></div>
        </div>
        <div className="player-extras"><button className={`player-control queue-toggle ${showQueue ? 'selected' : ''}`} onClick={() => setShowQueue(!showQueue)} aria-label="Queue"><ListMusic size={18}/></button><div className="volume-control"><button className="volume-toggle" onClick={() => setVolume(current => { if (current === 0) return lastAudibleVolume.current || 0.75; lastAudibleVolume.current = current; return 0 })} aria-label={volume === 0 ? 'Turn sound on' : 'Turn sound off'} title={volume === 0 ? 'Turn sound on' : 'Turn sound off'}>{volume === 0 ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button><input className="range volume-range" type="range" min="0" max="1" step="0.01" value={volume} onChange={event => { const next = Number(event.target.value); if (next > 0) lastAudibleVolume.current = next; setVolume(next) }} style={{'--range-progress': `${volume * 100}%`} as CSSProperties}/></div><div className="player-more-wrap"><button className={`icon-button player-more ${showPlayerMenu ? 'selected' : ''}`} aria-label="More options" aria-expanded={showPlayerMenu} onClick={() => { setShowPlayerMenu(open => !open); setShowPlayerPlaylistMenu(false) }}><MoreHorizontal size={19}/></button>{showPlayerMenu && currentTrack && <div className="track-menu player-track-menu"><button onClick={() => { enqueueTrack(currentTrack.id); setShowPlayerMenu(false) }}><ListMusic size={14}/> Add to queue</button><button onClick={() => { downloadTrack(currentTrack); setShowPlayerMenu(false) }}><Download size={14}/> Download</button><div className="player-save-wrap"><button onClick={() => setShowPlayerPlaylistMenu(open => !open)}><ListPlus size={14}/> Save to playlist</button>{showPlayerPlaylistMenu && <div className="player-playlist-menu"><strong>Save to playlist</strong>{playlists.map(playlist => <button key={playlist.id} onClick={() => { saveTracksToPlaylist(playlist.id, [currentTrack.id]); setShowPlayerMenu(false); setShowPlayerPlaylistMenu(false) }}><ListMusic size={14}/>{playlist.name}</button>)}<button className="new-playlist-option" onClick={() => { createPlaylistForTracks([currentTrack.id]); setShowPlayerMenu(false); setShowPlayerPlaylistMenu(false) }}><Plus size={14}/> New playlist</button></div>}</div><button onClick={() => { goToAlbum(currentTrack); setShowPlayerMenu(false) }}><Disc3 size={14}/> Go to album</button><button onClick={() => { goToArtist(currentTrack); setShowPlayerMenu(false) }}><UserRound size={14}/> Go to artist</button><button onClick={() => { beginEditTrack(currentTrack.id); setShowPlayerMenu(false) }}><Music2 size={14}/> Edit details & artwork</button><button className="danger-action" onClick={() => { removeTrack(currentTrack.id); setShowPlayerMenu(false) }}><Trash2 size={14}/> Delete song</button></div>}</div></div>
      </footer>

      {showCreate && <div className="modal-backdrop" onClick={cancelCreatePlaylist}><div className="modal" onClick={event => event.stopPropagation()}><div className="modal-heading"><div><span className="section-kicker">MAKE IT YOURS</span><h3>New playlist</h3></div><button className="icon-button" onClick={cancelCreatePlaylist}><X size={18}/></button></div><label className="field-label">Playlist name</label><input className="modal-input" autoFocus value={newPlaylistName} onChange={event => setNewPlaylistName(event.target.value)} onKeyDown={event => event.key === 'Enter' && createPlaylist()} placeholder="Give your playlist a name"/><div className="modal-actions"><button className="secondary-button" onClick={cancelCreatePlaylist}>Cancel</button><button className="primary-button compact" onClick={createPlaylist} disabled={!newPlaylistName.trim()}>Create playlist</button></div></div></div>}
      {deleteRequestIds.length > 0 && <div className="modal-backdrop delete-confirm-backdrop" onClick={cancelRemoveTracks}><div className="modal delete-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title" onClick={event => event.stopPropagation()}><div className="delete-warning-icon"><AlertTriangle size={21}/></div><div className="modal-heading"><div><span className="section-kicker">PLEASE CONFIRM</span><h3 id="delete-confirm-title">Delete {deleteRequestIds.length === 1 ? 'this song' : `${deleteRequestIds.length} songs`}?</h3></div><button className="icon-button" onClick={cancelRemoveTracks} disabled={deletingTracks} aria-label="Close"><X size={18}/></button></div><p className="delete-confirm-copy">{deleteRequestIds.length === 1 ? 'This song will be removed from your library and playlists.' : `These ${deleteRequestIds.length} songs will be removed from your library and playlists.`}</p>{deleteRequestIds.length === 1 && tracks.find(track => track.id === deleteRequestIds[0]) && <div className="delete-confirm-track"><img src={tracks.find(track => track.id === deleteRequestIds[0])!.cover} alt=""/><span><strong>{tracks.find(track => track.id === deleteRequestIds[0])!.title}</strong><small>{tracks.find(track => track.id === deleteRequestIds[0])!.artist}</small></span></div>}<div className="modal-actions"><button className="secondary-button" onClick={cancelRemoveTracks} disabled={deletingTracks}>Cancel</button><button className="danger-confirm-button" onClick={() => void confirmRemoveTracks()} disabled={deletingTracks}><Trash2 size={15}/>{deletingTracks ? 'Deleting…' : `Delete ${deleteRequestIds.length === 1 ? 'song' : 'songs'}`}</button></div></div></div>}
      {showNas && <div className="modal-backdrop" onClick={() => setShowNas(false)}><div className="modal nas-modal" onClick={event => event.stopPropagation()}><div className="modal-heading"><div><span className="section-kicker">YOUR PRIVATE CLOUD</span><h3>Connect your Synology</h3></div><button className="icon-button" onClick={() => setShowNas(false)}><X size={18}/></button></div><p className="modal-description">Connect a custom library API to sync, upload, and delete songs. Set its base URL, then Musync uses GET /library.json, POST /tracks, and DELETE /tracks/:id.</p><label className="field-label" htmlFor="nas-api-url">Custom NAS API base URL</label><input id="nas-api-url" className="modal-input" value={nasApiBaseUrl} onChange={event => setNasApiBaseUrl(event.target.value)} placeholder="https://nas.example.com/api"/><label className="field-label nas-token-label" htmlFor="nas-api-token">Bearer token (optional)</label><input id="nas-api-token" className="modal-input" type="password" autoComplete="off" value={nasApiToken} onChange={event => setNasApiToken(event.target.value)} placeholder="Token is kept only for this session"/><label className="field-label nas-manifest-label" htmlFor="manifest-url">Read-only manifest URL (optional)</label><input id="manifest-url" className="modal-input" value={manifestUrl} onChange={event => setManifestUrl(event.target.value)} onKeyDown={event => event.key === 'Enter' && void connectNas()} placeholder="https://nas.example.com/music/library.json"/><div className="manifest-help"><strong>Endpoint contract</strong><code>GET /library.json · POST /tracks (multipart file + tags) · DELETE /tracks/:id</code><span>POST /tracks should return JSON with an id and playable url. Allow this app in the API CORS settings. {nasStatus}</span></div><div className="modal-actions"><button className="secondary-button" onClick={() => setShowNas(false)}>Cancel</button><button className="primary-button compact" onClick={() => void connectNas()} disabled={(!nasApiBaseUrl.trim() && !manifestUrl.trim()) || connecting}>{connecting ? <LoaderCircle size={15} className="spin"/> : <HardDrive size={15}/>} {connecting ? 'Connecting…' : 'Connect library'}</button></div></div></div>}
      {editingAlbum && <div className="modal-backdrop" onClick={() => setEditingAlbum(null)}><div className="modal edit-track-modal edit-artist-modal" onClick={event => event.stopPropagation()}><div className="modal-heading"><div><span className="section-kicker">ALBUM DETAILS</span><h3>Edit album artwork</h3></div><button className="icon-button" onClick={() => setEditingAlbum(null)} aria-label="Close"><X size={18}/></button></div><div className="artist-image-modal-layout"><div className="album-image-preview"><img src={editDraft.cover} alt={`${editingAlbum} artwork preview`}/></div><div className="artist-image-modal-actions"><strong>{editingAlbum}</strong><p>Choose new artwork for every song on this album.</p><button className="secondary-button" onClick={() => coverInputRef.current?.click()}><Upload size={14}/> Upload artwork</button><input ref={coverInputRef} type="file" accept="image/*" hidden onChange={async event => { const file = event.target.files?.[0]; if (file) { const cover = await blobAsDataUrl(file); setEditDraft(current => ({ ...current, cover })) } event.target.value = '' }}/></div></div><div className="art-search"><label className="field-label">Search album artwork</label><div className="art-search-row"><input className="modal-input" value={artQuery} onChange={event => setArtQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void searchArtwork()} placeholder="Search artist or album"/><button className="secondary-button" disabled={artSearching} onClick={() => void searchArtwork()}><Search size={14}/>{artSearching ? 'Searching…' : 'Search'}</button></div><small className="art-credit">Artwork search by MusicBrainz and Cover Art Archive.</small>{artError && <p className="art-error">{artError}</p>}<div className="art-results">{artResults.map(result => <button key={result.id} className="art-result" onClick={() => void selectArtwork(result.cover)}><img src={result.cover} alt=""/><span><strong>{result.title}</strong><small>{result.artist}</small></span></button>)}</div></div><div className="modal-actions"><button className="secondary-button" onClick={() => setEditingAlbum(null)}>Cancel</button><button className="primary-button compact" onClick={() => void saveAlbumArtwork()}>Save artwork</button></div></div></div>}
      {editingArtist && <div className="modal-backdrop" onClick={() => setEditingArtist(null)}><div className="modal edit-track-modal edit-artist-modal" onClick={event => event.stopPropagation()}><div className="modal-heading"><div><span className="section-kicker">ARTIST DETAILS</span><h3>Edit artist image</h3></div><button className="icon-button" onClick={() => setEditingArtist(null)} aria-label="Close"><X size={18}/></button></div><div className="artist-image-modal-layout"><div className="artist-image-preview">{artistImageDraft ? <img src={artistImageDraft} alt={`${editingArtist} preview`}/> : <span>{editingArtist.slice(0, 1).toUpperCase()}</span>}</div><div className="artist-image-modal-actions"><strong>{editingArtist}</strong><p>Search for an image or upload one from your device.</p><button className="secondary-button" onClick={() => artistImageInputRef.current?.click()}><Upload size={14}/> Upload image</button><input ref={artistImageInputRef} type="file" accept="image/*" hidden onChange={event => { void uploadArtistImage(event.target.files?.[0]); event.target.value = '' }}/>{artistImageDraft && <button className="artist-remove-image" onClick={() => setArtistImageDraft('')}>Remove image</button>}</div></div><div className="art-search"><label className="field-label">Search artist images</label><div className="art-search-row"><input className="modal-input" value={artistImageQuery} onChange={event => setArtistImageQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void searchArtistImages(editingArtist)} placeholder="Search artist or image name"/><button className="secondary-button" disabled={artistImageSearching} onClick={() => void searchArtistImages(editingArtist)}><Search size={14}/>{artistImageSearching ? 'Searching…' : 'Search'}</button></div><small className="art-credit">Image search by Wikimedia Commons.</small>{artistImageError && <p className="art-error">{artistImageError}</p>}<div className="art-results">{artistImageResults.map(result => <button key={result.id} className="art-result" onClick={() => void selectArtistImage(result)}><img src={result.cover} alt=""/><span><strong>{result.title}</strong><small>{result.artist}</small></span></button>)}</div></div><div className="modal-actions"><button className="secondary-button" onClick={() => setEditingArtist(null)}>Cancel</button><button className="primary-button compact" onClick={saveArtistImage}>Save image</button></div></div></div>}
      {editingTrack && <div className="modal-backdrop" onClick={() => setEditingTrack(null)}>
        <div className="modal edit-track-modal" onClick={event => event.stopPropagation()}>
          <div className="modal-heading"><div><span className="section-kicker">LIBRARY DETAILS</span><h3>Edit song</h3></div><button className="icon-button" onClick={() => setEditingTrack(null)} aria-label="Close"><X size={18}/></button></div>
          <div className="song-edit-tabs" role="tablist" aria-label="Song details tabs">{(['Basic', 'Details', 'Classification', 'Lyrics'] as const).map(tab => <button key={tab} type="button" role="tab" aria-selected={songEditTab === tab} className={songEditTab === tab ? 'active' : ''} onClick={() => setSongEditTab(tab)}>{tab}</button>)}</div>
          <div className="track-editor-columns">
            <section className="current-track-panel">
              <div className="editor-pane-title">{songEditTab === 'Basic' ? 'CURRENT ALBUM ART & TAGS' : `CURRENT ${songEditTab.toUpperCase()}`}</div>
              {songEditTab === 'Basic' && <><div className="current-art-row"><img className="current-art-preview" src={editDraft.cover} alt="Current album artwork"/><div className="current-art-actions"><button className="secondary-button" onClick={() => coverInputRef.current?.click()}><Upload size={14}/> Upload artwork</button><input ref={coverInputRef} type="file" accept="image/*" hidden onChange={async event => { const file = event.target.files?.[0]; if (file) { const cover = await blobAsDataUrl(file); setEditDraft(current => ({ ...current, cover })) } event.target.value = '' }}/><button className="text-button artwork-revert-link" onClick={revertTrackArtwork} disabled={editDraft.cover === editingTrack.cover && !artPreview}>Revert artwork</button></div></div><div className="current-meta-title">CURRENT TAGS</div></>}
              <div className="current-meta-grid">
                {songEditTab === 'Basic' && <>
                <label className="metadata-input-field" data-updated={acceptedMetadataFields.includes('title')}>Song title<input className="modal-input" value={editDraft.title} onChange={event => setEditDraft(current => ({ ...current, title: event.target.value }))}/></label>
                <label className="metadata-input-field" data-updated={acceptedMetadataFields.includes('artist')}>Artist<input className="modal-input" value={editDraft.artist} onChange={event => setEditDraft(current => ({ ...current, artist: event.target.value }))}/></label>
                <label className="metadata-input-field" data-updated={acceptedMetadataFields.includes('album')}>Album<input className="modal-input" value={editDraft.album} onChange={event => setEditDraft(current => ({ ...current, album: event.target.value }))}/></label>
                <label className="metadata-input-field" data-updated={acceptedMetadataFields.includes('albumArtist')}>Album artist<input className="modal-input" value={editDraft.albumArtist} onChange={event => setEditDraft(current => ({ ...current, albumArtist: event.target.value }))}/></label>
                <label className="metadata-input-field" data-updated={acceptedMetadataFields.includes('year')}>Release date<input className="modal-input" value={editDraft.year} onChange={event => setEditDraft(current => ({ ...current, year: event.target.value }))} placeholder="YYYY-MM-DD"/></label>
                <label className="metadata-input-field" data-updated={acceptedMetadataFields.includes('genre')}>Genre<input className="modal-input" value={editDraft.genre} onChange={event => setEditDraft(current => ({ ...current, genre: event.target.value }))}/></label>
                <div className="metadata-input-pair"><label className="metadata-input-field" data-updated={acceptedMetadataFields.includes('trackNumber')}>Track #<input className="modal-input" value={editDraft.trackNumber} onChange={event => setEditDraft(current => ({ ...current, trackNumber: event.target.value }))}/></label><label className="metadata-input-field" data-updated={acceptedMetadataFields.includes('trackCount')}>Tracks<input className="modal-input" value={editDraft.trackCount} onChange={event => setEditDraft(current => ({ ...current, trackCount: event.target.value }))}/></label></div>
                <div className="metadata-input-pair"><label className="metadata-input-field" data-updated={acceptedMetadataFields.includes('discNumber')}>Disc #<input className="modal-input" value={editDraft.discNumber} onChange={event => setEditDraft(current => ({ ...current, discNumber: event.target.value }))}/></label><label className="metadata-input-field" data-updated={acceptedMetadataFields.includes('discCount')}>Discs<input className="modal-input" value={editDraft.discCount} onChange={event => setEditDraft(current => ({ ...current, discCount: event.target.value }))}/></label></div>
                </>}
                {songEditTab === 'Details' && <>
                  <label className="metadata-input-field metadata-input-wide">Composer<input className="modal-input" value={editDraft.composer} onChange={event => setEditDraft(current => ({ ...current, composer: event.target.value }))}/></label>
                  <label className="metadata-input-field">Publisher<input className="modal-input" value={editDraft.publisher} onChange={event => setEditDraft(current => ({ ...current, publisher: event.target.value }))}/></label>
                  <label className="metadata-input-field">Copyright<input className="modal-input" value={editDraft.copyright} onChange={event => setEditDraft(current => ({ ...current, copyright: event.target.value }))}/></label>
                  <label className="metadata-input-field">Language<input className="modal-input" value={editDraft.language} onChange={event => setEditDraft(current => ({ ...current, language: event.target.value }))} placeholder="e.g. English"/></label>
                  <label className="metadata-input-field">ISRC<input className="modal-input" value={editDraft.isrc} onChange={event => setEditDraft(current => ({ ...current, isrc: event.target.value }))}/></label>
                  <label className="metadata-input-field metadata-input-wide">Notes<textarea className="modal-input metadata-notes-input" value={editDraft.notes} onChange={event => setEditDraft(current => ({ ...current, notes: event.target.value }))} rows={3}/></label>
                </>}
                {songEditTab === 'Classification' && <>
                  <label className="metadata-input-field">Genre<input className="modal-input" value={editDraft.genre} onChange={event => setEditDraft(current => ({ ...current, genre: event.target.value }))}/></label>
                  <label className="metadata-input-field">Mood<input className="modal-input" value={editDraft.mood} onChange={event => setEditDraft(current => ({ ...current, mood: event.target.value }))} placeholder="e.g. Dreamy"/></label>
                  <label className="metadata-input-field">BPM<input className="modal-input" inputMode="decimal" value={editDraft.bpm} onChange={event => setEditDraft(current => ({ ...current, bpm: event.target.value }))}/></label>
                  <label className="metadata-input-field">Musical key<input className="modal-input" value={editDraft.musicalKey} onChange={event => setEditDraft(current => ({ ...current, musicalKey: event.target.value }))} placeholder="e.g. C minor"/></label>
                  <label className="metadata-input-field">Rating<input className="modal-input" type="number" min="0" max="5" value={editDraft.rating} onChange={event => setEditDraft(current => ({ ...current, rating: event.target.value }))} placeholder="0–5 stars"/></label>
                </>}
                {songEditTab === 'Lyrics' && <label className="metadata-input-field metadata-input-wide">Lyrics<textarea className="modal-input metadata-notes-input lyrics-editor" value={editDraft.lyrics} onChange={event => setEditDraft(current => ({ ...current, lyrics: event.target.value }))} rows={14} placeholder="Add or edit song lyrics"/></label>}
              </div>
            </section>
            <section className="suggested-track-panel">
              <div className="editor-pane-title">{songEditTab === 'Basic' ? 'SUGGESTED ART & TAGS' : songEditTab === 'Lyrics' ? 'LYRICS' : `SUGGESTED ${songEditTab.toUpperCase()}`}</div>
              {songEditTab !== 'Basic' && <p className="tab-context-note">{songEditTab === 'Lyrics' ? 'Lyrics are saved with this song and embedded in the MP3 when available.' : 'These fields are saved with your library and written to supported MP3 tags.'}</p>}
              {songEditTab === 'Basic' && <>
              <div className="found-artwork-card">
                {(!artSearchSubmitted || artSearching) && <div className="artwork-search-stage"><div className="artwork-skeleton-strip" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span className="artwork-skeleton-block" key={index}/>)}</div><div className="artwork-search-overlay"><div className="art-search-row"><input className="modal-input" aria-label="Search album artwork" value={artQuery} onChange={event => setArtQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void searchArtwork()} placeholder="Search artist or album"/><button className="secondary-button" disabled={artSearching} onClick={() => void searchArtwork()}><Search size={14}/>{artSearching ? 'Searching…' : 'Search'}</button></div></div></div>}
                {artSearchSubmitted && !artSearching && <div className="artwork-results-state"><div className="art-search-row artwork-search-inline"><input className="modal-input" aria-label="Search album artwork" value={artQuery} onChange={event => setArtQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void searchArtwork()} placeholder="Search artist or album"/><button className="secondary-button" onClick={() => void searchArtwork()}><Search size={14}/> Search</button></div>{artResults.length > 0 ? <div className="found-artwork-grid" aria-label="Found album artwork">{artResults.map(result => <button key={result.id} className={`found-artwork-option ${selectedArtResultId === result.id ? 'selected' : ''}`} onClick={() => void selectArtwork(result.cover, result.id)} aria-pressed={selectedArtResultId === result.id} aria-label={`Use ${result.title} artwork by ${result.artist}`} title={`${result.title} · ${result.artist}`}><img src={result.cover} alt=""/></button>)}</div> : <span className="found-artwork-status" role="status">{artError || 'No album artwork found.'}</span>}</div>}
              </div>
              <div className="metadata-lookup-heading"><div><strong>Found metadata</strong><small>{metadataEditStatus || 'Search to compare found tags with your current values.'}</small></div><button className="secondary-button metadata-find-button" onClick={() => void findMissingMetadataForEdit()} disabled={metadataEditSearching}><Search size={14}/>{metadataEditSearching ? 'Searching…' : 'Find metadata'}</button></div>
              <div className={`metadata-review ${Object.keys(metadataSuggestions).length ? 'has-found-tags' : 'is-empty'}`}><div className="metadata-found-rows">{(['title', 'artist', 'album', 'albumArtist', 'year', 'genre'] as const).map(key => renderFoundMetadataField(key, ({ title: 'Title', artist: 'Artist', album: 'Album', albumArtist: 'Album artist', year: 'Release date', genre: 'Genre' })[key]))}<div className="metadata-found-pair">{renderFoundMetadataField('trackNumber', 'Track #')}{renderFoundMetadataField('trackCount', 'Tracks')}</div><div className="metadata-found-pair">{renderFoundMetadataField('discNumber', 'Disc #')}{renderFoundMetadataField('discCount', 'Discs')}</div>{renderFoundMetadataField('composer', 'Composer')}</div><div className="metadata-review-actions"><button className="secondary-button" onClick={revertMetadataSuggestions} disabled={Object.keys(metadataSuggestions).length === 0}>Keep current</button><button className="primary-button compact" onClick={acceptAllMetadataSuggestions} disabled={Object.keys(metadataSuggestions).length === 0}>Accept all</button></div></div>
              </>}
            </section>
          </div>
          <div className="modal-actions"><button className="secondary-button" onClick={() => editingTrack.file && downloadTrack(editingTrack)} disabled={!editingTrack.file}><Download size={14}/> Download tagged MP3</button><button className="secondary-button" onClick={() => setEditingTrack(null)}>Cancel</button><button className="primary-button compact" onClick={() => void saveTrackEdits()} disabled={!editDraft.title.trim()}>Save changes</button></div>
        </div>
      </div>}
    </div>
  )
}

type TableProps = {
  tracks: Track[]
  favorites: string[]
  currentId: string
  isPlaying: boolean
  onPlay: (track: Track) => void
  onFavorite: (id: string) => void
  onMenu: (id: string | null) => void
  menuTrack: string | null
  onRemove: (id: string) => void
  onEdit: (id: string) => void
  onDownload: (track: Track) => void
  onPlayNext: (id: string) => void
  onEnqueue: (id: string) => void
  onGoToAlbum: (track: Track) => void
  onGoToArtist: (track: Track) => void
  onAddToPlaylist: (id: string | null) => void
  onCreatePlaylist: (trackId: string) => void
  sortField: SortField
  sortDirection: SortDirection
  sortByAdded?: boolean
  customColumns: MetaColumn[]
  onCustomColumnsChange: (columns: MetaColumn[]) => void
  onSort: (field: SortField) => void
  onUpdateMetadata: (trackId: string, field: EditableField, value: string) => void
  selectedIds: string[]
  onSelectTrack: (id: string) => void
  onSelectAll: (ids: string[], selected: boolean) => void
  onQueueSelected: (ids: string[]) => void
  onDeleteSelected: (ids: string[]) => void
  onSaveSelected: (playlistId: string, ids: string[]) => void
  onCreatePlaylistSelected: (ids: string[]) => void
  onUploadSelected: (ids: string[]) => void
  metadataScanning: boolean
  metadataScanStatus: string
  onScanMissingMetadata: (ids: string[]) => void
  playlists: { id: string; name: string; trackIds: string[] }[]
  playlistTarget: string | null
  addToPlaylist: (playlistId: string, trackId: string) => void
  preserveOrder?: boolean
  onReorder?: (sourceId: string, targetId: string, placeAfter?: boolean) => void
}

function TrackTable({
  tracks,
  favorites,
  currentId,
  isPlaying,
  onPlay,
  onFavorite,
  onMenu,
  menuTrack,
  onRemove,
  onEdit,
  onDownload,
  onPlayNext,
  onEnqueue,
  onGoToAlbum,
  onGoToArtist,
  onAddToPlaylist,
  onCreatePlaylist,
  sortField,
  sortDirection,
  sortByAdded = false,
  customColumns,
  onCustomColumnsChange,
  onSort,
  onUpdateMetadata,
  selectedIds,
  onSelectTrack,
  onSelectAll,
  onQueueSelected,
  onDeleteSelected,
  onSaveSelected,
  onCreatePlaylistSelected,
  onUploadSelected,
  metadataScanning,
  metadataScanStatus,
  onScanMissingMetadata,
  playlists,
  playlistTarget,
  addToPlaylist,
  preserveOrder = false,
  onReorder,
}: TableProps) {
  const [bulkPlaylistOpen, setBulkPlaylistOpen] = useState(false)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [draggedTrackId, setDraggedTrackId] = useState<string | null>(null)
  const [dragTargetId, setDragTargetId] = useState<string | null>(null)
  const [endDropTarget, setEndDropTarget] = useState(false)
  const rowElementsRef = useRef(new Map<string, HTMLDivElement>())
  const selectedTracks = tracks.filter(track => selectedIds.includes(track.id))
  const allSelected = tracks.length > 0 && tracks.every(track => selectedIds.includes(track.id))
  const sortedTracks = preserveOrder ? tracks : [...tracks].sort((a, b) => {
    if (sortByAdded) return (b.addedAt || 0) - (a.addedAt || 0)
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    return collator.compare(a[sortField], b[sortField]) * (sortDirection === 'asc' ? 1 : -1)
  })
  const suggestionsFor = (field: EditableField) => [...new Set(tracks.map(track => (field === 'year' ? track.year?.slice(0, 4) : track[field])?.trim()).filter((value): value is string => Boolean(value)))]
  const sortableHeading = (field: SortField, label: string) => preserveOrder ? <span className="sortable-heading fixed-playlist-heading">{label}</span> : <button className="sortable-heading" onClick={() => onSort(field)} aria-label={`Sort by ${label} ${sortField === field && sortDirection === 'desc' ? 'ascending' : 'descending'}`}>
    {label}{sortField === field ? sortDirection === 'asc' ? <ChevronDown size={12}/> : <ChevronUp size={12}/> : <ChevronDown size={12} className="sort-muted"/>}
  </button>
  const gridColumns = `34px minmax(170px,1.3fr) minmax(115px,.9fr) minmax(120px,.9fr) ${customColumns.map(() => 'minmax(90px,.7fr)').join(' ')} 68px 104px`
  const columnSelector = <div className="column-config-wrap"><button className="column-config-button" onClick={() => setColumnsOpen(open => !open)} aria-expanded={columnsOpen}><Columns3 size={14}/> Columns {customColumns.length > 0 && <span>{customColumns.length}/4</span>}</button>{columnsOpen && <div className="column-config-menu"><strong>Extra song details</strong><small>Choose up to four columns</small>{(Object.keys(metaColumnLabels) as MetaColumn[]).map(column => <label key={column} className={customColumns.includes(column) ? 'column-option selected' : 'column-option'}><input type="checkbox" checked={customColumns.includes(column)} disabled={!customColumns.includes(column) && customColumns.length >= 4} onChange={event => onCustomColumnsChange(event.target.checked ? [...customColumns, column] : customColumns.filter(item => item !== column))}/>{metaColumnLabels[column]}</label>)}</div>}</div>
  const firstTrackId = sortedTracks[0]?.id
  const lastTrackId = sortedTracks[sortedTracks.length - 1]?.id

  useEffect(() => {
    if (!preserveOrder || !draggedTrackId || !firstTrackId || !lastTrackId) return
    const isAboveFirstTrack = (event: DragEvent) => {
      const firstRow = rowElementsRef.current.get(firstTrackId)
      if (!firstRow) return false
      const bounds = firstRow.getBoundingClientRect()
      return event.clientY <= bounds.top && event.clientX >= bounds.left && event.clientX <= bounds.right
    }
    const isBelowLastTrack = (event: DragEvent) => {
      const lastRow = rowElementsRef.current.get(lastTrackId)
      if (!lastRow) return false
      const bounds = lastRow.getBoundingClientRect()
      return event.clientY >= bounds.bottom && event.clientX >= bounds.left && event.clientX <= bounds.right
    }
    const handleWindowDragOver = (event: DragEvent) => {
      if (isAboveFirstTrack(event)) {
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        setDragTargetId(firstTrackId)
        setEndDropTarget(false)
        return
      }
      if (!isBelowLastTrack(event)) {
        setEndDropTarget(false)
        setDragTargetId(current => current === firstTrackId ? null : current)
        return
      }
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      setDragTargetId(null)
      setEndDropTarget(true)
    }
    const handleWindowDrop = (event: DragEvent) => {
      if (event.defaultPrevented) return
      const dropAtStart = isAboveFirstTrack(event)
      const dropAtEnd = isBelowLastTrack(event)
      if (!dropAtStart && !dropAtEnd) return
      event.preventDefault()
      const sourceId = event.dataTransfer?.getData('text/plain') || draggedTrackId
      const targetId = dropAtStart ? firstTrackId : lastTrackId
      if (sourceId && sourceId !== targetId) onReorder?.(sourceId, targetId, dropAtEnd)
      setDraggedTrackId(null)
      setDragTargetId(null)
      setEndDropTarget(false)
    }
    window.addEventListener('dragover', handleWindowDragOver)
    window.addEventListener('drop', handleWindowDrop)
    return () => {
      window.removeEventListener('dragover', handleWindowDragOver)
      window.removeEventListener('drop', handleWindowDrop)
    }
  }, [preserveOrder, draggedTrackId, firstTrackId, lastTrackId, onReorder])

  return (
    <div className="track-table-wrap">
      {selectedTracks.length > 0 && <div className="bulk-actions"><span><strong>{selectedTracks.length}</strong> selected</span><button className="secondary-button" disabled={metadataScanning} onClick={() => onScanMissingMetadata(selectedTracks.map(track => track.id))}><Search size={14}/>{metadataScanning ? 'Scanning…' : 'Find missing metadata'}</button><button className="secondary-button" onClick={() => onQueueSelected(selectedTracks.map(track => track.id))}><ListMusic size={14}/> Add to queue</button><div className="bulk-playlist-wrap"><button className="secondary-button" onClick={() => setBulkPlaylistOpen(open => !open)}><ListPlus size={14}/> Save to playlist</button>{bulkPlaylistOpen && <div className="bulk-playlist-menu"><strong>Save {selectedTracks.length} songs to</strong>{playlists.map(playlist => <button key={playlist.id} onClick={() => { onSaveSelected(playlist.id, selectedTracks.map(track => track.id)); setBulkPlaylistOpen(false) }}><ListMusic size={14}/>{playlist.name}</button>)}<button className="bulk-new-playlist" onClick={() => { onCreatePlaylistSelected(selectedTracks.map(track => track.id)); setBulkPlaylistOpen(false) }}><Plus size={14}/> New playlist</button></div>}</div><button className="secondary-button bulk-upload" onClick={() => onUploadSelected(selectedTracks.map(track => track.id))}><Upload size={14}/> Upload to NAS</button><button className="secondary-button bulk-delete" onClick={() => onDeleteSelected(selectedTracks.map(track => track.id))}><Trash2 size={14}/> Delete selected</button><button className="bulk-clear" onClick={() => onSelectAll(selectedTracks.map(track => track.id), false)}>Clear</button>{metadataScanStatus && <small className="metadata-scan-status">{metadataScanStatus}</small>}</div>}
      <div className={`track-table ${preserveOrder ? 'playlist-track-table' : ''} ${selectedTracks.length ? 'has-selection' : ''}`}>
      <div className="track-table-head" style={{gridTemplateColumns: gridColumns, minWidth: `${694 + customColumns.length * 100}px`}}>
        <span className={`track-index-heading ${selectedTracks.length ? 'has-selection' : ''}`}><span className="track-index-label">#</span><input ref={element => { if (element) element.indeterminate = selectedTracks.length > 0 && !allSelected }} className="track-select-all" type="checkbox" aria-label="Select all songs in this list" aria-checked={selectedTracks.length > 0 && !allSelected ? 'mixed' : allSelected} checked={allSelected} onChange={event => onSelectAll(tracks.map(track => track.id), event.target.checked)}/></span>
        <span>{sortableHeading('title', 'TITLE')}</span>
        <span>{sortableHeading('artist', 'ARTIST')}</span>
        <span>{sortableHeading('album', 'ALBUM')}</span>
        {customColumns.map(column => <span className="custom-metadata-heading" key={column}>{metaColumnLabels[column]}</span>)}
        <span className="time-heading"><Clock3 size={13}/><span className="time-label">TIME</span></span>
        <span className="column-config-cell">{columnSelector}</span>
      </div>

      {sortedTracks.map((track, index) => (
        <div
          ref={element => { if (element) rowElementsRef.current.set(track.id, element); else rowElementsRef.current.delete(track.id) }}
          className={`track-row ${currentId === track.id ? 'is-current' : ''} ${selectedIds.includes(track.id) ? 'is-selected' : ''} ${draggedTrackId === track.id ? 'is-dragging' : ''} ${dragTargetId === track.id ? 'is-drop-target' : ''}`}
          style={{gridTemplateColumns: gridColumns, minWidth: `${694 + customColumns.length * 100}px`}}
          key={track.id}
          draggable={preserveOrder}
          tabIndex={preserveOrder ? 0 : undefined}
          aria-roledescription={preserveOrder ? 'Draggable playlist song' : undefined}
          aria-label={preserveOrder ? `${track.title}, position ${index + 1}. Use Alt and the arrow keys to reorder.` : undefined}
          onDragStart={event => { if (!preserveOrder) return; setDraggedTrackId(track.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', track.id) }}
          onDragOver={event => { if (!preserveOrder) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragTargetId(track.id); setEndDropTarget(false) }}
          onDragLeave={event => { if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return; setDragTargetId(current => current === track.id ? null : current) }}
          onDrop={event => { if (!preserveOrder) return; event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedTrackId; if (sourceId && sourceId !== track.id) onReorder?.(sourceId, track.id, false); setDraggedTrackId(null); setDragTargetId(null); setEndDropTarget(false) }}
          onDragEnd={() => { setDraggedTrackId(null); setDragTargetId(null); setEndDropTarget(false) }}
          onKeyDown={event => { if (!preserveOrder || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return; event.preventDefault(); const movingDown = event.key === 'ArrowDown'; const target = sortedTracks[index + (movingDown ? 1 : -1)]; if (target) onReorder?.(track.id, target.id, movingDown) }}
        >
          <div className={`track-index-cell ${selectedIds.includes(track.id) ? 'is-selected' : ''}`}>
            <span className="track-index-number">{String(index + 1).padStart(2, '0')}</span>
            <input className="track-row-select" type="checkbox" aria-label={`Select ${track.title}`} checked={selectedIds.includes(track.id)} onChange={event => { onSelectTrack(track.id); event.currentTarget.blur() }}/>
          </div>

          <div className="track-title-cell">
            <button type="button" className="track-cover-wrap" onClick={() => onPlay(track)} aria-label={`Play ${track.title}`}><img src={track.cover} alt=""/><span className="track-cover-play" aria-hidden="true">{currentId === track.id && isPlaying ? <Pause size={15} fill="currentColor"/> : <Play size={15} fill="currentColor"/>}</span></button>
            <span className="track-title-text"><EditableCell value={track.title} field="title" suggestions={suggestionsFor('title')} onCommit={value => onUpdateMetadata(track.id, 'title', value)}/></span>
          </div>

          <span className="track-artist"><EditableCell value={track.artist} field="artist" suggestions={suggestionsFor('artist')} onCommit={value => onUpdateMetadata(track.id, 'artist', value)}/></span>
          <span className="track-album"><EditableCell value={track.album} field="album" suggestions={suggestionsFor('album')} onCommit={value => onUpdateMetadata(track.id, 'album', value)}/></span>
          {customColumns.map(column => <span className="track-custom-metadata" key={column} title={track[column] || ''}><EditableCell value={column === 'year' ? track.year?.slice(0, 4) : track[column]} field={column} suggestions={suggestionsFor(column)} onCommit={value => onUpdateMetadata(track.id, column, value)}/></span>)}
          <span className="track-duration"><span className="track-duration-label">{track.duration ? formatTime(track.duration) : '—'}</span></span>

          <div className={`track-actions ${menuTrack === track.id || playlistTarget === track.id ? 'menu-open' : ''}`}>
            <button
              className={`row-action ${favorites.includes(track.id) ? 'liked' : ''}`}
              onClick={() => onFavorite(track.id)}
              aria-label="Favorite"
            >
              <Heart size={16} />
            </button>

            <div className="more-wrap">
              <button
                className="row-action"
                onClick={() => { onAddToPlaylist(null); onMenu(menuTrack === track.id ? null : track.id) }}
                aria-label="More options"
              >
                <MoreHorizontal size={18} />
              </button>

              {menuTrack === track.id && (
                <div className="track-menu">
                  <button onClick={() => onPlayNext(track.id)}><SkipForward size={14} /> Play next</button>
                  <button onClick={() => onEnqueue(track.id)}><ListMusic size={14} /> Add to queue</button>
                  <button onClick={() => onDownload(track)}><Download size={14}/> Download</button>
                  <button onClick={() => onAddToPlaylist(track.id)}><ListPlus size={14} /> Save to playlist</button>
                  <button onClick={() => onGoToAlbum(track)}><Disc3 size={14} /> Go to album</button>
                  <button onClick={() => onGoToArtist(track)}><UserRound size={14} /> Go to artist</button>
                  <button onClick={() => onEdit(track.id)}><Music2 size={14}/> Edit details & artwork</button>
                  <button
                    className="danger-action"
                    onClick={() => onRemove(track.id)}
                  >
                    <Trash2 size={14} /> Delete song
                  </button>
                </div>
              )}

              {playlistTarget === track.id && (
                <div className="playlist-popover">
                  <strong>Save to playlist</strong>
                  {playlists.map(playlist => (
                    <button
                      key={playlist.id}
                      onClick={() => addToPlaylist(playlist.id, track.id)}
                    >
                      <ListMusic size={14} /> {playlist.name}
                    </button>
                  ))}
                  {playlists.length === 0 && (
                    <small>Create a playlist first.</small>
                  )}
                  <button className="new-playlist-option" onClick={() => onCreatePlaylist(track.id)}><Plus size={14}/> New playlist</button>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      {preserveOrder && sortedTracks.length > 0 && <div className={`playlist-end-drop-zone ${endDropTarget ? 'active' : ''}`} style={{minWidth: `${694 + customColumns.length * 100}px`}} aria-label="Drop here to move song to the end of the playlist" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragTargetId(null); setEndDropTarget(true) }} onDragLeave={event => { if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return; setEndDropTarget(false) }} onDrop={event => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedTrackId; const lastTrack = sortedTracks[sortedTracks.length - 1]; if (sourceId && lastTrack && sourceId !== lastTrack.id) onReorder?.(sourceId, lastTrack.id, true); setDraggedTrackId(null); setDragTargetId(null); setEndDropTarget(false) }}/>} 
      </div>
    </div>
  )
}

export default App
