//! Closing Bell — oracle-banded execution guard for tokenized equities.
//!
//! The guard does not route swaps. It brackets one inside a single transaction:
//!
//!   ix 0  record_pre_state   snapshot balances + oracle price + band into a PDA
//!   ix 1  any swap           Jupiter, unmodified, real routing, any venue
//!   ix 2  verify_fill        balance deltas -> realised price -> band check -> revert
//!
//! Solana's atomicity does the enforcement. The guard never moves a token, so Token-2022
//! extensions (transfer hook, permanent delegate, confidential transfer) cannot affect it,
//! and it inherits real aggregated liquidity rather than needing a pool of its own.

use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};
use solana_program::log::sol_log_compute_units;

declare_id!("DeAF1jFtXTweJnC8x1P5VkzYNcdiqC6EfGiz6uxhi8ig");

pub const TOKEN_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Pyth shard to pin price accounts to.
///
/// Sponsored price accounts are PDAs of the push-oracle program
/// `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` with seeds `[shard_u16_le, feed_id]`,
/// while the account *owner* is the receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`.
/// Deriving against the receiver finds nothing.
///
/// Shard choice is a correctness issue. Measured 2026-09-18 on `Equity.US.AAPL/USD`:
/// shard 0 was 34.5 days stale at 305.92 against a true 337.10 — 10% wrong. Shard 1 was
/// 5 seconds old.
pub const PYTH_SHARD: u16 = 1;

// ---------------------------------------------------------------------------
// Bounds on the one off-chain input.
// ---------------------------------------------------------------------------

/// Hard ceiling on the keeper-supplied basis, in bps.
///
/// `basis_bps` moves the band *centre*, so an unbounded keeper could authorize a fill at
/// any price while the band check still passes — that would be off-chain anchoring wearing
/// an on-chain costume. Measured redemption premiums are +57 bp (SPYx) and +27 bp
/// (AAPLx, QQQx), so 300 bp is generous by a factor of five. A rogue keeper can shade the
/// centre slightly; it cannot authorize an arbitrary fill.
pub const MAX_BASIS_BPS: i64 = 300;

/// Maximum basis movement, in bps per minute.
///
/// A structural redemption premium moves slowly. A jump is a bug or an attack.
pub const MAX_BASIS_DRIFT_BPS_PER_MIN: i64 = 10;

/// Beyond this age the basis is not trusted.
pub const BASIS_MAX_AGE_SECS: i64 = 3_600;

/// Extra band width applied when the basis is too stale to use.
///
/// Falling back to a zero basis mis-centres the band by up to the true premium, so widen
/// rather than pretend the centre is exact.
pub const STALE_BASIS_EXTRA_BPS: u64 = 100;

/// Beyond this age the market clock is not trusted, and the market is treated as closed.
pub const CLOCK_MAX_AGE_SECS: i64 = 600;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct GuardConfig {
    pub authority: Pubkey,
    pub keeper: Pubkey,
    /// Allowed deviation while the reference market is open.
    pub base_band_bps: u16,
    /// Allowed deviation while the reference market is shut.
    pub closed_band_bps: u16,
    /// Widen the band by `k * (conf / price)`.
    pub conf_multiplier_bps: u16,
    /// Reject outright above this confidence ratio.
    pub max_conf_ratio_bps: u16,
    pub max_staleness_secs: u32,
    pub paused: bool,
    pub bump: u8,
}

impl GuardConfig {
    pub const LEN: usize = 8 + 32 + 32 + 2 + 2 + 2 + 2 + 4 + 1 + 1;
}

#[account]
pub struct GuardedMarket {
    /// The tokenized equity being traded.
    pub base_mint: Pubkey,
    /// What it trades against (USDC).
    pub quote_mint: Pubkey,
    /// Pinned Pyth account — must be the `PYTH_SHARD` account for `feed_id`.
    pub price_update: Pubkey,
    pub feed_id: [u8; 32],
    pub base_decimals: u8,
    pub quote_decimals: u8,
    /// 0 = inherit the band from `GuardConfig`.
    pub band_override_bps: u16,

