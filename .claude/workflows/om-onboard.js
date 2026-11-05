export const meta = {
  name: 'om-onboard',
  description: 'OM onboarding: research a product from its domain or a written brief, build profile, claims, ICP and a 30-day plan',
  whenToUse: 'First run for a new product. args: {slug, now, domain?} — products/<slug>/ must exist (copied from _template) with product.json, and brief.md when there is no domain',
  phases: [
    { title: 'Discover', detail: 'site, competitors, customer language, reviews, market size in parallel' },
    { title: 'Define', detail: 'product analyst, positioning, then ICP and messaging' },
    { title: 'Map', detail: 'keywords, communities, SERPs, tracking, pricing in parallel' },
    { title: 'Plan', detail: 'CMO plan, red team, final plan' },
  ],
}

const slug = args?.slug
if (!slug) throw new Error('om-onboard needs args.slug')
const now = args?.now ?? 'unknown-time'
const hasDomain = Boolean(args?.domain)
const ws = `products/${slug}/`
const source = hasDomain ? `the live site ${args.domain}` : `${ws}brief.md (there is no domain yet; skip anything that needs the live site and list it as pending)`

// If an agent type isn't registered in this session yet, fall back to a general agent
// that follows the agent's definition file, so one missing type can't stop the run.
const run = async (agentType, id, job, phaseName) => {
  const prompt = `Product workspace: ${ws} (slug "${slug}"). Task id: ${id}. Source of truth about the product: ${source}. ${job} Write your result file ${ws}runs/${id}.json. Current time: ${now}.`
  try {
    return await agent(prompt, { agentType, label: `${agentType} ${id}`, phase: phaseName })
  } catch (e) {
    log(`${agentType} unavailable (${String(e).slice(0, 60)}…); using general-purpose with .claude/agents/${agentType}.md`)
    return agent(`Act as the agent defined in .claude/agents/${agentType}.md: read that file first and follow it exactly.\n\n${prompt}`,
      { agentType: 'general-purpose', label: `${agentType}* ${id}`, phase: phaseName })
  }
}
const apply = (label) => agent(`Run \`node tools/apply-results.mjs ${slug} --now ${now}\` from the project root and return stdout.`, { label, effort: 'low', model: 'haiku' })

phase('Discover')
await parallel([
  hasDomain ? () => run('om-site-crawler', 'O1', 'Write research/site-inventory.md.', 'Discover') : null,
  () => run('om-competitor-intel', 'O2', 'Write research/competitors.md.', 'Discover'),
  () => run('om-voc-miner', 'O3', 'Write research/voc.md.', 'Discover'),
  () => run('om-review-miner', 'O4', 'Write research/reviews.md from competitor reviews.', 'Discover'),
  () => run('om-market-sizer', 'O5', 'Write research/market-size.md.', 'Discover'),
  () => run('om-trend-watcher', 'O6', 'Write research/intel/trends.md.', 'Discover'),
].filter(Boolean))

phase('Define')
await run('om-product-analyst', 'O7', 'Write profile.md and claims.md from the research so far. Mark claims verified only when the site or brief states them.', 'Define')
await parallel([
  () => run('om-positioning-strategist', 'O8', 'Write research/positioning.md.', 'Define'),
  () => run('om-icp-builder', 'O9', 'Write research/icp.md.', 'Define'),
  () => run('om-jtbd-analyst', 'O10', 'Write research/jtbd.md.', 'Define'),
])
await run('om-message-architect', 'O11', 'Write research/message-house.md from positioning, ICP and JTBD.', 'Define')

phase('Map')
await parallel([
  () => run('om-keyword-researcher', 'O12', 'Write research/keywords.md.', 'Map'),
  () => run('om-community-scout', 'O13', 'Write research/communities.md.', 'Map'),
  () => run('om-serp-analyst', 'O14', 'Write research/serp.md for the top 20 target queries.', 'Map'),
  () => run('om-pricing-intel', 'O15', 'Write research/pricing-intel.md.', 'Map'),
  () => run('om-tracking-engineer', 'O16', 'Write research/tracking.md: the analytics and conversion events to set up.', 'Map'),
  () => run('om-risk-officer', 'O17', 'Write research/risks.md.', 'Map'),
])

phase('Plan')
await run('om-cmo', 'O18', 'Write plan.md (30 days, one revenue goal, channel portfolio) and 20–40 new_tasks across the roster pods, with depends_on and priority.', 'Plan')
await run('om-red-team', 'O19', 'Attack plan.md. Write reports/red-team.md with the three biggest risks and what to change.', 'Plan')
await run('om-cmo', 'O20', 'Read reports/red-team.md and revise plan.md. Add or change new_tasks only where the red team found a real gap.', 'Plan')
const stats = await apply('apply onboarding')
await agent('Run `node tools/build-state.mjs` and return stdout.', { label: 'build state', effort: 'low', model: 'haiku' })

return { slug, hasDomain, applied: stats }
