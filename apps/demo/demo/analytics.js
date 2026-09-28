import { inject } from '@vercel/analytics'

// Page views for the hosted demo, through Vercel Web Analytics: no cookies, and the script and
// its reports both go to this site's own origin (`/_vercel/insights/…`), so the CSP needs no
// change. In `npm run dev` it logs to the console instead of reporting. Demo only — the package
// itself carries no analytics.
inject()
