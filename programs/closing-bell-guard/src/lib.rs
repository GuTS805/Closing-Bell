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

    /// Instruction 0 of the guarded-fill sandwich. Snapshots balances and the oracle band.
    ///
    /// The guard does not route the swap. It brackets it:
    ///
    ///   ix 0  record_pre_state   snapshot balances + oracle price
    ///   ix 1  any swap           Jupiter, unmodified, real routing, any venue
    ///   ix 2  verify_fill        balance deltas -> realised price -> band check
    ///
    /// Solana's atomicity does the enforcement: if `verify_fill` errors, the swap in ix 1
    /// reverts with it. The guard never moves a token, so Token-2022 extensions
    /// (transfer hooks, permanent delegate, confidential transfer) are irrelevant to it,
    /// and it inherits real aggregated liquidity instead of bootstrapping a pool.
    pub fn record_pre_state(
        ctx: Context<RecordPreState>,
        feed_id_hex: String,
        max_staleness_secs: u64,
        market_open: bool,
        basis_bps: i64,
        base_decimals: u8,
        quote_decimals: u8,
    ) -> Result<()> {
        let feed_id = get_feed_id_from_hex(&feed_id_hex)?;
        let clock = Clock::get()?;

        let price = ctx
            .accounts
            .price_update
            .get_price_no_older_than(&clock, max_staleness_secs, &feed_id)
            .map_err(|_| error!(GuardError::StaleOracle))?;

        let abs_price = price.price.unsigned_abs();
        require!(abs_price > 0, GuardError::StaleOracle);

        let conf_ratio_bps = (price.conf as u128)
            .checked_mul(10_000)
            .and_then(|v| v.checked_div(abs_price as u128))
            .ok_or(GuardError::MathOverflow)? as u64;
        require!(conf_ratio_bps <= MAX_CONF_RATIO_BPS, GuardError::LowConfidence);

        let base = if market_open { BASE_BAND_BPS } else { CLOSED_BAND_BPS };
        let band_bps = base
            .checked_add(conf_ratio_bps.saturating_mul(CONF_MULTIPLIER_BPS) / 10_000)
            .ok_or(GuardError::MathOverflow)?;

        let p = &mut ctx.accounts.pending;
        p.user = ctx.accounts.user.key();
        p.base_mint = Pubkey::default();
        p.quote_mint = Pubkey::default();
        p.base_before = token_amount(&ctx.accounts.base_token_account)?;
        p.quote_before = token_amount(&ctx.accounts.quote_token_account)?;
        p.oracle_price = price.price;
        p.oracle_expo = price.exponent;
        p.base_decimals = base_decimals;
        p.quote_decimals = quote_decimals;
        p.band_bps = band_bps;
        p.basis_bps = basis_bps;
        p.slot = clock.slot;
        p.bump = ctx.bumps.pending;

        msg!(
            "pre: base={} quote={} oracle={} expo={} band={}bps basis={}bps",
            p.base_before,
            p.quote_before,
            p.oracle_price,
            p.oracle_expo,
            p.band_bps,
            p.basis_bps
        );
        Ok(())
    }

    /// Instruction 2 of the guarded-fill sandwich. Reverts the transaction if the fill
    /// that happened in between executed outside the band.
    pub fn verify_fill(ctx: Context<VerifyFill>) -> Result<()> {
        msg!("CU at verify entry:");
        sol_log_compute_units();

        let p = &ctx.accounts.pending;
        let clock = Clock::get()?;
        // Must be the same transaction, not a snapshot replayed later.
        require!(clock.slot == p.slot, GuardError::StaleSnapshot);

        let base_after = token_amount(&ctx.accounts.base_token_account)?;
        let quote_after = token_amount(&ctx.accounts.quote_token_account)?;

        // Buy direction: base increased, quote decreased.
        let base_delta = base_after
            .checked_sub(p.base_before)
            .ok_or(GuardError::NoFillDetected)?;
        let quote_delta = p
            .quote_before
            .checked_sub(quote_after)
            .ok_or(GuardError::NoFillDetected)?;
        require!(base_delta > 0 && quote_delta > 0, GuardError::NoFillDetected);

        // Realised price in quote-raw-units per base-raw-unit, scaled by 1e12.
        const SCALE_EXP: u32 = 12;
        let realised = (quote_delta as u128)
            .checked_mul(pow10(SCALE_EXP)?)
            .ok_or(GuardError::MathOverflow)?
            .checked_div(base_delta as u128)
            .ok_or(GuardError::MathOverflow)?;

        // Oracle price in the same units:
        //   price * 10^expo  (USD per whole base)
        //     * 10^quote_decimals / 10^base_decimals   (to raw units)
        //     * 10^SCALE_EXP
        let net = p.oracle_expo
            + p.quote_decimals as i32
            - p.base_decimals as i32
            + SCALE_EXP as i32;
        let oracle_raw = p.oracle_price.unsigned_abs() as u128;
        let mut expected = if net >= 0 {
            oracle_raw
                .checked_mul(pow10(net as u32)?)
                .ok_or(GuardError::MathOverflow)?
        } else {
            oracle_raw
                .checked_div(pow10((-net) as u32)?)
                .ok_or(GuardError::MathOverflow)?
        };

        // Recenter on what the tokenized asset is worth, not the underlying.
        if p.basis_bps != 0 {
            let adj = 10_000i128
                .checked_add(p.basis_bps as i128)
                .ok_or(GuardError::MathOverflow)?;
            require!(adj > 0, GuardError::MathOverflow);
            expected = expected
                .checked_mul(adj as u128)
                .ok_or(GuardError::MathOverflow)?
                / 10_000u128;
        }
        require!(expected > 0, GuardError::MathOverflow);

        let diff = realised.abs_diff(expected);
        let deviation_bps = diff
            .checked_mul(10_000)
            .ok_or(GuardError::MathOverflow)?
            / expected;

        msg!(
            "fill: base_delta={} quote_delta={} realised={} expected={} deviation={}bps band={}bps",
            base_delta,
            quote_delta,
            realised,
            expected,
            deviation_bps,
            p.band_bps
        );

        msg!("CU after verify:");
        sol_log_compute_units();

        require!(
            deviation_bps <= p.band_bps as u128,
            GuardError::OutsideBand
        );

        emit!(FillVerified {
            user: p.user,
            base_delta,
            quote_delta,
            deviation_bps: deviation_bps as u64,
            band_bps: p.band_bps,
            basis_bps: p.basis_bps,
        });
        Ok(())
    }
}