    /// Keeper-supplied xStock premium over the underlying equity, in bps.
    ///
    /// The band must be centred on what the tokenized asset is worth, not on the
    /// underlying. Measured 2026-09-18, every xStock carries one, because only authorized
    /// participants can arbitrage redemption 1:1: SPYx +57 bp, QQQx/AAPLx +27 bp,
    /// GOOGLx +19 bp, NVDAx +9 bp. Centring on the equity feed would systematically block
    /// one side of every trade.
    ///
    /// It is keeper-supplied rather than read on-chain because the source feeds are not
    /// maintained — `Crypto.*X/USD` was 5.8 days stale and `Crypto.*X/*.RR` ~59 days
    /// stale, shard 0 only. Bounded by `MAX_BASIS_BPS` and `MAX_BASIS_DRIFT_BPS_PER_MIN`,
    /// and aged out by `BASIS_MAX_AGE_SECS`.
    pub basis_bps: i64,
    pub basis_updated_at: i64,

    pub paused: bool,
    pub fills_allowed: u64,
    pub fills_blocked: u64,
    pub bump: u8,
}

impl GuardedMarket {
    pub const LEN: usize =
        8 + 32 + 32 + 32 + 32 + 1 + 1 + 2 + 8 + 8 + 1 + 8 + 8 + 1;
}

#[account]
pub struct MarketClock {
    pub is_open: bool,
    /// 0 closed, 1 pre, 2 regular, 3 post.
    pub session: u8,
    pub next_transition_ts: i64,
    pub updated_at: i64,
    pub holiday_flag: bool,
    pub bump: u8,
}

impl MarketClock {
    pub const LEN: usize = 8 + 1 + 1 + 8 + 8 + 1 + 1;
}

/// Snapshot taken before the swap, consumed by `verify_fill` in the same transaction.
///
/// Created with `init` (not `init_if_needed`) and closed by `verify_fill`, so a snapshot
/// cannot be reused: a second `record_pre_state` for the same (user, base account) fails
/// while one is outstanding. Slot equality is then belt-and-braces rather than the only
/// protection — necessary because several transactions share a slot.
#[account]
pub struct PendingFill {
    pub user: Pubkey,
    pub market: Pubkey,
    pub base_before: u64,
    pub quote_before: u64,
    pub oracle_price: i64,
    pub oracle_expo: i32,
    pub base_decimals: u8,
    pub quote_decimals: u8,
    pub band_bps: u64,
    pub basis_bps: i64,
    pub slot: u64,
    pub bump: u8,
}

impl PendingFill {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 4 + 1 + 1 + 8 + 8 + 8 + 1;
}

// ---------------------------------------------------------------------------
// Token account parsing
// ---------------------------------------------------------------------------

/// The parts of an SPL Token / Token-2022 account the guard needs.
///
/// Both programs share the same first 72 bytes — mint, owner, amount — and Token-2022
/// appends extensions after the base layout, so this is valid for either. Parsing directly
/// avoids an `anchor-spl` dependency, which in this toolchain is another version hazard
/// for no gain: nothing here moves tokens.
struct TokenAccountView {
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
}

fn read_token_account(acc: &AccountInfo) -> Result<TokenAccountView> {
    require!(
        acc.owner == &TOKEN_PROGRAM_ID || acc.owner == &TOKEN_2022_PROGRAM_ID,
        GuardError::NotATokenAccount
    );
    let data = acc.try_borrow_data()?;
    require!(data.len() >= 72, GuardError::NotATokenAccount);
    Ok(TokenAccountView {
        mint: Pubkey::try_from(&data[0..32]).map_err(|_| error!(GuardError::NotATokenAccount))?,
        owner: Pubkey::try_from(&data[32..64]).map_err(|_| error!(GuardError::NotATokenAccount))?,
        amount: u64::from_le_bytes(
            data[64..72].try_into().map_err(|_| error!(GuardError::NotATokenAccount))?,
        ),
    })
}

/// Binds a token account to the registered market and to the signing user.
///
/// Without this the guard is theatre: a user could point it at accounts of their choosing
/// and the deltas would describe something other than the trade being checked.
fn bind_token_account(
    acc: &AccountInfo,
    expected_mint: &Pubkey,
    expected_owner: &Pubkey,
) -> Result<u64> {
    let view = read_token_account(acc)?;
    require_keys_eq!(view.mint, *expected_mint, GuardError::TokenAccountMintMismatch);
    require_keys_eq!(view.owner, *expected_owner, GuardError::TokenAccountOwnerMismatch);
    Ok(view.amount)
}

