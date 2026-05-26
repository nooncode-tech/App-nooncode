import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOverpassQuery } from '@/lib/server/maxwell/lead-engine'
import { getNicheById } from '@/lib/server/maxwell/niches'

// Architecture C2 + spec §4.E: Overpass query is generic byte-identical when
// no niche is provided, and switches to a strict tag-whitelist per niche.

const center = { latitude: 19.4326, longitude: -99.1332 } // CDMX

test('generic mode preserves the legacy amenity/shop/tourism/office/craft/healthcare query', () => {
  const query = buildOverpassQuery(center, 10, undefined)

  assert.match(query, /node\["name"\]\["amenity"\]/)
  assert.match(query, /node\["name"\]\["shop"\]/)
  assert.match(query, /node\["name"\]\["tourism"\]/)
  assert.match(query, /node\["name"\]\["office"\]/)
  assert.match(query, /node\["name"\]\["craft"\]/)
  assert.match(query, /node\["name"\]\["healthcare"\]/)
  // Generic mode must NOT scope to a specific tag value.
  assert.doesNotMatch(query, /\["amenity"="restaurant"\]/)
})

test('niche whitelist mode emits only the niche overpass tags as key=value filters', () => {
  const restaurante = getNicheById('restaurante')
  assert.ok(restaurante, 'restaurante niche must exist in catalog')
  const query = buildOverpassQuery(center, 10, restaurante)

  assert.match(query, /\["name"\]\["amenity"="restaurant"\]/)
  // Whitelist must NOT include the broader generic tags.
  assert.doesNotMatch(query, /node\["name"\]\["shop"\]\(/)
  assert.doesNotMatch(query, /node\["name"\]\["tourism"\]\(/)
})

test('niche whitelist emits node/way/relation triplet for every overpass tag', () => {
  const dental = getNicheById('dental')
  assert.ok(dental, 'dental niche must exist in catalog')
  const query = buildOverpassQuery(center, 5, dental)

  for (const tag of dental.overpassTags) {
    const filter = `["name"]["${tag.key}"="${tag.value}"]`
    assert.ok(query.includes(`node${filter}`), `expected node filter for ${tag.key}=${tag.value}`)
    assert.ok(query.includes(`way${filter}`), `expected way filter for ${tag.key}=${tag.value}`)
    assert.ok(query.includes(`relation${filter}`), `expected relation filter for ${tag.key}=${tag.value}`)
  }
})

test('radius is honored: 100km is the upper bound clamp', () => {
  const restaurante = getNicheById('restaurante')!
  const shortQuery = buildOverpassQuery(center, 5, restaurante)
  const longQuery = buildOverpassQuery(center, 200, restaurante) // clamped to 100km

  assert.match(shortQuery, /\(around:5000,/)
  assert.match(longQuery, /\(around:100000,/)
})
