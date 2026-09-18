//! Closing Bell — day-0 feasibility probe.
//!
//! This is NOT the full guard. It exists to answer the SS12 question:
//! can an Anchor program read a Pyth equity price, derive the band, and still
//! have compute budget left for a swap CPI?
//!
//! Every instruction logs compute units around the work so the test harness can
//! report a real number instead of a guess.

use anchor_lang::prelude::*;
use solana_program::log::sol_log_compute_units;
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

declare_id!("DeAF1jFtXTweJnC8x1P5VkzYNcdiqC6EfGiz6uxhi8ig");

/// Pyth shard to pin price accounts to.
///
/// Sponsored price accounts are PDAs of the push-oracle program
/// `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` with seeds `[shard_u16_le, feed_id]`,
/// while the account *owner* is the receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`.
/// Deriving against the receiver finds nothing.
///
/// Shard choice is a correctness issue, not a preference. Measured 2026-09-18 on
/// `Equity.US.AAPL/USD`: shard 0 was 34.5 days stale and priced 305.92 against a true
/// 337.10 — 10% wrong. Shard 1 was 5 seconds old. The same pattern holds on the
/// `Crypto.SOL/USD` control (shard 2 stale by 889 days).
///
/// `create_guarded_market` stores a concrete `price_update` address; this constant records
/// which shard that address must come from, and the keeper asserts freshness on the
/// specific account rather than trusting the derivation.
#[allow(dead_code)]
const PYTH_SHARD: u16 = 1;

/// Band applied while the reference market is open (0.50%).
const BASE_BAND_BPS: u64 = 50;
/// Band applied while the reference market is shut (2.00%).
const CLOSED_BAND_BPS: u64 = 200;
/// Multiplier on the oracle confidence ratio when widening the band.
const CONF_MULTIPLIER_BPS: u64 = 10_000;
/// Reject outright above this confidence ratio — the price is not worth quoting.
const MAX_CONF_RATIO_BPS: u64 = 500;

#[program]
pub mod closing_bell_guard {
    use super::*;

    /// Reads the oracle, derives the band, and reports CU consumption.
    ///
    /// `market_open` is passed in rather than derived. Measured 2026-09-18 at 03:21 ET on
    /// a Friday with NYSE shut, the equity feed was 23 seconds old: staleness and
    /// market-hours are uncorrelated for a 24/5 feed, so the architecture's "two
    /// independent signals" collapses to the keeper clock alone. Staleness is still worth
    /// checking — it catches a dead feed — but it cannot carry market state.
    ///
    /// Note also that `publish_time` can read *ahead* of the on-chain clock (observed up
    /// to 13 s), so age must be allowed to go negative. See docs/day0-findings.md.
    pub fn probe_oracle(
        ctx: Context<ProbeOracle>,
        feed_id_hex: String,
        max_staleness_secs: u64,
        market_open: bool,
    ) -> Result<()> {
        msg!("CU at entry:");
        sol_log_compute_units();

        let feed_id = get_feed_id_from_hex(&feed_id_hex)?;
        let clock = Clock::get()?;

        let price = ctx
            .accounts
            .price_update
            .get_price_no_older_than(&clock, max_staleness_secs, &feed_id)
            .map_err(|_| error!(GuardError::StaleOracle))?;

        msg!("CU after oracle read:");
        sol_log_compute_units();

        // Confidence as a ratio of price, in bps.
        let abs_price = price.price.unsigned_abs();
        require!(abs_price > 0, GuardError::StaleOracle);
        let conf_ratio_bps = (price.conf as u128)
            .checked_mul(10_000)
            .and_then(|v| v.checked_div(abs_price as u128))
            .ok_or(GuardError::StaleOracle)? as u64;

        require!(conf_ratio_bps <= MAX_CONF_RATIO_BPS, GuardError::LowConfidence);

        let base = if market_open { BASE_BAND_BPS } else { CLOSED_BAND_BPS };
        let band_bps = base
            .checked_add(
                conf_ratio_bps
                    .checked_mul(CONF_MULTIPLIER_BPS)
                    .ok_or(GuardError::StaleOracle)?
                    / 10_000,
            )
            .ok_or(GuardError::StaleOracle)?;

        msg!("CU after band math:");
        sol_log_compute_units();

        msg!(
            "price={} conf={} expo={} publish_time={}",
            price.price,
            price.conf,
            price.exponent,
            price.publish_time
        );
        msg!(
            "age_secs={} conf_ratio_bps={} band_bps={} market_open={}",
            clock.unix_timestamp - price.publish_time,
            conf_ratio_bps,
            band_bps,
            market_open
        );

        emit!(BandDerived {
            price: price.price,
            conf: price.conf,
            exponent: price.exponent,
            publish_time: price.publish_time,
            conf_ratio_bps,
            band_bps,
            market_open,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct ProbeOracle<'info> {
    pub price_update: Account<'info, PriceUpdateV2>,
}

#[event]
pub struct BandDerived {
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
    pub conf_ratio_bps: u64,
    pub band_bps: u64,
    pub market_open: bool,
}

#[error_code]
pub enum GuardError {
    #[msg("Execution price outside oracle band")]
    OutsideBand,
    #[msg("Oracle price too stale to act on")]
    StaleOracle,
    #[msg("Market clock stale; refusing to trade")]
    StaleClock,
    #[msg("Size cap exceeded while market is closed")]
    SizeCapExceeded,
    #[msg("Guard or market is paused")]
    Paused,
    #[msg("Confidence interval too wide")]
    LowConfidence,
    #[msg("Pool does not match registered market")]
    PoolMismatch,
}