fn pow10(exp: u32) -> Result<u128> {
    10u128.checked_pow(exp).ok_or(error!(GuardError::MathOverflow))
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

#[program]
pub mod closing_bell_guard {
    use super::*;

    pub fn initialize_guard_config(
        ctx: Context<InitializeGuardConfig>,
        keeper: Pubkey,
        base_band_bps: u16,
        closed_band_bps: u16,
        conf_multiplier_bps: u16,
        max_conf_ratio_bps: u16,
        max_staleness_secs: u32,
    ) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.keeper = keeper;
        c.base_band_bps = base_band_bps;
        c.closed_band_bps = closed_band_bps;
        c.conf_multiplier_bps = conf_multiplier_bps;
        c.max_conf_ratio_bps = max_conf_ratio_bps;
        c.max_staleness_secs = max_staleness_secs;
        c.paused = false;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn create_guarded_market(
        ctx: Context<CreateGuardedMarket>,
        feed_id_hex: String,
        base_decimals: u8,
        quote_decimals: u8,
        band_override_bps: u16,
    ) -> Result<()> {
        let feed_id = get_feed_id_from_hex(&feed_id_hex)?;

        // The pinned account must actually carry this feed, or shard pinning means nothing.
        //
        // Compared directly rather than via `get_price_no_older_than`: registration should
        // not fail because the feed happens to be stale right now, and passing `u64::MAX`
        // as the max age panics inside the SDK on `publish_time + max_age`.
        require!(
            ctx.accounts.price_update.price_message.feed_id == feed_id,
            GuardError::FeedIdMismatch
        );

        let m = &mut ctx.accounts.market;
        m.base_mint = ctx.accounts.base_mint.key();
        m.quote_mint = ctx.accounts.quote_mint.key();
        m.price_update = ctx.accounts.price_update.key();
        m.feed_id = feed_id;
        m.base_decimals = base_decimals;
        m.quote_decimals = quote_decimals;
        m.band_override_bps = band_override_bps;
        m.basis_bps = 0;
        m.basis_updated_at = 0;
        m.paused = false;
        m.fills_allowed = 0;
        m.fills_blocked = 0;
        m.bump = ctx.bumps.market;
        Ok(())
    }

    pub fn update_market_clock(
        ctx: Context<UpdateMarketClock>,
        is_open: bool,
        session: u8,
        next_transition_ts: i64,
        holiday_flag: bool,
    ) -> Result<()> {
        let c = &mut ctx.accounts.clock_account;
        c.is_open = is_open;
        c.session = session;
        c.next_transition_ts = next_transition_ts;
        c.holiday_flag = holiday_flag;
        c.updated_at = Clock::get()?.unix_timestamp;
        c.bump = ctx.bumps.clock_account;
        Ok(())
    }

    /// Keeper pushes the redemption basis, under in-program bounds.
    ///
    /// Three constraints, all enforced here rather than trusted:
    ///   1. absolute ceiling      `MAX_BASIS_BPS`
    ///   2. rate limit            `MAX_BASIS_DRIFT_BPS_PER_MIN`
    ///   3. ageing                consumers apply `BASIS_MAX_AGE_SECS`
    pub fn update_basis(ctx: Context<UpdateBasis>, new_basis_bps: i64) -> Result<()> {
        require!(
            new_basis_bps.abs() <= MAX_BASIS_BPS,
            GuardError::BasisOutOfBounds
        );

        let now = Clock::get()?.unix_timestamp;
        let m = &mut ctx.accounts.market;

        // Rate-limit movement, but only against a basis we still trust.
        if m.basis_updated_at > 0 && now.saturating_sub(m.basis_updated_at) <= BASIS_MAX_AGE_SECS {
            let elapsed_secs = now.saturating_sub(m.basis_updated_at).max(1);
            // Allow at least one minute's worth so a prompt correction is not blocked.
            let allowed = MAX_BASIS_DRIFT_BPS_PER_MIN
                .saturating_mul(elapsed_secs)
                .saturating_div(60)
                .max(MAX_BASIS_DRIFT_BPS_PER_MIN);
            let delta = new_basis_bps.saturating_sub(m.basis_bps).abs();
            require!(delta <= allowed, GuardError::BasisDriftTooLarge);
        }

        m.basis_bps = new_basis_bps;
        m.basis_updated_at = now;
        msg!("basis={}bps at {}", new_basis_bps, now);
        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    /// Instruction 0 of the guarded-fill sandwich.
    pub fn record_pre_state(ctx: Context<RecordPreState>) -> Result<()> {
        let config = &ctx.accounts.config;
        let market = &ctx.accounts.market;
        require!(!config.paused && !market.paused, GuardError::Paused);

        let clock = Clock::get()?;

        let price = ctx
            .accounts
            .price_update
            .get_price_no_older_than(
                &clock,
                config.max_staleness_secs as u64,
                &market.feed_id,
            )
            .map_err(|_| error!(GuardError::StaleOracle))?;

        let abs_price = price.price.unsigned_abs();
        require!(abs_price > 0, GuardError::StaleOracle);

        let conf_ratio_bps = (price.conf as u128)
            .checked_mul(10_000)
            .and_then(|v| v.checked_div(abs_price as u128))
            .ok_or(GuardError::MathOverflow)? as u64;
        require!(
            conf_ratio_bps <= config.max_conf_ratio_bps as u64,
            GuardError::LowConfidence
        );

        // Market state comes from the keeper clock alone. Oracle staleness cannot carry it:
        // measured 2026-09-18 at 03:21 ET with NYSE shut, the equity feed was 23 s old.
        // A stale clock fails closed.
        let clock_acct = &ctx.accounts.clock_account;
        let clock_fresh =
            clock.unix_timestamp.saturating_sub(clock_acct.updated_at) <= CLOCK_MAX_AGE_SECS;
        let market_open = clock_acct.is_open && clock_fresh && !clock_acct.holiday_flag;

        let base_band = if market.band_override_bps > 0 {
            market.band_override_bps as u64
        } else if market_open {
            config.base_band_bps as u64
        } else {
            config.closed_band_bps as u64
        };

        // Age the basis rather than trusting an old number.
        let basis_fresh = market.basis_updated_at > 0
            && clock.unix_timestamp.saturating_sub(market.basis_updated_at) <= BASIS_MAX_AGE_SECS;
        let (basis_bps, stale_basis_widening) = if basis_fresh {
            (market.basis_bps, 0)
        } else {
            (0, STALE_BASIS_EXTRA_BPS)
        };

        let band_bps = base_band
            .checked_add(conf_ratio_bps.saturating_mul(config.conf_multiplier_bps as u64) / 10_000)
            .and_then(|v| v.checked_add(stale_basis_widening))
            .ok_or(GuardError::MathOverflow)?;

        // Bind both token accounts to the registered market and the signing user.
        let base_before = bind_token_account(
            &ctx.accounts.base_token_account,
            &market.base_mint,
            &ctx.accounts.user.key(),
        )?;
        let quote_before = bind_token_account(
            &ctx.accounts.quote_token_account,
            &market.quote_mint,
            &ctx.accounts.user.key(),
        )?;

        let p = &mut ctx.accounts.pending;
        p.user = ctx.accounts.user.key();
        p.market = market.key();
        p.base_before = base_before;
        p.quote_before = quote_before;
        p.oracle_price = price.price;
        p.oracle_expo = price.exponent;
        p.base_decimals = market.base_decimals;
        p.quote_decimals = market.quote_decimals;
        p.band_bps = band_bps;
        p.basis_bps = basis_bps;
        p.slot = clock.slot;
        p.bump = ctx.bumps.pending;

        msg!(
            "pre: base={} quote={} oracle={} expo={} band={}bps basis={}bps open={}",
            base_before,
            quote_before,
            price.price,
            price.exponent,
            band_bps,
            basis_bps,
            market_open
        );
        Ok(())
    }

    /// Instruction 2 of the guarded-fill sandwich.
    ///
    /// Handles both directions. Price is `quote_delta / base_delta` either way; the band is
    /// applied symmetrically, so a buy too far above and a sell too far below both revert.
    ///
    /// Known property: this observes *net* balance change. Two swaps in one transaction,
    /// one out of band and one offsetting, net to whatever the user actually received, and
    /// that net is what gets checked. That is the economically meaningful quantity, but it
    /// is stated here so nobody discovers it as a surprise.
    pub fn verify_fill(ctx: Context<VerifyFill>) -> Result<()> {
        msg!("CU at verify entry:");
        sol_log_compute_units();

        let p = &ctx.accounts.pending;
        let market = &ctx.accounts.market;
        let clock = Clock::get()?;
        require!(clock.slot == p.slot, GuardError::StaleSnapshot);

        let base_after = bind_token_account(
            &ctx.accounts.base_token_account,
            &market.base_mint,
            &p.user,
        )?;
        let quote_after = bind_token_account(
            &ctx.accounts.quote_token_account,
            &market.quote_mint,
            &p.user,
        )?;

        let (base_delta, quote_delta, is_buy) = if base_after > p.base_before
            && p.quote_before > quote_after
        {
            (base_after - p.base_before, p.quote_before - quote_after, true)
        } else if p.base_before > base_after && quote_after > p.quote_before {
            (p.base_before - base_after, quote_after - p.quote_before, false)
        } else {
            // Covers the zero-delta case (snapshot, no swap, verify): the implied price is
            // undefined, so this errors rather than dividing by zero or passing trivially.
            return Err(error!(GuardError::NoFillDetected));
        };
        require!(base_delta > 0 && quote_delta > 0, GuardError::NoFillDetected);

        // Realised price in quote-raw-units per base-raw-unit, scaled by 1e12.
        const SCALE_EXP: u32 = 12;
        let realised = (quote_delta as u128)
            .checked_mul(pow10(SCALE_EXP)?)
            .ok_or(GuardError::MathOverflow)?
            .checked_div(base_delta as u128)
            .ok_or(GuardError::MathOverflow)?;

        // Oracle price in the same units.
        let net = p.oracle_expo + p.quote_decimals as i32 - p.base_decimals as i32
            + SCALE_EXP as i32;
        let oracle_raw = p.oracle_price.unsigned_abs() as u128;
        let mut expected = if net >= 0 {
            oracle_raw.checked_mul(pow10(net as u32)?).ok_or(GuardError::MathOverflow)?
        } else {
            oracle_raw.checked_div(pow10((-net) as u32)?).ok_or(GuardError::MathOverflow)?
        };

        // Recentre on what the tokenized asset is worth, not the underlying.
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

        let deviation_bps = realised
            .abs_diff(expected)
            .checked_mul(10_000)
            .ok_or(GuardError::MathOverflow)?
            / expected;

        msg!(
            "fill: {} base_delta={} quote_delta={} realised={} expected={} deviation={}bps band={}bps",
            if is_buy { "BUY" } else { "SELL" },
            base_delta,
            quote_delta,
            realised,
            expected,
            deviation_bps,
            p.band_bps
        );

        msg!("CU after verify:");
        sol_log_compute_units();

        let within = deviation_bps <= p.band_bps as u128;
        let m = &mut ctx.accounts.market;
        if within {
            m.fills_allowed = m.fills_allowed.saturating_add(1);
        } else {
            // Counter never persists on the reject path — the transaction reverts — but it
            // is kept so a future non-reverting advisory mode can use the same code.
            m.fills_blocked = m.fills_blocked.saturating_add(1);
        }
        require!(within, GuardError::OutsideBand);

        emit!(FillVerified {
            user: p.user,
            market: p.market,
            is_buy,
            base_delta,
            quote_delta,
            deviation_bps: deviation_bps as u64,
            band_bps: p.band_bps,
            basis_bps: p.basis_bps,
        });
        Ok(())
    }

    /// Standalone oracle read, kept for CU measurement (`scripts/day0-feasibility.ts`).
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

        let abs_price = price.price.unsigned_abs();
        require!(abs_price > 0, GuardError::StaleOracle);
        let conf_ratio_bps = (price.conf as u128)
            .checked_mul(10_000)
            .and_then(|v| v.checked_div(abs_price as u128))
            .ok_or(GuardError::MathOverflow)? as u64;

        let base = if market_open { 50 } else { 200 };
        let band_bps = base + conf_ratio_bps;

        msg!("CU after band math:");
        sol_log_compute_units();
        msg!(
            "price={} conf={} expo={} publish_time={} age_secs={} band_bps={}",
            price.price,
            price.conf,
            price.exponent,
            price.publish_time,
            clock.unix_timestamp - price.publish_time,
            band_bps
        );
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeGuardConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = GuardConfig::LEN, seeds = [b"config"], bump)]
    pub config: Account<'info, GuardConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateGuardedMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GuardConfig>,
    #[account(
        init,
        payer = authority,
        space = GuardedMarket::LEN,
        seeds = [b"market", base_mint.key().as_ref()],
        bump
    )]
    pub market: Account<'info, GuardedMarket>,
    /// CHECK: recorded as the market's base mint; never deserialized.
    pub base_mint: AccountInfo<'info>,
    /// CHECK: recorded as the market's quote mint; never deserialized.
    pub quote_mint: AccountInfo<'info>,
    pub price_update: Account<'info, PriceUpdateV2>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMarketClock<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, constraint = config.keeper == keeper.key() @ GuardError::NotKeeper)]
    pub config: Account<'info, GuardConfig>,
    #[account(
        init_if_needed,
        payer = keeper,
        space = MarketClock::LEN,
        seeds = [b"clock"],
        bump
    )]
    pub clock_account: Account<'info, MarketClock>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateBasis<'info> {
    pub keeper: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, constraint = config.keeper == keeper.key() @ GuardError::NotKeeper)]
    pub config: Account<'info, GuardConfig>,
    #[account(mut, seeds = [b"market", market.base_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, GuardedMarket>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GuardConfig>,
}

