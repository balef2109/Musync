# Musync

A personal music library interface for MP3s stored on a Synology NAS. It includes search, album and artist browsing, favorites, shuffle, playback controls, playlist creation, playlist JSON import/export, and local audio import.

Album and artist cards open dedicated detail pages with their matching songs. Artist imagery is looked up from Wikipedia's free page thumbnails when available, with a name initial fallback; on an artist detail page, hover over the artist image to search Wikimedia Commons or upload a replacement. On an album detail page, hover over its cover to search or upload replacement artwork. Saved images are kept in this browser, and album artwork is applied to the album's songs. Song menus can play a track next, queue it, download it, save it to an existing or new playlist, or browse to its album or artist.

## Connect a Synology library

Musync runs in the browser, so it cannot scan a NAS folder directly. Host a `library.json` manifest on the NAS and use **Connect NAS** to add its URL. The manifest should list playable media URLs:

```json
{
  "tracks": [
    {
      "title": "Song title",
      "artist": "Artist",
      "album": "Album",
      "duration": 213,
      "cover": "https://nas.example.com/music/cover.jpg",
      "url": "https://nas.example.com/music/song.mp3"
    }
  ]
}
```

The manifest and audio URLs need to be reachable by the browser. Use HTTPS and configure the NAS web server to allow cross-origin requests from the Musync site. The manifest URL and synced track list are saved in this browser. Audio playback depends on the NAS serving audio files with browser-compatible range requests and MIME types.

For two-way continuity, configure a custom API base URL in **Connect NAS**. Musync then reads `GET /library.json`, uploads audio and tags as multipart form data to `POST /tracks`, and removes NAS files through `DELETE /tracks/:id`. The upload form includes `file`, `title`, `artist`, `album`, `duration`, and available year, genre, track/disc number, composer, and embedded cover art fields. The upload endpoint must return JSON in the form `{ "id": "track-id", "url": "https://nas.example.com/music/song.mp3" }`. The library response should have a `tracks` array with each track's `id`, `title`, `artist`, `album`, `duration`, `cover`, and `url`. An optional Bearer token can be entered in the connection dialog; it is kept for the current browser session. Configure API CORS to allow the Musync site. Local imports upload automatically once the custom API has been connected; selected local songs can also be uploaded from the bulk action bar.

Playlist import/export uses this same JSON shape with a playlist `name` and `tracks` array. Local file imports are available from **Import music**.

## MP3 tags and artwork

On import, Musync reads common ID3v2 and ID3v1 fields (title, artist, album, year, genre, track/disc numbers, composer) and embedded ID3v2 cover images. Imported files and their edited details are stored in this browser's IndexedDB. Use a song's **Edit details & artwork** menu to update those details, search MusicBrainz/Cover Art Archive, or upload an image. Saving edits writes supported fields and embedded artwork into the MP3 held in the browser; **Download tagged MP3** exports that updated file. Tracks without tags can use their filename as the starting title. Previously imported files need to be imported again for their embedded tags to be read.

Select songs in a list and choose **Find missing metadata** to look up confident MusicBrainz recording matches and fill only blank or placeholder fields. The same lookup is available in the song editor; review the filled fields and save them there. Local MP3 files are updated with the discovered ID3 tags when possible. Bulk scans run one lookup at a time to respect MusicBrainz request limits.

## Development

Run `npm install` and `npm run dev` to start the local app.
