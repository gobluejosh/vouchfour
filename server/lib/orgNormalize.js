// Org name normalization for career overlap matching

const SUFFIXES = /,?\s*\b(Inc\.?|LLC|Corp\.?|Corporation|Co\.?|Ltd\.?|Limited|Incorporated)\s*$/i
const SYMBOLS = /[®™]/g

const ALIASES = {
  'guild education': 'guild',
  'amazon web services': 'amazon',
  'amazon lab126': 'amazon',
  'aws': 'amazon',
  'fullcontact inc': 'fullcontact',
  'ibotta inc': 'ibotta',
  'havenly brands (havenly, interior define, burrow, the citizenry, the inside, and st. frank)': 'havenly',
}

export function normalizeOrgName(name) {
  if (!name) return ''
  let n = name.trim().replace(SYMBOLS, '').replace(SUFFIXES, '').trim().toLowerCase()
  return ALIASES[n] || n
}