#[derive(Accounts)]
pub struct RecordPreState<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    /// `init`, not `init_if_needed`: an outstanding snapshot makes a second one impossible.
    #[account(
        init,
        payer = user,
        space = PendingFill::LEN,
        seeds = [b"pending", user.key().as_ref(), market.key().as_ref()],
        bump
    )]
    pub pending: Account<'info, PendingFill>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GuardConfig>,
    #[account(seeds = [b"market", market.base_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, GuardedMarket>,
    #[account(seeds = [b"clock"], bump = clock_account.bump)]
    pub clock_account: Account<'info, MarketClock>,
    #[account(address = market.price_update @ GuardError::PriceAccountMismatch)]
    pub price_update: Account<'info, PriceUpdateV2>,
    /// CHECK: bound to market.base_mint and to `user` in `bind_token_account`.
    pub base_token_account: AccountInfo<'info>,
    /// CHECK: bound to market.quote_mint and to `user` in `bind_token_account`.
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
        has_one = market,
        seeds = [b"pending", user.key().as_ref(), market.key().as_ref()],
        bump = pending.bump
    )]
    pub pending: Account<'info, PendingFill>,
    #[account(mut, seeds = [b"market", market.base_mint.as_ref()], bump = market.bump)]
    pub market: Account<'info, GuardedMarket>,
    /// CHECK: bound to market.base_mint and to the snapshot's user.
    pub base_token_account: AccountInfo<'info>,
    /// CHECK: bound to market.quote_mint and to the snapshot's user.
    pub quote_token_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ProbeOracle<'info> {
    pub price_update: Account<'info, PriceUpdateV2>,
}

// ---------------------------------------------------------------------------

#[event]
pub struct FillVerified {
    pub user: Pubkey,
    pub market: Pubkey,
    pub is_buy: bool,
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
    #[msg("Token account mint does not match the registered market")]
    TokenAccountMintMismatch,
    #[msg("Token account is not owned by the signing user")]
    TokenAccountOwnerMismatch,
    #[msg("Price account does not match the one pinned for this market")]
    PriceAccountMismatch,
    #[msg("Price account does not carry the expected feed id")]
    FeedIdMismatch,
    #[msg("Basis exceeds the in-program ceiling")]
    BasisOutOfBounds,
    #[msg("Basis moved faster than the permitted rate")]
    BasisDriftTooLarge,
    #[msg("Caller is not the configured keeper")]
    NotKeeper,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Snapshot is from an earlier slot; record and verify must share a transaction")]
    StaleSnapshot,
    #[msg("No fill detected between snapshot and verification")]
    NoFillDetected,
}
