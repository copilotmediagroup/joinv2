import fs from 'node:fs'

const envFile = '.env.local'

if (!fs.existsSync(envFile)) {
  console.error('FAIL: .env.local missing')
  process.exit(1)
}

const env = Object.fromEntries(
  fs
    .readFileSync(envFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=')

      return [
        line.slice(0, index),
        line.slice(index + 1),
      ]
    })
)

const key = env.GOOGLE_MAPS_API_KEY

if (!key) {
  console.error('FAIL: GOOGLE_MAPS_API_KEY missing')
  process.exit(1)
}

const response = await fetch(
  'https://places.googleapis.com/v1/places:searchText',
  {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,

      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.primaryType',
        'places.rating',
        'places.userRatingCount',
        'places.currentOpeningHours',
        'places.photos',
      ].join(','),
    },

    body: JSON.stringify({
      textQuery: 'rooftop bars in Tampa Florida',

      locationBias: {
        circle: {
          center: {
            latitude: 27.9506,
            longitude: -82.4572,
          },

          radius: 12000,
        },
      },

      maxResultCount: 5,
    }),
  }
)

const body = await response.json()

if (!response.ok) {
  console.error('FAIL: GOOGLE PLACES REQUEST')
  console.error(JSON.stringify(body, null, 2))
  process.exit(1)
}

const places = body.places ?? []

console.log('')
console.log('============================================')
console.log('GOOGLE PLACES LIVE RESPONSE')
console.log('============================================')

places.forEach((place, index) => {
  console.log('')
  console.log(`#${index + 1}`)
  console.log('ID:', place.id)
  console.log('NAME:', place.displayName?.text)
  console.log('ADDRESS:', place.formattedAddress)
  console.log('TYPE:', place.primaryType)
  console.log('RATING:', place.rating)
  console.log('REVIEWS:', place.userRatingCount)

  console.log(
    'OPEN NOW:',
    place.currentOpeningHours?.openNow ?? 'unknown'
  )

  console.log(
    'LOCATION:',
    place.location?.latitude,
    place.location?.longitude
  )

  console.log(
    'PHOTO COUNT:',
    place.photos?.length ?? 0
  )
})

console.log('')
console.log('============================================')
console.log(`PASS: ${places.length} LIVE GOOGLE PLACES`)
console.log('============================================')
