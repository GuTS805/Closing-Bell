"use client";

/**
 * Read-only wallet context. No transaction is ever sent through this connection — it
 * exists so useWallet() can hand the position page a public key, nothing more.
 */
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

const RPC = process.env.NEXT_PUBLIC_MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";

export default function WalletContextProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC}>
      {/* No adapter list: every current wallet (Phantom, Solflare, Backpack, ...) registers
          itself via the Wallet Standard, so nothing needs to be imported per-wallet here. */}
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
