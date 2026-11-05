export const meta = {
  name: 'om-portfolio',
  description: 'OM portfolio run: the autopilot cycle for every active product, one after another',
  whenToUse: 'Daily run across all products. args: {now, maxWaves?, perWave?}',
  phases: [
    { title: 'Discover', detail: 'list active products' },
    { title: 'Run', detail: 'om-autopilot per product' },
  ],
}

const now = args?.now ?? 'unknown-time'
const LIST = { type: 'object', properties: { slugs: { type: 'array', items: { type: 'string' } } }, required: ['slugs'] }

phase('Discover')
const { slugs } = await agent('List the folders in products/ (skip names starting with "_") whose product.json has stage "active". Return their names.',
  { label: 'list products', phase: 'Discover', schema: LIST, effort: 'low', model: 'haiku' })
if (!slugs.length) { log('No active products'); return { products: [] } }

phase('Run')
const results = []
for (const slug of slugs) {
  log(`Autopilot: ${slug}`)
  try {
    results.push(await workflow('om-autopilot', { slug, now, maxWaves: args?.maxWaves ?? 3, perWave: args?.perWave ?? 8 }))
  } catch (e) {
    results.push({ slug, error: String(e) })
  }
}
return { products: results }
