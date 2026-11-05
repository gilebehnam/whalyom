---
name: ext-wsh-market-sizing-analysis
description: Calculate TAM/SAM/SOM for market opportunities using top-down, bottom-up, and value theory methodologies. Use this skill when sizing markets, estimating addressable revenue, validating market opportunity for a new venture, or building investor-ready market analysis for a startup pitch or business plan.
version: 1.0.0
license: MIT
---

> **Whalyom note (added on install; not part of the upstream skill).** Source: https://github.com/wshobson/agents (MIT). Inside Whalyom: read `product.json`, `profile.md`, `claims.md` and `LEARNINGS.md` first. Use only claims from `claims.md`; treat every statistic, benchmark or example in this skill as a general heuristic, never as a claim about the product. Write drafts to `outbox/` and results to `runs/<task-id>.json`; nothing is published, sent, or changes ad spend without owner approval, and budget caps in `product.json` always hold. No fake accounts, vote manipulation, bulk unsolicited DMs, or scraping against a site's terms. Code, API and CLI examples are reference only: do not install packages or run them against live accounts. Related upstream skills are installed as `ext-wsh-<slug>` where available; if one is missing, use the closest Whalyom skill or work from this file.

# Market Sizing Analysis

Comprehensive market sizing methodologies for calculating Total Addressable Market (TAM), Serviceable Available Market (SAM), and Serviceable Obtainable Market (SOM) for startup opportunities.

## Overview

Market sizing provides the foundation for startup strategy, fundraising, and business planning. Calculate market opportunity using three complementary methodologies: top-down (industry reports), bottom-up (customer segment calculations), and value theory (willingness to pay).

## Core Concepts

### The Three-Tier Market Framework

**TAM (Total Addressable Market)**

- Total revenue opportunity if achieving 100% market share
- Defines the universe of potential customers
- Used for long-term vision and market validation
- Example: All email marketing software revenue globally

**SAM (Serviceable Available Market)**

- Portion of TAM targetable with current product/service
- Accounts for geographic, segment, or capability constraints
- Represents realistic addressable opportunity
- Example: AI-powered email marketing for e-commerce in North America

**SOM (Serviceable Obtainable Market)**

- Realistic market share achievable in 3-5 years
- Accounts for competition, resources, and market dynamics
- Used for financial projections and fundraising
- Example: 2-5% of SAM based on competitive landscape

### When to Use Each Methodology

**Top-Down Analysis**

- Use when established market research exists
- Best for mature, well-defined markets
- Validates market existence and growth
- Starts with industry reports and narrows down

**Bottom-Up Analysis**

- Use when targeting specific customer segments
- Best for new or niche markets
- Most credible for investors
- Builds from customer data and pricing

**Value Theory**

- Use when creating new market categories
- Best for disruptive innovations
- Estimates based on value creation
- Calculates willingness to pay for problem solution

## Detailed patterns and worked examples

Detailed pattern documentation lives in `references/details.md`. Read that file when the navigation tier above is insufficient.

