// Retail inMotion edition: an internal app installed only on Retail inMotion sites, with no
// Marketplace listing, so there is no licence to check. Every installation is allowed, in every
// Forge environment. The resolvers keep calling licenseAllows so the code stays in step with the
// Marketplace edition.

export function licenseAllows() {
  return true;
}

export const UNLICENSED_MESSAGE = 'Customer Insights is not available on this site.';