/// Snapshot taken before the swap, consumed by `verify_fill` in the same transaction.
#[account]
pub struct PendingFill {
    pub user: Pubkey,
    /// Token being acquired (the tokenized equity).
    pub base_mint: Pubkey,
    /// Token being spent (USDC).
    pub quote_mint: Pubkey,
    pub base_before: u64,
    pub quote_before: u64,
    pub oracle_price: i64,
    pub oracle_expo: i32,
    pub base_decimals: u8,
    pub quote_decimals: u8,
    /// Allowed deviation, already widened for confidence and market state.
    pub band_bps: u64,
    /// Keeper-supplied xStock premium over the underlying equity, in bps.
    ///
    /// The band must be centered on what the tokenized asset is actually worth, not on
    /// the underlying. Measured 2026-09-18: SPYx carries a +57 bp structural premium
    /// (`Crypto.SPYX/SPY.RR` = 1.00571) because only authorized participants can arbitrage
    /// redemption 1:1. Centering on the equity feed would systematically block one side of
    /// every SPYx trade.
    ///
    /// This is supplied by the keeper rather than read on-chain because the xStock feeds
    /// are not maintained: `Crypto.*X/USD` was 5.8 days stale and `Crypto.*X/*.RR` ~59 days
    /// stale, on shard 0 only. See docs/day0-findings.md.
    pub basis_bps: i64,
    pub slot: u64,
    pub bump: u8,
}

impl PendingFill {
    pub const LEN: usize = 8 + 32 * 3 + 8 * 2 + 8 + 4 + 1 + 1 + 8 + 8 + 8 + 1;
}

/// Reads the `amount` field of an SPL Token or Token-2022 token account.
///
/// Both programs share the same first 72 bytes (mint, owner, amount), and Token-2022
/// extensions are appended after the base layout, so this is valid for either. Parsing
/// directly avoids taking an `anchor-spl` dependency, which in this toolchain is another
/// version-resolution hazard for no gain — nothing here needs to move tokens.
fn token_amount(acc: &AccountInfo) -> Result<u64> {
    require!(
        acc.owner == &TOKEN_PROGRAM_ID || acc.owner == &TOKEN_2022_PROGRAM_ID,
        GuardError::NotATokenAccount
    );
    let data = acc.try_borrow_data()?;
    require!(data.len() >= 72, GuardError::NotATokenAccount);
    Ok(u64::from_le_bytes(
        data[64..72].try_into().map_err(|_| error!(GuardError::NotATokenAccount))?,
    ))
}

/// `10^exp` as u128, for the decimal reconciliation in `verify_fill`.
fn pow10(exp: u32) -> Result<u128> {
    10u128.checked_pow(exp).ok_or(error!(GuardError::MathOverflow))
}

pub const TOKEN_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

#[derive(Accounts)]
pub struct ProbeOracle<'info> {
    pub price_update: Account<'info, PriceUpdateV2>,
}

#[derive(Accounts)]
pub struct RecordPreState<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init_if_needed,
        payer = user,
        space = PendingFill::LEN,
        seeds = [b"pending", user.key().as_ref(), base_token_account.key().as_ref()],
        bump
    )]
    pub pending: Account<'info, PendingFill>,
    pub price_update: Account<'info, PriceUpdateV2>,
    /// CHECK: parsed as a token account; ownership is asserted in `token_amount`.
    pub base_token_account: AccountInfo<'info>,
    /// CHECK: parsed as a token account; ownership is asserted in `token_amount`.
    pub quote_token_account: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifyFill<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        close = user,
        has_one = user,
        seeds = [b"pending", user.key().as_ref(), base_token_account.key().as_ref()],
        bump = pending.bump
    )]
    pub pending: Account<'info, PendingFill>,
    /// CHECK: parsed as a token account; ownership is asserted in `token_amount`.
    pub base_token_account: AccountInfo<'info>,
    /// CHECK: parsed as a token account; ownership is asserted in `token_amount`.
    pub quote_token_account: AccountInfo<'info>,
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

#[event]
pub struct FillVerified {
    pub user: Pubkey,
    pub base_delta: u64,
    pub quote_delta: u64,
    pub deviation_bps: u64,
    pub band_bps: u64,
    pub basis_bps: i64,
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
    #[msg("Account is not an SPL Token or Token-2022 token account")]
    NotATokenAccount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Snapshot is from an earlier slot; record and verify must share a transaction")]
    StaleSnapshot,
    #[msg("No fill detected between snapshot and verification")]
    NoFillDetected,
}
