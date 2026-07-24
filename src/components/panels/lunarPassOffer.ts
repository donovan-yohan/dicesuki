import { LUNAR_DAILY_STAR_AMOUNT } from '../../lib/lunarPass'

const LUNAR_PASS_TERM_DAYS = 30
const LUNAR_PASS_PURCHASE_STAR_AMOUNT = 300

/**
 * Locked Lunar Pass offer from the monetization spec §3.1.
 *
 * The monthly total is derived so the offer cannot drift from its two grants.
 */
export const LUNAR_PASS_OFFER = Object.freeze({
  priceUsd: 2.99,
  purchaseStars: LUNAR_PASS_PURCHASE_STAR_AMOUNT,
  dailyStars: LUNAR_DAILY_STAR_AMOUNT,
  monthlyStars:
    LUNAR_PASS_PURCHASE_STAR_AMOUNT +
    (LUNAR_DAILY_STAR_AMOUNT * LUNAR_PASS_TERM_DAYS),
})
